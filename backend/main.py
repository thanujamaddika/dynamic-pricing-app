from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from PIL import Image
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest
from sse_starlette.sse import EventSourceResponse
from tinydb import TinyDB, Query
from datetime import datetime
import numpy as np
import os, uuid, base64, json, requests, random, time, io, re
from bs4 import BeautifulSoup
import asyncio
from concurrent.futures import ThreadPoolExecutor
import uuid as uuid_lib
import datetime as dt

executor = ThreadPoolExecutor(max_workers=5)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY environment variable is missing")
client = Groq(api_key=GROQ_API_KEY)

# Price history database
db = TinyDB("price_history.json")
prices_table = db.table("prices")
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
]

def get_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }

def validate_image(contents: bytes) -> dict:
    try:
        img = Image.open(io.BytesIO(contents))
        img.verify()
        img = Image.open(io.BytesIO(contents))
        width, height = img.size
        return {"valid": True, "width": width, "height": height, "format": img.format, "mode": img.mode}
    except Exception as e:
        return {"valid": False, "error": str(e)}

# ── Price sanity filter: drop results that are clearly wrong category ──
CATEGORY_PRICE_FLOORS = {
    "laptop": 15000,
    "mobile": 3000,
    "phone": 3000,
    "smartphone": 3000,
    "tablet": 5000,
    "tv": 5000,
    "television": 5000,
    "refrigerator": 8000,
    "washing machine": 8000,
    "air conditioner": 15000,
    "camera": 3000,
    "headphone": 200,
    "earphone": 100,
    "watch": 200,
    "keyboard": 200,
    "mouse": 100,
    "monitor": 3000,
    "surface": 15000,
    "macbook": 50000,
    "iphone": 30000,
    "ipad": 20000,
}

def get_price_floor(query: str) -> float:
    q = query.lower()
    for keyword, floor in CATEGORY_PRICE_FLOORS.items():
        if keyword in q:
            return float(floor)
    return 50.0  # default minimum for unknown products

def analyze_prices_ml(prices: list) -> dict:
    if not prices:
        return {}
    if len(prices) < 2:
        return {
            "lowest": round(prices[0], 2), "highest": round(prices[0], 2),
            "average": round(prices[0], 2), "recommended": round(prices[0] * 1.05, 2),
            "total_sources": 1, "outliers_removed": 0,
            "clusters": [{"tier": "Budget", "center_price": round(prices[0], 2)}],
            "strategy": "Competitive Pricing"
        }
    prices_array = np.array(prices).reshape(-1, 1)
    iso = IsolationForest(contamination=0.1, random_state=42)
    outlier_labels = iso.fit_predict(prices_array)
    clean_prices = [p for p, label in zip(prices, outlier_labels) if label == 1]
    outliers_removed = len(prices) - len(clean_prices)
    if not clean_prices:
        clean_prices = prices
    n_clusters = min(3, len(clean_prices))
    clean_array = np.array(clean_prices).reshape(-1, 1)
    kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
    kmeans.fit(clean_array)
    centers = sorted([float(c[0]) for c in kmeans.cluster_centers_])
    cluster_labels = ["Budget", "Mid-range", "Premium"]
    clusters = [{"tier": cluster_labels[i], "center_price": round(centers[i], 2)} for i in range(len(centers))]
    lowest = round(min(clean_prices), 2)
    highest = round(max(clean_prices), 2)
    average = round(sum(clean_prices) / len(clean_prices), 2)
    recommended = round(centers[0] * 1.05, 2)
    if recommended < average * 0.9:
        strategy = "Penetration Pricing"
    elif recommended > average * 1.1:
        strategy = "Premium Pricing"
    else:
        strategy = "Competitive Pricing"
    return {
        "lowest": lowest, "highest": highest, "average": average,
        "recommended": recommended, "total_sources": len(prices),
        "outliers_removed": outliers_removed, "clusters": clusters, "strategy": strategy
    }

# ── Amazon ──
def scrape_amazon(query):
    try:
        time.sleep(random.uniform(1, 2))
        url = f"https://www.amazon.in/s?k={query.replace(' ', '+')}"
        res = requests.get(url, headers=get_headers(), timeout=10)
        soup = BeautifulSoup(res.text, "html.parser")
        results = []
        items = soup.select("div[data-component-type='s-search-result']")[:6]
        for item in items:
            price_el = item.select_one(".a-price .a-offscreen")
            if not price_el:
                continue
            price_text = price_el.text.strip().replace("₹", "").replace(",", "")
            try:
                price = float(price_text)
            except ValueError:
                continue
            title = ""
            link_el = item.select_one("h2 a")
            if link_el:
                title = (link_el.get("title") or link_el.get("aria-label") or "").strip()
            if not title:
                span_el = item.select_one("h2 span")
                if span_el:
                    title = span_el.get_text(" ", strip=True)
            if len(title) < 10:
                continue
            product_url = ("https://www.amazon.in" + link_el["href"]) if link_el and link_el.get("href") else url
            results.append({
                "site": "Amazon", "title": title[:80], "price": price,
                "currency": "INR", "url": product_url, "logo": "🛒", "status": "success"
            })
            if len(results) == 3:
                break
        return results
    except Exception as e:
        print(f"Amazon error: {e}")
        return []

# ── Snapdeal (FIXED) ──
def scrape_snapdeal(query):
    try:
        from playwright.sync_api import sync_playwright
        url = f"https://www.snapdeal.com/search?keyword={query.replace(' ', '%20')}&sort=rlvncy"
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
            )
            context = browser.new_context(
                user_agent=random.choice(USER_AGENTS),
                viewport={"width": 1366, "height": 768},
                locale="en-IN",
                extra_http_headers={
                    "Accept-Language": "en-IN,en;q=0.9",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Referer": "https://www.snapdeal.com/",
                }
            )
            page = context.new_page()
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            page.goto(url, timeout=40000, wait_until="domcontentloaded")
            # Wait for product grid
            try:
                page.wait_for_selector(
                    "div.product-tuple-listing, div.col-xs-6, div[class*='product']",
                    timeout=12000
                )
            except Exception:
                pass
            page.wait_for_timeout(4000)
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(2000)
            html = page.content()
            browser.close()

        soup = BeautifulSoup(html, "html.parser")
        results = []

        # Strategy 1: standard product-tuple cards
        items = soup.select("div.product-tuple-listing")[:8]
        for item in items:
            title_el = item.select_one("p.product-title")
            price_el = (
                item.select_one("span.lfloat.product-price") or
                item.select_one("span.product-price") or
                item.select_one(".product-price")
            )
            link_el = item.select_one("a.dp-widget-link") or item.select_one("a[href*='snapdeal.com/product']")
            if not title_el or not price_el:
                continue
            price_text = price_el.text.strip().replace("Rs.", "").replace("₹", "").replace(",", "").strip()
            try:
                price = float(re.sub(r'[^\d.]', '', price_text))
                if price < 100:
                    continue
            except:
                continue
            href = link_el.get("href", "") if link_el else ""
            results.append({
                "site": "Snapdeal", "title": title_el.text.strip()[:80],
                "price": price, "currency": "INR",
                "url": href or url, "logo": "🟡", "status": "success"
            })
            if len(results) == 3:
                break

        # Strategy 2: JSON catalog data embedded in page
        if not results:
            catalog_match = re.search(r'catalogList\s*=\s*(\[.*?\]);', html, re.DOTALL)
            if catalog_match:
                try:
                    catalog = json.loads(catalog_match.group(1))
                    for item in catalog[:5]:
                        price = float(str(item.get("sellingPrice", item.get("price", 0))).replace(",", ""))
                        title = item.get("title", item.get("name", ""))
                        link = item.get("productUrl", url)
                        if price >= 100 and len(title) >= 5:
                            results.append({
                                "site": "Snapdeal", "title": title[:80],
                                "price": price, "currency": "INR",
                                "url": link, "logo": "🟡", "status": "success"
                            })
                        if len(results) == 3:
                            break
                except Exception:
                    pass

        # Strategy 3: regex fallback
        if not results:
            prices_raw = re.findall(r'(?:Rs\.|₹)\s*([\d,]+)', html)
            titles_raw = re.findall(r'class="product-title"[^>]*>\s*([^<]{10,80})\s*<', html)
            seen = set()
            for i in range(min(6, len(titles_raw), len(prices_raw))):
                try:
                    price = float(prices_raw[i].replace(",", ""))
                    title = titles_raw[i].strip()
                    key = f"{title[:20]}_{price}"
                    if price < 100 or key in seen:
                        continue
                    seen.add(key)
                    results.append({
                        "site": "Snapdeal", "title": title[:80],
                        "price": price, "currency": "INR",
                        "url": url, "logo": "🟡", "status": "success"
                    })
                    if len(results) == 3:
                        break
                except:
                    continue

        return results
    except Exception as e:
        print(f"Snapdeal error: {e}")
        return []

# ── Flipkart ──
def scrape_flipkart(query):
    try:
        from playwright.sync_api import sync_playwright
        url = f"https://www.flipkart.com/search?q={query.replace(' ', '+')}"
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page(user_agent=random.choice(USER_AGENTS))
            page.goto(url, timeout=30000)
            page.wait_for_timeout(5000)
            html = page.content()
            browser.close()
        soup = BeautifulSoup(html, "html.parser")
        results = []
        seen_urls = set()
        for a_tag in soup.select("a[href*='/p/']"):
            href = a_tag.get("href", "")
            if href in seen_urls:
                continue
            title_candidates = [
                el.get_text(" ", strip=True)
                for el in a_tag.select("div, span")
                if len(el.get_text(strip=True)) > 15
            ]
            if not title_candidates:
                raw = a_tag.get_text(" ", strip=True)
                if len(raw) > 15:
                    title_candidates = [raw]
            if not title_candidates:
                continue
            title = max(title_candidates, key=len)[:80]
            card_text = a_tag.get_text()
            price_matches = re.findall(r'₹\s*([\d,]+)', card_text)
            if not price_matches:
                continue
            try:
                price = int(price_matches[0].replace(",", ""))
            except ValueError:
                continue
            if price < 50:
                continue
            seen_urls.add(href)
            results.append({
                "site": "Flipkart", "title": title, "price": price,
                "currency": "INR",
                "url": "https://www.flipkart.com" + href if href.startswith("/") else href,
                "logo": "🛍️", "status": "success"
            })
            if len(results) == 3:
                break
        return results
    except Exception as e:
        print(f"Flipkart error: {e}")
        return []

# ── Meesho (FIXED) ──
def scrape_meesho(query):
    try:
        from playwright.sync_api import sync_playwright
        url = f"https://www.meesho.com/search?q={query.replace(' ', '%20')}"
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
            )
            context = browser.new_context(
                user_agent=random.choice(USER_AGENTS),
                viewport={"width": 1280, "height": 800},
                locale="en-IN",
                extra_http_headers={
                    "Accept-Language": "en-IN,en;q=0.9",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                }
            )
            page = context.new_page()
            # Mask automation signals
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            page.goto(url, timeout=40000, wait_until="domcontentloaded")
            # Wait for products to appear — try multiple selectors
            try:
                page.wait_for_selector(
                    "div[class*='ProductList'], div[data-testid='product-container'], a[href*='/p/']",
                    timeout=12000
                )
            except Exception:
                pass
            page.wait_for_timeout(4000)
            # Scroll to trigger lazy-load
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(2000)
            html = page.content()
            browser.close()

        results = []

        # Strategy 1: structured cards
        soup = BeautifulSoup(html, "html.parser")
        cards = (
            soup.select("div[class*='ProductList__GridCol']") or
            soup.select("div[data-testid='product-container']") or
            soup.select("div[class*='NewProductCard']") or
            soup.select("div[class*='ProductCard']")
        )
        for card in cards[:8]:
            title_el = (
                card.select_one("p[class*='product-title']") or
                card.select_one("p[class*='Text__StyledText']") or
                card.select_one("span[class*='product-title']") or
                card.select_one("p")
            )
            price_el = (
                card.select_one("h5[class*='Text__StyledText']") or
                card.select_one("span[class*='price']") or
                card.select_one("h5") or
                card.select_one("span[class*='Price']")
            )
            link_el = card.select_one("a")
            if not title_el or not price_el:
                continue
            price_text = re.sub(r'[^\d.]', '', price_el.text.strip())
            try:
                price = float(price_text)
                if price < 10:
                    continue
            except:
                continue
            title = title_el.text.strip()
            if len(title) < 5:
                continue
            href = link_el.get("href", "") if link_el else ""
            if href and not href.startswith("http"):
                href = "https://www.meesho.com" + href
            results.append({
                "site": "Meesho", "title": title[:80],
                "price": price, "currency": "INR",
                "url": href or url, "logo": "🟣", "status": "success"
            })
            if len(results) == 3:
                break

        # Strategy 2: JSON-LD / __NEXT_DATA__ embedded product data
        if not results:
            next_data_match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
            if next_data_match:
                try:
                    next_json = json.loads(next_data_match.group(1))
                    # Walk the props tree looking for product lists
                    raw_str = json.dumps(next_json)
                    names = re.findall(r'"name"\s*:\s*"([^"]{8,80})"', raw_str)
                    price_vals = re.findall(r'"(?:price|mrp|selling_price)"\s*:\s*(\d+(?:\.\d+)?)', raw_str)
                    unique_names = list(dict.fromkeys(names))
                    unique_prices = []
                    seen_p = set()
                    for pv in price_vals:
                        if pv not in seen_p and float(pv) >= 10:
                            seen_p.add(pv)
                            unique_prices.append(float(pv))
                    for i in range(min(3, len(unique_names), len(unique_prices))):
                        results.append({
                            "site": "Meesho", "title": unique_names[i][:80],
                            "price": unique_prices[i], "currency": "INR",
                            "url": url, "logo": "🟣", "status": "success"
                        })
                except Exception:
                    pass

        # Strategy 3: regex fallback on raw HTML
        if not results:
            prices_raw = re.findall(r'₹\s*([\d,]+)', html)
            titles_raw = re.findall(r'"name"\s*:\s*"([^"]{8,80})"', html)
            unique_titles = list(dict.fromkeys(titles_raw))
            unique_prices = []
            seen_set = set()
            for p in prices_raw:
                val = p.replace(",", "")
                if val not in seen_set and float(val) >= 10:
                    seen_set.add(val)
                    unique_prices.append(float(val))
            for i in range(min(3, len(unique_titles), len(unique_prices))):
                results.append({
                    "site": "Meesho", "title": unique_titles[i][:80],
                    "price": unique_prices[i], "currency": "INR",
                    "url": url, "logo": "🟣", "status": "success"
                })

        return results
    except Exception as e:
        print(f"Meesho error: {e}")
        return []

# ── IndiaMart (NEW) ──
def scrape_indiamart(query):
    try:
        from playwright.sync_api import sync_playwright
        url = f"https://dir.indiamart.com/search.mp?ss={query.replace(' ', '+')}"
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"]
            )
            context = browser.new_context(
                user_agent=random.choice(USER_AGENTS),
                viewport={"width": 1280, "height": 800},
                locale="en-IN",
            )
            page = context.new_page()
            page.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            page.goto(url, timeout=35000, wait_until="domcontentloaded")
            try:
                page.wait_for_selector("div.card-body, div.prd-card, div[class*='product']", timeout=10000)
            except Exception:
                pass
            page.wait_for_timeout(3000)
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(1500)
            html = page.content()
            browser.close()

        soup = BeautifulSoup(html, "html.parser")
        results = []

        # IndiaMart product cards
        cards = (
            soup.select("div.card-body") or
            soup.select("div.productsec") or
            soup.select("div[class*='prd-card']") or
            soup.select("div.ls-container div.lst")
        )

        for card in cards[:8]:
            # Title
            title_el = (
                card.select_one("a.prd-name") or
                card.select_one("h3.prd-name") or
                card.select_one("span.prd-name") or
                card.select_one("a[class*='title']") or
                card.select_one("h3") or
                card.select_one("a")
            )
            # Price — IndiaMart uses "Get Price" for many items; skip those
            price_el = (
                card.select_one("span.prc") or
                card.select_one("p.price") or
                card.select_one("span[class*='price']") or
                card.select_one("div[class*='price']")
            )
            link_el = card.select_one("a[href]")

            if not title_el:
                continue

            title = title_el.get_text(" ", strip=True)
            if len(title) < 5:
                continue

            if price_el:
                price_text = re.sub(r'[^\d.]', '', price_el.get_text(strip=True))
            else:
                # Try extracting price from card text
                card_text = card.get_text()
                price_matches = re.findall(r'₹\s*([\d,]+)', card_text)
                price_text = price_matches[0].replace(",", "") if price_matches else ""

            if not price_text:
                continue
            try:
                price = float(price_text)
                if price < 1:
                    continue
            except:
                continue

            href = link_el.get("href", "") if link_el else ""
            if href and not href.startswith("http"):
                href = "https://dir.indiamart.com" + href

            results.append({
                "site": "IndiaMart", "title": title[:80],
                "price": price, "currency": "INR",
                "url": href or url, "logo": "🏭", "status": "success"
            })
            if len(results) == 3:
                break

        # Fallback: regex scrape
        if not results:
            price_matches = re.findall(r'₹\s*([\d,]+)', html)
            title_matches = re.findall(
                r'class="[^"]*(?:prd-name|product-name|title)[^"]*"[^>]*>([^<]{5,80})<', html
            )
            seen_titles = list(dict.fromkeys(title_matches))
            seen_prices = []
            seen_set = set()
            for pm in price_matches:
                val = pm.replace(",", "")
                if val not in seen_set:
                    seen_set.add(val)
                    try:
                        v = float(val)
                        if v >= 1:
                            seen_prices.append(v)
                    except:
                        pass
            for i in range(min(3, len(seen_titles), len(seen_prices))):
                results.append({
                    "site": "IndiaMart", "title": seen_titles[i].strip()[:80],
                    "price": seen_prices[i], "currency": "INR",
                    "url": url, "logo": "🏭", "status": "success"
                })

        return results
    except Exception as e:
        print(f"IndiaMart error: {e}")
        return []

# ── API Endpoints ──
@app.get("/")
def home():
    return {"message": "Dynamic Pricing API is running!"}

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type.")
    contents = await file.read()
    img_info = validate_image(contents)
    if not img_info["valid"]:
        raise HTTPException(status_code=400, detail="Invalid image.")
    size_mb = len(contents) / (1024 * 1024)
    if size_mb > 10:
        raise HTTPException(status_code=400, detail="File too large.")
    extension = file.filename.split(".")[-1]
    unique_filename = f"{uuid.uuid4()}.{extension}"
    with open(os.path.join(UPLOAD_DIR, unique_filename), "wb") as f:
        f.write(contents)
    return {"status": "success", "filename": unique_filename, "original_name": file.filename,
            "size_mb": round(size_mb, 2), "file_type": file.content_type, "image_info": img_info}

@app.post("/identify")
async def identify_product(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Invalid file type.")
    contents = await file.read()
    img_info = validate_image(contents)
    if not img_info["valid"]:
        raise HTTPException(status_code=400, detail="Corrupted or invalid image.")
    image_base64 = base64.b64encode(contents).decode("utf-8")
    prompt = """Look at this product image carefully. Return ONLY a JSON object, no extra text:
{
    "product_name": "full product name",
    "brand": "brand name or Unknown",
    "category": "product category",
    "key_specs": ["spec1", "spec2", "spec3"],
    "search_query": "best search query to find this product online",
    "confidence": 0.95,
    "description": "one sentence description"
}
Be specific. Return ONLY the JSON."""
    try:
        response = client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{file.content_type};base64,{image_base64}"}}
            ]}],
            max_tokens=500
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        product_data = json.loads(raw)
        return {"status": "success", "product": product_data, "image_info": img_info}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI identification failed: {str(e)}")

@app.get("/stream-prices")
async def stream_prices(query: str):
    session_id = str(uuid_lib.uuid4())

    async def event_generator():
        yield {"event": "session_started", "data": json.dumps({
            "session_id": session_id, "query": query,
            "message": "Starting price search across 5 platforms..."
        })}
        await asyncio.sleep(0.1)

        loop = asyncio.get_event_loop()

        tasks_map = {
            "Amazon":    (loop.run_in_executor(executor, scrape_amazon, query),    "🛒"),
            "Snapdeal":  (loop.run_in_executor(executor, scrape_snapdeal, query),  "🟡"),
            "Flipkart":  (loop.run_in_executor(executor, scrape_flipkart, query),  "🛍️"),
            "Meesho":    (loop.run_in_executor(executor, scrape_meesho, query),    "🟣"),
            "IndiaMart": (loop.run_in_executor(executor, scrape_indiamart, query), "🏭"),
        }

        all_results = []

        for site_name, (task, logo) in tasks_map.items():
            try:
                results = await asyncio.wait_for(task, timeout=45)
                all_results.extend(results)
                if results:
                    for item in results:
                        yield {"event": "price_scraped", "data": json.dumps({
                            "session_id": session_id, "source": site_name,
                            "product_name": item["title"], "price": item["price"],
                            "currency": item["currency"], "product_url": item["url"],
                            "logo": logo,
                            "scraped_at": dt.datetime.now().isoformat(), "in_stock": True
                        })}
                else:
                    yield {"event": "scraper_failed", "data": json.dumps({
                        "session_id": session_id, "source": site_name,
                        "reason": "NO_RESULTS", "retry_count": 1,
                        "failed_at": dt.datetime.now().isoformat()
                    })}
            except Exception:
                yield {"event": "scraper_failed", "data": json.dumps({
                    "session_id": session_id, "source": site_name,
                    "reason": "SCRAPER_ERROR", "retry_count": 1,
                    "failed_at": dt.datetime.now().isoformat()
                })}

        price_floor = get_price_floor(query)
        prices_inr_filtered = [r["price"] for r in all_results if r["currency"] == "INR" and r["price"] >= price_floor]
        prices_inr = prices_inr_filtered if prices_inr_filtered else [r["price"] for r in all_results if r["currency"] == "INR"]
        analysis = analyze_prices_ml(prices_inr) if prices_inr else {}

        if analysis:
            yield {"event": "analysis_ready", "data": json.dumps({
                "session_id": session_id,
                "recommended_price": analysis.get("recommended"),
                "price_range": {"low": analysis.get("lowest"), "high": analysis.get("highest")},
                "strategy": analysis.get("strategy"),
                "competitive_score": 78,
                "clusters": analysis.get("clusters", []),
                "outliers_removed": analysis.get("outliers_removed", 0),
                "total_sources": analysis.get("total_sources", 0)
            })}

        yield {"event": "done", "data": json.dumps({
            "session_id": session_id, "message": "Search complete"
        })}

    return EventSourceResponse(event_generator())

@app.post("/recommend")
async def recommend_price(data: dict):
    product = data.get("product", {})
    analysis = data.get("analysis", {})
    if not analysis:
        raise HTTPException(status_code=400, detail="No price data provided.")
    clusters_text = ""
    if analysis.get("clusters"):
        clusters_text = "Price Clusters: " + ", ".join(
            [f"{c['tier']}: ₹{c['center_price']}" for c in analysis["clusters"]]
        )
    prompt = f"""You are a pricing expert. Given this product and ML market analysis, give a pricing recommendation.

Product: {product.get('product_name')} by {product.get('brand')}
Category: {product.get('category')}

ML Price Analysis:
- Lowest price: ₹{analysis.get('lowest')}
- Average price: ₹{analysis.get('average')}
- Highest price: ₹{analysis.get('highest')}
- Recommended price: ₹{analysis.get('recommended')}
- Outliers removed by IsolationForest: {analysis.get('outliers_removed', 0)}
- Pricing Strategy: {analysis.get('strategy')}
- {clusters_text}
- Total listings: {analysis.get('total_sources')}

Give recommendation in exactly this JSON format:
{{
    "strategy": "{analysis.get('strategy', 'Competitive Pricing')}",
    "recommended_price": {analysis.get('recommended')},
    "reason": "2-3 sentence explanation why this price is best",
    "market_summary": "1 sentence about current market",
    "confidence": "High"
}}
Return ONLY the JSON."""
    try:
        response = client.chat.completions.create(
            model="meta-llama/llama-4-scout-17b-16e-instruct",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()
        recommendation = json.loads(raw)
        return {"status": "success", "recommendation": recommendation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recommendation failed: {str(e)}")

@app.post("/save-history")
async def save_price_history(data: dict):
    product_name = data.get("product_name", "")
    prices = data.get("prices", [])
    analysis = data.get("analysis", {})
    if not product_name or not prices:
        raise HTTPException(status_code=400, detail="Product name and prices required.")
    record = {
        "product_name": product_name,
        "timestamp": datetime.now().isoformat(),
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "prices": prices,
        "lowest": analysis.get("lowest", 0),
        "highest": analysis.get("highest", 0),
        "average": analysis.get("average", 0),
        "recommended": analysis.get("recommended", 0),
        "strategy": analysis.get("strategy", "")
    }
    prices_table.insert(record)
    return {"status": "success", "message": "Price history saved"}

@app.get("/get-history/{product_name}")
async def get_price_history(product_name: str):
    Product = Query()
    records = prices_table.search(
        Product.product_name.matches(f".*{product_name}.*", flags=2)
    )
    records_sorted = sorted(records, key=lambda x: x["timestamp"])[-10:]
    return {"status": "success", "history": records_sorted}

@app.get("/all-history")
async def get_all_history():
    all_records = prices_table.all()
    records_sorted = sorted(all_records, key=lambda x: x["timestamp"], reverse=True)[:20]
    return {"status": "success", "history": records_sorted}
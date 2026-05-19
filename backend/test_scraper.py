import requests
import random, re
from bs4 import BeautifulSoup

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
]

def get_headers():
    return {
        "User-Agent": random.choice(USER_AGENTS),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }

query = "iphone 15"

# Test Amazon India
print("="*40)
print("Amazon India (amazon.in)")
url = f"https://www.amazon.in/s?k={query.replace(' ','+')}"
res = requests.get(url, headers=get_headers(), timeout=10)
soup = BeautifulSoup(res.text, "html.parser")
items = soup.select("div[data-component-type='s-search-result']")[:3]
print(f"Status: {res.status_code} | Items found: {len(items)}")
for item in items:
    title = item.select_one("h2 span")
    price = item.select_one(".a-price .a-offscreen")
    if title and price:
        print(f"✅ {title.text[:50]} → {price.text}")

# Test Amazon Global (US)
print("\n"+"="*40)
print("Amazon Global (amazon.com)")
url2 = f"https://www.amazon.com/s?k={query.replace(' ','+')}"
res2 = requests.get(url2, headers=get_headers(), timeout=10)
soup2 = BeautifulSoup(res2.text, "html.parser")
items2 = soup2.select("div[data-component-type='s-search-result']")[:3]
print(f"Status: {res2.status_code} | Items found: {len(items2)}")
for item in items2:
    title = item.select_one("h2 span")
    price = item.select_one(".a-price .a-offscreen")
    if title and price:
        print(f"✅ {title.text[:50]} → {price.text}")

# Test Amazon UAE
print("\n"+"="*40)
print("Amazon UAE (amazon.ae)")
url3 = f"https://www.amazon.ae/s?k={query.replace(' ','+')}"
res3 = requests.get(url3, headers=get_headers(), timeout=10)
soup3 = BeautifulSoup(res3.text, "html.parser")
items3 = soup3.select("div[data-component-type='s-search-result']")[:3]
print(f"Status: {res3.status_code} | Items found: {len(items3)}")
for item in items3:
    title = item.select_one("h2 span")
    price = item.select_one(".a-price .a-offscreen")
    if title and price:
        print(f"✅ {title.text[:50]} → {price.text}")

# Test Amazon UK
print("\n"+"="*40)
print("Amazon UK (amazon.co.uk)")
url4 = f"https://www.amazon.co.uk/s?k={query.replace(' ','+')}"
res4 = requests.get(url4, headers=get_headers(), timeout=10)
soup4 = BeautifulSoup(res4.text, "html.parser")
items4 = soup4.select("div[data-component-type='s-search-result']")[:3]
print(f"Status: {res4.status_code} | Items found: {len(items4)}")
for item in items4:
    title = item.select_one("h2 span")
    price = item.select_one(".a-price .a-offscreen")
    if title and price:
        print(f"✅ {title.text[:50]} → {price.text}")
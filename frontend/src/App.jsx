import { useState, useRef, useEffect } from "react";
import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const target = parseFloat(value) || 0;
    const start = display;
    const duration = 900;
    const startTime = performance.now();
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(start + (target - start) * eased);
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span>{Math.round(display).toLocaleString("en-IN")}</span>;
}

function MiniBar({ value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 1s cubic-bezier(.16,1,.3,1)" }} />
    </div>
  );
}

function PulseDot({ color = "#00f5a0" }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10, flexShrink: 0 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: 0.4, animation: "ping 1.4s ease-out infinite" }} />
      <span style={{ position: "relative", borderRadius: "50%", width: 10, height: 10, background: color }} />
    </span>
  );
}

const PLATFORMS = {
  Amazon:   { logo: "🛒", color: "#ff9900" },
  Snapdeal: { logo: "🟡", color: "#e40046" },
  Flipkart: { logo: "🛍️", color: "#2874f0" },
  Meesho:   { logo: "🟣", color: "#9b2e9b" },
  IndiaMart:{ logo: "🏭", color: "#00a550" },
};

export default function App() {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [identifying, setIdentifying] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [product, setProduct] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("analysis");
  const [timeStr, setTimeStr] = useState("");
  const fileInputRef = useRef(null);
  const analysisRef = useRef({});

  useEffect(() => {
    const update = () => setTimeStr(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  function handleFile(file) {
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) { setError("Only JPG, PNG, or WebP allowed."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Image must be under 10MB."); return; }
    setError(null); setProduct(null); setPriceData(null);
    setRecommendation(null); setShowHistory(false); setHistory([]);
    analysisRef.current = {};
    setImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
  }

  function onDragOver(e) { e.preventDefault(); setDragging(true); }
  function onDragLeave() { setDragging(false); }
  function onDrop(e) { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }

  async function handleIdentify() {
    if (!image) return;
    setIdentifying(true); setError(null);
    try {
      const formData = new FormData();
      formData.append("file", image);
      const res = await axios.post(`${API_URL}/identify`, formData, { headers: { "Content-Type": "multipart/form-data" } });
      setProduct(res.data.product);
    } catch (err) {
      setError(err.response?.data?.detail || "AI identification failed.");
    } finally { setIdentifying(false); }
  }

  async function handleScrape() {
    if (!product) return;
    setScraping(true); setError(null); setPriceData(null);
    analysisRef.current = {};
    const allResults = [];

    const scraperStatusMap = {};
    Object.keys(PLATFORMS).forEach(site => {
      scraperStatusMap[site] = { site, logo: PLATFORMS[site].logo, status: "pending", count: 0 };
    });

    setPriceData({ results: [], analysis: {}, scraper_status: Object.values(scraperStatusMap) });

    try {
      const query = encodeURIComponent(product.search_query);
      const eventSource = new EventSource(`${API_URL}/stream-prices?query=${query}`);

      eventSource.addEventListener("price_scraped", (e) => {
        const data = JSON.parse(e.data);
        allResults.push({
          site: data.source, title: data.product_name, price: data.price,
          currency: data.currency, url: data.product_url,
          logo: PLATFORMS[data.source]?.logo || "🛒", status: "success"
        });
        if (scraperStatusMap[data.source]) {
          scraperStatusMap[data.source].status = "success";
          scraperStatusMap[data.source].count += 1;
        }
        setPriceData(prev => ({
          results: [...allResults],
          analysis: prev?.analysis || {},
          scraper_status: Object.values(scraperStatusMap)
        }));
      });

      eventSource.addEventListener("scraper_failed", (e) => {
        const data = JSON.parse(e.data);
        if (scraperStatusMap[data.source]) scraperStatusMap[data.source].status = "failed";
        setPriceData(prev => ({
          results: [...allResults],
          analysis: prev?.analysis || {},
          scraper_status: Object.values(scraperStatusMap)
        }));
      });

      eventSource.addEventListener("analysis_ready", (e) => {
        const data = JSON.parse(e.data);
        const avg = allResults.length > 0 ? allResults.reduce((a, b) => a + b.price, 0) / allResults.length : 0;
        const latestAnalysis = {
          lowest: data.price_range.low, highest: data.price_range.high,
          average: Math.round(avg * 100) / 100, recommended: data.recommended_price,
          strategy: data.strategy, clusters: data.clusters,
          outliers_removed: data.outliers_removed, total_sources: data.total_sources,
        };
        analysisRef.current = latestAnalysis;
        setPriceData(prev => ({
          results: [...allResults],
          analysis: latestAnalysis,
          scraper_status: Object.values(scraperStatusMap)
        }));
      });

      eventSource.addEventListener("done", () => {
        eventSource.close(); setScraping(false);
        if (allResults.length > 0 && product) {
          axios.post(`${API_URL}/save-history`, {
            product_name: product.product_name,
            prices: allResults,
            analysis: analysisRef.current
          }).catch(() => {});
        }
      });

      eventSource.onerror = () => { eventSource.close(); setScraping(false); };
    } catch {
      setError("Price scraping failed."); setScraping(false);
    }
  }

  async function handleRecommend() {
    if (!product || !priceData) return;
    setRecommending(true); setError(null);
    try {
      const res = await axios.post(`${API_URL}/recommend`, { product, analysis: priceData.analysis });
      setRecommendation(res.data.recommendation);
    } catch (err) {
      setError(err.response?.data?.detail || "Recommendation failed.");
    } finally { setRecommending(false); }
  }

  async function loadHistory() {
    if (!product) return;
    try {
      const res = await axios.get(`${API_URL}/get-history/${encodeURIComponent(product.product_name)}`);
      setHistory(res.data.history); setShowHistory(true);
    } catch {}
  }

  function handleReset() {
    setImage(null); setPreview(null); setProduct(null); setPriceData(null);
    setRecommendation(null); setError(null); setShowHistory(false); setHistory([]);
    analysisRef.current = {};
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const step = !preview ? 0 : !product ? 1 : !(priceData?.analysis?.total_sources) ? 2 : !recommendation ? 3 : 4;
  const analysis = priceData?.analysis || {};
  const hasAnalysis = analysis.total_sources > 0;
  const strategyColor = { "Penetration Pricing": "#00f5a0", "Competitive Pricing": "#3b9eff", "Premium Pricing": "#f5a623" }[analysis.strategy] || "#3b9eff";
  const strategyRgb = { "Penetration Pricing": "0,245,160", "Competitive Pricing": "59,158,255", "Premium Pricing": "245,166,35" }[analysis.strategy] || "59,158,255";

  const mono = "'JetBrains Mono', monospace";
  const sans = "'Syne', sans-serif";

  const card = {
    background: "rgba(13,20,33,0.85)",
    border: "1px solid rgba(30,58,95,0.55)",
    borderRadius: 16, padding: 20, marginBottom: 14,
    backdropFilter: "blur(24px)",
    animation: "fadeUp 0.5s cubic-bezier(.16,1,.3,1) both",
  };

  const sectionLabel = (n, text, dot) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: "#3a5570", letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
        {n.toString().padStart(2, "0")} / {text}
      </span>
      {dot && (<><PulseDot color={dot} /><span style={{ fontSize: 10, color: dot, fontFamily: mono }}>{dot === "#00f5a0" ? "LIVE" : dot === "#f5a623" ? "READY" : "DONE"}</span></>)}
    </div>
  );

  const successCount = priceData?.scraper_status?.filter(s => s.status === "success").length || 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #060b14; font-family: 'Syne', sans-serif; color: #e2e8f0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d1421; }
        ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 99px; }
        @keyframes ping    { 0%   { transform: scale(1); opacity: .5; } 100% { transform: scale(2.4); opacity: 0; } }
        @keyframes fadeUp  { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(110vh); } }
        @keyframes glowBorder { 0%,100% { border-color: rgba(0,245,160,.25); } 50% { border-color: rgba(0,245,160,.7); } }
        .btn-glow:hover  { transform: translateY(-2px); filter: brightness(1.1); }
        .btn-glow:active { transform: translateY(0); }
        .row-hover:hover { border-color: rgba(0,245,160,.35) !important; transform: translateX(3px); }
        .tab-btn:hover   { color: #e2e8f0 !important; }
        .listing-row     { animation: slideIn .35s cubic-bezier(.16,1,.3,1) both; }
        .platform-badge:hover { transform: translateY(-2px); }
      `}</style>

      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 55% at 15% 8%, rgba(0,245,160,.07) 0%, transparent 55%), radial-gradient(ellipse 60% 70% at 85% 85%, rgba(59,158,255,.07) 0%, transparent 55%)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(20,40,70,.2) 1px,transparent 1px),linear-gradient(90deg,rgba(20,40,70,.2) 1px,transparent 1px)", backgroundSize: "48px 48px" }} />
        <div style={{ position: "absolute", left: 0, right: 0, height: 2, background: "linear-gradient(90deg,transparent,rgba(0,245,160,.06),transparent)", animation: "scanline 10s linear infinite" }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", padding: "0 16px 48px", maxWidth: 580, margin: "0 auto" }}>

        <header style={{ paddingTop: 22, paddingBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: "linear-gradient(135deg,#00f5a0,#00bcd4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, boxShadow: "0 0 24px rgba(0,245,160,.45)", flexShrink: 0 }}>◈</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.02em", color: "white", lineHeight: 1.1 }}>PriceIntel<span style={{ color: "#00f5a0" }}>.</span>AI</div>
                <div style={{ fontSize: 9, color: "#2a4a6a", fontFamily: mono, letterSpacing: ".1em" }}>DYNAMIC PRICING ENGINE v3.0 · 5 PLATFORMS</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: mono, fontSize: 13, color: "#00f5a0", fontWeight: 700 }}>{timeStr}</div>
              <div style={{ fontSize: 9, color: "#2a4a6a", fontFamily: mono, letterSpacing: ".08em" }}>IST · LIVE MARKET</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {["Upload", "Identify", "Scan Prices", "Recommend"].map((label, i) => {
              const done = step > i + 1;
              const active = step === i + 1;
              return (
                <div key={label} style={{ flex: 1 }}>
                  <div style={{ height: 3, borderRadius: 99, marginBottom: 5, background: done ? "#00f5a0" : active ? "rgba(0,245,160,.5)" : "rgba(255,255,255,.07)", transition: "background .4s" }} />
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", fontFamily: mono, color: done ? "#00f5a0" : active ? "rgba(0,245,160,.75)" : "#1e3a5f" }}>
                    {done ? "✓ " : active ? "▶ " : ""}{label}
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        {/* 01 UPLOAD */}
        <div style={{ ...card, borderColor: dragging ? "rgba(0,245,160,.6)" : "rgba(30,58,95,.55)", ...(dragging && { animation: "glowBorder 1s ease infinite" }) }}>
          {sectionLabel(1, "Product Image", preview ? "#00f5a0" : null)}
          <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            onClick={() => !preview && fileInputRef.current?.click()}
            style={{ border: `1.5px dashed ${dragging ? "#00f5a0" : preview ? "rgba(0,245,160,.3)" : "rgba(30,58,95,.8)"}`, borderRadius: 12, padding: preview ? 12 : 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: preview ? "default" : "pointer", background: dragging ? "rgba(0,245,160,.04)" : "rgba(6,11,20,.5)", minHeight: preview ? 0 : 140, transition: "all .3s" }}>
            {preview ? (
              <div style={{ width: "100%", display: "flex", gap: 14, alignItems: "center" }}>
                <img src={preview} alt="product" style={{ width: 76, height: 76, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(0,245,160,.3)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "white", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{image?.name}</div>
                  <div style={{ fontSize: 10, color: "#3a5570", fontFamily: mono, marginBottom: 10 }}>{(image?.size / 1024).toFixed(0)} KB · {image?.type?.split("/")[1]?.toUpperCase()}</div>
                  <button onClick={e => { e.stopPropagation(); handleReset(); }} style={{ fontSize: 11, color: "#f87171", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: mono }}>✕ Remove</button>
                </div>
              </div>
            ) : (
              <><div style={{ fontSize: 30, marginBottom: 10, opacity: .45 }}>⬆</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.65)", marginBottom: 4 }}>Drop product image here</div>
              <div style={{ fontSize: 11, color: "#1e3a5f", fontFamily: mono }}>JPG · PNG · WebP · Max 10 MB</div></>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />
          {error && <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(248,113,113,.07)", border: "1px solid rgba(248,113,113,.25)", borderRadius: 8, color: "#f87171", fontSize: 12, fontFamily: mono }}>⚠ {error}</div>}
          {preview && !product && (
            <button className="btn-glow" onClick={handleIdentify} disabled={identifying}
              style={{ marginTop: 14, width: "100%", padding: "13px 0", borderRadius: 10, border: "none", cursor: identifying ? "not-allowed" : "pointer", background: identifying ? "rgba(0,245,160,.12)" : "linear-gradient(135deg,#00f5a0,#00bcd4)", color: identifying ? "#00f5a0" : "#060b14", fontSize: 13, fontWeight: 800, letterSpacing: ".04em", transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: sans }}>
              {identifying ? <><span style={{ width: 14, height: 14, border: "2px solid #00f5a0", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />ANALYZING IMAGE...</> : "⬡ IDENTIFY PRODUCT WITH AI"}
            </button>
          )}
        </div>

        {/* 02 PRODUCT */}
        {product && (
          <div style={card}>
            {sectionLabel(2, "Product Intel", "#00f5a0")}
            <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 19, fontWeight: 800, color: "white", lineHeight: 1.2, marginBottom: 4 }}>{product.product_name}</div>
                <div style={{ fontSize: 12, color: "#3a7090", fontFamily: mono }}>{product.brand} <span style={{ color: "#1e3a5f" }}>·</span> {product.category}</div>
              </div>
              <div style={{ background: "rgba(0,245,160,.08)", border: "1px solid rgba(0,245,160,.2)", borderRadius: 12, padding: "10px 14px", textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#00f5a0", lineHeight: 1, fontFamily: mono }}>{Math.round(product.confidence * 100)}%</div>
                <div style={{ fontSize: 9, color: "#3a5570", marginTop: 3, letterSpacing: ".08em" }}>CONFIDENCE</div>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {product.key_specs?.map((spec, i) => (
                <span key={i} style={{ fontSize: 11, background: "rgba(59,158,255,.1)", border: "1px solid rgba(59,158,255,.2)", color: "#3b9eff", padding: "3px 10px", borderRadius: 99, fontFamily: mono }}>{spec}</span>
              ))}
            </div>
            <div style={{ background: "rgba(6,11,20,.6)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 8, padding: "8px 12px", marginBottom: 14 }}>
              <div style={{ fontSize: 9, color: "#1e3a5f", letterSpacing: ".1em", marginBottom: 4, fontFamily: mono }}>SEARCH QUERY</div>
              <div style={{ fontSize: 12, color: "#00bcd4", fontFamily: mono, fontWeight: 600 }}>{product.search_query}</div>
            </div>
            {!priceData && (
              <button className="btn-glow" onClick={handleScrape} disabled={scraping}
                style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none", cursor: scraping ? "not-allowed" : "pointer", background: scraping ? "rgba(59,158,255,.12)" : "linear-gradient(135deg,#3b9eff,#0070f3)", color: scraping ? "#3b9eff" : "white", fontSize: 13, fontWeight: 800, letterSpacing: ".04em", transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: sans }}>
                {scraping ? <><span style={{ width: 14, height: 14, border: "2px solid #3b9eff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />STREAMING LIVE PRICES...</> : "⚡ SCAN 5 PLATFORMS LIVE"}
              </button>
            )}
          </div>
        )}

        {/* LIVE STREAM */}
        {scraping && priceData && (
          <div style={{ ...card, borderColor: "rgba(0,245,160,.25)", animation: "glowBorder 2s ease infinite, fadeUp .5s cubic-bezier(.16,1,.3,1) both" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PulseDot color="#00f5a0" />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#00f5a0", letterSpacing: ".1em", textTransform: "uppercase", fontFamily: mono }}>Live Price Stream</span>
              </div>
              <span style={{ fontSize: 10, fontFamily: mono, color: "#3a5570" }}>{successCount}/{Object.keys(PLATFORMS).length} platforms</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {priceData.scraper_status?.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "rgba(6,11,20,.5)", borderRadius: 8, border: `1px solid ${s.status === "success" ? "rgba(0,245,160,.15)" : s.status === "failed" ? "rgba(248,113,113,.15)" : "rgba(30,58,95,.4)"}` }}>
                  <span style={{ fontSize: 15 }}>{s.logo}</span>
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.site}</span>
                  {s.status === "pending" && <span style={{ width: 11, height: 11, border: "2px solid #fbbf24", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", flexShrink: 0 }} />}
                  <span style={{ fontSize: 10, fontFamily: mono, fontWeight: 600, flexShrink: 0, color: s.status === "success" ? "#00f5a0" : s.status === "failed" ? "#f87171" : "#fbbf24" }}>
                    {s.status === "success" ? `+${s.count}` : s.status === "failed" ? "✗" : "..."}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 03 ANALYSIS */}
        {hasAnalysis && (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#3a5570", letterSpacing: ".12em", textTransform: "uppercase", fontFamily: mono }}>03 / Market Analysis</span>
              <div style={{ display: "flex", gap: 4 }}>
                {["analysis", "listings", "clusters"].map(tab => (
                  <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)}
                    style={{ fontSize: 9, fontWeight: 700, padding: "4px 9px", borderRadius: 6, border: "1px solid", borderColor: activeTab === tab ? "rgba(0,245,160,.4)" : "rgba(30,58,95,.4)", background: activeTab === tab ? "rgba(0,245,160,.1)" : "transparent", color: activeTab === tab ? "#00f5a0" : "#3a5570", cursor: "pointer", letterSpacing: ".07em", textTransform: "uppercase", fontFamily: mono, transition: "all .2s" }}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 16 }}>
              {priceData.scraper_status?.map((s, i) => (
                <div key={i} className="platform-badge" style={{ background: s.status === "success" ? "rgba(0,245,160,.06)" : "rgba(248,113,113,.06)", border: `1px solid ${s.status === "success" ? "rgba(0,245,160,.2)" : "rgba(248,113,113,.2)"}`, borderRadius: 10, padding: "8px 4px", textAlign: "center", transition: "transform .2s" }}>
                  <div style={{ fontSize: 16, marginBottom: 2 }}>{s.logo}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,.7)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.site}</div>
                  <div style={{ fontSize: 9, fontFamily: mono, color: s.status === "success" ? "#00f5a0" : "#f87171" }}>{s.status === "success" ? `✓ ${s.count}` : "✗"}</div>
                </div>
              ))}
            </div>

            {activeTab === "analysis" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
                  {[
                    { label: "LOWEST", value: analysis.lowest, color: "#00f5a0", icon: "▼" },
                    { label: "HIGHEST", value: analysis.highest, color: "#f87171", icon: "▲" },
                    { label: "AVERAGE", value: analysis.average, color: "#3b9eff", icon: "◈" },
                    { label: "SUGGESTED", value: analysis.recommended, color: "#f5a623", icon: "★", hl: true },
                  ].map(({ label, value, color, icon, hl }) => (
                    <div key={label} style={{ background: hl ? "rgba(245,166,35,.07)" : "rgba(6,11,20,.5)", border: `1px solid ${hl ? "rgba(245,166,35,.25)" : "rgba(30,58,95,.4)"}`, borderRadius: 12, padding: "12px 14px", position: "relative", overflow: "hidden" }}>
                      {hl && <div style={{ position: "absolute", top: 0, right: 0, width: 56, height: 56, background: "radial-gradient(circle,rgba(245,166,35,.18),transparent)", pointerEvents: "none" }} />}
                      <div style={{ fontSize: 9, color: "#1e3a5f", letterSpacing: ".1em", marginBottom: 6, fontFamily: mono }}>{icon} {label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: mono }}>₹<AnimatedNumber value={value} /></div>
                    </div>
                  ))}
                </div>
                <div style={{ background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                  <div style={{ fontSize: 9, color: "#1e3a5f", letterSpacing: ".1em", marginBottom: 10, fontFamily: mono }}>PRICE RANGE VISUALIZER</div>
                  {[["Lowest", analysis.lowest, "#00f5a0"], ["Average", analysis.average, "#3b9eff"], ["Highest", analysis.highest, "#f87171"], ["Suggested", analysis.recommended, "#f5a623"]].map(([label, value, color]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ width: 54, fontSize: 10, color: "#3a5570", fontFamily: mono, flexShrink: 0 }}>{label}</span>
                      <MiniBar value={value} max={analysis.highest} color={color} />
                      <span style={{ width: 76, fontSize: 11, fontWeight: 700, color, textAlign: "right", fontFamily: mono, flexShrink: 0 }}>₹{value?.toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: `rgba(${strategyRgb},.07)`, border: `1px solid rgba(${strategyRgb},.25)`, borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: strategyColor, boxShadow: `0 0 8px ${strategyColor}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: strategyColor }}>{analysis.strategy}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#3a5570", fontFamily: mono }}>{analysis.total_sources} listings · {analysis.outliers_removed} outlier{analysis.outliers_removed !== 1 ? "s" : ""} removed</span>
                </div>
              </>
            )}

            {activeTab === "listings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {priceData.results?.length === 0 && <div style={{ textAlign: "center", padding: "24px 0", color: "#1e3a5f", fontSize: 12, fontFamily: mono }}>— No listings found —</div>}
                {priceData.results?.map((item, i) => (
                  <div key={i} className="row-hover listing-row" style={{ animationDelay: `${i * 45}ms`, background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, transition: "all .2s" }}>
                    <div style={{ fontSize: 20, flexShrink: 0 }}>{item.logo}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 9, color: "#3a5570", letterSpacing: ".08em", marginBottom: 3, fontFamily: mono }}>{item.site}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.82)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#00f5a0", fontFamily: mono }}>₹{item.price?.toLocaleString("en-IN")}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#3b9eff", fontFamily: mono, textDecoration: "none" }}>VIEW →</a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "clusters" && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  {analysis.clusters?.map((c, i) => {
                    const cls = [
                      { c: "#00f5a0", bg: "rgba(0,245,160,.08)", bd: "rgba(0,245,160,.2)", w: "33%" },
                      { c: "#3b9eff", bg: "rgba(59,158,255,.08)", bd: "rgba(59,158,255,.2)", w: "66%" },
                      { c: "#f5a623", bg: "rgba(245,166,35,.08)", bd: "rgba(245,166,35,.2)", w: "100%" }
                    ][i] || {};
                    return (
                      <div key={i} style={{ flex: 1, background: cls.bg, border: `1px solid ${cls.bd}`, borderRadius: 12, padding: "14px 10px", textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: cls.c, letterSpacing: ".1em", marginBottom: 8, fontFamily: mono, fontWeight: 700 }}>{c.tier.toUpperCase()}</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: "white", fontFamily: mono }}>₹{c.center_price?.toLocaleString("en-IN")}</div>
                        <div style={{ width: "100%", height: 3, background: `${cls.c}22`, borderRadius: 99, marginTop: 10 }}>
                          <div style={{ height: "100%", background: cls.c, borderRadius: 99, width: cls.w, transition: "width 1s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 10, padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, color: "#3a5570", fontFamily: mono, lineHeight: 1.7 }}>
                    KMeans clustering · {analysis.total_sources} price points across 5 platforms<br />
                    IsolationForest removed <span style={{ color: "#fbbf24", fontWeight: 700 }}>{analysis.outliers_removed}</span> outlier{analysis.outliers_removed !== 1 ? "s" : ""}
                  </div>
                </div>
              </>
            )}

            {!recommendation && !scraping && (
              <button className="btn-glow" onClick={handleRecommend} disabled={recommending}
                style={{ marginTop: 14, width: "100%", padding: "13px 0", borderRadius: 10, border: "none", cursor: recommending ? "not-allowed" : "pointer", background: recommending ? "rgba(245,166,35,.12)" : "linear-gradient(135deg,#f5a623,#f04f23)", color: recommending ? "#f5a623" : "white", fontSize: 13, fontWeight: 800, letterSpacing: ".04em", transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: sans }}>
                {recommending ? <><span style={{ width: 14, height: 14, border: "2px solid #f5a623", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} />AI ANALYSING MARKET...</> : "★ GET AI PRICE RECOMMENDATION"}
              </button>
            )}
          </div>
        )}

        {/* 04 RECOMMENDATION */}
        {recommendation && (
          <div style={{ ...card, borderColor: "rgba(245,166,35,.3)", boxShadow: "0 0 40px rgba(245,166,35,.08)" }}>
            {sectionLabel(4, "AI Recommendation", "#f5a623")}
            <div style={{ textAlign: "center", background: "rgba(245,166,35,.06)", border: "1px solid rgba(245,166,35,.2)", borderRadius: 14, padding: "22px 14px", marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "#3a5570", letterSpacing: ".14em", marginBottom: 8, fontFamily: mono }}>RECOMMENDED SELLING PRICE</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: "#f5a623", fontFamily: mono, lineHeight: 1, marginBottom: 12 }}>₹<AnimatedNumber value={recommendation.recommended_price} /></div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `rgba(${strategyRgb},.12)`, border: `1px solid rgba(${strategyRgb},.3)`, borderRadius: 99, padding: "5px 16px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: strategyColor, display: "inline-block", boxShadow: `0 0 6px ${strategyColor}` }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: strategyColor, fontFamily: mono }}>{recommendation.strategy}</span>
              </div>
            </div>
            <div style={{ background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "#1e3a5f", letterSpacing: ".1em", marginBottom: 6, fontFamily: mono }}>◈ MARKET SUMMARY</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.72)", lineHeight: 1.65 }}>{recommendation.market_summary}</div>
            </div>
            <div style={{ background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: "#1e3a5f", letterSpacing: ".1em", marginBottom: 6, fontFamily: mono }}>★ RATIONALE</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.72)", lineHeight: 1.65 }}>{recommendation.reason}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(0,245,160,.06)", border: "1px solid rgba(0,245,160,.2)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#00f5a0", boxShadow: "0 0 8px #00f5a0" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#00f5a0", fontFamily: mono }}>CONFIDENCE: {recommendation.confidence?.toUpperCase()}</span>
            </div>
          </div>
        )}

        {/* HISTORY */}
        {priceData && product && !scraping && (
          <button onClick={loadHistory}
            style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "1px solid rgba(59,158,255,.25)", background: "rgba(59,158,255,.06)", color: "#3b9eff", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10, letterSpacing: ".04em", fontFamily: sans }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(59,158,255,.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(59,158,255,.06)"}>
            ⟳ VIEW PRICE HISTORY
          </button>
        )}

        {showHistory && (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#3a5570", letterSpacing: ".12em", textTransform: "uppercase", fontFamily: mono }}>Price History · {history.length} records</span>
              <button onClick={() => setShowHistory(false)} style={{ fontSize: 10, color: "#f87171", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.2)", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: mono }}>✕ CLOSE</button>
            </div>
            {history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "#1e3a5f", fontSize: 12, fontFamily: mono }}>— No prior records for this product —</div>
            ) : (
              <>
                <div style={{ background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "#1e3a5f", letterSpacing: ".1em", marginBottom: 10, fontFamily: mono }}>AVERAGE PRICE TREND</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 90 }}>
                    {history.map((record, i) => {
                      const maxPrice = Math.max(...history.map(r => r.average || 0));
                      const barH = maxPrice > 0 ? Math.max((record.average / maxPrice) * 68, 6) : 6;
                      const isLast = i === history.length - 1;
                      return (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                          <div style={{ fontSize: 8, color: isLast ? "#00f5a0" : "#1e3a5f", fontFamily: mono, fontWeight: 700, whiteSpace: "nowrap" }}>₹{Math.round((record.average || 0) / 1000)}k</div>
                          <div style={{ width: "100%", height: barH, background: isLast ? "linear-gradient(180deg,#00f5a0,#007a55)" : "linear-gradient(180deg,#1e3a5f,#0d1421)", borderRadius: "4px 4px 0 0", transition: "height .8s cubic-bezier(.16,1,.3,1)" }} />
                          <div style={{ fontSize: 7, color: "#1e3a5f", fontFamily: mono }}>{record.date?.split(" ")[1] || ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {history.slice(-5).reverse().map((record, i) => (
                    <div key={i} style={{ background: "rgba(6,11,20,.5)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#1e3a5f", fontFamily: mono, marginBottom: 3 }}>🕐 {record.date}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: strategyColor }}>{record.strategy || "Competitive Pricing"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: "#00f5a0", fontFamily: mono }}>₹{record.average?.toLocaleString("en-IN")}</div>
                        <div style={{ fontSize: 9, color: "#1e3a5f", fontFamily: mono }}>AVG PRICE</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* RESET */}
        {priceData && !scraping && (
          <button onClick={handleReset}
            style={{ width: "100%", padding: "11px 0", borderRadius: 10, border: "1px solid rgba(30,58,95,.4)", background: "transparent", color: "#1e3a5f", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 24, letterSpacing: ".07em", fontFamily: sans }}
            onMouseEnter={e => e.currentTarget.style.color = "#3a5570"}
            onMouseLeave={e => e.currentTarget.style.color = "#1e3a5f"}>
            ↺ SCAN ANOTHER PRODUCT
          </button>
        )}

        {!priceData && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 6 }}>
            {Object.entries(PLATFORMS).map(([site, { logo }]) => (
              <div key={site} style={{ background: "rgba(13,20,33,.6)", border: "1px solid rgba(30,58,95,.4)", borderRadius: 12, padding: "10px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{logo}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,.5)", marginBottom: 2 }}>{site}</div>
                <div style={{ fontSize: 8, color: "#1e3a5f", fontFamily: mono }}>{site.toLowerCase()}.com</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 28 }}>
          <div style={{ fontSize: 10, color: "#0d1e30", fontFamily: mono, letterSpacing: ".1em" }}>
            PRICEINTEL.AI · GROQ + LLAMA-4 · 5 PLATFORMS · {new Date().getFullYear()}
          </div>
        </div>
      </div>
    </>
  );
}
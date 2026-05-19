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
    <div style={{ flex: 1, height: 7, background: "rgba(255,255,255,0.07)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 1s cubic-bezier(.16,1,.3,1)", boxShadow: `0 0 8px ${color}88` }} />
    </div>
  );
}

function PulseDot({ color = "#00f5a0" }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10, flexShrink: 0 }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, opacity: 0.5, animation: "ping 1.4s ease-out infinite" }} />
      <span style={{ position: "relative", borderRadius: "50%", width: 10, height: 10, background: color, boxShadow: `0 0 6px ${color}` }} />
    </span>
  );
}

const PLATFORMS = {
  Amazon:    { logo: "🛒", color: "#ff9900" },
  Snapdeal:  { logo: "🟡", color: "#e40046" },
  Flipkart:  { logo: "🛍️", color: "#2874f0" },
  Meesho:    { logo: "🟣", color: "#f43397" },
  IndiaMart: { logo: "🏭", color: "#00a651" },
};

// ── Section label with vivid glow badge ──
function SectionLabel({ n, text, live, liveColor = "#00f5a0", liveText }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
      {/* Number chip */}
      <div style={{
        background: `linear-gradient(135deg, ${liveColor}22, ${liveColor}08)`,
        border: `1px solid ${liveColor}55`,
        borderRadius: 8,
        padding: "3px 9px",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        fontWeight: 700,
        color: liveColor,
        letterSpacing: "0.06em",
        flexShrink: 0,
      }}>
        {n.toString().padStart(2, "0")}
      </div>
      {/* Label text */}
      <span style={{
        fontFamily: "'Syne', sans-serif",
        fontSize: 13,
        fontWeight: 800,
        color: "#e8f4ff",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}>{text}</span>
      {/* Live badge */}
      {live && (
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: `${liveColor}18`,
          border: `1px solid ${liveColor}44`,
          borderRadius: 99,
          padding: "2px 10px",
          marginLeft: 2,
        }}>
          <PulseDot color={liveColor} />
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9, fontWeight: 700,
            color: liveColor, letterSpacing: "0.12em",
          }}>{liveText || "LIVE"}</span>
        </div>
      )}
    </div>
  );
}

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
  const [lowConfidenceWarning, setLowConfidenceWarning] = useState(false);
  const [cacheHit, setCacheHit] = useState(false);
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
    setLowConfidenceWarning(false); setCacheHit(false);
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
      setLowConfidenceWarning(res.data.low_confidence_warning || res.data.product?.confidence < 0.5);
      setCacheHit(res.data.cache_hit || false);
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
      eventSource.addEventListener("session_started", (e) => { console.log("SSE session started:", JSON.parse(e.data)); });
      eventSource.addEventListener("price_scraped", (e) => {
        const data = JSON.parse(e.data);
        allResults.push({ site: data.source, title: data.product_name, price: data.price, currency: data.currency, url: data.product_url, logo: PLATFORMS[data.source]?.logo || "🛒", status: "success", match_score: data.match_score, latency_ms: data.latency_ms });
        if (scraperStatusMap[data.source]) { scraperStatusMap[data.source].status = "success"; scraperStatusMap[data.source].count += 1; }
        setPriceData(prev => ({ results: [...allResults], analysis: prev?.analysis || {}, scraper_status: Object.values(scraperStatusMap) }));
      });
      eventSource.addEventListener("scraper_failed", (e) => {
        const data = JSON.parse(e.data);
        if (scraperStatusMap[data.source]) { scraperStatusMap[data.source].status = "failed"; scraperStatusMap[data.source].reason = data.reason; }
        setPriceData(prev => ({ results: [...allResults], analysis: prev?.analysis || {}, scraper_status: Object.values(scraperStatusMap) }));
      });
      eventSource.addEventListener("analysis_ready", (e) => {
        const data = JSON.parse(e.data);
        const avg = allResults.length > 0 ? allResults.reduce((a, b) => a + b.price, 0) / allResults.length : 0;
        const latestAnalysis = { lowest: data.price_range.low, highest: data.price_range.high, average: Math.round(avg * 100) / 100, recommended: data.recommended_price, strategy: data.strategy, clusters: data.clusters, outliers_removed: data.outliers_removed, total_sources: data.total_sources, competitive_score: data.competitive_score, anomaly_rate: data.anomaly_rate };
        analysisRef.current = latestAnalysis;
        setPriceData(prev => ({ results: [...allResults], analysis: latestAnalysis, scraper_status: Object.values(scraperStatusMap) }));
      });
      eventSource.addEventListener("done", () => {
        eventSource.close(); setScraping(false);
        if (allResults.length > 0 && product) {
          axios.post(`${API_URL}/save-history`, { product_name: product.product_name, prices: allResults, analysis: analysisRef.current }).catch(() => {});
        }
      });
      eventSource.onerror = () => { eventSource.close(); setScraping(false); };
    } catch { setError("Price scraping failed."); setScraping(false); }
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
    setLowConfidenceWarning(false); setCacheHit(false);
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
    background: "rgba(10,17,30,0.92)",
    border: "1px solid rgba(40,75,130,0.5)",
    borderRadius: 18,
    padding: 22,
    marginBottom: 14,
    backdropFilter: "blur(28px)",
    animation: "fadeUp 0.45s cubic-bezier(.16,1,.3,1) both",
    boxShadow: "0 4px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
  };

  const successCount = priceData?.scraper_status?.filter(s => s.status === "success").length || 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #04090f; font-family: 'Syne', sans-serif; color: #e2e8f0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a1120; }
        ::-webkit-scrollbar-thumb { background: #1e3a6a; border-radius: 99px; }

        @keyframes ping    { 0%   { transform: scale(1);   opacity: .6; } 100% { transform: scale(2.6); opacity: 0; } }
        @keyframes fadeUp  { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideIn { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes scanline { 0% { transform: translateY(-100%); } 100% { transform: translateY(110vh); } }
        @keyframes glowBorder { 0%,100% { box-shadow: 0 0 0 0 rgba(0,245,160,0); border-color: rgba(0,245,160,.3); } 50% { box-shadow: 0 0 22px 2px rgba(0,245,160,.12); border-color: rgba(0,245,160,.7); } }
        @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
        @keyframes popIn   { 0% { transform: scale(0.92); opacity:0; } 100% { transform: scale(1); opacity:1; } }

        .btn-glow:hover  { transform: translateY(-2px); filter: brightness(1.12); box-shadow: 0 8px 32px rgba(0,0,0,.4); }
        .btn-glow:active { transform: translateY(0); }
        .row-hover:hover { border-color: rgba(0,245,160,.4) !important; transform: translateX(4px); background: rgba(0,245,160,.04) !important; }
        .tab-btn:hover   { color: #e2e8f0 !important; border-color: rgba(255,255,255,.2) !important; }
        .platform-badge:hover { transform: translateY(-3px); box-shadow: 0 6px 20px rgba(0,0,0,.4); }
        .listing-row     { animation: slideIn .35s cubic-bezier(.16,1,.3,1) both; }
        .spec-tag:hover  { background: rgba(59,158,255,.2) !important; }
      `}</style>

      {/* ── Background ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 90% 60% at 10% 5%, rgba(0,245,160,.09) 0%, transparent 55%), radial-gradient(ellipse 70% 75% at 90% 90%, rgba(59,158,255,.09) 0%, transparent 55%), radial-gradient(ellipse 50% 40% at 55% 50%, rgba(120,60,220,.04) 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(20,50,100,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(20,50,100,.14) 1px, transparent 1px)", backgroundSize: "52px 52px" }} />
        <div style={{ position: "absolute", left: 0, right: 0, height: "1.5px", background: "linear-gradient(90deg, transparent, rgba(0,245,160,.09), rgba(59,158,255,.09), transparent)", animation: "scanline 12s linear infinite", opacity: 0.7 }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", padding: "0 16px 56px", maxWidth: 590, margin: "0 auto" }}>

        {/* ── HEADER ── */}
        <header style={{ paddingTop: 24, paddingBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 42, height: 42, borderRadius: 13, background: "linear-gradient(135deg, #00f5a0, #00bcd4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 21, boxShadow: "0 0 28px rgba(0,245,160,.55), 0 0 60px rgba(0,245,160,.2)", flexShrink: 0 }}>◈</div>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-.025em", color: "#ffffff", lineHeight: 1.1 }}>
                  PriceIntel<span style={{ color: "#00f5a0", textShadow: "0 0 12px rgba(0,245,160,.6)" }}>.</span>AI
                </div>
                <div style={{ fontSize: 9, color: "#3a5f80", fontFamily: mono, letterSpacing: ".12em", marginTop: 1 }}>DYNAMIC PRICING ENGINE v3.0 · 5 PLATFORMS</div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: mono, fontSize: 15, color: "#00f5a0", fontWeight: 700, textShadow: "0 0 14px rgba(0,245,160,.5)", letterSpacing: ".04em" }}>{timeStr}</div>
              <div style={{ fontSize: 9, color: "#2a4a6a", fontFamily: mono, letterSpacing: ".1em", marginTop: 1 }}>IST · LIVE MARKET</div>
            </div>
          </div>

          {/* Step progress */}
          <div style={{ display: "flex", gap: 5 }}>
            {["Upload", "Identify", "Scan Prices", "Recommend"].map((label, i) => {
              const done = step > i + 1;
              const active = step === i + 1;
              const col = done ? "#00f5a0" : active ? "#00d4ff" : "#1a3050";
              return (
                <div key={label} style={{ flex: 1 }}>
                  <div style={{ height: 3, borderRadius: 99, marginBottom: 6, background: done ? "#00f5a0" : active ? "rgba(0,212,255,.6)" : "rgba(255,255,255,.06)", transition: "background .5s", boxShadow: done ? "0 0 8px rgba(0,245,160,.5)" : active ? "0 0 8px rgba(0,212,255,.4)" : "none" }} />
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", fontFamily: mono, color: col, transition: "color .5s" }}>
                    {done ? "✓ " : active ? "▶ " : ""}{label}
                  </div>
                </div>
              );
            })}
          </div>
        </header>

        {/* ── 01 UPLOAD ── */}
        <div style={{ ...card, ...(dragging && { animation: "glowBorder 1s ease infinite", borderColor: "rgba(0,245,160,.6)" }) }}>
          <SectionLabel n={1} text="Product Image" live={!!preview} liveColor="#00f5a0" liveText="LIVE" />

          <div
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            onClick={() => !preview && fileInputRef.current?.click()}
            style={{
              border: `1.5px dashed ${dragging ? "#00f5a0" : preview ? "rgba(0,245,160,.35)" : "rgba(40,80,140,.7)"}`,
              borderRadius: 13,
              padding: preview ? 14 : 36,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              cursor: preview ? "default" : "pointer",
              background: dragging ? "rgba(0,245,160,.04)" : preview ? "rgba(0,245,160,.025)" : "rgba(4,9,15,.6)",
              minHeight: preview ? 0 : 150,
              transition: "all .3s",
            }}>
            {preview ? (
              <div style={{ width: "100%", display: "flex", gap: 16, alignItems: "center" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <img src={preview} alt="product" style={{ width: 82, height: 82, borderRadius: 12, objectFit: "cover", border: "1.5px solid rgba(0,245,160,.35)", display: "block" }} />
                  <div style={{ position: "absolute", inset: -1, borderRadius: 13, boxShadow: "0 0 16px rgba(0,245,160,.2)", pointerEvents: "none" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#ffffff", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{image?.name}</div>
                  <div style={{ fontSize: 11, color: "#3a7090", fontFamily: mono, marginBottom: 12 }}>{(image?.size / 1024).toFixed(0)} KB · {image?.type?.split("/")[1]?.toUpperCase()}</div>
                  <button onClick={e => { e.stopPropagation(); handleReset(); }} style={{ fontSize: 11, color: "#f87171", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.25)", padding: "4px 12px", borderRadius: 7, cursor: "pointer", fontFamily: mono, transition: "all .2s" }}>✕ Remove</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 34, marginBottom: 12, opacity: .4 }}>⬆</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,.55)", marginBottom: 5 }}>Drop product image here</div>
                <div style={{ fontSize: 11, color: "#1e3a5f", fontFamily: mono }}>JPG · PNG · WebP · Max 10 MB</div>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={e => handleFile(e.target.files[0])} />

          {error && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(248,113,113,.07)", border: "1px solid rgba(248,113,113,.3)", borderRadius: 9, color: "#f87171", fontSize: 12, fontFamily: mono }}>⚠ {error}</div>
          )}

          {preview && !product && (
            <button className="btn-glow" onClick={handleIdentify} disabled={identifying}
              style={{ marginTop: 16, width: "100%", padding: "14px 0", borderRadius: 11, border: "none", cursor: identifying ? "not-allowed" : "pointer", background: identifying ? "rgba(0,245,160,.1)" : "linear-gradient(135deg,#00f5a0,#00bcd4)", color: identifying ? "#00f5a0" : "#04090f", fontSize: 13, fontWeight: 800, letterSpacing: ".05em", transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: sans }}>
              {identifying ? <><span style={{ width: 14, height: 14, border: "2.5px solid #00f5a0", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> ANALYZING IMAGE...</> : "⬡ IDENTIFY PRODUCT WITH AI"}
            </button>
          )}
        </div>

        {/* ── 02 PRODUCT INTEL ── */}
        {product && (
          <div style={{ ...card, animation: "popIn .4s cubic-bezier(.16,1,.3,1) both" }}>
            <SectionLabel n={2} text="Product Intel" live liveColor="#00d4ff" liveText="LIVE" />

            {cacheHit && (
              <div style={{ marginBottom: 12, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(59,158,255,.1)", border: "1px solid rgba(59,158,255,.3)", borderRadius: 99, padding: "4px 14px" }}>
                <span style={{ fontSize: 10, color: "#3b9eff", fontFamily: mono, fontWeight: 700 }}>⚡ CACHED — No AI call made</span>
              </div>
            )}
            {lowConfidenceWarning && (
              <div style={{ background: "rgba(248,113,113,.07)", border: "1px solid rgba(248,113,113,.35)", borderRadius: 9, padding: "10px 14px", marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: "#f87171", fontFamily: mono }}>⚠ LOW CONFIDENCE — Upload a clearer image for better results.</span>
              </div>
            )}

            {/* Product name + confidence */}
            <div style={{ display: "flex", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 21, fontWeight: 800, color: "#ffffff", lineHeight: 1.2, marginBottom: 5, letterSpacing: "-.01em" }}>{product.product_name}</div>
                <div style={{ fontSize: 12, fontFamily: mono, marginBottom: 0 }}>
                  <span style={{ color: "#00d4ff", fontWeight: 700 }}>{product.brand}</span>
                  <span style={{ color: "#1e3a5f", margin: "0 6px" }}>·</span>
                  <span style={{ color: "#7ab8d4" }}>{product.category}</span>
                </div>
              </div>
              {/* Confidence meter */}
              <div style={{
                background: product.confidence >= 0.8 ? "rgba(0,245,160,.1)" : product.confidence >= 0.6 ? "rgba(251,191,36,.1)" : "rgba(248,113,113,.1)",
                border: `1.5px solid ${product.confidence >= 0.8 ? "rgba(0,245,160,.35)" : product.confidence >= 0.6 ? "rgba(251,191,36,.35)" : "rgba(248,113,113,.35)"}`,
                borderRadius: 13,
                padding: "12px 16px",
                textAlign: "center",
                flexShrink: 0,
                boxShadow: product.confidence >= 0.8 ? "0 0 18px rgba(0,245,160,.15)" : "none",
              }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: product.confidence >= 0.8 ? "#00f5a0" : product.confidence >= 0.6 ? "#fbbf24" : "#f87171", lineHeight: 1, fontFamily: mono, textShadow: product.confidence >= 0.8 ? "0 0 12px rgba(0,245,160,.6)" : "none" }}>{Math.round(product.confidence * 100)}%</div>
                <div style={{ fontSize: 9, color: "#3a6070", marginTop: 4, letterSpacing: ".1em", fontFamily: mono }}>CONFIDENCE</div>
              </div>
            </div>

            {/* Specs */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
              {product.key_specs?.map((spec, i) => (
                <span key={i} className="spec-tag" style={{ fontSize: 11, background: "rgba(59,158,255,.12)", border: "1px solid rgba(59,158,255,.28)", color: "#7ac8ff", padding: "4px 12px", borderRadius: 99, fontFamily: mono, fontWeight: 600, transition: "all .2s" }}>{spec}</span>
              ))}
            </div>

            {/* Search query chip */}
            <div style={{ background: "rgba(4,9,15,.7)", border: "1px solid rgba(40,80,140,.45)", borderRadius: 9, padding: "10px 14px", marginBottom: 16 }}>
              <div style={{ fontSize: 9, color: "#2a4a6a", letterSpacing: ".12em", marginBottom: 5, fontFamily: mono }}>SEARCH QUERY</div>
              <div style={{ fontSize: 12, color: "#00d4ff", fontFamily: mono, fontWeight: 700, letterSpacing: ".02em" }}>{product.search_query}</div>
            </div>

            {!priceData && (
              <button className="btn-glow" onClick={handleScrape} disabled={scraping}
                style={{ width: "100%", padding: "14px 0", borderRadius: 11, border: "none", cursor: scraping ? "not-allowed" : "pointer", background: scraping ? "rgba(59,158,255,.1)" : "linear-gradient(135deg,#3b9eff,#0055d4)", color: scraping ? "#3b9eff" : "#ffffff", fontSize: 13, fontWeight: 800, letterSpacing: ".05em", transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: sans, boxShadow: scraping ? "none" : "0 0 24px rgba(59,158,255,.3)" }}>
                {scraping ? <><span style={{ width: 14, height: 14, border: "2.5px solid #3b9eff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> STREAMING LIVE PRICES...</> : "⚡ SCAN 5 PLATFORMS LIVE"}
              </button>
            )}
          </div>
        )}

        {/* ── LIVE STREAM STATUS ── */}
        {scraping && priceData && (
          <div style={{ ...card, borderColor: "rgba(0,245,160,.3)", animation: "glowBorder 2s ease infinite, fadeUp .5s cubic-bezier(.16,1,.3,1) both" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <PulseDot color="#00f5a0" />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#00f5a0", letterSpacing: ".12em", fontFamily: mono }}>LIVE SSE PRICE STREAM</span>
              </div>
              <span style={{ fontSize: 11, fontFamily: mono, color: "#4a7090", fontWeight: 700 }}>{successCount}<span style={{ color: "#1e3a5f" }}>/{Object.keys(PLATFORMS).length}</span> platforms</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {priceData.scraper_status?.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "rgba(4,9,15,.6)", borderRadius: 9, border: `1px solid ${s.status === "success" ? "rgba(0,245,160,.2)" : s.status === "failed" ? "rgba(248,113,113,.2)" : "rgba(40,80,140,.3)"}`, transition: "all .3s" }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{s.logo}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#ddeeff" }}>{s.site}</span>
                  {s.status === "pending" && <span style={{ width: 12, height: 12, border: "2px solid #fbbf24", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite", flexShrink: 0 }} />}
                  <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, flexShrink: 0, color: s.status === "success" ? "#00f5a0" : s.status === "failed" ? "#f87171" : "#fbbf24" }}>
                    {s.status === "success" ? `✓ ${s.count} found` : s.status === "failed" ? `✗ ${s.reason || "FAILED"}` : "searching..."}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 03 MARKET ANALYSIS ── */}
        {hasAnalysis && (
          <div style={card}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <SectionLabel n={3} text="Market Analysis" live liveColor={strategyColor} liveText="READY" />
              <div style={{ display: "flex", gap: 4 }}>
                {["analysis", "listings", "clusters"].map(tab => (
                  <button key={tab} className="tab-btn" onClick={() => setActiveTab(tab)}
                    style={{ fontSize: 9, fontWeight: 700, padding: "5px 10px", borderRadius: 7, border: "1px solid", borderColor: activeTab === tab ? `${strategyColor}55` : "rgba(30,60,120,.4)", background: activeTab === tab ? `${strategyColor}18` : "transparent", color: activeTab === tab ? strategyColor : "#3a5a70", cursor: "pointer", letterSpacing: ".08em", textTransform: "uppercase", fontFamily: mono, transition: "all .2s" }}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Platform status grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 18 }}>
              {priceData.scraper_status?.map((s, i) => (
                <div key={i} className="platform-badge" style={{
                  background: s.status === "success" ? "rgba(0,245,160,.07)" : "rgba(248,113,113,.06)",
                  border: `1px solid ${s.status === "success" ? "rgba(0,245,160,.25)" : "rgba(248,113,113,.2)"}`,
                  borderRadius: 11,
                  padding: "8px 4px",
                  textAlign: "center",
                  transition: "all .25s",
                  cursor: "default",
                  boxShadow: s.status === "success" ? "0 0 12px rgba(0,245,160,.08)" : "none",
                }}>
                  <div style={{ fontSize: 15, marginBottom: 3 }}>{s.logo}</div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: s.status === "success" ? "#c8e8ff" : "#8090a0", marginBottom: 3, letterSpacing: ".04em" }}>{s.site}</div>
                  <div style={{ fontSize: 10, fontFamily: mono, color: s.status === "success" ? "#00f5a0" : "#f87171", fontWeight: 700 }}>
                    {s.status === "success" ? `✓ ${s.count}` : "✗"}
                  </div>
                </div>
              ))}
            </div>

            {/* ── TAB: ANALYSIS ── */}
            {activeTab === "analysis" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 16 }}>
                  {[
                    { label: "LOWEST",    value: analysis.lowest,      color: "#00f5a0", icon: "▼", glow: "rgba(0,245,160,.18)" },
                    { label: "HIGHEST",   value: analysis.highest,     color: "#f87171", icon: "▲", glow: "rgba(248,113,113,.18)" },
                    { label: "AVERAGE",   value: analysis.average,     color: "#3b9eff", icon: "◈", glow: "rgba(59,158,255,.18)" },
                    { label: "SUGGESTED", value: analysis.recommended, color: "#f5a623", icon: "★", glow: "rgba(245,166,35,.22)", hl: true },
                  ].map(({ label, value, color, icon, glow, hl }) => (
                    <div key={label} style={{
                      background: hl ? "rgba(245,166,35,.07)" : "rgba(4,9,15,.6)",
                      border: `1px solid ${hl ? "rgba(245,166,35,.3)" : "rgba(40,80,140,.4)"}`,
                      borderRadius: 13,
                      padding: "14px 16px",
                      position: "relative",
                      overflow: "hidden",
                      boxShadow: hl ? "0 0 24px rgba(245,166,35,.1)" : "none",
                    }}>
                      {hl && <div style={{ position: "absolute", top: -10, right: -10, width: 70, height: 70, background: `radial-gradient(circle, ${glow}, transparent)`, pointerEvents: "none" }} />}
                      <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 8, fontFamily: mono, fontWeight: 700 }}>{icon} {label}</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: mono, textShadow: `0 0 14px ${glow}` }}>₹<AnimatedNumber value={value} /></div>
                    </div>
                  ))}
                </div>

                {/* Price range bar */}
                <div style={{ background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.4)", borderRadius: 13, padding: "14px 16px", marginBottom: 14 }}>
                  <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 12, fontFamily: mono, fontWeight: 700 }}>PRICE RANGE VISUALIZER</div>
                  {[["Lowest", analysis.lowest, "#00f5a0"], ["Average", analysis.average, "#3b9eff"], ["Highest", analysis.highest, "#f87171"], ["Suggested", analysis.recommended, "#f5a623"]].map(([label, value, color]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
                      <span style={{ width: 58, fontSize: 10, color: "#4a7090", fontFamily: mono, flexShrink: 0, fontWeight: 600 }}>{label}</span>
                      <MiniBar value={value} max={analysis.highest} color={color} />
                      <span style={{ width: 80, fontSize: 12, fontWeight: 800, color, textAlign: "right", fontFamily: mono, flexShrink: 0 }}>₹{value?.toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>

                {/* Strategy pill */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: `rgba(${strategyRgb},.08)`, border: `1px solid rgba(${strategyRgb},.3)`, borderRadius: 11, padding: "11px 16px", marginBottom: analysis.competitive_score ? 12 : 0, boxShadow: `0 0 20px rgba(${strategyRgb},.08)` }}>
                  <div style={{ width: 9, height: 9, borderRadius: "50%", background: strategyColor, boxShadow: `0 0 10px ${strategyColor}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: strategyColor }}>{analysis.strategy}</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#3a6070", fontFamily: mono }}>
                    <span style={{ color: "#6090a0", fontWeight: 700 }}>{analysis.total_sources}</span> listings · <span style={{ color: "#fbbf24" }}>{analysis.outliers_removed}</span> outliers removed
                  </span>
                </div>

                {/* Competitive score */}
                {analysis.competitive_score && (
                  <div style={{ background: "rgba(59,158,255,.07)", border: "1px solid rgba(59,158,255,.25)", borderRadius: 11, padding: "12px 16px" }}>
                    <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 8, fontFamily: mono, fontWeight: 700 }}>◎ COMPETITIVE SCORE</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,.06)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${analysis.competitive_score}%`, height: "100%", background: "linear-gradient(90deg, #3b9eff, #00f5a0)", borderRadius: 99, transition: "width 1.2s", boxShadow: "0 0 10px rgba(59,158,255,.5)" }} />
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 800, color: "#3b9eff", fontFamily: mono, textShadow: "0 0 10px rgba(59,158,255,.5)" }}>{analysis.competitive_score}<span style={{ fontSize: 10, color: "#2a5070" }}>/100</span></span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── TAB: LISTINGS ── */}
            {activeTab === "listings" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {priceData.results?.length === 0 && (
                  <div style={{ textAlign: "center", padding: "28px 0", color: "#1e3a5f", fontSize: 12, fontFamily: mono }}>— No listings found —</div>
                )}
                {priceData.results?.map((item, i) => (
                  <div key={i} className="row-hover listing-row" style={{ animationDelay: `${i * 45}ms`, background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.35)", borderRadius: 12, padding: "13px 15px", display: "flex", alignItems: "center", gap: 13, transition: "all .22s", cursor: "pointer" }}>
                    <div style={{ fontSize: 20, flexShrink: 0 }}>{item.logo}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, color: "#4a7090", letterSpacing: ".07em", marginBottom: 4, fontFamily: mono, fontWeight: 600 }}>{item.site}{item.match_score ? ` · ${item.match_score}% match` : ""}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#c8ddf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 800, color: "#00f5a0", fontFamily: mono, textShadow: "0 0 10px rgba(0,245,160,.4)" }}>₹{item.price?.toLocaleString("en-IN")}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#3b9eff", fontFamily: mono, textDecoration: "none", fontWeight: 700 }}>VIEW →</a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── TAB: CLUSTERS ── */}
            {activeTab === "clusters" && (
              <>
                <div style={{ display: "flex", gap: 9, marginBottom: 14 }}>
                  {analysis.clusters?.map((c, i) => {
                    const cls = [
                      { c: "#00f5a0", bg: "rgba(0,245,160,.08)", bd: "rgba(0,245,160,.25)", w: "33%" },
                      { c: "#3b9eff", bg: "rgba(59,158,255,.08)", bd: "rgba(59,158,255,.25)", w: "66%" },
                      { c: "#f5a623", bg: "rgba(245,166,35,.08)", bd: "rgba(245,166,35,.25)", w: "100%" }
                    ][i] || {};
                    return (
                      <div key={i} style={{ flex: 1, background: cls.bg, border: `1px solid ${cls.bd}`, borderRadius: 13, padding: "16px 12px", textAlign: "center", boxShadow: `0 0 16px ${cls.c}15` }}>
                        <div style={{ fontSize: 9, color: cls.c, letterSpacing: ".12em", marginBottom: 10, fontFamily: mono, fontWeight: 800 }}>{c.tier.toUpperCase()}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", fontFamily: mono, textShadow: `0 0 12px ${cls.c}80` }}>₹{c.center_price?.toLocaleString("en-IN")}</div>
                        <div style={{ width: "100%", height: 3, background: `${cls.c}22`, borderRadius: 99, marginTop: 12 }}>
                          <div style={{ height: "100%", background: cls.c, borderRadius: 99, width: cls.w, transition: "width 1.2s", boxShadow: `0 0 8px ${cls.c}` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.4)", borderRadius: 11, padding: "12px 16px" }}>
                  <div style={{ fontSize: 11, color: "#4a7090", fontFamily: mono, lineHeight: 1.75 }}>
                    KMeans clustering · <span style={{ color: "#7ab8d4", fontWeight: 700 }}>{analysis.total_sources}</span> price points across 5 platforms<br />
                    IsolationForest removed <span style={{ color: "#fbbf24", fontWeight: 700 }}>{analysis.outliers_removed}</span> statistical outlier{analysis.outliers_removed !== 1 ? "s" : ""}
                    {analysis.anomaly_rate > 0 && <><br /><span style={{ color: "#fbbf24" }}>Anomaly rate: {(analysis.anomaly_rate * 100).toFixed(0)}%</span></>}
                  </div>
                </div>
              </>
            )}

            {!recommendation && !scraping && (
              <button className="btn-glow" onClick={handleRecommend} disabled={recommending}
                style={{ marginTop: 16, width: "100%", padding: "14px 0", borderRadius: 11, border: "none", cursor: recommending ? "not-allowed" : "pointer", background: recommending ? "rgba(245,166,35,.1)" : "linear-gradient(135deg,#f5a623,#e8430a)", color: recommending ? "#f5a623" : "#ffffff", fontSize: 13, fontWeight: 800, letterSpacing: ".05em", transition: "all .25s", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, fontFamily: sans, boxShadow: recommending ? "none" : "0 0 28px rgba(245,166,35,.3)" }}>
                {recommending ? <><span style={{ width: 14, height: 14, border: "2.5px solid #f5a623", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" }} /> AI ANALYSING MARKET...</> : "★ GET AI PRICE RECOMMENDATION"}
              </button>
            )}
          </div>
        )}

        {/* ── 04 AI RECOMMENDATION ── */}
        {recommendation && (
          <div style={{ ...card, borderColor: "rgba(245,166,35,.35)", boxShadow: "0 0 50px rgba(245,166,35,.1), 0 4px 32px rgba(0,0,0,.4)", animation: "popIn .4s cubic-bezier(.16,1,.3,1) both" }}>
            <SectionLabel n={4} text="AI Recommendation" live liveColor="#f5a623" liveText="READY" />

            {/* Price hero */}
            <div style={{ textAlign: "center", background: "rgba(245,166,35,.07)", border: "1px solid rgba(245,166,35,.25)", borderRadius: 16, padding: "26px 16px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(245,166,35,.09), transparent)", pointerEvents: "none" }} />
              <div style={{ fontSize: 10, color: "#5a6070", letterSpacing: ".16em", marginBottom: 10, fontFamily: mono, fontWeight: 700 }}>RECOMMENDED SELLING PRICE</div>
              <div style={{ fontSize: 46, fontWeight: 800, color: "#f5a623", fontFamily: mono, lineHeight: 1, marginBottom: 14, textShadow: "0 0 28px rgba(245,166,35,.6)" }}>₹<AnimatedNumber value={recommendation.recommended_price} /></div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: `rgba(${strategyRgb},.14)`, border: `1px solid rgba(${strategyRgb},.35)`, borderRadius: 99, padding: "6px 18px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: strategyColor, display: "inline-block", boxShadow: `0 0 8px ${strategyColor}` }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: strategyColor, fontFamily: mono, letterSpacing: ".06em" }}>{recommendation.strategy}</span>
              </div>
            </div>

            {/* Market summary */}
            <div style={{ background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.4)", borderRadius: 11, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 7, fontFamily: mono, fontWeight: 700 }}>◈ MARKET SUMMARY</div>
              <div style={{ fontSize: 13, color: "#b0cce0", lineHeight: 1.7 }}>{recommendation.market_summary}</div>
            </div>

            {/* Rationale */}
            <div style={{ background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.4)", borderRadius: 11, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 7, fontFamily: mono, fontWeight: 700 }}>★ RATIONALE</div>
              <div style={{ fontSize: 13, color: "#b0cce0", lineHeight: 1.7 }}>{recommendation.reason}</div>
            </div>

            {/* Risk factors */}
            {recommendation.risk_factors && (
              <div style={{ background: "rgba(248,113,113,.05)", border: "1px solid rgba(248,113,113,.22)", borderRadius: 11, padding: "14px 16px", marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "#f87171", letterSpacing: ".12em", marginBottom: 7, fontFamily: mono, fontWeight: 700 }}>⚠ RISK FACTORS</div>
                <div style={{ fontSize: 13, color: "#d0a8a8", lineHeight: 1.7 }}>{recommendation.risk_factors}</div>
              </div>
            )}

            {/* Competitive score */}
            {recommendation.competitive_score && (
              <div style={{ background: "rgba(59,158,255,.07)", border: "1px solid rgba(59,158,255,.22)", borderRadius: 11, padding: "12px 16px", marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 8, fontFamily: mono, fontWeight: 700 }}>◎ COMPETITIVE SCORE</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,.06)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${recommendation.competitive_score}%`, height: "100%", background: "linear-gradient(90deg,#3b9eff,#00f5a0)", borderRadius: 99, boxShadow: "0 0 10px rgba(59,158,255,.5)" }} />
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#3b9eff", fontFamily: mono }}>{recommendation.competitive_score}<span style={{ fontSize: 10, color: "#2a5070" }}>/100</span></span>
                </div>
              </div>
            )}

            {/* Confidence badge */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "rgba(0,245,160,.07)", border: "1px solid rgba(0,245,160,.25)", borderRadius: 11, padding: "12px 16px", boxShadow: "0 0 18px rgba(0,245,160,.07)" }}>
              <div style={{ width: 9, height: 9, borderRadius: "50%", background: "#00f5a0", boxShadow: "0 0 10px #00f5a0", animation: "ping 2s ease-out infinite" }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: "#00f5a0", fontFamily: mono, letterSpacing: ".08em", textShadow: "0 0 12px rgba(0,245,160,.5)" }}>CONFIDENCE: {recommendation.confidence?.toUpperCase()}</span>
            </div>
          </div>
        )}

        {/* ── HISTORY BUTTON ── */}
        {priceData && product && !scraping && (
          <button onClick={loadHistory}
            style={{ width: "100%", padding: "13px 0", borderRadius: 11, border: "1px solid rgba(59,158,255,.3)", background: "rgba(59,158,255,.07)", color: "#3b9eff", fontSize: 13, fontWeight: 700, cursor: "pointer", marginBottom: 10, letterSpacing: ".05em", fontFamily: sans, transition: "all .25s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,158,255,.14)"; e.currentTarget.style.boxShadow = "0 0 20px rgba(59,158,255,.15)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(59,158,255,.07)"; e.currentTarget.style.boxShadow = "none"; }}>
            ⟳ VIEW PRICE HISTORY
          </button>
        )}

        {/* ── HISTORY PANEL ── */}
        {showHistory && (
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#c8ddf0", letterSpacing: ".06em", textTransform: "uppercase", fontFamily: sans }}>Price History <span style={{ color: "#3b9eff", fontFamily: mono, fontSize: 12 }}>· {history.length} records</span></span>
              <button onClick={() => setShowHistory(false)} style={{ fontSize: 10, color: "#f87171", background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.25)", padding: "4px 12px", borderRadius: 7, cursor: "pointer", fontFamily: mono, fontWeight: 700 }}>✕ CLOSE</button>
            </div>
            {history.length === 0 ? (
              <div style={{ textAlign: "center", padding: "28px 0", color: "#1e3a5f", fontSize: 12, fontFamily: mono }}>— No prior records —</div>
            ) : (
              <>
                <div style={{ background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.4)", borderRadius: 13, padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "#2a5070", letterSpacing: ".12em", marginBottom: 12, fontFamily: mono, fontWeight: 700 }}>AVERAGE PRICE TREND</div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 96 }}>
                    {history.map((record, i) => {
                      const maxPrice = Math.max(...history.map(r => r.average || 0));
                      const barH = maxPrice > 0 ? Math.max((record.average / maxPrice) * 72, 6) : 6;
                      const isLast = i === history.length - 1;
                      return (
                        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={{ fontSize: 8, color: isLast ? "#00f5a0" : "#2a4a6a", fontFamily: mono, fontWeight: 700, whiteSpace: "nowrap" }}>₹{Math.round((record.average || 0) / 1000)}k</div>
                          <div style={{ width: "100%", height: barH, background: isLast ? "linear-gradient(180deg,#00f5a0,#007a55)" : "linear-gradient(180deg,#1e3a5f,#0d1421)", borderRadius: "4px 4px 0 0", transition: "height .9s", boxShadow: isLast ? "0 0 8px rgba(0,245,160,.35)" : "none" }} />
                          <div style={{ fontSize: 7, color: "#1e3a5f", fontFamily: mono }}>{record.date?.split(" ")[1] || ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {history.slice(-5).reverse().map((record, i) => (
                    <div key={i} style={{ background: "rgba(4,9,15,.6)", border: "1px solid rgba(40,80,140,.35)", borderRadius: 11, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ fontSize: 10, color: "#2a5070", fontFamily: mono, marginBottom: 4, fontWeight: 600 }}>🕐 {record.date}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: strategyColor }}>{record.strategy || "Competitive Pricing"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#00f5a0", fontFamily: mono, textShadow: "0 0 10px rgba(0,245,160,.4)" }}>₹{record.average?.toLocaleString("en-IN")}</div>
                        <div style={{ fontSize: 9, color: "#2a5070", fontFamily: mono, fontWeight: 600 }}>AVG PRICE</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── RESET ── */}
        {priceData && !scraping && (
          <button onClick={handleReset}
            style={{ width: "100%", padding: "12px 0", borderRadius: 11, border: "1px solid rgba(40,80,140,.35)", background: "transparent", color: "#2a4a6a", fontSize: 12, fontWeight: 700, cursor: "pointer", marginBottom: 24, letterSpacing: ".08em", fontFamily: sans, transition: "all .25s" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#5a8090"; e.currentTarget.style.borderColor = "rgba(40,80,140,.6)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#2a4a6a"; e.currentTarget.style.borderColor = "rgba(40,80,140,.35)"; }}>
            ↺ SCAN ANOTHER PRODUCT
          </button>
        )}

        {/* ── IDLE PLATFORM GRID ── */}
        {!priceData && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 7, marginTop: 6 }}>
            {Object.entries(PLATFORMS).map(([site, { logo, color }]) => (
              <div key={site} style={{ background: "rgba(10,17,30,.7)", border: "1px solid rgba(30,60,120,.4)", borderRadius: 13, padding: "12px 4px", textAlign: "center", transition: "all .25s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${color}55`; e.currentTarget.style.boxShadow = `0 0 16px ${color}22`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(30,60,120,.4)"; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ fontSize: 17, marginBottom: 5 }}>{logo}</div>
                <div style={{ fontSize: 10, fontWeight: 800, color: "#8090a8", marginBottom: 3, letterSpacing: ".04em" }}>{site}</div>
                <div style={{ fontSize: 8, color: "#1e3a5f", fontFamily: mono, fontWeight: 700 }}>LIVE</div>
              </div>
            ))}
          </div>
        )}

        {/* ── FOOTER ── */}
        <div style={{ textAlign: "center", marginTop: 32 }}>
          <div style={{ fontSize: 10, color: "#0d1e30", fontFamily: mono, letterSpacing: ".12em" }}>
            PRICEINTEL.AI · GROQ + LLAMA-4 · 5 PLATFORMS · {new Date().getFullYear()}
          </div>
        </div>
      </div>
    </>
  );
}
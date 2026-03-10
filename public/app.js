const FEAR_GREED_API_URL = "https://api.alternative.me/fng/?limit=1";
const FEAR_GREED_FALLBACK_SECONDS = 900;
const FEAR_GREED_INITIAL_RETRY_SECONDS = 30;
const WIDGET_LOAD_TIMEOUT_MS = 12000;
const USE_DIRECT_CHARTS = false;

const MARKET_SYMBOLS = {
  BTC: { tv: "BINANCE:BTCUSDT", title: "BTC/USD" },
  VIX: { tv: "AMEX:VXX", title: "VIX Proxy" },
  DXY: { tv: "AMEX:UUP", title: "DXY Proxy" },
  US10Y: { tv: "AMEX:IEF", title: "US10Y Proxy" },
  NDX: { tv: "NASDAQ:QQQ", title: "Nasdaq 100 Proxy" },
  SPX: { tv: "AMEX:SPY", title: "S&P 500 Proxy" },
};

const WIDGETS = [
  {
    containerId: "chart-btc",
    statusId: "status-btc",
    symbol: MARKET_SYMBOLS.BTC.tv,
    fallbackKey: "BTC",
    label: "BTC/USD",
    main: true,
  },
  {
    containerId: "chart-vix",
    statusId: "status-vix",
    symbol: MARKET_SYMBOLS.VIX.tv,
    fallbackKey: "VIX",
    label: "VIX",
    main: false,
  },
  {
    containerId: "chart-dxy",
    statusId: "status-dxy",
    symbol: MARKET_SYMBOLS.DXY.tv,
    fallbackKey: "DXY",
    label: "DXY",
    main: false,
  },
  {
    containerId: "chart-us10y",
    statusId: "status-us10y",
    symbol: MARKET_SYMBOLS.US10Y.tv,
    fallbackKey: "US10Y",
    label: "US10Y",
    main: false,
  },
  {
    containerId: "chart-ndx",
    statusId: "status-ndx",
    symbol: MARKET_SYMBOLS.NDX.tv,
    fallbackKey: "NDX",
    label: "Nasdaq 100",
    main: false,
  },
  {
    containerId: "chart-spx",
    statusId: "status-spx",
    symbol: MARKET_SYMBOLS.SPX.tv,
    fallbackKey: "SPX",
    label: "S&P 500",
    main: false,
  },
];

const FNG_CLASSIFICATION_MAP = {
  "Extreme Fear": "극도의 공포",
  Fear: "공포",
  Neutral: "중립",
  Greed: "탐욕",
  "Extreme Greed": "극도의 탐욕",
};

const YAHOO_SYMBOL_MAP = {
  VIX: "%5EVIX",
  DXY: "DX-Y.NYB",
  US10Y: "%5ETNX",
  NDX: "%5ENDX",
  SPX: "%5EGSPC",
};

let tradingViewScriptPromise = null;
let lightweightChartsPromise = null;
let chartsInitialized = false;
let tickerInitialized = false;
let fearGreedTimerId = null;
let fearGreedInFlight = false;
let lastFearGreedData = null;
let lastFearGreedFetchedAt = 0;
const activeFallbacks = new Set();

document.addEventListener("DOMContentLoaded", () => {
  initTickerTape();
  initTradingViewCharts();
  initFearAndGreedCard();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearFearGreedTimer();
      return;
    }

    if (Date.now() - lastFearGreedFetchedAt > 60 * 1000) {
      fetchFearAndGreed();
    } else if (!fearGreedTimerId && lastFearGreedData?.time_until_update) {
      scheduleFearAndGreedFetch(lastFearGreedData.time_until_update);
    }
  });
});

function initTickerTape() {
  if (tickerInitialized) return;
  tickerInitialized = true;

  const target = document.getElementById("ticker-widget");
  const statusEl = document.getElementById("ticker-status");
  if (!target || !statusEl) return;

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
  script.async = true;
  script.defer = true;
  script.text = JSON.stringify({
    symbols: [
      { proName: MARKET_SYMBOLS.BTC.tv, title: MARKET_SYMBOLS.BTC.title },
      { proName: MARKET_SYMBOLS.VIX.tv, title: MARKET_SYMBOLS.VIX.title },
      { proName: MARKET_SYMBOLS.DXY.tv, title: MARKET_SYMBOLS.DXY.title },
      { proName: MARKET_SYMBOLS.US10Y.tv, title: MARKET_SYMBOLS.US10Y.title },
      { proName: MARKET_SYMBOLS.NDX.tv, title: MARKET_SYMBOLS.NDX.title },
      { proName: MARKET_SYMBOLS.SPX.tv, title: MARKET_SYMBOLS.SPX.title },
    ],
    showSymbolLogo: false,
    colorTheme: "dark",
    isTransparent: true,
    displayMode: "compact",
    locale: "kr",
  });
  target.appendChild(script);

  window.setTimeout(() => {
    const hasIframe = target.querySelector("iframe");
    if (!hasIframe) statusEl.hidden = false;
  }, WIDGET_LOAD_TIMEOUT_MS);
}

function initTradingViewCharts() {
  if (chartsInitialized) return;
  chartsInitialized = true;

  if (USE_DIRECT_CHARTS) {
    for (const widgetInfo of WIDGETS) {
      activeFallbacks.add(widgetInfo.containerId);
      renderFallbackChart(widgetInfo).catch(() => {
        showStatus(widgetInfo.statusId, `${widgetInfo.label} 데이터 수신 실패`);
      });
    }
    return;
  }

  for (const widgetInfo of WIDGETS) {
    trackWidgetLoad(widgetInfo);
  }

  loadTradingViewScript()
    .then(() => {
      for (const widgetInfo of WIDGETS) {
        createTradingViewWidget(widgetInfo);
      }
    })
    .catch(() => {
      for (const widgetInfo of WIDGETS) {
        activateDirectFallback(widgetInfo, "위젯 로더 실패");
      }
    });
}

function createTradingViewWidget(widgetInfo) {
  if (!window.TradingView) return;
  const container = document.getElementById(widgetInfo.containerId);
  if (!container) return;

  const options = {
    autosize: true,
    symbol: widgetInfo.symbol,
    interval: widgetInfo.main ? "30" : "60",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "kr",
    enable_publishing: false,
    allow_symbol_change: false,
    load_last_chart: false,
    disabled_features: ["use_localstorage_for_settings"],
    calendar: false,
    container_id: widgetInfo.containerId,
  };

  if (widgetInfo.main) {
    options.withdateranges = true;
    options.hide_side_toolbar = false;
    options.details = true;
    options.hotlist = false;
  } else {
    options.hide_top_toolbar = true;
    options.hide_side_toolbar = true;
    options.withdateranges = false;
    options.details = false;
  }

  new window.TradingView.widget(options);
}

function loadTradingViewScript() {
  if (tradingViewScriptPromise) return tradingViewScriptPromise;
  if (window.TradingView) return Promise.resolve();

  tradingViewScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("TradingView script load failed"));
    document.head.appendChild(script);
  });

  return tradingViewScriptPromise;
}

function loadLightweightChartsScript() {
  if (lightweightChartsPromise) return lightweightChartsPromise;
  if (window.LightweightCharts) return Promise.resolve();

  lightweightChartsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Lightweight Charts script load failed"));
    document.head.appendChild(script);
  });

  return lightweightChartsPromise;
}

function trackWidgetLoad(widgetInfo) {
  const container = document.getElementById(widgetInfo.containerId);
  const statusEl = document.getElementById(widgetInfo.statusId);
  if (!container || !statusEl) return;

  const observer = new MutationObserver(() => {
    const hasIframe = container.querySelector("iframe");
    if (hasIframe) {
      statusEl.hidden = true;
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true, subtree: true });

  window.setTimeout(() => {
    const hasIframe = container.querySelector("iframe");
    if (!hasIframe) {
      activateDirectFallback(widgetInfo, "위젯 응답 지연");
    }
    observer.disconnect();
  }, WIDGET_LOAD_TIMEOUT_MS);
}

function activateDirectFallback(widgetInfo, reason) {
  if (activeFallbacks.has(widgetInfo.containerId)) return;
  activeFallbacks.add(widgetInfo.containerId);

  showStatus(widgetInfo.statusId, `${widgetInfo.label} ${reason} · 직접 렌더링 전환`);
  renderFallbackChart(widgetInfo).catch(() => {
    showStatus(widgetInfo.statusId, `${widgetInfo.label} 직접 렌더링 데이터 수신 실패`);
  });
}

async function renderFallbackChart(widgetInfo) {
  await loadLightweightChartsScript();
  const data = await fetchFallbackSeries(widgetInfo.fallbackKey);
  if (!data.length) throw new Error("No fallback data");

  const container = document.getElementById(widgetInfo.containerId);
  if (!container || !window.LightweightCharts) return;

  container.innerHTML = "";

  const chart = window.LightweightCharts.createChart(container, {
    layout: {
      textColor: "#d2def4",
      background: { type: "solid", color: "transparent" },
    },
    grid: {
      vertLines: { color: "rgba(110, 125, 161, 0.16)" },
      horzLines: { color: "rgba(110, 125, 161, 0.16)" },
    },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: "rgba(110, 125, 161, 0.5)" },
    timeScale: { borderColor: "rgba(110, 125, 161, 0.5)" },
    localization: { locale: "ko-KR" },
  });

  const series = chart.addAreaSeries({
    lineColor: "#54d2ff",
    topColor: "rgba(84, 210, 255, 0.35)",
    bottomColor: "rgba(84, 210, 255, 0.03)",
    lineWidth: 2,
  });
  series.setData(data);

  const resizeObserver = new ResizeObserver(() => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width > 0 && height > 0) chart.resize(width, height);
  });
  resizeObserver.observe(container);
}

async function fetchFallbackSeries(key) {
  if (key === "BTC") {
    return fetchBinanceSeries();
  }
  return fetchYahooSeries(key);
}

async function fetchBinanceSeries() {
  const response = await fetch(
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=240",
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error(`BTC fallback HTTP ${response.status}`);

  const payload = await response.json();
  return payload
    .map((row) => {
      const time = Math.floor(Number(row[0]) / 1000);
      const value = Number(row[4]);
      if (!Number.isFinite(time) || !Number.isFinite(value)) return null;
      return { time, value };
    })
    .filter(Boolean);
}

async function fetchYahooSeries(key) {
  const symbol = YAHOO_SYMBOL_MAP[key];
  if (!symbol) return [];

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=6mo`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Yahoo fallback HTTP ${response.status}`);

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const output = [];

  for (let i = 0; i < timestamps.length; i += 1) {
    const time = Number(timestamps[i]);
    const value = Number(closes[i]);
    if (!Number.isFinite(time) || !Number.isFinite(value)) continue;
    output.push({ time, value });
  }

  return output;
}

function initFearAndGreedCard() {
  fetchFearAndGreed();
}

async function fetchFearAndGreed() {
  if (fearGreedInFlight || document.hidden) return;
  fearGreedInFlight = true;
  clearFearGreedTimer();

  try {
    const response = await fetch(FEAR_GREED_API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const item = payload?.data?.[0];
    if (!item) throw new Error("Missing fear and greed payload");

    lastFearGreedData = item;
    lastFearGreedFetchedAt = Date.now();
    renderFearAndGreed(item, false);

    const nextSeconds = Number(item.time_until_update) || FEAR_GREED_FALLBACK_SECONDS;
    scheduleFearAndGreedFetch(nextSeconds);
  } catch {
    if (lastFearGreedData) {
      renderFearAndGreed(lastFearGreedData, true);
      scheduleFearAndGreedFetch(FEAR_GREED_FALLBACK_SECONDS);
    } else {
      renderFearAndGreedUnavailable();
      scheduleFearAndGreedFetch(FEAR_GREED_INITIAL_RETRY_SECONDS);
    }
  } finally {
    fearGreedInFlight = false;
  }
}

function scheduleFearAndGreedFetch(seconds) {
  if (document.hidden) return;
  clearFearGreedTimer();

  const waitMs = Math.max(30, Number(seconds) || FEAR_GREED_FALLBACK_SECONDS) * 1000;
  fearGreedTimerId = window.setTimeout(() => {
    fetchFearAndGreed();
  }, waitMs);
}

function clearFearGreedTimer() {
  if (!fearGreedTimerId) return;
  window.clearTimeout(fearGreedTimerId);
  fearGreedTimerId = null;
}

function renderFearAndGreed(item, isStale) {
  const valueEl = document.getElementById("fng-value");
  const classEl = document.getElementById("fng-classification");
  const updatedEl = document.getElementById("fng-updated");
  const statusEl = document.getElementById("fng-status");
  const badgeEl = document.getElementById("fng-badge");
  const card = document.querySelector(".card-fng");
  if (!valueEl || !classEl || !updatedEl || !statusEl || !badgeEl || !card) return;

  const numericValue = Number(item.value);
  const rawClass = String(item.value_classification || "Neutral");
  const translatedClass = FNG_CLASSIFICATION_MAP[rawClass] || rawClass;
  const updatedTime = formatTimestamp(item.timestamp);

  valueEl.textContent = Number.isFinite(numericValue) ? String(numericValue) : "N/A";
  classEl.textContent = translatedClass;
  updatedEl.textContent = `업데이트: ${updatedTime}`;

  card.classList.remove("fng-fear", "fng-greed", "fng-neutral");
  const toneClass = resolveFearGreedTone(rawClass, numericValue);
  card.classList.add(`fng-${toneClass}`);

  if (isStale) {
    statusEl.textContent = "상태: 연결 지연 (마지막 수신값 유지)";
    badgeEl.textContent = "연결 지연";
    badgeEl.className = "chip";
    return;
  }

  statusEl.textContent = "상태: 정상 수신";
  badgeEl.textContent = "실시간";
  badgeEl.className = "chip chip-primary";
}

function renderFearAndGreedUnavailable() {
  const valueEl = document.getElementById("fng-value");
  const classEl = document.getElementById("fng-classification");
  const updatedEl = document.getElementById("fng-updated");
  const statusEl = document.getElementById("fng-status");
  const badgeEl = document.getElementById("fng-badge");
  const card = document.querySelector(".card-fng");
  if (!valueEl || !classEl || !updatedEl || !statusEl || !badgeEl || !card) return;

  valueEl.textContent = "N/A";
  classEl.textContent = "데이터 없음";
  updatedEl.textContent = "업데이트: -";
  statusEl.textContent = "상태: 연결 지연 (30초 후 재시도)";
  badgeEl.textContent = "초기 실패";
  badgeEl.className = "chip";
  card.classList.remove("fng-fear", "fng-greed");
  card.classList.add("fng-neutral");
}

function resolveFearGreedTone(rawClass, numericValue) {
  const lower = String(rawClass).toLowerCase();
  if (lower.includes("greed")) return "greed";
  if (lower.includes("fear")) return "fear";
  if (Number.isFinite(numericValue)) {
    if (numericValue > 50) return "greed";
    if (numericValue < 50) return "fear";
  }
  return "neutral";
}

function formatTimestamp(unixTimestamp) {
  const value = Number(unixTimestamp);
  if (!Number.isFinite(value)) return "-";

  const date = new Date(value * 1000);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function showStatus(statusId, text) {
  const statusEl = document.getElementById(statusId);
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.hidden = false;
}

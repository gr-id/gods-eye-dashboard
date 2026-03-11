const express = require("express");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { XMLParser } = require("fast-xml-parser");

initializeApp();
const db = getFirestore();
const LAYOUT_DOC = db.collection("layouts").doc("global");
const GOOGLE_NEWS_RSS_URL =
  "https://news.google.com/rss/search?q=stock+market+OR+federal+reserve+OR+inflation+OR+bitcoin&hl=en-US&gl=US&ceid=US:en";
const GEMINI_MODEL_CANDIDATES = ["gemini-2.5-pro", "gemini-2.5-flash"];

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const FRED_API_KEY = defineSecret("FRED_API_KEY");
const LAYOUT_ADMIN_PIN = defineSecret("LAYOUT_ADMIN_PIN");

const CANDIDATE_SYMBOLS = [
  {
    symbol: "BINANCE:BTCUSDT",
    title: "BTC/USD",
    reason: "디지털 자산 위험선호 지표",
    tags: ["crypto", "risk-on", "global"],
    aliases: ["btc", "bitcoin", "비트코인"],
  },
  {
    symbol: "AMEX:SPY",
    title: "S&P 500",
    reason: "미국 대형주 대표 지수",
    tags: ["us", "index", "equity", "risk-on"],
    aliases: ["sp500", "s&p", "미국지수"],
  },
  {
    symbol: "NASDAQ:QQQ",
    title: "Nasdaq 100",
    reason: "기술 성장주 민감도",
    tags: ["us", "index", "tech", "ai", "risk-on"],
    aliases: ["nasdaq", "qqq", "나스닥"],
  },
  {
    symbol: "AMEX:IWM",
    title: "Russell 2000",
    reason: "중소형주 체력 확인",
    tags: ["us", "small-cap", "equity", "risk-on"],
    aliases: ["russell", "iwm"],
  },
  {
    symbol: "AMEX:VXX",
    title: "VIX Proxy",
    reason: "변동성 리스크 확인",
    tags: ["volatility", "hedge", "risk-off"],
    aliases: ["vix", "변동성", "공포지수"],
  },
  {
    symbol: "AMEX:UUP",
    title: "DXY Proxy",
    reason: "달러 강세 흐름 추적",
    tags: ["dollar", "macro", "risk-off"],
    aliases: ["dxy", "달러", "환율"],
  },
  {
    symbol: "AMEX:IEF",
    title: "US10Y Proxy",
    reason: "중장기 금리 방향성",
    tags: ["rates", "bond", "macro"],
    aliases: ["us10y", "국채", "금리"],
  },
  {
    symbol: "AMEX:TLT",
    title: "US20Y+ Bond",
    reason: "장기채 듀레이션 민감도",
    tags: ["rates", "bond", "duration"],
    aliases: ["tlt", "장기채"],
  },
  {
    symbol: "COMEX:GC1!",
    title: "Gold Futures",
    reason: "안전자산 선호도",
    tags: ["commodity", "gold", "risk-off", "inflation"],
    aliases: ["gold", "금", "안전자산"],
  },
  {
    symbol: "NYMEX:CL1!",
    title: "Crude Oil Futures",
    reason: "에너지/인플레이션 압력",
    tags: ["commodity", "energy", "inflation"],
    aliases: ["oil", "원유", "에너지"],
  },
  {
    symbol: "AMEX:GLD",
    title: "Gold ETF",
    reason: "금 현물 대체 추적",
    tags: ["commodity", "gold", "etf", "risk-off"],
    aliases: ["gld", "gold etf"],
  },
  {
    symbol: "AMEX:SLV",
    title: "Silver ETF",
    reason: "산업+귀금속 혼합 민감도",
    tags: ["commodity", "silver", "etf"],
    aliases: ["silver", "은", "slv"],
  },
  {
    symbol: "AMEX:XLE",
    title: "Energy Sector",
    reason: "에너지 섹터 상대강도",
    tags: ["us", "sector", "energy", "theme"],
    aliases: ["xle", "에너지섹터"],
  },
  {
    symbol: "AMEX:XLK",
    title: "Technology Sector",
    reason: "기술 섹터 모멘텀",
    tags: ["us", "sector", "tech", "ai", "theme"],
    aliases: ["xlk", "기술섹터"],
  },
  {
    symbol: "AMEX:XLF",
    title: "Financial Sector",
    reason: "금리-은행 민감도",
    tags: ["us", "sector", "financial", "macro"],
    aliases: ["xlf", "금융섹터"],
  },
  {
    symbol: "AMEX:EEM",
    title: "Emerging Markets",
    reason: "신흥국 위험선호 흐름",
    tags: ["em", "global", "risk-on"],
    aliases: ["eem", "신흥국"],
  },
  {
    symbol: "AMEX:FXI",
    title: "China Large Cap",
    reason: "중국 대형주 체력",
    tags: ["china", "global", "equity"],
    aliases: ["fxi", "중국"],
  },
  {
    symbol: "NASDAQ:NVDA",
    title: "NVIDIA",
    reason: "AI 인프라 대표 종목",
    tags: ["us", "ai", "semiconductor", "theme"],
    aliases: ["nvda", "엔비디아", "ai"],
  },
  {
    symbol: "NASDAQ:MSFT",
    title: "Microsoft",
    reason: "엔터프라이즈 AI 수요 확인",
    tags: ["us", "ai", "cloud", "theme"],
    aliases: ["msft", "마이크로소프트"],
  },
  {
    symbol: "NASDAQ:AAPL",
    title: "Apple",
    reason: "메가캡 소비/디바이스 수요",
    tags: ["us", "mega-cap", "consumer"],
    aliases: ["aapl", "애플"],
  },
  {
    symbol: "NASDAQ:TSLA",
    title: "Tesla",
    reason: "고베타 성장주 민감도",
    tags: ["us", "ev", "high-beta", "theme"],
    aliases: ["tesla", "tsla", "테슬라", "전기차"],
  },
  {
    symbol: "KRX:005930",
    title: "Samsung Electronics",
    reason: "한국 대표 대형 반도체/IT",
    tags: ["kr", "korea", "semiconductor", "large-cap", "volume"],
    aliases: ["삼성전자", "005930", "samsung"],
  },
  {
    symbol: "KRX:000660",
    title: "SK hynix",
    reason: "메모리 사이클 핵심 종목",
    tags: ["kr", "korea", "semiconductor", "large-cap", "volume", "ai"],
    aliases: ["하이닉스", "sk하이닉스", "000660"],
  },
  {
    symbol: "KRX:035420",
    title: "NAVER",
    reason: "플랫폼/AI 서비스 확장성",
    tags: ["kr", "korea", "internet", "ai", "theme"],
    aliases: ["네이버", "035420", "naver"],
  },
  {
    symbol: "KRX:035720",
    title: "Kakao",
    reason: "국내 플랫폼 민감도",
    tags: ["kr", "korea", "internet", "theme"],
    aliases: ["카카오", "035720", "kakao"],
  },
  {
    symbol: "KRX:005380",
    title: "Hyundai Motor",
    reason: "완성차/수출 경기 민감도",
    tags: ["kr", "korea", "auto", "export", "large-cap", "volume"],
    aliases: ["현대차", "005380"],
  },
  {
    symbol: "KRX:051910",
    title: "LG Chem",
    reason: "배터리 밸류체인 핵심",
    tags: ["kr", "korea", "battery", "theme"],
    aliases: ["lg화학", "051910"],
  },
  {
    symbol: "KRX:207940",
    title: "Samsung Biologics",
    reason: "바이오 대형주 체력 확인",
    tags: ["kr", "korea", "bio", "large-cap"],
    aliases: ["삼성바이오로직스", "207940"],
  },
];

const RISK_ON_SYMBOLS = new Set(["NASDAQ:QQQ", "NASDAQ:NVDA", "NASDAQ:TSLA", "AMEX:XLE", "KRX:000660"]);
const ALLOWED_CHART_INTERVALS = new Set(["30", "W", "D", "M", "60"]);
const ALLOWED_SECTION_TYPES = new Set(["chart", "fng", "ai", "metric"]);
const YAHOO_TO_TRADINGVIEW_EXCHANGE = {
  NMS: "NASDAQ",
  NAS: "NASDAQ",
  NYQ: "NYSE",
  ASE: "AMEX",
  PCX: "AMEX",
  AMEX: "AMEX",
  KSC: "KRX",
  KOE: "KRX",
};

const DEFAULT_LAYOUT_SECTIONS = [
  {
    id: "btc-main",
    type: "chart",
    title: "BTC/USD 메인 차트",
    symbol: "BINANCE:BTCUSDT",
    badge: "주요 지표",
    span: 2,
    order: 0,
    widgetOptions: { interval: "30", main: true }
  },
  {
    id: "fng-core",
    type: "fng",
    title: "Fear & Greed",
    span: 1,
    order: 1,
    widgetOptions: {}
  },
  {
    id: "vix",
    type: "chart",
    title: "VIX",
    symbol: "AMEX:VXX",
    badge: "변동성",
    span: 1,
    order: 2,
    widgetOptions: { interval: "60" }
  },
  {
    id: "dxy",
    type: "chart",
    title: "DXY",
    symbol: "AMEX:UUP",
    badge: "달러 인덱스",
    span: 1,
    order: 3,
    widgetOptions: { interval: "60" }
  },
  {
    id: "us10y",
    type: "chart",
    title: "US10Y",
    symbol: "AMEX:IEF",
    badge: "거시 금리",
    span: 1,
    order: 4,
    widgetOptions: { interval: "60" }
  },
  {
    id: "ndx",
    type: "chart",
    title: "Nasdaq 100",
    symbol: "NASDAQ:QQQ",
    badge: "Equity",
    span: 1,
    order: 5,
    widgetOptions: { interval: "60" }
  },
  {
    id: "spx",
    type: "chart",
    title: "S&P 500",
    symbol: "AMEX:SPY",
    badge: "Equity",
    span: 1,
    order: 6,
    widgetOptions: { interval: "60" }
  },
  {
    id: "ai-overview",
    type: "ai",
    title: "AI 시황 분석",
    span: 3,
    order: 7,
    widgetOptions: {}
  }
];

const DEFAULT_LAYOUT_STORE = {
  version: 2,
  updatedAt: null,
  updatedBy: "system",
  meta: {},
  activeLayoutId: "layout-main",
  layouts: [
    {
      id: "layout-main",
      name: "기본 레이아웃",
      settings: {
        chartInterval: "30",
      },
      sections: DEFAULT_LAYOUT_SECTIONS,
    },
  ],
};

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/layout", async (_req, res) => {
  try {
    const layout = await getOrCreateLayout();
    return res.status(200).json({ layout });
  } catch (error) {
    logger.error("getLayout failed", error);
    return res.status(500).json({ error: "레이아웃 조회에 실패했습니다." });
  }
});

app.post("/api/layout/save", async (req, res) => {
  try {
    const pin = String(req.body?.pin || "");
    const validateOnly = Boolean(req.body?.validateOnly);
    const updatedBy = String(req.body?.updatedBy || "web-admin");

    if (!validatePin(pin)) {
      return res.status(401).json({ error: "관리자 PIN이 올바르지 않습니다." });
    }

    if (validateOnly) {
      return res.status(200).json({ ok: true });
    }

    const incoming = normalizeLayout(req.body?.layout || DEFAULT_LAYOUT_STORE);
    const toWrite = {
      ...incoming,
      updatedAt: Date.now(),
      updatedBy,
    };

    await LAYOUT_DOC.set(toWrite, { merge: false });
    return res.status(200).json({ ok: true, layout: toWrite });
  } catch (error) {
    logger.error("saveLayout failed", error);
    return res.status(500).json({ error: "레이아웃 저장에 실패했습니다." });
  }
});

app.post("/api/ai/suggest-symbols", async (req, res) => {
  const partialReasons = [];

  try {
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const query = String(req.body?.query || "").trim();
    const existingSymbols = new Set(
      sections
        .filter((x) => x && x.type === "chart" && x.symbol)
        .map((x) => String(x.symbol).toUpperCase())
    );
    const scopedCandidates = getQueryScopedCandidates(query, existingSymbols);

    const [news, fred, fearGreed] = await Promise.all([
      safeFetchNews(partialReasons),
      safeFetchFred(partialReasons),
      safeFetchFearGreed(partialReasons),
    ]);

    let recommendations = [];
    const geminiKey = GEMINI_API_KEY.value();
    if (geminiKey) {
      try {
        recommendations = await suggestWithGemini({
          geminiKey,
          candidates: scopedCandidates,
          news,
          fred,
          fearGreed,
          query,
        });
      } catch (error) {
        partialReasons.push(`Gemini 호출 실패: ${String(error.message || error)}`);
      }
    }

    if (!recommendations.length) {
      partialReasons.push("Gemini 응답 없음 또는 파싱 실패");
      recommendations = buildFallbackRecommendations(scopedCandidates, fearGreed, query);
    }

    return res.status(200).json({
      recommendations: recommendations.slice(0, 8),
      query,
      partial: partialReasons.length > 0,
      issues: partialReasons,
    });
  } catch (error) {
    logger.error("suggestSymbolsAI failed", error);
    return res.status(500).json({ error: "AI 심볼 추천에 실패했습니다." });
  }
});

app.post("/api/symbols/search", async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    const requested = Number(req.body?.limit);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.round(requested), 1), 20) : 10;

    const catalogResults = searchLocalSymbols(query, limit);
    const seen = new Set(catalogResults.map((item) => item.symbol));
    const merged = [...catalogResults];

    if (merged.length < limit && query) {
      try {
        const yahooResults = await searchYahooSymbols(query, limit - merged.length);
        yahooResults.forEach((item) => {
          if (seen.has(item.symbol)) return;
          seen.add(item.symbol);
          merged.push(item);
        });
      } catch (error) {
        logger.warn("searchSymbols yahoo fallback failed", {
          message: String(error.message || error),
        });
      }
    }

    return res.status(200).json({ query, results: merged.slice(0, limit) });
  } catch (error) {
    logger.error("searchSymbols failed", error);
    return res.status(500).json({ error: "심볼 검색에 실패했습니다." });
  }
});

app.post("/api/ai/analyze-layout", async (req, res) => {
  const partialReasons = [];

  try {
    const sections = Array.isArray(req.body?.sections) ? req.body.sections : [];
    const symbols = sections
      .filter((x) => x && x.type === "chart" && x.symbol)
      .map((x) => String(x.symbol).toUpperCase());

    const [news, fred, fearGreed] = await Promise.all([
      safeFetchNews(partialReasons),
      safeFetchFred(partialReasons),
      safeFetchFearGreed(partialReasons),
    ]);

    let report = null;
    const geminiKey = GEMINI_API_KEY.value();
    if (geminiKey) {
      try {
        report = await analyzeWithGemini({ geminiKey, symbols, news, fred, fearGreed });
      } catch (error) {
        partialReasons.push(`Gemini 호출 실패: ${String(error.message || error)}`);
      }
    }

    if (!report) {
      partialReasons.push("Gemini 응답 없음 또는 파싱 실패");
      report = buildFallbackReport({ symbols, news, fred, fearGreed });
    }

    report = normalizeAiReport(report, symbols);
    const analysis = buildLegacyAnalysisText(report);

    return res.status(200).json({
      analysis,
      report,
      partial: partialReasons.length > 0,
      issues: partialReasons,
    });
  } catch (error) {
    logger.error("analyzeLayoutAI failed", error);
    return res.status(500).json({ error: "AI 시황 분석에 실패했습니다." });
  }
});

exports.api = onRequest(
  {
    cors: true,
    invoker: "public",
    ingressSettings: "ALLOW_ALL",
    secrets: [GEMINI_API_KEY, FRED_API_KEY, LAYOUT_ADMIN_PIN],
    timeoutSeconds: 60,
  },
  app
);

async function getOrCreateLayout() {
  const snap = await LAYOUT_DOC.get();
  if (snap.exists) {
    return normalizeLayout(snap.data());
  }

  const initial = normalizeLayout(DEFAULT_LAYOUT_STORE);
  await LAYOUT_DOC.set({
    ...initial,
    updatedAt: Date.now(),
    updatedBy: "system-init",
  });
  return initial;
}

function validatePin(inputPin) {
  const expected = LAYOUT_ADMIN_PIN.value();
  if (!expected) return false;
  return String(inputPin) === String(expected);
}

function normalizeLayout(layout) {
  const source = layout && typeof layout === "object" ? clone(layout) : clone(DEFAULT_LAYOUT_STORE);
  if (Array.isArray(source.layouts)) {
    return normalizeLayoutStoreV2(source);
  }
  return migrateLegacyLayoutV1(source);
}

function migrateLegacyLayoutV1(layoutV1) {
  const legacySections = Array.isArray(layoutV1.sections) ? layoutV1.sections : [];
  const fallbackInterval = inferIntervalFromSections(legacySections);

  return normalizeLayoutStoreV2({
    version: 2,
    updatedAt: Number(layoutV1.updatedAt) || null,
    updatedBy: String(layoutV1.updatedBy || "system"),
    meta: typeof layoutV1.meta === "object" && layoutV1.meta ? layoutV1.meta : {},
    activeLayoutId: "layout-main",
    layouts: [
      {
        id: "layout-main",
        name: "기본 레이아웃",
        settings: { chartInterval: fallbackInterval },
        sections: legacySections,
      },
    ],
  });
}

function normalizeLayoutStoreV2(source) {
  const layouts = (Array.isArray(source.layouts) ? source.layouts : [])
    .map((layout, index) => normalizeSingleLayout(layout, index))
    .filter(Boolean);

  const normalizedLayouts = layouts.length
    ? layouts
    : [normalizeSingleLayout(DEFAULT_LAYOUT_STORE.layouts[0], 0)];

  const activeLayoutId = normalizedLayouts.some((layout) => layout.id === String(source.activeLayoutId || ""))
    ? String(source.activeLayoutId)
    : normalizedLayouts[0].id;

  return {
    version: 2,
    updatedAt: Number(source.updatedAt) || null,
    updatedBy: String(source.updatedBy || "system"),
    meta: typeof source.meta === "object" && source.meta ? source.meta : {},
    activeLayoutId,
    layouts: normalizedLayouts,
  };
}

function normalizeSingleLayout(layout, index) {
  if (!layout || typeof layout !== "object") return null;

  const sections = Array.isArray(layout.sections) ? layout.sections : [];
  const normalizedSections = sections
    .map((section, sectionIndex) => normalizeSection(section, sectionIndex))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((section, sectionIndex) => ({ ...section, order: sectionIndex }));

  const safeSections = normalizedSections.length
    ? normalizedSections
    : clone(DEFAULT_LAYOUT_SECTIONS).map((section, sectionIndex) =>
        normalizeSection({ ...section, order: sectionIndex }, sectionIndex)
      );

  return {
    id: String(layout.id || makeId("layout")),
    name: String(layout.name || `레이아웃 ${index + 1}`),
    settings: normalizeLayoutSettings(layout.settings, safeSections),
    sections: safeSections,
  };
}

function normalizeLayoutSettings(settings, sections) {
  const requestedInterval = settings?.chartInterval;
  const fallbackInterval = inferIntervalFromSections(Array.isArray(sections) ? sections : []);
  return {
    chartInterval: normalizeChartInterval(requestedInterval || fallbackInterval),
  };
}

function inferIntervalFromSections(sections) {
  const chart = sections.find((section) => section && section.type === "chart");
  const candidate = chart?.widgetOptions?.interval;
  return normalizeChartInterval(candidate);
}

function normalizeChartInterval(value) {
  const interval = String(value || "30").toUpperCase();
  if (interval === "1W") return "W";
  if (interval === "1D") return "D";
  if (interval === "1M" || interval === "1MO" || interval === "MO") return "M";
  if (interval === "30M" || interval === "30MIN" || interval === "M30") return "30";
  if (interval === "1H" || interval === "H") return "60";
  if (ALLOWED_CHART_INTERVALS.has(interval)) return interval;
  return "30";
}

function normalizeMetricKey(metricKey) {
  if (String(metricKey || "").toLowerCase() === "feargreed") return "fearGreed";
  return "fearGreed";
}

function normalizeSection(section, fallbackOrder) {
  if (!section || typeof section !== "object") return null;

  const type = ALLOWED_SECTION_TYPES.has(section.type) ? section.type : "chart";
  const normalized = {
    id: String(section.id || makeId(type)),
    type,
    title: String(section.title || type.toUpperCase()),
    span: clampSpan(section.span),
    order: Number.isFinite(Number(section.order)) ? Number(section.order) : fallbackOrder,
    widgetOptions: typeof section.widgetOptions === "object" && section.widgetOptions ? section.widgetOptions : {},
  };

  if (type === "chart") {
    normalized.symbol = String(section.symbol || "BINANCE:BTCUSDT").toUpperCase();
    normalized.badge = String(section.badge || "차트");
  }

  if (type === "metric") {
    normalized.metricKey = normalizeMetricKey(section.metricKey);
  }

  return normalized;
}

function clampSpan(value) {
  const span = Number(value);
  if (!Number.isFinite(span)) return 1;
  return Math.max(1, Math.min(3, Math.round(span)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function safeFetchNews(partialReasons) {
  try {
    return await fetchNews();
  } catch (error) {
    partialReasons.push(`Google News RSS 실패: ${error.message}`);
    return [];
  }
}

async function safeFetchFred(partialReasons) {
  try {
    return await fetchFred();
  } catch (error) {
    partialReasons.push(`FRED 실패: ${error.message}`);
    return [];
  }
}

async function safeFetchFearGreed(partialReasons) {
  try {
    return await fetchFearGreed();
  } catch (error) {
    partialReasons.push(`Fear&Greed 실패: ${error.message}`);
    return null;
  }
}

async function fetchNews() {
  const rawXml = await fetchText(GOOGLE_NEWS_RSS_URL);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });
  const parsed = parser.parse(rawXml);
  const channel = parsed?.rss?.channel;
  const items = Array.isArray(channel?.item)
    ? channel.item
    : channel?.item
      ? [channel.item]
      : [];

  return items
    .map((item) => String(item?.title || "").trim())
    .filter(Boolean)
    // Strip trailing source suffix from Google News title.
    .map((title) => title.replace(/\s*-\s*[^-]+$/, "").trim())
    .slice(0, 10);
}

async function fetchFred() {
  const key = FRED_API_KEY.value();
  if (!key) {
    throw new Error("FRED_API_KEY 미설정");
  }

  const seriesIds = ["DGS10", "DGS2", "FEDFUNDS", "CPIAUCSL", "UNRATE"];
  const responses = await Promise.all(
    seriesIds.map(async (seriesId) => {
      const url = new URL("https://api.stlouisfed.org/fred/series/observations");
      url.searchParams.set("series_id", seriesId);
      url.searchParams.set("api_key", key);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("sort_order", "desc");
      url.searchParams.set("limit", "2");

      const payload = await fetchJson(url.toString());
      const observations = Array.isArray(payload.observations) ? payload.observations : [];
      const latest = observations[0] || {};
      return {
        seriesId,
        date: latest.date || null,
        value: latest.value || null,
      };
    })
  );

  return responses;
}

async function fetchFearGreed() {
  const payload = await fetchJson("https://api.alternative.me/fng/?limit=1");
  const item = payload?.data?.[0];
  if (!item) {
    throw new Error("Fear&Greed 응답 없음");
  }

  return {
    value: item.value,
    classification: item.value_classification,
    timestamp: item.timestamp,
  };
}

async function suggestWithGemini({ geminiKey, candidates, news, fred, fearGreed, query }) {
  const allowed = Array.isArray(candidates) ? candidates : [];
  if (!allowed.length) return [];

  const prompt = [
    "당신은 거시/자산배분 분석가입니다.",
    "사용자 요청과 오늘 시황에 맞는 후보 심볼을 고르세요.",
    "반드시 후보 목록에 있는 symbol만 사용하고 JSON 객체만 반환하세요.",
    "형식: {\"recommendations\":[{\"symbol\":\"...\",\"title\":\"...\",\"reason\":\"...\"}]}",
    "reason은 1문장 한국어로 간결하게 작성하세요.",
    `사용자요청: ${query || "없음"}`,
    `후보: ${JSON.stringify(allowed)}`,
    `FearGreed: ${JSON.stringify(fearGreed)}`,
    `News: ${JSON.stringify(news.slice(0, 10))}`,
    `FRED: ${JSON.stringify(fred)}`,
  ].join("\n");

  const output = await callGeminiJson(geminiKey, prompt);
  const recs = Array.isArray(output.recommendations) ? output.recommendations : [];

  return recs
    .map((item) => ({
      symbol: String(item.symbol || "").toUpperCase(),
      title: String(item.title || item.symbol || ""),
      reason: String(item.reason || ""),
    }))
    .filter((item) => item.symbol && allowed.some((cand) => cand.symbol === item.symbol))
    .slice(0, 8);
}

async function analyzeWithGemini({ geminiKey, symbols, news, fred, fearGreed }) {
  const prompt = [
    "당신은 한국어 금융 브리핑 어시스턴트입니다.",
    "아래 데이터로 구조화된 시황 리포트를 만드세요.",
    "JSON 객체만 반환하세요.",
    "형식: {\"summary\":\"...\",\"buy\":[\"...\"],\"sell\":[\"...\"],\"themes\":[\"...\"],\"bullish\":[\"...\"],\"bearish\":[\"...\"]}",
    "buy/sell은 종목명 또는 심볼을 포함해 작성하세요.",
    `심볼: ${JSON.stringify(symbols)}`,
    `FearGreed: ${JSON.stringify(fearGreed)}`,
    `News: ${JSON.stringify(news.slice(0, 10))}`,
    `FRED: ${JSON.stringify(fred)}`,
  ].join("\n");

  const report = await callGeminiJson(geminiKey, prompt);
  return normalizeAiReport(report, symbols);
}

function buildFallbackRecommendations(candidates, fearGreed, query) {
  const preferredRiskOn = Number(fearGreed?.value) >= 50;
  const queryText = String(query || "").trim();
  const sorted = [...(Array.isArray(candidates) ? candidates : [])].sort((a, b) => {
    const queryScore = scoreCandidateByQuery(b, queryText) - scoreCandidateByQuery(a, queryText);
    if (queryScore !== 0) return queryScore;

    const aRisk = RISK_ON_SYMBOLS.has(a.symbol) ? (preferredRiskOn ? 1 : -1) : 0;
    const bRisk = RISK_ON_SYMBOLS.has(b.symbol) ? (preferredRiskOn ? 1 : -1) : 0;
    if (bRisk !== aRisk) return bRisk - aRisk;

    return String(a.symbol).localeCompare(String(b.symbol));
  });

  return sorted.slice(0, 8).map((item) => ({
    symbol: item.symbol,
    title: item.title,
    reason: `${item.reason} 기반 기본 추천`,
  }));
}

function buildFallbackReport({ symbols, news, fred, fearGreed }) {
  const riskOn = Number(fearGreed?.value) >= 50;
  const symbolSet = new Set((Array.isArray(symbols) ? symbols : []).map((symbol) => String(symbol || "").toUpperCase()));
  const scoped =
    CANDIDATE_SYMBOLS.filter((item) => symbolSet.has(item.symbol)).length > 0
      ? CANDIDATE_SYMBOLS.filter((item) => symbolSet.has(item.symbol))
      : CANDIDATE_SYMBOLS;

  const buyPool = scoped.filter((item) =>
    riskOn
      ? item.tags?.includes("risk-on") || item.tags?.includes("ai") || item.tags?.includes("semiconductor")
      : item.tags?.includes("risk-off") || item.tags?.includes("bond") || item.tags?.includes("large-cap")
  );
  const sellPool = scoped.filter((item) =>
    riskOn
      ? item.tags?.includes("risk-off") || item.tags?.includes("dollar")
      : item.tags?.includes("risk-on") || item.tags?.includes("high-beta")
  );

  const summary = fearGreed
    ? `Fear & Greed ${fearGreed.value}(${fearGreed.classification}) 기준으로 ${riskOn ? "위험선호" : "방어"} 우위 흐름입니다.`
    : "Fear & Greed 데이터 지연 상태로 보수적 해석이 필요합니다.";

  const report = {
    summary,
    buy: buyPool.slice(0, 3).map(formatRecommendationLine),
    sell: sellPool.slice(0, 3).map(formatRecommendationLine),
    themes: collectThemes(news, scoped),
    bullish: buildBullishPoints(fearGreed, fred, news),
    bearish: buildBearishPoints(fearGreed, fred, news),
  };

  return normalizeAiReport(report, symbols);
}

function normalizeAiReport(raw, symbols) {
  const report = raw && typeof raw === "object" ? raw : {};
  const fallbackSummary = Array.isArray(symbols) && symbols.length
    ? `${symbols.slice(0, 6).join(", ")} 중심으로 현재 시장 흐름을 점검했습니다.`
    : "현재 가용 데이터 기준으로 시장 흐름을 요약했습니다.";

  return {
    summary: String(report.summary || fallbackSummary).trim() || fallbackSummary,
    buy: normalizeReportList(report.buy),
    sell: normalizeReportList(report.sell),
    themes: normalizeReportList(report.themes),
    bullish: normalizeReportList(report.bullish),
    bearish: normalizeReportList(report.bearish),
  };
}

function normalizeReportList(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";

      const symbol = String(item.symbol || "").trim().toUpperCase();
      const title = String(item.title || "").trim();
      const reason = String(item.reason || "").trim();
      return [symbol || title, reason].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .slice(0, 8);
}

function buildLegacyAnalysisText(report) {
  return [
    `[요약] ${report.summary}`,
    `[매수 추천] ${toInlineList(report.buy)}`,
    `[매도 추천] ${toInlineList(report.sell)}`,
    `[주목 테마] ${toInlineList(report.themes)}`,
    `[긍정 관점] ${toInlineList(report.bullish)}`,
    `[부정 관점] ${toInlineList(report.bearish)}`,
  ].join("\n");
}

function toInlineList(items) {
  if (!Array.isArray(items) || !items.length) return "데이터 없음";
  return items.join(" / ");
}

function formatRecommendationLine(item) {
  return `${item.symbol} (${item.title}) - ${item.reason}`;
}

function collectThemes(news, scoped) {
  const text = `${Array.isArray(news) ? news.join(" ") : ""} ${scoped.map((item) => item.title).join(" ")}`
    .toLowerCase();
  const themes = [];

  if (text.includes("ai") || text.includes("반도체")) themes.push("AI/반도체");
  if (text.includes("oil") || text.includes("에너지")) themes.push("에너지");
  if (text.includes("inflation") || text.includes("cpi")) themes.push("인플레이션/금리");
  if (text.includes("korea") || text.includes("한국") || scoped.some((item) => item.tags?.includes("kr"))) {
    themes.push("한국 대형주");
  }

  return themes.length ? themes.slice(0, 4) : ["거시 민감자산 로테이션"];
}

function buildBullishPoints(fearGreed, fred, news) {
  const points = [];
  if (Number(fearGreed?.value) >= 50) points.push("심리 지표가 위험선호 구간으로 복귀했습니다.");
  if (Array.isArray(news) && news.some((item) => /ai|earnings|growth/i.test(item))) {
    points.push("성장/AI 관련 뉴스 흐름이 위험자산 선호를 지지합니다.");
  }
  if (Array.isArray(fred) && fred.some((item) => item.seriesId === "DGS10")) {
    points.push("금리 레벨 변화가 밸류에이션 재평가 기회를 만들 수 있습니다.");
  }
  return points.length ? points.slice(0, 4) : ["과매도 구간 반등 가능성에 유의합니다."];
}

function buildBearishPoints(fearGreed, fred, news) {
  const points = [];
  if (Number(fearGreed?.value) < 50) points.push("심리 지표가 방어 구간에 머물러 변동성 확대 위험이 있습니다.");
  if (Array.isArray(news) && news.some((item) => /inflation|tariff|war|recession|긴축/i.test(item))) {
    points.push("거시 불확실성 뉴스가 리스크 프리미엄을 높일 수 있습니다.");
  }
  if (Array.isArray(fred) && fred.some((item) => item.seriesId === "FEDFUNDS")) {
    points.push("정책금리 경로 불확실성은 성장주 변동성을 키울 수 있습니다.");
  }
  return points.length ? points.slice(0, 4) : ["데이터 공백 구간에서는 추격 매수보다 분할 대응이 유리합니다."];
}

function getQueryScopedCandidates(query, existingSymbols) {
  const text = String(query || "").trim();
  const available = CANDIDATE_SYMBOLS.filter((item) => !existingSymbols.has(item.symbol));
  if (!text) return available;

  const scored = available
    .map((item) => ({ item, score: scoreCandidateByQuery(item, text) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  const hasPositive = available.some((item) => scoreCandidateByQuery(item, text) > 0);
  return hasPositive ? scored : available;
}

function scoreCandidateByQuery(item, query) {
  const text = String(query || "").toLowerCase().trim();
  if (!text) return 0;

  const tokens = text.split(/\s+/).filter(Boolean);
  const haystack = [
    String(item.symbol || "").toLowerCase(),
    String(item.title || "").toLowerCase(),
    String(item.reason || "").toLowerCase(),
    ...(Array.isArray(item.tags) ? item.tags.map((value) => String(value || "").toLowerCase()) : []),
    ...(Array.isArray(item.aliases) ? item.aliases.map((value) => String(value || "").toLowerCase()) : []),
  ].join(" ");

  let score = haystack.includes(text) ? 8 : 0;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 2;
  });

  if ((text.includes("한국") || text.includes("kr") || text.includes("korea")) && item.tags?.includes("kr")) {
    score += 6;
  }
  if ((text.includes("거래량") || text.includes("volume")) && item.tags?.includes("volume")) {
    score += 5;
  }
  if ((text.includes("ai") || text.includes("반도체")) && (item.tags?.includes("ai") || item.tags?.includes("semiconductor"))) {
    score += 4;
  }

  return score;
}

function searchLocalSymbols(query, limit) {
  const text = String(query || "").trim();
  const pool = getQueryScopedCandidates(text, new Set());
  return pool.slice(0, limit).map((item) => {
    const [exchange] = String(item.symbol).split(":");
    return {
      symbol: item.symbol,
      title: item.title,
      exchange: exchange || "",
      source: "catalog",
      reason: item.reason,
    };
  });
}

async function searchYahooSymbols(query, limit) {
  if (!query || limit <= 0) return [];

  const endpoint = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("quotesCount", String(Math.max(limit * 2, 8)));
  endpoint.searchParams.set("newsCount", "0");

  const payload = await fetchJson(endpoint.toString(), {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
  const results = [];
  for (const quote of quotes) {
    const symbol = mapYahooQuoteToTradingViewSymbol(quote);
    if (!symbol) continue;

    results.push({
      symbol,
      title: String(quote.longname || quote.shortname || symbol),
      exchange: String(symbol.split(":")[0] || ""),
      source: "yahoo",
      reason: "Yahoo 검색 결과",
    });
    if (results.length >= limit) break;
  }

  return results;
}

function mapYahooQuoteToTradingViewSymbol(quote) {
  const quoteType = String(quote?.quoteType || "").toUpperCase();
  if (!["EQUITY", "ETF", "INDEX"].includes(quoteType)) return null;

  const raw = String(quote?.symbol || "").trim().toUpperCase();
  if (!raw) return null;

  const exchange = String(quote?.exchange || "").toUpperCase();
  let tvExchange = YAHOO_TO_TRADINGVIEW_EXCHANGE[exchange] || "";
  let ticker = raw;

  if (!tvExchange && (raw.endsWith(".KS") || raw.endsWith(".KQ"))) {
    tvExchange = "KRX";
  }
  if (tvExchange === "KRX") {
    ticker = raw.replace(/\.(KS|KQ)$/i, "");
  } else if (raw.includes(".")) {
    return null;
  }

  if (!tvExchange && raw && !raw.includes(".")) {
    tvExchange = "NASDAQ";
  }

  if (!tvExchange || !ticker) return null;
  return `${tvExchange}:${ticker}`;
}

async function callGeminiJson(apiKey, prompt) {
  const text = await callGeminiText(apiKey, prompt, "application/json");
  return extractJsonObject(text);
}

async function callGeminiText(apiKey, prompt, responseMimeType) {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
    },
  };

  if (responseMimeType) {
    body.generationConfig.responseMimeType = responseMimeType;
  }

  let lastError = null;
  for (const modelId of GEMINI_MODEL_CANDIDATES) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
    try {
      const payload = await fetchJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } catch (error) {
      lastError = error;
      logger.warn("Gemini model attempt failed", {
        modelId,
        message: String(error.message || error),
      });
    }
  }

  throw new Error(`Gemini 모델 호출 실패: ${String(lastError?.message || "unknown")}`);
}

function extractJsonObject(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${body.slice(0, 120)}`.trim());
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${body.slice(0, 120)}`.trim());
  }

  return response.text();
}

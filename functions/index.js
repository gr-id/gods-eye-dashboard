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

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const FRED_API_KEY = defineSecret("FRED_API_KEY");
const LAYOUT_ADMIN_PIN = defineSecret("LAYOUT_ADMIN_PIN");

const CANDIDATE_SYMBOLS = [
  { symbol: "BINANCE:BTCUSDT", title: "BTC/USD", reason: "디지털 자산 리스크 온/오프" },
  { symbol: "AMEX:SPY", title: "S&P 500", reason: "미국 대형주 대표 지수" },
  { symbol: "NASDAQ:QQQ", title: "Nasdaq 100", reason: "성장주/기술주 민감도" },
  { symbol: "AMEX:IWM", title: "Russell 2000", reason: "중소형주 체력 확인" },
  { symbol: "AMEX:VXX", title: "VIX Proxy", reason: "변동성 리스크 확인" },
  { symbol: "AMEX:UUP", title: "DXY Proxy", reason: "달러 강세 흐름 추적" },
  { symbol: "AMEX:IEF", title: "US10Y Proxy", reason: "중장기 금리 방향성" },
  { symbol: "AMEX:TLT", title: "US20Y+ Bond", reason: "장기채 듀레이션 민감도" },
  { symbol: "COMEX:GC1!", title: "Gold Futures", reason: "안전자산 선호도" },
  { symbol: "NYMEX:CL1!", title: "Crude Oil Futures", reason: "에너지/인플레이션 압력" },
  { symbol: "AMEX:GLD", title: "Gold ETF", reason: "금 현물 대체 추적" },
  { symbol: "AMEX:SLV", title: "Silver ETF", reason: "산업+귀금속 혼합 민감도" },
  { symbol: "AMEX:XLE", title: "Energy Sector", reason: "에너지 섹터 상대강도" },
  { symbol: "AMEX:XLK", title: "Technology Sector", reason: "기술 섹터 모멘텀" },
  { symbol: "AMEX:XLF", title: "Financial Sector", reason: "금리-은행 민감도" },
  { symbol: "AMEX:EEM", title: "Emerging Markets", reason: "신흥국 리스크 선호" },
  { symbol: "AMEX:FXI", title: "China Large Cap", reason: "중국 대형주 체력" },
  { symbol: "NASDAQ:NVDA", title: "NVIDIA", reason: "AI 테마 선도주" },
  { symbol: "NASDAQ:AAPL", title: "Apple", reason: "메가캡 수요 확인" },
  { symbol: "NASDAQ:TSLA", title: "Tesla", reason: "고베타 성장주 민감도" }
];

const DEFAULT_LAYOUT = {
  version: 1,
  updatedAt: null,
  updatedBy: "system",
  meta: {},
  sections: [
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
  ]
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

    const incoming = normalizeLayout(req.body?.layout || DEFAULT_LAYOUT);
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
    const existingSymbols = new Set(
      sections
        .filter((x) => x && x.type === "chart" && x.symbol)
        .map((x) => String(x.symbol).toUpperCase())
    );

    const [news, fred, fearGreed] = await Promise.all([
      safeFetchNews(partialReasons),
      safeFetchFred(partialReasons),
      safeFetchFearGreed(partialReasons),
    ]);

    let recommendations = [];
    const geminiKey = GEMINI_API_KEY.value();
    if (geminiKey) {
      recommendations = await suggestWithGemini({
        geminiKey,
        existingSymbols,
        news,
        fred,
        fearGreed,
      });
    }

    if (!recommendations.length) {
      partialReasons.push("Gemini 응답 없음 또는 파싱 실패");
      recommendations = buildFallbackRecommendations(existingSymbols, fearGreed);
    }

    return res.status(200).json({
      recommendations: recommendations.slice(0, 8),
      partial: partialReasons.length > 0,
      issues: partialReasons,
    });
  } catch (error) {
    logger.error("suggestSymbolsAI failed", error);
    return res.status(500).json({ error: "AI 심볼 추천에 실패했습니다." });
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

    let analysis = "";
    const geminiKey = GEMINI_API_KEY.value();
    if (geminiKey) {
      analysis = await analyzeWithGemini({ geminiKey, symbols, news, fred, fearGreed });
    }

    if (!analysis) {
      partialReasons.push("Gemini 응답 없음 또는 파싱 실패");
      analysis = buildFallbackAnalysis({ symbols, news, fred, fearGreed });
    }

    return res.status(200).json({
      analysis,
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

  const initial = normalizeLayout(DEFAULT_LAYOUT);
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
  const source = layout && typeof layout === "object" ? clone(layout) : clone(DEFAULT_LAYOUT);
  const sections = Array.isArray(source.sections) ? source.sections : [];

  const normalizedSections = sections
    .map((section, index) => normalizeSection(section, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((section, index) => ({ ...section, order: index }));

  return {
    version: Number(source.version) || 1,
    updatedAt: Number(source.updatedAt) || null,
    updatedBy: String(source.updatedBy || "system"),
    meta: typeof source.meta === "object" && source.meta ? source.meta : {},
    sections: normalizedSections.length ? normalizedSections : clone(DEFAULT_LAYOUT.sections),
  };
}

function normalizeSection(section, fallbackOrder) {
  if (!section || typeof section !== "object") return null;

  const type = ["chart", "fng", "ai"].includes(section.type) ? section.type : "chart";
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

async function suggestWithGemini({ geminiKey, existingSymbols, news, fred, fearGreed }) {
  const allowed = CANDIDATE_SYMBOLS.filter((item) => !existingSymbols.has(item.symbol));
  if (!allowed.length) return [];

  const prompt = [
    "당신은 거시/자산배분 분석가입니다.",
    "아래 후보 심볼 중에서 오늘 시황에 맞는 8개를 고르세요.",
    "반드시 후보 목록에 있는 symbol만 사용하고, JSON 객체만 반환하세요.",
    "형식: {\"recommendations\":[{\"symbol\":\"...\",\"title\":\"...\",\"reason\":\"...\"}]}",
    "reason은 1문장 한국어로 간결하게 작성하세요.",
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
    "현재 화면 차트 구성과 뉴스/거시지표를 바탕으로 시황을 3~6문장으로 요약하세요.",
    "불확실하면 단정하지 말고 가능성 표현을 쓰세요.",
    "출력은 평문 텍스트만 반환하세요.",
    `심볼: ${JSON.stringify(symbols)}`,
    `FearGreed: ${JSON.stringify(fearGreed)}`,
    `News: ${JSON.stringify(news.slice(0, 10))}`,
    `FRED: ${JSON.stringify(fred)}`,
  ].join("\n");

  const text = await callGeminiText(geminiKey, prompt);
  return String(text || "").trim();
}

function buildFallbackRecommendations(existingSymbols, fearGreed) {
  const preferredRiskOn = Number(fearGreed?.value) >= 50;
  const sorted = [...CANDIDATE_SYMBOLS].sort((a, b) => {
    const riskOnSet = new Set(["NASDAQ:QQQ", "NASDAQ:NVDA", "AMEX:XLE", "NASDAQ:TSLA"]);
    const aScore = riskOnSet.has(a.symbol) ? (preferredRiskOn ? 1 : -1) : 0;
    const bScore = riskOnSet.has(b.symbol) ? (preferredRiskOn ? 1 : -1) : 0;
    return bScore - aScore;
  });

  return sorted
    .filter((item) => !existingSymbols.has(item.symbol))
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      title: item.title,
      reason: `${item.reason} 기반 기본 추천`,
    }));
}

function buildFallbackAnalysis({ symbols, news, fred, fearGreed }) {
  const fearText = fearGreed
    ? `Fear & Greed는 ${fearGreed.value}(${fearGreed.classification}) 수준입니다.`
    : "Fear & Greed 데이터는 현재 지연 중입니다.";

  const newsText = news.length
    ? `주요 뉴스는 ${news.slice(0, 2).join(" / ")} 흐름이 관찰됩니다.`
    : "뉴스 피드는 일시적으로 비어 있어 가격 반응 중심으로 해석이 필요합니다.";

  const fredText = fred.length
    ? `거시 지표(FRED)에서는 ${fred
        .slice(0, 2)
        .map((item) => `${item.seriesId}:${item.value}`)
        .join(", ")} 값이 최근 상태로 확인됩니다.`
    : "거시 지표 수집이 지연되어 방향성 판단 신뢰도가 낮습니다.";

  const symbolText = symbols.length
    ? `현재 레이아웃은 ${symbols.slice(0, 8).join(", ")} 중심으로 구성되어 있어 위험자산과 금리 민감도를 함께 점검하기에 적합합니다.`
    : "현재 차트 심볼이 없어 분석 범위가 제한됩니다.";

  return `${fearText}\n${newsText}\n${fredText}\n${symbolText}`;
}

async function callGeminiJson(apiKey, prompt) {
  const text = await callGeminiText(apiKey, prompt, "application/json");
  return extractJsonObject(text);
}

async function callGeminiText(apiKey, prompt, responseMimeType) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
    },
  };

  if (responseMimeType) {
    body.generationConfig.responseMimeType = responseMimeType;
  }

  const payload = await fetchJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
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

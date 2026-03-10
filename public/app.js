const FEAR_GREED_API_URL = "https://api.alternative.me/fng/?limit=1";
const FEAR_GREED_FALLBACK_SECONDS = 900;
const FEAR_GREED_INITIAL_RETRY_SECONDS = 30;
const WIDGET_LOAD_TIMEOUT_MS = 12000;

const API_BASE = "/api";

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
      widgetOptions: { interval: "30", main: true },
    },
    {
      id: "fng-core",
      type: "fng",
      title: "Fear & Greed",
      span: 1,
      order: 1,
      widgetOptions: {},
    },
    {
      id: "vix",
      type: "chart",
      title: "VIX",
      symbol: "AMEX:VXX",
      badge: "변동성",
      span: 1,
      order: 2,
      widgetOptions: { interval: "60" },
    },
    {
      id: "dxy",
      type: "chart",
      title: "DXY",
      symbol: "AMEX:UUP",
      badge: "달러 인덱스",
      span: 1,
      order: 3,
      widgetOptions: { interval: "60" },
    },
    {
      id: "us10y",
      type: "chart",
      title: "US10Y",
      symbol: "AMEX:IEF",
      badge: "거시 금리",
      span: 1,
      order: 4,
      widgetOptions: { interval: "60" },
    },
    {
      id: "ndx",
      type: "chart",
      title: "Nasdaq 100",
      symbol: "NASDAQ:QQQ",
      badge: "Equity",
      span: 1,
      order: 5,
      widgetOptions: { interval: "60" },
    },
    {
      id: "spx",
      type: "chart",
      title: "S&P 500",
      symbol: "AMEX:SPY",
      badge: "Equity",
      span: 1,
      order: 6,
      widgetOptions: { interval: "60" },
    },
    {
      id: "ai-overview",
      type: "ai",
      title: "AI 시황 분석",
      span: 3,
      order: 7,
      widgetOptions: {},
    },
  ],
};

const FNG_CLASSIFICATION_MAP = {
  "Extreme Fear": "극도의 공포",
  Fear: "공포",
  Neutral: "중립",
  Greed: "탐욕",
  "Extreme Greed": "극도의 탐욕",
};

const state = {
  layoutMode: false,
  savedLayout: null,
  draftLayout: null,
  pinVerifiedSession: sessionStorage.getItem("layoutPinVerified") === "1",
  adminPin: null,
  dragSourceId: null,
  aiSuggestions: [],
  aiAnalysis: "분석 버튼을 누르면 현재 차트 구성 기반으로 시황 요약을 제공합니다.",
  aiAnalysisPartial: false,
  fearGreedTimerId: null,
  fearGreedInFlight: false,
  lastFearGreedData: null,
  lastFearGreedFetchedAt: 0,
  tradingViewScriptPromise: null,
};

const refs = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindRefs();
  bindGlobalEvents();

  const layout = await loadLayoutFromServer();
  state.savedLayout = layout;
  state.draftLayout = cloneLayout(layout);

  render();
  initFearAndGreedCard();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearFearGreedTimer();
      return;
    }
    if (Date.now() - state.lastFearGreedFetchedAt > 60 * 1000) {
      fetchFearAndGreed();
    } else if (!state.fearGreedTimerId && state.lastFearGreedData?.time_until_update) {
      scheduleFearGreedFetch(state.lastFearGreedData.time_until_update);
    }
  });
});

function bindRefs() {
  refs.grid = document.getElementById("dashboard-grid");
  refs.editToggleBtn = document.getElementById("edit-toggle-btn");
  refs.toolbar = document.getElementById("layout-toolbar");
  refs.layoutSaveBtn = document.getElementById("layout-save-btn");
  refs.layoutCancelBtn = document.getElementById("layout-cancel-btn");
  refs.layoutAddBtn = document.getElementById("layout-add-btn");
  refs.layoutAiAddBtn = document.getElementById("layout-ai-add-btn");
  refs.tickerWidget = document.getElementById("ticker-widget");
  refs.tickerStatus = document.getElementById("ticker-status");

  refs.symbolModal = document.getElementById("symbol-modal");
  refs.symbolInput = document.getElementById("symbol-input");
  refs.titleInput = document.getElementById("title-input");
  refs.symbolModalError = document.getElementById("symbol-modal-error");
  refs.symbolModalSubmit = document.getElementById("symbol-modal-submit");
  refs.symbolModalCancel = document.getElementById("symbol-modal-cancel");

  refs.aiModal = document.getElementById("ai-modal");
  refs.aiModalStatus = document.getElementById("ai-modal-status");
  refs.aiSuggestList = document.getElementById("ai-suggest-list");
  refs.aiModalApply = document.getElementById("ai-modal-apply");
  refs.aiModalCancel = document.getElementById("ai-modal-cancel");
}

function bindGlobalEvents() {
  refs.editToggleBtn.addEventListener("click", onEditModeToggle);
  refs.layoutSaveBtn.addEventListener("click", onSaveLayout);
  refs.layoutCancelBtn.addEventListener("click", onCancelLayout);
  refs.layoutAddBtn.addEventListener("click", openSymbolModal);
  refs.layoutAiAddBtn.addEventListener("click", openAiModal);

  refs.symbolModalSubmit.addEventListener("click", onSubmitManualSymbol);
  refs.symbolModalCancel.addEventListener("click", () => closeModal("symbol"));
  refs.aiModalApply.addEventListener("click", applyAiSelections);
  refs.aiModalCancel.addEventListener("click", () => closeModal("ai"));

  document.querySelectorAll("[data-close-modal]").forEach((node) => {
    node.addEventListener("click", (event) => {
      const name = event.currentTarget.getAttribute("data-close-modal");
      closeModal(name);
    });
  });
}

function getActiveLayout() {
  return state.layoutMode ? state.draftLayout : state.savedLayout;
}

function render() {
  document.body.classList.toggle("layout-mode", state.layoutMode);
  refs.toolbar.hidden = !state.layoutMode;
  refs.editToggleBtn.textContent = state.layoutMode ? "편집 중" : "변경";

  const layout = getActiveLayout();
  const sections = sortSections(layout.sections);

  refs.grid.innerHTML = "";
  for (const section of sections) {
    refs.grid.appendChild(createSectionCard(section));
  }

  bindSectionEvents();
  initChartWidgets(sections.filter((x) => x.type === "chart"));
  refreshTicker(sections.filter((x) => x.type === "chart"));
  renderAiSectionText();
  if (state.lastFearGreedData) renderFearAndGreed(state.lastFearGreedData, false);
}

function createSectionCard(section) {
  const card = document.createElement("section");
  card.className = `card section-card span-${clampSpan(section.span)}`;
  card.dataset.sectionId = section.id;
  card.dataset.sectionType = section.type;
  card.draggable = state.layoutMode;

  if (section.type === "chart") {
    const isMain = section.widgetOptions?.main === true;
    card.innerHTML = `
      <div class="card-title-row">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="card-title-right">
          <span class="chip ${isMain ? "chip-primary" : ""}">${escapeHtml(section.badge || "차트")}</span>
          ${renderSpanControls(section.span)}
        </div>
      </div>
      <div id="chart-host-${section.id}" class="widget-host ${isMain ? "widget-host-main" : "widget-host-secondary"}"></div>
      <p id="status-${section.id}" class="widget-status" hidden>${escapeHtml(section.title)} 차트 로딩 지연</p>
    `;
    return card;
  }

  if (section.type === "fng") {
    card.classList.add("fng-card");
    card.innerHTML = `
      <div class="card-title-row">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="card-title-right">
          <span id="fng-badge" class="chip chip-muted">로딩 중</span>
          ${renderSpanControls(section.span)}
        </div>
      </div>
      <div class="fng-body">
        <p id="fng-value" class="fng-value">N/A</p>
        <p id="fng-classification" class="fng-classification">데이터 수집 대기</p>
        <p id="fng-updated" class="fng-updated">업데이트: -</p>
        <p id="fng-status" class="fng-status">상태: 초기화 중</p>
      </div>
    `;
    return card;
  }

  if (section.type === "ai") {
    card.innerHTML = `
      <div class="card-title-row">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="card-title-right">
          <button class="btn btn-outline ai-analyze-btn" type="button">분석</button>
          ${renderSpanControls(section.span)}
        </div>
      </div>
      <div class="ai-card-body">
        <p id="ai-analysis-text" class="ai-analysis">${escapeHtml(state.aiAnalysis)}</p>
      </div>
    `;
    return card;
  }

  card.innerHTML = `
    <div class="card-title-row">
      <h2>지원되지 않는 섹션</h2>
      ${renderSpanControls(section.span)}
    </div>
  `;
  return card;
}

function renderSpanControls(currentSpan) {
  if (!state.layoutMode) return "";
  const value = clampSpan(currentSpan);
  return `
    <div class="span-controls">
      <button class="span-btn ${value === 1 ? "active" : ""}" data-span="1" type="button">1</button>
      <button class="span-btn ${value === 2 ? "active" : ""}" data-span="2" type="button">2</button>
      <button class="span-btn ${value === 3 ? "active" : ""}" data-span="3" type="button">3</button>
    </div>
  `;
}

function bindSectionEvents() {
  const cards = refs.grid.querySelectorAll(".section-card");
  cards.forEach((card) => {
    const sectionId = card.dataset.sectionId;

    if (state.layoutMode) {
      card.addEventListener("dragstart", () => {
        state.dragSourceId = sectionId;
        card.classList.add("dragging");
      });

      card.addEventListener("dragend", () => {
        state.dragSourceId = null;
        card.classList.remove("dragging");
        clearDropTargets();
      });

      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        card.classList.add("drop-target");
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("drop-target");
      });

      card.addEventListener("drop", () => {
        card.classList.remove("drop-target");
        reorderDraftSections(state.dragSourceId, sectionId);
      });
    }

    card.querySelectorAll(".span-btn").forEach((button) => {
      button.addEventListener("click", () => {
        if (!state.layoutMode) return;
        const span = Number(button.dataset.span);
        setSectionSpan(sectionId, span);
      });
    });

    const analyzeBtn = card.querySelector(".ai-analyze-btn");
    if (analyzeBtn) {
      analyzeBtn.addEventListener("click", runAiAnalysis);
    }
  });
}

function clearDropTargets() {
  refs.grid.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
}

function setSectionSpan(sectionId, span) {
  const section = state.draftLayout.sections.find((x) => x.id === sectionId);
  if (!section) return;
  section.span = clampSpan(span);
  render();
}

function reorderDraftSections(fromId, toId) {
  if (!fromId || !toId || fromId === toId) return;

  const ordered = sortSections(state.draftLayout.sections);
  const fromIndex = ordered.findIndex((x) => x.id === fromId);
  const toIndex = ordered.findIndex((x) => x.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;

  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);

  ordered.forEach((section, index) => {
    section.order = index;
  });
  state.draftLayout.sections = ordered;
  render();
}

async function onEditModeToggle() {
  if (state.layoutMode) return;

  const pin = await ensureAdminPin();
  if (!pin) return;

  state.layoutMode = true;
  state.draftLayout = cloneLayout(state.savedLayout);
  render();
}

async function ensureAdminPin() {
  if (state.adminPin) return state.adminPin;

  const input = window.prompt("관리자 PIN을 입력하세요.");
  if (!input) return null;

  try {
    await apiRequest("/layout/save", {
      method: "POST",
      body: {
        pin: input,
        validateOnly: true,
      },
    });
    state.adminPin = input;
    state.pinVerifiedSession = true;
    sessionStorage.setItem("layoutPinVerified", "1");
    return input;
  } catch (error) {
    window.alert(error.message || "PIN 확인에 실패했습니다.");
    return null;
  }
}

async function onSaveLayout() {
  if (!state.layoutMode) return;

  const pin = await ensureAdminPin();
  if (!pin) return;

  try {
    const payload = {
      pin,
      layout: normalizeLayout(state.draftLayout),
      updatedBy: "web-admin",
    };
    const result = await apiRequest("/layout/save", { method: "POST", body: payload });
    state.savedLayout = normalizeLayout(result.layout || state.draftLayout);
    state.draftLayout = cloneLayout(state.savedLayout);
    state.layoutMode = false;
    render();
    window.alert("레이아웃이 저장되었습니다.");
  } catch (error) {
    window.alert(error.message || "레이아웃 저장에 실패했습니다.");
  }
}

function onCancelLayout() {
  if (!state.layoutMode) return;
  state.layoutMode = false;
  state.draftLayout = cloneLayout(state.savedLayout);
  render();
}

function openSymbolModal() {
  refs.symbolModal.hidden = false;
  refs.symbolModalError.hidden = true;
  refs.symbolInput.value = "";
  refs.titleInput.value = "";
  refs.symbolInput.focus();
}

function closeModal(name) {
  if (name === "symbol") refs.symbolModal.hidden = true;
  if (name === "ai") refs.aiModal.hidden = true;
}

function onSubmitManualSymbol() {
  const symbol = String(refs.symbolInput.value || "").trim().toUpperCase();
  const title = String(refs.titleInput.value || "").trim();

  if (!/^[A-Z0-9_]+:[A-Z0-9._-]+$/.test(symbol)) {
    refs.symbolModalError.hidden = false;
    refs.symbolModalError.textContent = "심볼 형식이 올바르지 않습니다. 예: NASDAQ:TSLA";
    return;
  }

  if (!title) {
    refs.symbolModalError.hidden = false;
    refs.symbolModalError.textContent = "표시명을 입력해 주세요.";
    return;
  }

  const duplicate = state.draftLayout.sections.some((section) => section.type === "chart" && section.symbol === symbol);
  if (duplicate) {
    refs.symbolModalError.hidden = false;
    refs.symbolModalError.textContent = "이미 추가된 심볼입니다.";
    return;
  }

  state.draftLayout.sections.push({
    id: makeId("chart"),
    type: "chart",
    title,
    symbol,
    badge: "Custom",
    span: 1,
    order: state.draftLayout.sections.length,
    widgetOptions: { interval: "60" },
  });

  closeModal("symbol");
  render();
}

async function openAiModal() {
  refs.aiModal.hidden = false;
  refs.aiModalStatus.textContent = "추천 목록을 준비하는 중입니다.";
  refs.aiSuggestList.innerHTML = "";

  try {
    const response = await apiRequest("/ai/suggest-symbols", {
      method: "POST",
      body: { sections: state.draftLayout.sections },
    });

    state.aiSuggestions = Array.isArray(response.recommendations) ? response.recommendations : [];
    if (!state.aiSuggestions.length) {
      refs.aiModalStatus.textContent = "추천 결과가 비어 있습니다.";
      return;
    }

    refs.aiModalStatus.textContent = response.partial
      ? "일부 외부 데이터 수집이 지연되어 부분 추천으로 표시됩니다."
      : "오늘 시황 기반 추천 심볼입니다.";

    refs.aiSuggestList.innerHTML = state.aiSuggestions
      .map((item, index) => {
        return `
          <label class="ai-suggest-item">
            <input type="checkbox" class="ai-suggest-check" data-index="${index}" checked />
            <div>
              <p class="ai-suggest-title">${escapeHtml(item.title || item.symbol)}</p>
              <p class="ai-suggest-symbol">${escapeHtml(item.symbol || "")}</p>
              <p class="ai-suggest-reason">${escapeHtml(item.reason || "")}</p>
            </div>
          </label>
        `;
      })
      .join("");
  } catch (error) {
    refs.aiModalStatus.textContent = error.message || "AI 추천 호출에 실패했습니다.";
  }
}

function applyAiSelections() {
  const checks = refs.aiSuggestList.querySelectorAll(".ai-suggest-check:checked");
  if (!checks.length) {
    closeModal("ai");
    return;
  }

  const existingSymbols = new Set(
    state.draftLayout.sections
      .filter((section) => section.type === "chart")
      .map((section) => String(section.symbol || "").toUpperCase())
  );

  checks.forEach((check) => {
    const index = Number(check.getAttribute("data-index"));
    const item = state.aiSuggestions[index];
    if (!item || !item.symbol) return;

    const symbol = String(item.symbol).toUpperCase();
    if (existingSymbols.has(symbol)) return;

    existingSymbols.add(symbol);
    state.draftLayout.sections.push({
      id: makeId("chart"),
      type: "chart",
      title: item.title || symbol,
      symbol,
      badge: "AI 추천",
      span: 1,
      order: state.draftLayout.sections.length,
      widgetOptions: { interval: "60" },
    });
  });

  closeModal("ai");
  render();
}

function renderAiSectionText() {
  const textNode = document.getElementById("ai-analysis-text");
  if (!textNode) return;
  textNode.textContent = state.aiAnalysis;
  textNode.classList.toggle("partial", Boolean(state.aiAnalysisPartial));
}

async function runAiAnalysis() {
  const buttons = refs.grid.querySelectorAll(".ai-analyze-btn");
  buttons.forEach((button) => {
    button.disabled = true;
    button.textContent = "분석 중";
  });

  try {
    const response = await apiRequest("/ai/analyze-layout", {
      method: "POST",
      body: { sections: getActiveLayout().sections },
    });

    state.aiAnalysis = response.analysis || "분석 결과가 없습니다.";
    state.aiAnalysisPartial = Boolean(response.partial);
    renderAiSectionText();
  } catch (error) {
    state.aiAnalysis = error.message || "분석 요청에 실패했습니다.";
    state.aiAnalysisPartial = true;
    renderAiSectionText();
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = "분석";
    });
  }
}

async function loadLayoutFromServer() {
  try {
    const response = await apiRequest("/layout", { method: "GET" });
    const layout = response.layout ? response.layout : DEFAULT_LAYOUT;
    return normalizeLayout(layout);
  } catch {
    return normalizeLayout(DEFAULT_LAYOUT);
  }
}

async function initChartWidgets(chartSections) {
  if (!chartSections.length) return;

  try {
    await loadTradingViewScript();
  } catch {
    chartSections.forEach((section) => {
      const status = document.getElementById(`status-${section.id}`);
      if (status) {
        status.hidden = false;
        status.textContent = `${section.title} 위젯 로더 실패`;
      }
    });
    return;
  }

  chartSections.forEach((section) => {
    createTradingViewWidget(section);
  });
}

function createTradingViewWidget(section) {
  if (!window.TradingView) return;
  const hostId = `chart-host-${section.id}`;
  const host = document.getElementById(hostId);
  const status = document.getElementById(`status-${section.id}`);
  if (!host) return;

  host.innerHTML = "";

  const options = {
    autosize: true,
    symbol: section.symbol,
    interval: section.widgetOptions?.interval || "60",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "kr",
    enable_publishing: false,
    allow_symbol_change: false,
    load_last_chart: false,
    disabled_features: ["use_localstorage_for_settings"],
    calendar: false,
    container_id: hostId,
  };

  if (section.widgetOptions?.main) {
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

  window.setTimeout(() => {
    const hasIframe = host.querySelector("iframe");
    if (!hasIframe && status) {
      status.hidden = false;
      status.textContent = `${section.title} 차트 로딩 지연`;
    } else if (status) {
      status.hidden = true;
    }
  }, WIDGET_LOAD_TIMEOUT_MS);
}

function refreshTicker(chartSections) {
  if (!refs.tickerWidget) return;

  const tickerSymbols = chartSections
    .filter((section) => section.symbol)
    .slice(0, 16)
    .map((section) => ({ proName: section.symbol, title: section.title }));

  refs.tickerWidget.innerHTML = "";
  refs.tickerStatus.hidden = true;

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
  script.async = true;
  script.defer = true;
  script.text = JSON.stringify({
    symbols: tickerSymbols,
    showSymbolLogo: false,
    colorTheme: "dark",
    isTransparent: true,
    displayMode: "compact",
    locale: "kr",
  });

  refs.tickerWidget.appendChild(script);

  window.setTimeout(() => {
    const hasIframe = refs.tickerWidget.querySelector("iframe");
    if (!hasIframe) refs.tickerStatus.hidden = false;
  }, WIDGET_LOAD_TIMEOUT_MS);
}

function loadTradingViewScript() {
  if (state.tradingViewScriptPromise) return state.tradingViewScriptPromise;
  if (window.TradingView) return Promise.resolve();

  state.tradingViewScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("TradingView script load failed"));
    document.head.appendChild(script);
  });

  return state.tradingViewScriptPromise;
}

function initFearAndGreedCard() {
  fetchFearAndGreed();
}

async function fetchFearAndGreed() {
  if (state.fearGreedInFlight || document.hidden) return;
  state.fearGreedInFlight = true;
  clearFearGreedTimer();

  try {
    const response = await fetch(FEAR_GREED_API_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const item = payload?.data?.[0];
    if (!item) throw new Error("Missing fear and greed payload");

    state.lastFearGreedData = item;
    state.lastFearGreedFetchedAt = Date.now();
    renderFearAndGreed(item, false);

    const nextSeconds = Number(item.time_until_update) || FEAR_GREED_FALLBACK_SECONDS;
    scheduleFearGreedFetch(nextSeconds);
  } catch {
    if (state.lastFearGreedData) {
      renderFearAndGreed(state.lastFearGreedData, true);
      scheduleFearGreedFetch(FEAR_GREED_FALLBACK_SECONDS);
    } else {
      renderFearAndGreedUnavailable();
      scheduleFearGreedFetch(FEAR_GREED_INITIAL_RETRY_SECONDS);
    }
  } finally {
    state.fearGreedInFlight = false;
  }
}

function scheduleFearGreedFetch(seconds) {
  if (document.hidden) return;
  clearFearGreedTimer();

  const waitMs = Math.max(30, Number(seconds) || FEAR_GREED_FALLBACK_SECONDS) * 1000;
  state.fearGreedTimerId = window.setTimeout(() => {
    fetchFearAndGreed();
  }, waitMs);
}

function clearFearGreedTimer() {
  if (!state.fearGreedTimerId) return;
  window.clearTimeout(state.fearGreedTimerId);
  state.fearGreedTimerId = null;
}

function renderFearAndGreed(item, isStale) {
  const card = refs.grid.querySelector('[data-section-type="fng"]');
  if (!card) return;

  const valueEl = card.querySelector("#fng-value");
  const classEl = card.querySelector("#fng-classification");
  const updatedEl = card.querySelector("#fng-updated");
  const statusEl = card.querySelector("#fng-status");
  const badgeEl = card.querySelector("#fng-badge");
  if (!valueEl || !classEl || !updatedEl || !statusEl || !badgeEl) return;

  const numericValue = Number(item.value);
  const rawClass = String(item.value_classification || "Neutral");
  const translatedClass = FNG_CLASSIFICATION_MAP[rawClass] || rawClass;
  const updatedTime = formatTimestamp(item.timestamp);

  valueEl.textContent = Number.isFinite(numericValue) ? String(numericValue) : "N/A";
  classEl.textContent = translatedClass;
  updatedEl.textContent = `업데이트: ${updatedTime}`;

  card.classList.remove("fng-fear", "fng-greed", "fng-neutral");
  card.classList.add(`fng-${resolveFearGreedTone(rawClass, numericValue)}`);

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

function renderFearGreedUnavailable() {
  const card = refs.grid.querySelector('[data-section-type="fng"]');
  if (!card) return;

  const valueEl = card.querySelector("#fng-value");
  const classEl = card.querySelector("#fng-classification");
  const updatedEl = card.querySelector("#fng-updated");
  const statusEl = card.querySelector("#fng-status");
  const badgeEl = card.querySelector("#fng-badge");
  if (!valueEl || !classEl || !updatedEl || !statusEl || !badgeEl) return;

  valueEl.textContent = "N/A";
  classEl.textContent = "데이터 없음";
  updatedEl.textContent = "업데이트: -";
  statusEl.textContent = "상태: 연결 지연 (30초 후 재시도)";
  badgeEl.textContent = "초기 실패";
  badgeEl.className = "chip";
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

async function apiRequest(path, options = {}) {
  const method = options.method || "GET";
  const headers = { "Content-Type": "application/json" };
  const payload = options.body ? JSON.stringify(options.body) : undefined;

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: payload,
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `요청 실패 (${response.status})`);
  }
  return data;
}

function normalizeLayout(layout) {
  const base = cloneLayout(layout && typeof layout === "object" ? layout : DEFAULT_LAYOUT);
  const sections = Array.isArray(base.sections) ? base.sections : [];

  base.sections = sections
    .map((section, index) => normalizeSection(section, index))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order)
    .map((section, index) => ({ ...section, order: index }));

  if (!base.sections.length) {
    return cloneLayout(DEFAULT_LAYOUT);
  }

  return {
    version: Number(base.version) || 1,
    updatedAt: base.updatedAt || null,
    updatedBy: String(base.updatedBy || "system"),
    meta: typeof base.meta === "object" && base.meta ? base.meta : {},
    sections: base.sections,
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

function sortSections(sections) {
  return [...sections].sort((a, b) => a.order - b.order);
}

function clampSpan(value) {
  const span = Number(value);
  if (!Number.isFinite(span)) return 1;
  return Math.max(1, Math.min(3, Math.round(span)));
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cloneLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

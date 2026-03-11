const FEAR_GREED_API_URL = "https://api.alternative.me/fng/?limit=1";
const FEAR_GREED_FALLBACK_SECONDS = 900;
const FEAR_GREED_INITIAL_RETRY_SECONDS = 30;
const WIDGET_LOAD_TIMEOUT_MS = 12000;
const TICKER_WIDGET_HEIGHT = 46;
const TICKER_SYMBOL_PATTERN = /^[A-Z0-9._-]+:[A-Z0-9._-]+$/;
const TICKER_SYMBOL_ALIASES = {
  "AMEX:IEF": "NASDAQ:IEF",
};

const API_BASE = "/api";
const ALLOWED_CHART_INTERVALS = new Set(["30", "W", "D", "M", "60"]);
const ALLOWED_SECTION_TYPES = new Set(["chart", "fng", "ai", "metric"]);
const DEFAULT_AI_MESSAGE = "분석 버튼을 누르면 구조화된 시황 요약을 제공합니다.";

const DEFAULT_LAYOUT_SECTIONS = [
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

const FNG_CLASSIFICATION_MAP = {
  "Extreme Fear": "극도의 공포",
  Fear: "공포",
  Neutral: "중립",
  Greed: "탐욕",
  "Extreme Greed": "극도의 탐욕",
};

const state = {
  layoutMode: false,
  savedLayoutStore: null,
  draftLayoutStore: null,
  pinVerifiedSession: sessionStorage.getItem("layoutPinVerified") === "1",
  adminPin: null,
  dragSourceId: null,
  aiSuggestions: [],
  aiAnalysis: DEFAULT_AI_MESSAGE,
  aiReport: null,
  aiAnalysisPartial: false,
  aiQuery: "",
  symbolSearchResults: [],
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

  const layoutStore = await loadLayoutFromServer();
  state.savedLayoutStore = layoutStore;
  state.draftLayoutStore = cloneLayout(layoutStore);

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
  refs.layoutCancelBtn = document.getElementById("layout-cancel-btn");

  refs.layoutSelect = document.getElementById("layout-select");
  refs.layoutCreateBtn = document.getElementById("layout-create-btn");
  refs.layoutDuplicateBtn = document.getElementById("layout-duplicate-btn");
  refs.layoutRenameBtn = document.getElementById("layout-rename-btn");

  refs.layoutAddBtn = document.getElementById("layout-add-btn");
  refs.layoutAiAddBtn = document.getElementById("layout-ai-add-btn");
  refs.layoutDeleteBtn = document.getElementById("layout-delete-btn");
  refs.timeframeBtns = Array.from(document.querySelectorAll(".timeframe-btn"));

  refs.tickerWidget = document.getElementById("ticker-widget");
  refs.tickerStatus = document.getElementById("ticker-status");

  refs.sectionModal = document.getElementById("section-modal");
  refs.sectionModalChartBtn = document.getElementById("section-modal-chart-btn");
  refs.sectionModalMetricBtn = document.getElementById("section-modal-metric-btn");
  refs.sectionModalCancel = document.getElementById("section-modal-cancel");

  refs.symbolModal = document.getElementById("symbol-modal");
  refs.symbolSearchInput = document.getElementById("symbol-search-input");
  refs.symbolSearchBtn = document.getElementById("symbol-search-btn");
  refs.symbolSearchResults = document.getElementById("symbol-search-results");
  refs.symbolInput = document.getElementById("symbol-input");
  refs.titleInput = document.getElementById("title-input");
  refs.symbolModalError = document.getElementById("symbol-modal-error");
  refs.symbolModalSubmit = document.getElementById("symbol-modal-submit");
  refs.symbolModalCancel = document.getElementById("symbol-modal-cancel");

  refs.aiModal = document.getElementById("ai-modal");
  refs.aiQueryInput = document.getElementById("ai-query-input");
  refs.aiQuerySubmit = document.getElementById("ai-query-submit");
  refs.aiModalStatus = document.getElementById("ai-modal-status");
  refs.aiSuggestList = document.getElementById("ai-suggest-list");
  refs.aiModalApply = document.getElementById("ai-modal-apply");
  refs.aiModalCancel = document.getElementById("ai-modal-cancel");
}

function bindGlobalEvents() {
  refs.editToggleBtn.addEventListener("click", onEditModeToggle);
  refs.layoutCancelBtn.addEventListener("click", onCancelLayout);

  refs.layoutSelect.addEventListener("change", onLayoutSelectionChange);
  refs.layoutCreateBtn.addEventListener("click", onCreateLayout);
  refs.layoutDuplicateBtn.addEventListener("click", onDuplicateLayout);
  refs.layoutRenameBtn.addEventListener("click", onRenameLayout);

  refs.layoutAddBtn.addEventListener("click", openSectionModal);
  refs.layoutAiAddBtn.addEventListener("click", openAiModal);
  refs.layoutDeleteBtn.addEventListener("click", onDeleteActiveLayout);

  refs.sectionModalChartBtn.addEventListener("click", onSelectChartSectionType);
  refs.sectionModalMetricBtn.addEventListener("click", onSelectMetricSectionType);
  refs.sectionModalCancel.addEventListener("click", () => closeModal("section"));

  refs.timeframeBtns.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveLayoutInterval(button.dataset.interval);
    });
  });

  refs.symbolModalSubmit.addEventListener("click", onSubmitManualSymbol);
  refs.symbolModalCancel.addEventListener("click", () => closeModal("symbol"));
  refs.symbolSearchBtn.addEventListener("click", onSearchSymbol);
  refs.symbolSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onSearchSymbol();
  });

  refs.aiModalApply.addEventListener("click", applyAiSelections);
  refs.aiModalCancel.addEventListener("click", () => closeModal("ai"));
  refs.aiQuerySubmit.addEventListener("click", () => fetchAiSuggestions());
  refs.aiQueryInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    fetchAiSuggestions();
  });

  document.querySelectorAll("[data-close-modal]").forEach((node) => {
    node.addEventListener("click", (event) => {
      const name = event.currentTarget.getAttribute("data-close-modal");
      closeModal(name);
    });
  });
}

function getActiveLayoutStore() {
  return state.layoutMode ? state.draftLayoutStore : state.savedLayoutStore;
}

function getLayoutById(layoutStore, layoutId) {
  if (!layoutStore || !Array.isArray(layoutStore.layouts)) return null;
  return layoutStore.layouts.find((layout) => layout.id === layoutId) || null;
}

function getActiveLayout(layoutStore = getActiveLayoutStore()) {
  if (!layoutStore || !Array.isArray(layoutStore.layouts) || !layoutStore.layouts.length) return null;
  return getLayoutById(layoutStore, layoutStore.activeLayoutId) || layoutStore.layouts[0];
}

function getEditableActiveLayout() {
  if (!state.layoutMode || !state.draftLayoutStore) return null;
  return getActiveLayout(state.draftLayoutStore);
}

function render() {
  const layoutStore = getActiveLayoutStore();
  const activeLayout = getActiveLayout(layoutStore);

  document.body.classList.toggle("layout-mode", state.layoutMode);
  refs.toolbar.hidden = !state.layoutMode;
  refs.editToggleBtn.textContent = state.layoutMode ? "저장" : "편집";
  refs.editToggleBtn.classList.toggle("btn-primary", state.layoutMode);
  refs.editToggleBtn.classList.toggle("btn-outline", !state.layoutMode);
  refs.layoutCancelBtn.hidden = !state.layoutMode;

  renderLayoutSelect(layoutStore);
  updateLayoutActionState(layoutStore);
  updateTimeframeButtons(activeLayout);

  refs.grid.innerHTML = "";
  if (!activeLayout) return;

  const sections = sortSections(activeLayout.sections);
  for (const section of sections) {
    refs.grid.appendChild(createSectionCard(section));
  }

  bindSectionEvents();
  initChartWidgets(sections.filter((section) => section.type === "chart"));
  refreshTicker(sections.filter((section) => section.type === "chart"));
  renderAiSectionText();
  if (state.lastFearGreedData) renderFearAndGreed(state.lastFearGreedData, false);
}

function renderLayoutSelect(layoutStore) {
  if (!layoutStore || !Array.isArray(layoutStore.layouts)) return;

  refs.layoutSelect.innerHTML = "";
  for (const layout of layoutStore.layouts) {
    const option = document.createElement("option");
    option.value = layout.id;
    option.textContent = layout.name;
    refs.layoutSelect.appendChild(option);
  }

  refs.layoutSelect.value = layoutStore.activeLayoutId;
}

function updateLayoutActionState(layoutStore) {
  const canEditLayouts = state.layoutMode;
  refs.layoutCreateBtn.disabled = !canEditLayouts;
  refs.layoutDuplicateBtn.disabled = !canEditLayouts;
  refs.layoutRenameBtn.disabled = !canEditLayouts;

  refs.layoutDeleteBtn.hidden = !state.layoutMode;
  refs.layoutDeleteBtn.disabled = !state.layoutMode || (layoutStore?.layouts?.length || 0) <= 1;
}

function updateTimeframeButtons(activeLayout) {
  const interval = normalizeChartInterval(activeLayout?.settings?.chartInterval);
  refs.timeframeBtns.forEach((button) => {
    const isActive = button.dataset.interval === interval;
    button.classList.toggle("active", isActive);
    button.disabled = false;
  });
}
function createSectionCard(section) {
  const card = document.createElement("section");
  card.className = `card section-card span-${clampSpan(section.span)}`;
  card.dataset.sectionId = section.id;
  card.dataset.sectionType = section.type;
  if (section.type === "metric") {
    card.dataset.metricKey = section.metricKey || "";
  }
  card.draggable = state.layoutMode;

  if (section.type === "chart") {
    const isMain = section.widgetOptions?.main === true;
    card.innerHTML = `
      <div class="card-title-row">
        <h2>${escapeHtml(section.title)}</h2>
        <div class="card-title-right">
          <span class="chip ${isMain ? "chip-primary" : ""}">${escapeHtml(section.badge || "차트")}</span>
          ${renderSpanControls(section.span, section.id)}
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
          <span class="chip chip-muted fng-badge">로딩 중</span>
          ${renderSpanControls(section.span, section.id)}
        </div>
      </div>
      <div class="fng-body">
        <p class="fng-value">N/A</p>
        <p class="fng-classification">데이터 수집 대기</p>
        <p class="fng-updated">업데이트: -</p>
        <p class="fng-status">상태: 초기화 중</p>
      </div>
    `;
    return card;
  }

  if (section.type === "metric") {
    const metricLabel = resolveMetricLabel(section.metricKey);
    card.classList.add("metric-card", "metric-compact");
    card.innerHTML = `
      <div class="card-title-row">
        <h2>${escapeHtml(section.title || metricLabel)}</h2>
        <div class="card-title-right">
          <span class="chip chip-muted metric-badge">로딩 중</span>
          ${renderSpanControls(section.span, section.id)}
        </div>
      </div>
      <div class="metric-body">
        <p class="metric-value">N/A</p>
        <p class="metric-classification">${escapeHtml(metricLabel)}</p>
        <p class="metric-updated">업데이트: -</p>
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
          ${renderSpanControls(section.span, section.id)}
        </div>
      </div>
      <div class="ai-card-body">
        <div class="ai-analysis ai-analysis-text">${escapeHtml(state.aiAnalysis)}</div>
      </div>
    `;
    return card;
  }

  card.innerHTML = `
    <div class="card-title-row">
      <h2>지원되지 않는 섹션</h2>
      ${renderSpanControls(section.span, section.id)}
    </div>
  `;
  return card;
}

function renderSpanControls(currentSpan, sectionId) {
  if (!state.layoutMode) return "";
  const value = clampSpan(currentSpan);
  return `
    <div class="section-edit-controls">
      <div class="span-controls">
        <button class="span-btn ${value === 1 ? "active" : ""}" data-span="1" type="button">1</button>
        <button class="span-btn ${value === 2 ? "active" : ""}" data-span="2" type="button">2</button>
        <button class="span-btn ${value === 3 ? "active" : ""}" data-span="3" type="button">3</button>
      </div>
      <button class="btn btn-outline section-delete-btn" data-delete-id="${escapeHtml(sectionId)}" type="button">삭제</button>
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

    const deleteBtn = card.querySelector(".section-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (!state.layoutMode) return;
        deleteDraftSection(sectionId);
      });
    }

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
  const activeLayout = getEditableActiveLayout();
  if (!activeLayout) return;

  const section = activeLayout.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return;

  section.span = clampSpan(span);
  render();
}

function deleteDraftSection(sectionId) {
  const activeLayout = getEditableActiveLayout();
  if (!activeLayout) return;

  const ordered = sortSections(activeLayout.sections);
  if (ordered.length <= 1) {
    window.alert("최소 1개 섹션은 유지해야 합니다.");
    return;
  }

  const target = ordered.find((section) => section.id === sectionId);
  if (!target) return;

  const ok = window.confirm(`"${target.title}" 섹션을 삭제할까요?`);
  if (!ok) return;

  const nextSections = ordered.filter((section) => section.id !== sectionId);
  nextSections.forEach((section, index) => {
    section.order = index;
  });

  activeLayout.sections = nextSections;
  render();
}

function reorderDraftSections(fromId, toId) {
  const activeLayout = getEditableActiveLayout();
  if (!activeLayout || !fromId || !toId || fromId === toId) return;

  const ordered = sortSections(activeLayout.sections);
  const fromIndex = ordered.findIndex((section) => section.id === fromId);
  const toIndex = ordered.findIndex((section) => section.id === toId);
  if (fromIndex < 0 || toIndex < 0) return;

  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);

  ordered.forEach((section, index) => {
    section.order = index;
  });

  activeLayout.sections = ordered;
  render();
}

async function onEditModeToggle() {
  if (state.layoutMode) {
    await onSaveLayout();
    return;
  }

  const pin = await ensureAdminPin();
  if (!pin) return;

  state.layoutMode = true;
  state.draftLayoutStore = cloneLayout(state.savedLayoutStore);
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
      layout: normalizeLayoutStore(state.draftLayoutStore),
      updatedBy: "web-admin",
    };
    const result = await apiRequest("/layout/save", { method: "POST", body: payload });

    state.savedLayoutStore = normalizeLayoutStore(result.layout || state.draftLayoutStore);
    state.draftLayoutStore = cloneLayout(state.savedLayoutStore);
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
  state.draftLayoutStore = cloneLayout(state.savedLayoutStore);
  render();
}
function onLayoutSelectionChange() {
  const selectedLayoutId = String(refs.layoutSelect.value || "");
  if (!selectedLayoutId) return;

  if (state.layoutMode) {
    if (!getLayoutById(state.draftLayoutStore, selectedLayoutId)) return;
    state.draftLayoutStore.activeLayoutId = selectedLayoutId;
  } else {
    if (!getLayoutById(state.savedLayoutStore, selectedLayoutId)) return;
    state.savedLayoutStore.activeLayoutId = selectedLayoutId;
  }

  render();
}

function onCreateLayout() {
  if (!state.layoutMode) {
    window.alert("레이아웃 편집 모드에서만 추가할 수 있습니다.");
    return;
  }

  const store = state.draftLayoutStore;
  const newLayout = normalizeSingleLayout(
    {
      id: makeId("layout"),
      name: `레이아웃 ${store.layouts.length + 1}`,
      settings: { chartInterval: "30" },
      sections: duplicateSectionsWithNewIds(DEFAULT_LAYOUT_STORE.layouts[0].sections),
    },
    store.layouts.length
  );

  store.layouts.push(newLayout);
  store.activeLayoutId = newLayout.id;
  render();
}

function onDuplicateLayout() {
  if (!state.layoutMode) {
    window.alert("레이아웃 편집 모드에서만 복제할 수 있습니다.");
    return;
  }

  const store = state.draftLayoutStore;
  const activeLayout = getActiveLayout(store);
  if (!activeLayout) return;

  const duplicated = normalizeSingleLayout(
    {
      id: makeId("layout"),
      name: `${activeLayout.name} 복제`,
      settings: cloneLayout(activeLayout.settings || {}),
      sections: duplicateSectionsWithNewIds(activeLayout.sections),
    },
    store.layouts.length
  );

  store.layouts.push(duplicated);
  store.activeLayoutId = duplicated.id;
  render();
}

function onRenameLayout() {
  if (!state.layoutMode) {
    window.alert("레이아웃 편집 모드에서만 이름을 변경할 수 있습니다.");
    return;
  }

  const activeLayout = getEditableActiveLayout();
  if (!activeLayout) return;

  const nextName = String(window.prompt("레이아웃 이름", activeLayout.name) || "").trim();
  if (!nextName) return;

  activeLayout.name = nextName;
  render();
}

function onDeleteActiveLayout() {
  if (!state.layoutMode) return;

  const store = state.draftLayoutStore;
  if (!store || !Array.isArray(store.layouts)) return;

  if (store.layouts.length <= 1) {
    window.alert("최소 1개의 레이아웃은 유지해야 합니다.");
    return;
  }

  const activeLayout = getActiveLayout(store);
  if (!activeLayout) return;

  const ok = window.confirm(`현재 레이아웃 "${activeLayout.name}"을(를) 삭제할까요?`);
  if (!ok) return;

  const currentIndex = store.layouts.findIndex((layout) => layout.id === activeLayout.id);
  const nextLayouts = store.layouts.filter((layout) => layout.id !== activeLayout.id);

  const nextIndex = Math.min(Math.max(currentIndex - 1, 0), nextLayouts.length - 1);
  store.layouts = nextLayouts;
  store.activeLayoutId = nextLayouts[nextIndex].id;

  render();
}

function setActiveLayoutInterval(interval) {
  const activeLayout = getActiveLayout();
  if (!activeLayout) return;

  activeLayout.settings = activeLayout.settings || {};
  activeLayout.settings.chartInterval = normalizeChartInterval(interval);
  render();
}

function openSectionModal() {
  if (!state.layoutMode) {
    window.alert("레이아웃 편집 모드에서만 섹션을 추가할 수 있습니다.");
    return;
  }
  refs.sectionModal.hidden = false;
}

function onSelectChartSectionType() {
  closeModal("section");
  openSymbolModal();
}

function onSelectMetricSectionType() {
  closeModal("section");
  addFearGreedMetricSection();
}

function addFearGreedMetricSection() {
  const activeLayout = getEditableActiveLayout();
  if (!activeLayout) return;

  activeLayout.sections.push({
    id: makeId("metric"),
    type: "metric",
    metricKey: "fearGreed",
    title: "Fear & Greed Mini",
    span: 1,
    order: activeLayout.sections.length,
    widgetOptions: { compact: true },
  });

  render();
}

function openSymbolModal() {
  if (!state.layoutMode) {
    window.alert("레이아웃 편집 모드에서만 차트를 추가할 수 있습니다.");
    return;
  }

  refs.symbolModal.hidden = false;
  refs.symbolModalError.hidden = true;
  refs.symbolModalError.textContent = "";
  refs.symbolSearchInput.value = "";
  refs.symbolInput.value = "";
  refs.titleInput.value = "";
  state.symbolSearchResults = [];
  renderSymbolSearchResults();
  refs.symbolSearchInput.focus();
  onSearchSymbol();
}

async function onSearchSymbol() {
  const query = String(refs.symbolSearchInput.value || "").trim();

  refs.symbolModalError.hidden = true;
  refs.symbolModalError.textContent = "";
  refs.symbolSearchBtn.disabled = true;
  refs.symbolSearchResults.innerHTML = `<p class="symbol-search-empty">검색 중...</p>`;

  try {
    const response = await apiRequest("/symbols/search", {
      method: "POST",
      body: { query, limit: 10 },
    });

    state.symbolSearchResults = Array.isArray(response.results) ? response.results : [];
    renderSymbolSearchResults();
  } catch (error) {
    state.symbolSearchResults = [];
    refs.symbolModalError.hidden = false;
    refs.symbolModalError.textContent = error.message || "심볼 검색 호출에 실패했습니다.";
    renderSymbolSearchResults();
  } finally {
    refs.symbolSearchBtn.disabled = false;
  }
}

function renderSymbolSearchResults() {
  if (!refs.symbolSearchResults) return;

  if (!state.symbolSearchResults.length) {
    refs.symbolSearchResults.innerHTML = `<p class="symbol-search-empty">검색 결과가 없습니다.</p>`;
    return;
  }

  refs.symbolSearchResults.innerHTML = state.symbolSearchResults
    .map((item, index) => {
      const title = escapeHtml(item.title || item.symbol || "");
      const symbol = escapeHtml(item.symbol || "");
      const source = escapeHtml(item.source || "catalog");
      return `
        <button class="symbol-search-item" type="button" data-symbol-index="${index}">
          <p class="symbol-search-title">${title}</p>
          <p class="symbol-search-meta">${symbol} · ${source}</p>
        </button>
      `;
    })
    .join("");

  refs.symbolSearchResults.querySelectorAll("[data-symbol-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-symbol-index"));
      const item = state.symbolSearchResults[index];
      if (!item) return;
      refs.symbolInput.value = String(item.symbol || "").toUpperCase();
      refs.titleInput.value = String(item.title || item.symbol || "");
      refs.symbolModalError.hidden = true;
      refs.symbolModalError.textContent = "";
    });
  });
}

function closeModal(name) {
  if (name === "symbol") refs.symbolModal.hidden = true;
  if (name === "ai") refs.aiModal.hidden = true;
  if (name === "section") refs.sectionModal.hidden = true;
}

function onSubmitManualSymbol() {
  const activeLayout = getEditableActiveLayout();
  if (!activeLayout) return;

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

  const duplicate = activeLayout.sections.some(
    (section) => section.type === "chart" && String(section.symbol || "").toUpperCase() === symbol
  );
  if (duplicate) {
    refs.symbolModalError.hidden = false;
    refs.symbolModalError.textContent = "이미 추가된 심볼입니다.";
    return;
  }

  activeLayout.sections.push({
    id: makeId("chart"),
    type: "chart",
    title,
    symbol,
    badge: "Custom",
    span: 1,
    order: activeLayout.sections.length,
    widgetOptions: { interval: "60" },
  });

  closeModal("symbol");
  render();
}

async function openAiModal() {
  refs.aiModal.hidden = false;
  refs.aiQueryInput.value = state.aiQuery || "";
  await fetchAiSuggestions();
}

async function fetchAiSuggestions() {
  const activeLayout = getEditableActiveLayout() || getActiveLayout();
  if (!activeLayout) return;

  state.aiQuery = String(refs.aiQueryInput.value || "").trim();
  refs.aiModalStatus.textContent = "추천 목록을 준비하는 중입니다.";
  refs.aiSuggestList.innerHTML = "";
  refs.aiQuerySubmit.disabled = true;

  try {
    const response = await apiRequest("/ai/suggest-symbols", {
      method: "POST",
      body: {
        sections: activeLayout.sections,
        query: state.aiQuery,
      },
    });

    state.aiSuggestions = Array.isArray(response.recommendations) ? response.recommendations : [];
    if (!state.aiSuggestions.length) {
      refs.aiModalStatus.textContent = "추천 결과가 비어 있습니다.";
      return;
    }

    const baseStatus = state.aiQuery
      ? `"${state.aiQuery}" 요청 기반 추천 결과입니다.`
      : "오늘 시황 기반 추천 심볼입니다.";
    refs.aiModalStatus.textContent = response.partial
      ? `${baseStatus} 일부 외부 데이터 수집이 지연되어 부분 추천으로 표시됩니다.`
      : baseStatus;

    refs.aiSuggestList.innerHTML = buildAiSuggestionListHtml(state.aiSuggestions);
  } catch (error) {
    refs.aiModalStatus.textContent = error.message || "AI 추천 호출에 실패했습니다.";
  } finally {
    refs.aiQuerySubmit.disabled = false;
  }
}

function buildAiSuggestionListHtml(items) {
  return items
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
}

function applyAiSelections() {
  const activeLayout = getEditableActiveLayout();
  if (!activeLayout) {
    closeModal("ai");
    return;
  }

  const checks = refs.aiSuggestList.querySelectorAll(".ai-suggest-check:checked");
  if (!checks.length) {
    closeModal("ai");
    return;
  }

  const existingSymbols = new Set(
    activeLayout.sections
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
    activeLayout.sections.push({
      id: makeId("chart"),
      type: "chart",
      title: item.title || symbol,
      symbol,
      badge: "AI 추천",
      span: 1,
      order: activeLayout.sections.length,
      widgetOptions: { interval: "60" },
    });
  });

  closeModal("ai");
  render();
}

function renderAiSectionText() {
  refs.grid.querySelectorAll(".ai-analysis-text").forEach((node) => {
    if (state.aiReport) {
      node.innerHTML = buildAiReportHtml(state.aiReport);
    } else {
      const safeText = escapeHtml(state.aiAnalysis).replaceAll("\n", "<br />");
      node.innerHTML = `<p class="ai-report-summary">${safeText}</p>`;
    }
    node.classList.toggle("partial", Boolean(state.aiAnalysisPartial));
  });
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
      body: { sections: getActiveLayout()?.sections || [] },
    });

    state.aiAnalysis = response.analysis || "분석 결과가 없습니다.";
    state.aiReport = normalizeAiReportFromApi(response.report);
    state.aiAnalysisPartial = Boolean(response.partial);
    renderAiSectionText();
  } catch (error) {
    state.aiAnalysis = error.message || "분석 요청에 실패했습니다.";
    state.aiReport = null;
    state.aiAnalysisPartial = true;
    renderAiSectionText();
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = "분석";
    });
  }
}

function normalizeAiReportFromApi(report) {
  if (!report || typeof report !== "object") return null;

  const normalizeList = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  };

  return {
    summary: String(report.summary || "").trim(),
    buy: normalizeList(report.buy),
    sell: normalizeList(report.sell),
    themes: normalizeList(report.themes),
    bullish: normalizeList(report.bullish),
    bearish: normalizeList(report.bearish),
  };
}

function buildAiReportHtml(report) {
  const blocks = [
    { title: "매수 추천", items: report.buy },
    { title: "매도 추천", items: report.sell },
    { title: "주목 테마", items: report.themes },
    { title: "긍정 관점", items: report.bullish },
    { title: "부정 관점", items: report.bearish },
  ];

  const body = blocks
    .map((block) => {
      const items = Array.isArray(block.items) && block.items.length ? block.items : ["데이터 없음"];
      const lines = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return `
        <section class="ai-report-block">
          <h3>${escapeHtml(block.title)}</h3>
          <ul>${lines}</ul>
        </section>
      `;
    })
    .join("");

  const summary = escapeHtml(report.summary || state.aiAnalysis || DEFAULT_AI_MESSAGE);
  return `
    <div class="ai-report">
      <p class="ai-report-summary">${summary}</p>
      ${body}
    </div>
  `;
}

async function loadLayoutFromServer() {
  try {
    const response = await apiRequest("/layout", { method: "GET" });
    const layout = response.layout ? response.layout : DEFAULT_LAYOUT_STORE;
    return normalizeLayoutStore(layout);
  } catch {
    return normalizeLayoutStore(DEFAULT_LAYOUT_STORE);
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

  const activeInterval = normalizeChartInterval(getActiveLayout()?.settings?.chartInterval);
  const options = {
    autosize: true,
    symbol: section.symbol,
    interval: activeInterval,
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
  if (!refs.tickerWidget || !refs.tickerStatus) return;

  const tickerSymbols = chartSections
    .map((section) => ({
      proName: String(TICKER_SYMBOL_ALIASES[String(section.symbol || "").toUpperCase()] || section.symbol || "").toUpperCase(),
      title: String(section.title || section.symbol || ""),
    }))
    .filter((item) => TICKER_SYMBOL_PATTERN.test(item.proName))
    .slice(0, 16);

  refs.tickerWidget.innerHTML = "";
  refs.tickerStatus.hidden = true;
  refs.tickerStatus.textContent = "티커 위젯 로딩이 지연되고 있습니다.";

  if (!tickerSymbols.length) {
    refs.tickerStatus.hidden = false;
    refs.tickerStatus.textContent = "표시 가능한 티커 심볼이 없습니다.";
    return;
  }

  const script = document.createElement("script");
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
  script.async = true;
  script.defer = true;
  script.text = JSON.stringify({
    symbols: tickerSymbols,
    showSymbolLogo: false,
    colorTheme: "dark",
    isTransparent: true,
    displayMode: "adaptive",
    width: "100%",
    height: TICKER_WIDGET_HEIGHT,
    locale: "kr",
  });

  refs.tickerWidget.appendChild(script);

  window.setTimeout(() => {
    const hasIframe = refs.tickerWidget.querySelector("iframe");
    refs.tickerStatus.hidden = Boolean(hasIframe);
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
      renderFearGreedUnavailable();
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

function getFearGreedCards() {
  return refs.grid.querySelectorAll(
    '[data-section-type="fng"], [data-section-type="metric"][data-metric-key="fearGreed"]'
  );
}

function renderFearAndGreed(item, isStale) {
  const cards = getFearGreedCards();
  if (!cards.length) return;

  const numericValue = Number(item.value);
  const rawClass = String(item.value_classification || "Neutral");
  const translatedClass = FNG_CLASSIFICATION_MAP[rawClass] || rawClass;
  const updatedTime = formatTimestamp(item.timestamp);
  const tone = resolveFearGreedTone(rawClass, numericValue);

  cards.forEach((card) => {
    const sectionType = card.dataset.sectionType;
    if (sectionType === "fng") {
      renderFearGreedFullCard(card, {
        numericValue,
        translatedClass,
        updatedTime,
        tone,
        isStale,
      });
      return;
    }

    if (sectionType === "metric" && card.dataset.metricKey === "fearGreed") {
      renderFearGreedMetricCard(card, {
        numericValue,
        translatedClass,
        updatedTime,
        tone,
        isStale,
      });
    }
  });
}

function renderFearGreedFullCard(card, data) {
  const valueEl = card.querySelector(".fng-value");
  const classEl = card.querySelector(".fng-classification");
  const updatedEl = card.querySelector(".fng-updated");
  const statusEl = card.querySelector(".fng-status");
  const badgeEl = card.querySelector(".fng-badge");
  if (!valueEl || !classEl || !updatedEl || !statusEl || !badgeEl) return;

  valueEl.textContent = Number.isFinite(data.numericValue) ? String(data.numericValue) : "N/A";
  classEl.textContent = data.translatedClass;
  updatedEl.textContent = `업데이트: ${data.updatedTime}`;

  card.classList.remove("fng-fear", "fng-greed", "fng-neutral");
  card.classList.add(`fng-${data.tone}`);

  if (data.isStale) {
    statusEl.textContent = "상태: 연결 지연 (마지막 수신값 유지)";
    badgeEl.textContent = "연결 지연";
    badgeEl.className = "chip fng-badge";
    return;
  }

  statusEl.textContent = "상태: 정상 수신";
  badgeEl.textContent = "실시간";
  badgeEl.className = "chip chip-primary fng-badge";
}

function renderFearGreedMetricCard(card, data) {
  const valueEl = card.querySelector(".metric-value");
  const classEl = card.querySelector(".metric-classification");
  const updatedEl = card.querySelector(".metric-updated");
  const badgeEl = card.querySelector(".metric-badge");
  if (!valueEl || !classEl || !updatedEl || !badgeEl) return;

  valueEl.textContent = Number.isFinite(data.numericValue) ? String(data.numericValue) : "N/A";
  classEl.textContent = data.translatedClass;
  updatedEl.textContent = `업데이트: ${data.updatedTime}`;

  card.classList.remove("metric-fear", "metric-greed", "metric-neutral");
  card.classList.add(`metric-${data.tone}`);

  if (data.isStale) {
    badgeEl.textContent = "지연";
    badgeEl.className = "chip metric-badge";
    return;
  }

  badgeEl.textContent = "실시간";
  badgeEl.className = "chip chip-primary metric-badge";
}

function renderFearGreedUnavailable() {
  const cards = getFearGreedCards();
  if (!cards.length) return;

  cards.forEach((card) => {
    const sectionType = card.dataset.sectionType;

    if (sectionType === "fng") {
      const valueEl = card.querySelector(".fng-value");
      const classEl = card.querySelector(".fng-classification");
      const updatedEl = card.querySelector(".fng-updated");
      const statusEl = card.querySelector(".fng-status");
      const badgeEl = card.querySelector(".fng-badge");
      if (!valueEl || !classEl || !updatedEl || !statusEl || !badgeEl) return;

      valueEl.textContent = "N/A";
      classEl.textContent = "데이터 없음";
      updatedEl.textContent = "업데이트: -";
      statusEl.textContent = "상태: 연결 지연 (30초 후 재시도)";
      badgeEl.textContent = "초기 실패";
      badgeEl.className = "chip fng-badge";
      return;
    }

    if (sectionType === "metric" && card.dataset.metricKey === "fearGreed") {
      const valueEl = card.querySelector(".metric-value");
      const classEl = card.querySelector(".metric-classification");
      const updatedEl = card.querySelector(".metric-updated");
      const badgeEl = card.querySelector(".metric-badge");
      if (!valueEl || !classEl || !updatedEl || !badgeEl) return;

      valueEl.textContent = "N/A";
      classEl.textContent = "데이터 없음";
      updatedEl.textContent = "업데이트: -";
      badgeEl.textContent = "초기 실패";
      badgeEl.className = "chip metric-badge";
    }
  });
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

function resolveMetricLabel(metricKey) {
  if (normalizeMetricKey(metricKey) === "fearGreed") return "Fear & Greed";
  return "Metric";
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
function normalizeLayoutStore(layoutStore) {
  const source = layoutStore && typeof layoutStore === "object" ? cloneLayout(layoutStore) : cloneLayout(DEFAULT_LAYOUT_STORE);
  if (Array.isArray(source.layouts)) {
    return normalizeLayoutStoreV2(source);
  }
  return migrateLegacyLayoutStore(source);
}

function migrateLegacyLayoutStore(layoutV1) {
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
    : cloneLayout(DEFAULT_LAYOUT_STORE.layouts[0].sections).map((section, sectionIndex) =>
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

function sortSections(sections) {
  return [...sections].sort((a, b) => a.order - b.order);
}

function duplicateSectionsWithNewIds(sections) {
  return sortSections(Array.isArray(sections) ? sections : []).map((section, index) => ({
    ...cloneLayout(section),
    id: makeId(section.type || "section"),
    order: index,
  }));
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

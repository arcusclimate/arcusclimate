const MAPBOX_TOKEN = (() => {
  if (typeof window === "undefined") return "";
  return (window.__env?.MAPBOX_TOKEN || window.MAPBOX_TOKEN || "").trim();
})();

const ENABLE_HOVER_TOOLTIPS = true;
const ENABLE_ISO_PANEL = true;

const RISK_CONTEXT = {
  "High Risk": "This state faces compounding grid, regulatory, and capacity constraints that make data center siting costly and uncertain. AI infrastructure growth here carries elevated operational and reputational risk.",
  "Moderate Risk": "This state has meaningful infrastructure or regulatory headwinds. Growth is possible but requires careful diligence on grid capacity, procurement, and policy trajectory.",
  "Emerging Risk": "This state shows early warning signals. Current conditions are manageable, but the risk profile is shifting — worth monitoring closely as AI compute demand grows.",
  "Low Risk": "This state presents favorable conditions for AI infrastructure growth, with supportive grid capacity, policy environment, and limited near-term constraint signals.",
  "No Data": ""
};

if (!MAPBOX_TOKEN) {
  console.error("Mapbox token missing. Set MAPBOX_TOKEN as a Vercel environment variable.");
} else {
  mapboxgl.accessToken = MAPBOX_TOKEN;
}

const ui = {
  panel: document.getElementById("panel"),
  panelClose: document.getElementById("panelClose"),
  panelTitle: document.getElementById("panelTitle"),
  panelMeta: document.getElementById("panelMeta"),
  panelRiskContext: document.getElementById("panelRiskContext"),
  panelTopSignals: document.getElementById("panelTopSignals"),
  panelEntriesHint: document.getElementById("panelEntriesHint"),
  panelEntries: document.getElementById("panelEntries"),
  hoverTooltip: document.getElementById("hoverTooltip"),
  topRiskList: document.getElementById("topRiskList"),
  legendLastUpdated: document.getElementById("legendLastUpdated"),
  onboardingBanner: document.getElementById("onboardingBanner"),
  onboardingClose: document.getElementById("onboardingClose"),

  stateSearch: document.getElementById("stateSearch"),
  filterIso: document.getElementById("filterIso"),
  filterCategory: document.getElementById("filterCategory"),
  filterImpact: document.getElementById("filterImpact"),
  filterType: document.getElementById("filterType"),
  filterDirection: document.getElementById("filterDirection"),
  filterSignalCategory: document.getElementById("filterSignalCategory"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),

  viewStateBtn: document.getElementById("viewStateBtn"),
  viewIsoBtn: document.getElementById("viewIsoBtn"),
};

const RISK_COLORS = {
  "Low Risk": "#A8D5BA",
  "Emerging Risk": "#F3E6AE",
  "Moderate Risk": "#F7C6C7",
  "High Risk": "#E57373",
  "No Data": "#E5E7EB",
};

const ISO_COLORS = {
  "PJM": "#7FB3D5",
  "MISO": "#A3BE8C",
  "SPP": "#EBCB8B",
  "ERCOT": "#D08770",
  "CAISO": "#88C0D0",
  "NYISO": "#B48EAD",
  "ISO-NE": "#81A1C1",
  "WECC": "#D8DEE9"
};

let map;
let statesGeo;
let isoGeo;

let statesData = [];
let entriesData = [];

let stateIndex = new Map();
let entriesByState = new Map();
let isoToStates = new Map();

let currentViewMode = "state";
let currentContext = null;
let hoveredStateId = null;
let hoveredIsoId = null;
let selectedStateId = null;

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (!res.ok) throw new Error(json.error || `Request failed: ${url}`);
    return json;
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 120)}`);
  }
}

function normalizeStateName(value) {
  return String(value || "").trim();
}

function parseTopSignals(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function fillSelect(el, values, placeholder) {
  if (!el) return;
  el.innerHTML = "";
  const base = document.createElement("option");
  base.value = "";
  base.textContent = placeholder;
  el.appendChild(base);
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function showHoverTooltip(x, y, html) {
  if (!ui.hoverTooltip) return;
  ui.hoverTooltip.innerHTML = html;
  ui.hoverTooltip.style.left = `${x + 16}px`;
  ui.hoverTooltip.style.top = `${y + 88}px`;
  ui.hoverTooltip.style.display = "block";
  ui.hoverTooltip.classList.remove("hover-tooltip--hidden");
}

function hideHoverTooltip() {
  if (!ui.hoverTooltip) return;
  ui.hoverTooltip.style.display = "none";
  ui.hoverTooltip.classList.add("hover-tooltip--hidden");
}

function buildIndexes() {
  stateIndex = new Map();
  entriesByState = new Map();
  isoToStates = new Map();

  for (const s of statesData) {
    const name = normalizeStateName(s.state || s.State);
    if (!name) continue;

    const gridRegions = Array.isArray(s.gridRegions)
      ? s.gridRegions
      : (s.gridRegions ? [s.gridRegions] : []);

    const rec = {
      state: name,
      calculatedRiskLevel: s.calculatedRiskLevel || s["Calculated Risk Level"] || "",
      riskScoreTotal: Number(s.riskScoreTotal ?? s["Risk Score Total"] ?? 0),
      entryCount: Number(s.entryCount ?? s["Entry Count"] ?? 0),
      topRiskSignals: parseTopSignals(s.topRiskSignals ?? s["Top Risk Signals"]),
      gridRegions,
      summary: s.summary || s.Summary || "",
      lastUpdated: s.lastUpdated || s["Last Updated"] || "",
    };

    stateIndex.set(name, rec);

    gridRegions.forEach(iso => {
      if (!isoToStates.has(iso)) isoToStates.set(iso, []);
      isoToStates.get(iso).push(name);
    });
  }

  for (const e of entriesData) {
    const state = normalizeStateName(e.state || e.State);
    if (!state) continue;

    const entry = {
      title: e.title || e.Title || "",
      summary: e.summary || e.Summary || "",
      link: e.link || e.Link || "",
      publishedDate: e.publishedDate || e["Published Date"] || "",
      state,
      category: e.category || e["Category (linked)"] || e.Category || "",
      impactLevel: e.impactLevel || e["Impact Level (linked)"] || e["Impact Level"] || "",
      signalType: e.signalType || e["Signal Type (linked)"] || e["Signal Type"] || "",
      signalDirection: e.signalDirection || e["Signal Direction (linked)"] || e["Signal Direction"] || "",
      signalCategory: e.signalCategory || e["Signal Category"] || "",
      impactRank: Number(e.impactRank ?? e["Impact Rank"] ?? 999),
      sourceDomain: e.sourceDomain || e["Source Domain"] || "",
    };

    if (!entriesByState.has(state)) entriesByState.set(state, []);
    entriesByState.get(state).push(entry);
  }

  for (const [, list] of entriesByState.entries()) {
    list.sort((a, b) => {
      if (a.impactRank !== b.impactRank) return a.impactRank - b.impactRank;
      return new Date(b.publishedDate || 0) - new Date(a.publishedDate || 0);
    });
  }
}

function attachStateRiskToGeoJSON() {
  statesGeo.features.forEach((feature) => {
    const name = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
    const state = stateIndex.get(name);
    feature.properties.calculatedRiskLevel = state?.calculatedRiskLevel || "No Data";
    feature.properties.riskScoreTotal = state?.riskScoreTotal ?? 0;
    feature.properties.entryCount = state?.entryCount ?? 0;
  });
}

function fillFilters() {
  const allEntries = [...entriesByState.values()].flat();
  fillSelect(ui.filterIso, uniqueSorted([...isoToStates.keys()]), "All ISO / RTO");
  fillSelect(ui.filterCategory, uniqueSorted(allEntries.map(e => e.category)), "All Categories");
  fillSelect(ui.filterImpact, uniqueSorted(allEntries.map(e => e.impactLevel)), "All Impact");
  fillSelect(ui.filterType, uniqueSorted(allEntries.map(e => e.signalType)), "All Signal Types");
  fillSelect(ui.filterDirection, uniqueSorted(allEntries.map(e => e.signalDirection)), "All Directions");
  fillSelect(ui.filterSignalCategory, uniqueSorted(allEntries.map(e => e.signalCategory)), "All Signal Categories");
}

function getFilters() {
  return {
    search: String(ui.stateSearch?.value || "").trim().toLowerCase(),
    iso: String(ui.filterIso?.value || "").trim(),
    category: String(ui.filterCategory?.value || "").trim(),
    impact: String(ui.filterImpact?.value || "").trim(),
    type: String(ui.filterType?.value || "").trim(),
    direction: String(ui.filterDirection?.value || "").trim(),
    signalCategory: String(ui.filterSignalCategory?.value || "").trim(),
  };
}

function entryMatchesFilters(entry, filters) {
  if (filters.search) {
    const blob = `${entry.title} ${entry.summary} ${entry.state}`.toLowerCase();
    if (!blob.includes(filters.search)) return false;
  }
  if (filters.iso) {
    const state = stateIndex.get(entry.state);
    const gridRegions = state?.gridRegions || [];
    if (!gridRegions.includes(filters.iso)) return false;
  }
  if (filters.category && entry.category !== filters.category) return false;
  if (filters.impact && entry.impactLevel !== filters.impact) return false;
  if (filters.type && entry.signalType !== filters.type) return false;
  if (filters.direction && entry.signalDirection !== filters.direction) return false;
  if (filters.signalCategory && entry.signalCategory !== filters.signalCategory) return false;
  return true;
}

function renderTopSignals(items) {
  ui.panelTopSignals.innerHTML = "";
  if (!items.length) {
    ui.panelTopSignals.innerHTML = "<li>No top signals available.</li>";
    return;
  }
  items.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    ui.panelTopSignals.appendChild(li);
  });
}

function renderEntries(entries) {
  ui.panelEntries.innerHTML = "";
  if (!entries.length) {
    ui.panelEntriesHint.textContent = "No matching resources.";
    ui.panelEntries.innerHTML = "<li>No matching entries for the current filters.</li>";
    return;
  }
  ui.panelEntriesHint.textContent = `${entries.length} matching resource${entries.length === 1 ? "" : "s"}`;
  entries.forEach(entry => {
    const li = document.createElement("li");
    const year = entry.publishedDate ? new Date(entry.publishedDate).getFullYear() : "";
    const meta = [entry.category, entry.impactLevel, year || "", entry.sourceDomain || ""].filter(Boolean).join(" · ");
    li.innerHTML = `
      <div class="entry__title">
        <a href="${entry.link}" target="_blank" rel="noopener noreferrer">${entry.title}</a>
      </div>
      <div class="entry__meta">${meta}</div>
      <div class="entry__summary">${entry.summary || ""}</div>
    `;
    ui.panelEntries.appendChild(li);
  });
}

function showPanel() {
  ui.panel.classList.remove("panel--hidden");
}

function hidePanel() {
  ui.panel.classList.add("panel--hidden");
  if (selectedStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
    selectedStateId = null;
  }
}

function getRiskBadgeClass(riskLevel) {
  const map = {
    "High Risk": "risk-badge--high",
    "Moderate Risk": "risk-badge--moderate",
    "Emerging Risk": "risk-badge--emerging",
    "Low Risk": "risk-badge--low",
  };
  return map[riskLevel] || "";
}

function renderStatePanel(stateName) {
  const state = stateIndex.get(stateName);
  if (!state) return;

  currentContext = { type: "state", value: stateName };

  ui.panelTitle.textContent = stateName;

  const riskBadge = state.calculatedRiskLevel
    ? `<span class="risk-badge ${getRiskBadgeClass(state.calculatedRiskLevel)}">${state.calculatedRiskLevel}</span>`
    : "";

  ui.panelMeta.innerHTML = [
    riskBadge,
    Number.isFinite(state.riskScoreTotal) ? `Score: ${state.riskScoreTotal}` : "",
    Number.isFinite(state.entryCount) ? `${state.entryCount} signals` : "",
    (state.gridRegions || []).length ? `ISO/RTO: ${state.gridRegions.join(", ")}` : ""
  ].filter(Boolean).join(" · ");

  if (ui.panelRiskContext) {
    const context = RISK_CONTEXT[state.calculatedRiskLevel] || "";
    ui.panelRiskContext.textContent = context;
    ui.panelRiskContext.style.display = context ? "block" : "none";
  }

  renderTopSignals(state.topRiskSignals || []);

  const filters = getFilters();
  const entries = (entriesByState.get(stateName) || []).filter(e => entryMatchesFilters(e, filters));
  renderEntries(entries);

  showPanel();

  if (map && map.getSource("states")) {
    if (selectedStateId !== null) {
      map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
    }
    const feature = statesGeo.features.find(f =>
      normalizeStateName(f.properties?.NAME || f.properties?.name || "") === stateName
    );
    if (feature && feature.id !== undefined) {
      selectedStateId = feature.id;
      map.setFeatureState({ source: "states", id: selectedStateId }, { selected: true });
    }
  }
}

function renderIsoPanel(isoName) {
  currentContext = { type: "iso", value: isoName };

  const stateNames = isoToStates.get(isoName) || [];
  const filters = getFilters();

  const allEntries = stateNames
    .flatMap(state => entriesByState.get(state) || [])
    .filter(e => entryMatchesFilters(e, filters));

  const topSignals = stateNames
    .flatMap(state => stateIndex.get(state)?.topRiskSignals || [])
    .slice(0, 8);

  ui.panelTitle.textContent = isoName;
  ui.panelMeta.innerHTML = `${stateNames.length} states · ${allEntries.length} signals`;

  if (ui.panelRiskContext) {
    ui.panelRiskContext.style.display = "none";
  }

  renderTopSignals(topSignals);
  renderEntries(allEntries);
  showPanel();
}

function refreshCurrentPanel() {
  if (!currentContext) return;
  if (currentContext.type === "state") renderStatePanel(currentContext.value);
  if (currentContext.type === "iso") renderIsoPanel(currentContext.value);
}

function safeSetFeatureState(source, id, state) {
  if (!map || id === undefined || id === null) return;
  if (!map.getSource(source)) return;
  map.setFeatureState({ source, id }, state);
}

function setLayerVisibility() {
  const showStates = currentViewMode === "state";
  const showIso = currentViewMode === "iso";
  if (map.getLayer("states-fill")) map.setLayoutProperty("states-fill", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-outline")) map.setLayoutProperty("states-outline", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-selected")) map.setLayoutProperty("states-selected", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("iso-fill")) map.setLayoutProperty("iso-fill", "visibility", showIso ? "visible" : "none");
  if (map.getLayer("iso-line")) map.setLayoutProperty("iso-line", "visibility", showIso ? "visible" : "none");
}

function renderLastUpdated() {
  if (!ui.legendLastUpdated) return;
  const dates = [...stateIndex.values()]
    .map(s => s.lastUpdated)
    .filter(Boolean)
    .map(d => new Date(d))
    .filter(d => !isNaN(d));
  if (!dates.length) return;
  const latest = new Date(Math.max(...dates));
  const formatted = latest.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  ui.legendLastUpdated.textContent = `Last updated: ${formatted}`;
}

function bindUI() {
  ui.panelClose.addEventListener("click", hidePanel);

  if (ui.onboardingClose) {
    ui.onboardingClose.addEventListener("click", () => {
      ui.onboardingBanner.style.display = "none";
    });
  }

  ui.viewStateBtn.addEventListener("click", () => {
    currentViewMode = "state";
    ui.viewStateBtn.classList.add("toggle__btn--active");
    ui.viewIsoBtn.classList.remove("toggle__btn--active");
    setLayerVisibility();
    hideHoverTooltip();
  });

  ui.viewIsoBtn.addEventListener("click", () => {
    currentViewMode = "iso";
    ui.viewIsoBtn.classList.add("toggle__btn--active");
    ui.viewStateBtn.classList.remove("toggle__btn--active");
    setLayerVisibility();
    hideHoverTooltip();
  });

  [
    ui.filterIso,
    ui.filterCategory,
    ui.filterImpact,
    ui.filterType,
    ui.filterDirection,
    ui.filterSignalCategory
  ].forEach(el => {
    el?.addEventListener("change", refreshCurrentPanel);
  });

  ui.stateSearch?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const query = ui.stateSearch.value.trim().toLowerCase();
    if (!query) return;
    if (currentViewMode === "state") {
      const match = [...stateIndex.keys()].find(name => name.toLowerCase().includes(query));
      if (match) renderStatePanel(match);
    } else {
      const match = [...isoToStates.keys()].find(name => name.toLowerCase().includes(query));
      if (match) renderIsoPanel(match);
    }
  });

  ui.clearFiltersBtn?.addEventListener("click", () => {
    ui.stateSearch.value = "";
    ui.filterIso.value = "";
    ui.filterCategory.value = "";
    ui.filterImpact.value = "";
    ui.filterType.value = "";
    ui.filterDirection.value = "";
    ui.filterSignalCategory.value = "";
    hideHoverTooltip();
    refreshCurrentPanel();
  });
}

function initMap() {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-97.5, 39.5],
    zoom: 3.4
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {
    map.addSource("states", {
      type: "geojson",
      data: statesGeo,
      generateId: true
    });

    map.addSource("iso", {
      type: "geojson",
      data: isoGeo,
      generateId: true
    });

    map.addLayer({
      id: "states-fill",
      type: "fill",
      source: "states",
      paint: {
        "fill-color": [
          "match",
          ["get", "calculatedRiskLevel"],
          "Low Risk", "#A8D5BA",
          "Emerging Risk", "#F3E6AE",
          "Moderate Risk", "#F7C6C7",
          "High Risk", "#E57373",
          "#E5E7EB"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.9,
          0.72
        ]
      }
    });

    map.addLayer({
      id: "states-outline",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#6B7280",
        "line-width": 1
      }
    });

    map.addLayer({
      id: "states-selected",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#1A56DB",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 2.5,
          0
        ]
      }
    });

    map.addLayer({
      id: "iso-fill",
      type: "fill",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "match",
          ["get", "iso"],
          "PJM", "#7FB3D5",
          "MISO", "#A3BE8C",
          "SPP", "#EBCB8B",
          "ERCOT", "#D08770",
          "CAISO", "#88C0D0",
          "NYISO", "#B48EAD",
          "ISO-NE", "#81A1C1",
          "WECC", "#D8DEE9",
          "#D1D5DB"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.30,
          0.16
        ]
      }
    });

    map.addLayer({
      id: "iso-line",
      type: "line",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "line-color": "#475569",
        "line-width": 1.8
      }
    });

    map.on("mousemove", "states-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";

      if (hoveredStateId !== null && hoveredStateId !== feature.id) {
        safeSetFeatureState("states", hoveredStateId, { hover: false });
      }
      hoveredStateId = feature.id;
      safeSetFeatureState("states", hoveredStateId, { hover: true });

      const stateName = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
      const state = stateIndex.get(stateName);

      showHoverTooltip(
        e.point.x,
        e.point.y,
        `<strong>${stateName}</strong><br>
         Risk: ${state?.calculatedRiskLevel || "No Data"}<br>
         Score: ${state?.riskScoreTotal ?? 0}<br>
         Signals: ${state?.entryCount ?? 0}<br>
         ISO/RTO: ${(state?.gridRegions || []).join(", ") || "—"}`
      );
    });

    map.on("mouseleave", "states-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredStateId !== null) safeSetFeatureState("states", hoveredStateId, { hover: false });
      hoveredStateId = null;
      hideHoverTooltip();
    });

    map.on("click", "states-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const stateName = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
      renderStatePanel(stateName);
    });

    map.on("mousemove", "iso-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      map.getCanvas().style.cursor = "pointer";

      if (hoveredIsoId !== null && hoveredIsoId !== feature.id) {
        safeSetFeatureState("iso", hoveredIsoId, { hover: false });
      }
      hoveredIsoId = feature.id;
      safeSetFeatureState("iso", hoveredIsoId, { hover: true });

      const isoName = String(feature.properties?.iso || "").trim();
      const stateNames = isoToStates.get(isoName) || [];
      const filters = getFilters();
      const entryCount = stateNames
        .flatMap(state => entriesByState.get(state) || [])
        .filter(entry => entryMatchesFilters(entry, filters))
        .length;

      showHoverTooltip(
        e.point.x,
        e.point.y,
        `<strong>${isoName}</strong><br>States: ${stateNames.length}<br>Signals: ${entryCount}`
      );
    });

    map.on("mouseleave", "iso-fill", () => {
      map.getCanvas().style.cursor = "";
      if (hoveredIsoId !== null) safeSetFeatureState("iso", hoveredIsoId, { hover: false });
      hoveredIsoId = null;
      hideHoverTooltip();
    });

    map.on("click", "iso-fill", (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const isoName = String(feature.properties?.iso || "").trim();
      if (!isoName) return;
      renderIsoPanel(isoName);
    });

    setLayerVisibility();
  });
}

function renderTopRiskStates() {
  if (!ui.topRiskList) return;
  ui.topRiskList.innerHTML = "";

  const ranked = [...stateIndex.values()]
    .filter(state => Number.isFinite(state.riskScoreTotal))
    .sort((a, b) => a.riskScoreTotal - b.riskScoreTotal)
    .slice(0, 5);

  ranked.forEach(state => {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = `${state.state} (${state.riskScoreTotal})`;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      renderStatePanel(state.state);
    });
    li.appendChild(link);
    ui.topRiskList.appendChild(li);
  });
}

async function main() {
  try {
    const [rawStatesGeo, rawIsoGeo, rawStatesApi, rawEntriesApi] = await Promise.all([
      fetchJson("/data/us-states.geojson"),
      fetchJson("/data/iso-rto.geojson"),
      fetchJson("/api/states"),
      fetchJson("/api/entries")
    ]);

    statesGeo = rawStatesGeo;
    isoGeo = rawIsoGeo;
    statesData = rawStatesApi.states || rawStatesApi;
    entriesData = rawEntriesApi.entries || rawEntriesApi;

    buildIndexes();
    attachStateRiskToGeoJSON();
    fillFilters();
    bindUI();
    renderTopRiskStates();
    renderLastUpdated();
    initMap();

  } catch (err) {
    console.error(err);
    alert(`Map failed to load: ${err.message}`);
  }
}

main();

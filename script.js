const MAPBOX_TOKEN = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg ";

const DATA_URLS = {
  statesGeo: "./data/us-states.geojson",
  isoGeo: "./data/iso-rto.geojson",
  statesApi: "./api/states",
  entriesApi: "./api/entries",
};

const RISK_CONTEXT = {
  "High Risk": "This state faces compounding constraints across grid capacity, regulatory environment, and community opposition that make new data center siting costly, slow, or politically uncertain. Score <= -71.",
  "Moderate Risk": "This state has meaningful infrastructure or regulatory headwinds. Growth is possible but requires careful diligence on grid timelines, tariff exposure, and policy trajectory. Score -21 to -70.",
  "Emerging Risk": "This state shows early warning signals. Current conditions are workable, but the risk profile is shifting as AI compute demand grows. Monitor grid, water, and legislative trends. Score -20 to +4.",
  "Low Risk": "This state presents relatively favorable conditions for AI infrastructure siting, with supportive grid capacity, policy environment, and limited near-term constraint signals. Score >= +5.",
  "No Data": ""
};

const ui = {
  appStatus: document.getElementById("appStatus"),
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
  filterDirection: document.getElementById("filterDirection"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  methodologyBtn: document.getElementById("methodologyBtn"),
  methodologyPanel: document.getElementById("methodologyPanel"),
  methodologyClose: document.getElementById("methodologyClose"),
  viewStateBtn: document.getElementById("viewStateBtn"),
  viewIsoBtn: document.getElementById("viewIsoBtn"),
  viewNationalBtn: document.getElementById("viewNationalBtn"),
};

let map = null;
let statesGeo = { type: "FeatureCollection", features: [] };
let isoGeo = { type: "FeatureCollection", features: [] };

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

/* ── Utility helpers ──────────────────────────────────── */

function showStatus(message, isError = false) {
  if (!ui.appStatus) return;
  ui.appStatus.textContent = message;
  ui.appStatus.style.display = "block";
  ui.appStatus.style.background = isError ? "#fff7ed" : "#eff6ff";
  ui.appStatus.style.borderColor = isError ? "#fdba74" : "#93c5fd";
  ui.appStatus.style.color = isError ? "#9a3412" : "#1d4ed8";
}

function clearStatus() {
  if (!ui.appStatus) return;
  ui.appStatus.style.display = "none";
  ui.appStatus.textContent = "";
}

async function fetchJson(url, { optional = false, fallback = null } = {}) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json") && !contentType.includes("geo+json")) {
      const text = await res.text();
      return JSON.parse(text);
    }

    return await res.json();
  } catch (err) {
    if (optional) {
      console.warn(`Optional fetch failed for ${url}:`, err);
      return fallback;
    }
    throw new Error(`Failed to load ${url}: ${err.message}`);
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
    .map((v) => v.trim())
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

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function getTooltipYOffset() {
  const banner = document.getElementById("onboardingBanner");
  const bannerH = (banner && banner.offsetParent !== null) ? banner.offsetHeight : 0;
  return 72 + bannerH + 16;
}

function adjustMapTop() {
  const banner = document.getElementById("onboardingBanner");
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  const bannerH = (banner && banner.offsetParent !== null) ? banner.offsetHeight : 0;
  mapEl.style.top = `${72 + bannerH}px`;
  if (map) map.resize();
}

function showHoverTooltip(x, y, html) {
  if (!ui.hoverTooltip) return;
  ui.hoverTooltip.innerHTML = html;
  ui.hoverTooltip.style.left = `${x + 16}px`;
  ui.hoverTooltip.style.top = `${y + getTooltipYOffset()}px`;
  ui.hoverTooltip.style.display = "block";
  ui.hoverTooltip.classList.remove("hover-tooltip--hidden");
}

function hideHoverTooltip() {
  if (!ui.hoverTooltip) return;
  ui.hoverTooltip.style.display = "none";
  ui.hoverTooltip.classList.add("hover-tooltip--hidden");
}

/* ── Data indexing ────────────────────────────────────── */

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
      calculatedRiskLevel: s.calculatedRiskLevel || s["Calculated Risk Level"] || "No Data",
      riskScoreTotal: Number(s.riskScoreTotal ?? s["Risk Score Total"] ?? 0),
      entryCount: Number(s.entryCount ?? s["Entry Count"] ?? 0),
      topRiskSignals: parseTopSignals(s.topRiskSignals ?? s["Top Risk Signals"]),
      gridRegions,
      summary: s.summary || s.Summary || "",
      lastUpdated: s.lastUpdated || s["Last Updated"] || "",
    };

    stateIndex.set(name, rec);

    gridRegions.forEach((iso) => {
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
      signalDirection: e.signalDirection || e["Signal Direction (linked)"] || e["Signal Direction"] || "",
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
  if (!statesGeo?.features?.length) return;

  statesGeo.features.forEach((feature) => {
    const name = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
    const state = stateIndex.get(name);

    feature.properties = feature.properties || {};
    feature.properties.calculatedRiskLevel = state?.calculatedRiskLevel || "No Data";
    feature.properties.riskScoreTotal = state?.riskScoreTotal ?? 0;
    feature.properties.entryCount = state?.entryCount ?? 0;
  });
}

function attachIsoRiskToGeoJSON() {
  if (!isoGeo?.features?.length) return;

  isoGeo.features.forEach((feature) => {
    const isoName = (feature.properties?.iso || "").trim();
    const stateNames = isoToStates.get(isoName) || [];

    if (!stateNames.length) {
      feature.properties.calculatedRiskLevel = "No Data";
      feature.properties.avgRiskScore = 0;
      return;
    }

    const scores = stateNames
      .map((name) => stateIndex.get(name)?.riskScoreTotal)
      .filter((s) => Number.isFinite(s));

    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    let riskLevel;
    if (avg <= -71) riskLevel = "High Risk";
    else if (avg <= -21) riskLevel = "Moderate Risk";
    else if (avg <= 4) riskLevel = "Emerging Risk";
    else riskLevel = "Low Risk";

    feature.properties.calculatedRiskLevel = riskLevel;
    feature.properties.avgRiskScore = Math.round(avg);
  });
}

function getIsoCentroids() {
  return {
    type: "FeatureCollection",
    features: isoGeo.features.map((f) => {
      const coords =
        f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates.flat(2)
          : f.geometry.coordinates.flat(1);
      let sumLng = 0,
        sumLat = 0,
        count = 0;
      coords.forEach(([lng, lat]) => {
        sumLng += lng;
        sumLat += lat;
        count++;
      });
      return {
        type: "Feature",
        properties: {
          iso: f.properties.iso,
          avgRiskScore: f.properties.avgRiskScore || 0,
        },
        geometry: {
          type: "Point",
          coordinates: [sumLng / count, sumLat / count],
        },
      };
    }),
  };
}

/* ── Filter helpers ───────────────────────────────────── */

function fillFilters() {
  const allEntries = [...entriesByState.values()].flat();

  if (ui.filterIso) {
    ui.filterIso.innerHTML = '<option value="">All Grid Regions</option>';
    const isoList = uniqueSorted([...isoToStates.keys()]);

    isoList.forEach((iso) => {
      const stateCount = (isoToStates.get(iso) || []).length;
      const opt = document.createElement("option");
      opt.value = iso;
      opt.textContent = `${iso} (${stateCount} states)`;
      ui.filterIso.appendChild(opt);
    });
  }

  fillSelect(ui.filterCategory, uniqueSorted(allEntries.map((e) => e.category)), "All Categories");
  fillSelect(ui.filterImpact, uniqueSorted(allEntries.map((e) => e.impactLevel)), "All Impact");
  fillSelect(ui.filterDirection, uniqueSorted(allEntries.map((e) => e.signalDirection)), "All Directions");
}

function getFilters() {
  return {
    search: String(ui.stateSearch?.value || "").trim().toLowerCase(),
    iso: String(ui.filterIso?.value || "").trim(),
    category: String(ui.filterCategory?.value || "").trim(),
    impact: String(ui.filterImpact?.value || "").trim(),
    direction: String(ui.filterDirection?.value || "").trim(),
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
  if (filters.direction && entry.signalDirection !== filters.direction) return false;

  return true;
}

/* ── Panel rendering ──────────────────────────────────── */

function renderTopSignals(items) {
  if (!ui.panelTopSignals) return;
  ui.panelTopSignals.innerHTML = "";

  if (!items.length) {
    ui.panelTopSignals.innerHTML = "<li>No top signals available.</li>";
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ui.panelTopSignals.appendChild(li);
  });
}

function renderEntries(entries) {
  if (!ui.panelEntries || !ui.panelEntriesHint) return;

  ui.panelEntries.innerHTML = "";

  if (!entries.length) {
    ui.panelEntriesHint.textContent = "No matching resources.";
    ui.panelEntries.innerHTML = "<li>No matching entries for the current filters.</li>";
    return;
  }

  ui.panelEntriesHint.textContent = `${entries.length} matching resource${entries.length === 1 ? "" : "s"}`;

  entries.forEach((entry) => {
    const li = document.createElement("li");
    const year = entry.publishedDate ? new Date(entry.publishedDate).getFullYear() : "";
    const meta = [entry.category, entry.impactLevel, year || "", entry.sourceDomain || ""]
      .filter(Boolean)
      .join(" · ");

    li.innerHTML = `
      <div class="entry__title">
        <a href="${entry.link || "#"}" target="_blank" rel="noopener noreferrer">${entry.title || "Untitled resource"}</a>
      </div>
      <div class="entry__meta">${meta}</div>
      <div class="entry__summary">${entry.summary || ""}</div>
    `;

    ui.panelEntries.appendChild(li);
  });
}

function showPanel() {
  if (ui.panel) ui.panel.classList.remove("panel--hidden");

  /* Auto-hide the mini-panel so it doesn't overlap */
  const miniPanel = document.getElementById("topRiskPanel");
  if (miniPanel) miniPanel.classList.add("mini-panel--hidden");
}

function hidePanel() {
  if (ui.panel) ui.panel.classList.add("panel--hidden");

  /* Restore mini-panel */
  const miniPanel = document.getElementById("topRiskPanel");
  if (miniPanel) miniPanel.classList.remove("mini-panel--hidden");

  if (map && selectedStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
  }

  selectedStateId = null;
}

function getRiskBadgeClass(riskLevel) {
  const classes = {
    "High Risk": "risk-badge--high",
    "Moderate Risk": "risk-badge--moderate",
    "Emerging Risk": "risk-badge--emerging",
    "Low Risk": "risk-badge--low",
  };
  return classes[riskLevel] || "";
}

function renderStatePanel(stateName) {
  if (stateName === "National") {
    renderNationalPanel();
    return;
  }

  const state = stateIndex.get(stateName);
  if (!state) return;

  /* Restore Top Risk Signals section if hidden by National view */
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";

  currentContext = { type: "state", value: stateName };

  if (ui.panelTitle) ui.panelTitle.textContent = stateName;

  const riskBadge = state.calculatedRiskLevel
    ? `<span class="risk-badge ${getRiskBadgeClass(state.calculatedRiskLevel)}">${state.calculatedRiskLevel}</span>`
    : "";

  if (ui.panelMeta) {
    ui.panelMeta.innerHTML = [
      riskBadge,
      Number.isFinite(state.riskScoreTotal) ? `Risk score: ${state.riskScoreTotal}` : "",
      Number.isFinite(state.entryCount) ? `${state.entryCount} signals` : "",
      (state.gridRegions || []).length ? `ISO/RTO: ${state.gridRegions.join(", ")}` : ""
    ].filter(Boolean).join(" · ");
  }

  if (ui.panelRiskContext) {
    const context = RISK_CONTEXT[state.calculatedRiskLevel] || "";
    ui.panelRiskContext.textContent = context;
    ui.panelRiskContext.style.display = context ? "block" : "none";
  }

  renderTopSignals(state.topRiskSignals || []);

  const filters = getFilters();
  const entries = (entriesByState.get(stateName) || []).filter((e) => entryMatchesFilters(e, filters));
  renderEntries(entries);
  showPanel();

  if (map && map.getSource("states")) {
    if (selectedStateId !== null) {
      map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
    }

    const feature = statesGeo.features.find(
      (f) => normalizeStateName(f.properties?.NAME || f.properties?.name || "") === stateName
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
    .flatMap((state) => entriesByState.get(state) || [])
    .filter((e) => entryMatchesFilters(e, filters));

  const topSignals = stateNames
    .flatMap((state) => stateIndex.get(state)?.topRiskSignals || [])
    .slice(0, 8);

  /* Aggregate risk for the ISO region */
  const stateScores = stateNames
    .map((name) => stateIndex.get(name)?.riskScoreTotal)
    .filter((s) => Number.isFinite(s));
  const avgScore = stateScores.length
    ? Math.round(stateScores.reduce((a, b) => a + b, 0) / stateScores.length)
    : 0;

  let isoRiskLevel;
  if (avgScore <= -71) isoRiskLevel = "High Risk";
  else if (avgScore <= -21) isoRiskLevel = "Moderate Risk";
  else if (avgScore <= 4) isoRiskLevel = "Emerging Risk";
  else isoRiskLevel = "Low Risk";

  if (ui.panelTitle) ui.panelTitle.textContent = isoName;

  const riskBadge = `<span class="risk-badge ${getRiskBadgeClass(isoRiskLevel)}">${isoRiskLevel}</span>`;
  if (ui.panelMeta) {
    ui.panelMeta.innerHTML = `${riskBadge} Avg score: ${avgScore} · ${stateNames.length} states · ${allEntries.length} signals`;
  }

  if (ui.panelRiskContext) {
    const context = RISK_CONTEXT[isoRiskLevel] || "";
    ui.panelRiskContext.textContent = context
      ? `Regional average across ${stateNames.length} states. ${context}`
      : "";
    ui.panelRiskContext.style.display = context ? "block" : "none";
  }

  /* Restore Top Risk Signals section if hidden by National view */
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";

  renderTopSignals(topSignals);
  renderEntries(allEntries);
  showPanel();
}

function renderNationalPanel() {
  currentContext = { type: "national", value: "National" };

  const filters = getFilters();
  const entries = (entriesByState.get("National") || []).filter((e) => entryMatchesFilters(e, filters));

  if (ui.panelTitle) ui.panelTitle.textContent = "National Media Coverage";

  if (ui.panelMeta) {
    ui.panelMeta.innerHTML = `<span class="risk-badge risk-badge--national">National</span> ${entries.length} article${entries.length === 1 ? "" : "s"} · via Data Center Watch`;
  }

  if (ui.panelRiskContext) {
    ui.panelRiskContext.textContent = "National-level media coverage tracking how data center expansion, AI infrastructure, and community opposition are being covered across major publications.";
    ui.panelRiskContext.style.display = "block";
  }

  renderTopSignals([]);
  if (ui.panelTopSignals?.parentElement) {
    ui.panelTopSignals.parentElement.style.display = "none";
  }

  renderEntries(entries);
  showPanel();

  /* Deselect any highlighted state on the map */
  if (map && selectedStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
  }
  selectedStateId = null;
}

function refreshCurrentPanel() {
  if (!currentContext) return;
  if (currentContext.type === "state") renderStatePanel(currentContext.value);
  if (currentContext.type === "iso") renderIsoPanel(currentContext.value);
  if (currentContext.type === "national") renderNationalPanel();
}

/* ── Map helpers ──────────────────────────────────────── */

function safeSetFeatureState(source, id, state) {
  if (!map || id === undefined || id === null) return;
  if (!map.getSource(source)) return;
  map.setFeatureState({ source, id }, state);
}

function setLayerVisibility() {
  if (!map) return;

  const showStates = currentViewMode === "state";
  const showIso = currentViewMode === "iso";

  if (map.getLayer("states-fill")) map.setLayoutProperty("states-fill", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-outline")) map.setLayoutProperty("states-outline", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-selected")) map.setLayoutProperty("states-selected", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("iso-fill")) map.setLayoutProperty("iso-fill", "visibility", showIso ? "visible" : "none");
  if (map.getLayer("iso-line")) map.setLayoutProperty("iso-line", "visibility", showIso ? "visible" : "none");
  if (map.getLayer("iso-labels")) map.setLayoutProperty("iso-labels", "visibility", showIso ? "visible" : "none");
}

function renderLastUpdated() {
  if (!ui.legendLastUpdated) return;

    /* Apply navy background, clean labels, and move labels above fills */
    applyMapStyle();

  const dates = [...stateIndex.values()]
    .map((s) => s.lastUpdated)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d));

  if (!dates.length) {
    ui.legendLastUpdated.textContent = "";
    return;
  }

  const latest = new Date(Math.max(...dates));
  ui.legendLastUpdated.textContent = `Last updated: ${latest.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/* ── UI bindings ──────────────────────────────────────── */

function bindUI() {
  ui.panelClose?.addEventListener("click", hidePanel);

  ui.onboardingClose?.addEventListener("click", () => {
    if (ui.onboardingBanner) ui.onboardingBanner.style.display = "none";
    adjustMapTop();
  });

  ui.viewStateBtn?.addEventListener("click", () => {
    currentViewMode = "state";
    ui.viewStateBtn?.classList.add("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    setLayerVisibility();
    hideHoverTooltip();
    hidePanel();
  });

  ui.viewIsoBtn?.addEventListener("click", () => {
    currentViewMode = "iso";
    ui.viewIsoBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    setLayerVisibility();
    hideHoverTooltip();
    hidePanel();
  });

  ui.viewNationalBtn?.addEventListener("click", () => {
    currentViewMode = "national";
    ui.viewNationalBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    setLayerVisibility();
    hideHoverTooltip();
    renderNationalPanel();
  });

  [ui.filterIso, ui.filterCategory, ui.filterImpact, ui.filterDirection].forEach((el) => {
    el?.addEventListener("change", refreshCurrentPanel);
  });

  ui.stateSearch?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const query = ui.stateSearch.value.trim().toLowerCase();
    if (!query) return;

    if (query === "national" || query === "media coverage") {
      ui.viewNationalBtn?.click();
      return;
    }

    if (currentViewMode === "state" || currentViewMode === "national") {
      const match = [...stateIndex.keys()].find((name) => name.toLowerCase().includes(query) && name !== "National");
      if (match) {
        renderStatePanel(match);
      } else {
        ui.stateSearch.classList.add("toolbar__input--no-match");
        setTimeout(() => ui.stateSearch.classList.remove("toolbar__input--no-match"), 1500);
      }
    } else {
      const match = [...isoToStates.keys()].find((name) => name.toLowerCase().includes(query));
      if (match) {
        renderIsoPanel(match);
      } else {
        ui.stateSearch.classList.add("toolbar__input--no-match");
        setTimeout(() => ui.stateSearch.classList.remove("toolbar__input--no-match"), 1500);
      }
    }
  });

  ui.clearFiltersBtn?.addEventListener("click", () => {
    if (ui.stateSearch) ui.stateSearch.value = "";
    if (ui.filterIso) ui.filterIso.value = "";
    if (ui.filterCategory) ui.filterCategory.value = "";
    if (ui.filterImpact) ui.filterImpact.value = "";
    if (ui.filterDirection) ui.filterDirection.value = "";

    hideHoverTooltip();
    refreshCurrentPanel();
  });

  ui.methodologyBtn?.addEventListener("click", () => {
    ui.methodologyPanel?.classList.toggle("methodology-panel--hidden");
  });

  ui.methodologyClose?.addEventListener("click", () => {
    ui.methodologyPanel?.classList.add("methodology-panel--hidden");
  });

  /* Mobile legend: tap to expand / collapse */
  const legend = document.getElementById("legend");
  if (legend) {
    legend.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        legend.classList.toggle("legend--expanded");
      }
    });
  }
}

/* ── Map initialisation ───────────────────────────────── */


/* Clean up Mapbox base style labels + background */

function applyMapStyle() {
  if (!map) return;

  var layers = map.getStyle().layers;

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];

    /* State labels: remove block caps, clean font */
    if (layer.id === "state-label") {
      map.setLayoutProperty("state-label", "text-transform", "none");
      map.setLayoutProperty("state-label", "text-font", ["DIN Pro Medium", "Arial Unicode MS Regular"]);
      map.setLayoutProperty("state-label", "text-size", 12);
      map.setLayoutProperty("state-label", "text-letter-spacing", 0.05);
      map.setPaintProperty("state-label", "text-color", "#FFFFFF");
      map.setPaintProperty("state-label", "text-halo-color", "rgba(0, 0, 0, 0.85)");
      map.setPaintProperty("state-label", "text-halo-width", 2);
    }

    /* City / settlement labels */
    if (layer.id === "settlement-major-label" || layer.id === "settlement-minor-label" || layer.id === "settlement-subdivision-label") {
      map.setLayoutProperty(layer.id, "text-font", ["DIN Pro Regular", "Arial Unicode MS Regular"]);
      map.setLayoutProperty(layer.id, "text-size", 10);
      map.setPaintProperty(layer.id, "text-color", "#E2E8F0");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(0, 0, 0, 0.8)");
      map.setPaintProperty(layer.id, "text-halo-width", 1.5);
    }

    /* Country labels */
    if (layer.id === "country-label") {
      map.setLayoutProperty(layer.id, "text-transform", "none");
      map.setLayoutProperty(layer.id, "text-font", ["DIN Pro Medium", "Arial Unicode MS Regular"]);
      map.setLayoutProperty(layer.id, "text-size", 12);
      map.setPaintProperty(layer.id, "text-color", "#94A3B8");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(10, 20, 50, 0.8)");
      map.setPaintProperty(layer.id, "text-halo-width", 1);
    }

    /* Continent / area labels */
    if (layer.id === "continent-label" || layer.id === "natural-point-label" || layer.id === "natural-line-label" || layer.id === "water-point-label" || layer.id === "water-line-label") {
      map.setLayoutProperty(layer.id, "text-font", ["DIN Pro Regular", "Arial Unicode MS Regular"]);
      map.setPaintProperty(layer.id, "text-color", "#475569");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(10, 20, 50, 0.7)");
      map.setPaintProperty(layer.id, "text-halo-width", 1);
    }

    /* Navy blue background: land */
    if (layer.id === "background") {
      map.setPaintProperty("background", "background-color", "#0F1E3D");
    }

    if (layer.type === "fill" && (layer.id === "land" || layer.id === "landcover" || layer.id === "landuse")) {
      map.setPaintProperty(layer.id, "fill-color", "#0F1E3D");
    }

    /* Navy blue background: water (darker) */
    if (layer.type === "fill" && (layer.id === "water" || layer.id.startsWith("water"))) {
      map.setPaintProperty(layer.id, "fill-color", "#091528");
    }

    /* State / admin borders: subtle */
    if (layer.id.includes("admin") && layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color", "rgba(148, 163, 184, 0.12)");
    }
  }

  /* Move label layers above choropleth fills */
  try {
    map.moveLayer("state-label");
    map.moveLayer("settlement-major-label");
    map.moveLayer("settlement-minor-label");
    map.moveLayer("settlement-subdivision-label");
    map.moveLayer("country-label");
  } catch(e) { /* layer may not exist */ }
}

function initMap() {
  if (!window.mapboxgl) {
    throw new Error("Mapbox GL JS did not load.");
  }

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("PASTE_YOUR_PUBLIC_MAPBOX_TOKEN_HERE")) {
    throw new Error("Mapbox token is still a placeholder. Add your public token at the top of script.js.");
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: [-97.5, 39.5],
    zoom: 3.4
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {

    /* applyMapStyle moved to after layers are added */

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

    /* ── State layers ───────────────────────────────── */

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
          "#1E293B"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.92,
          0.82
        ]
      }
    });

    map.addLayer({
      id: "states-outline",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#475569",
        "line-width": 1
      }
    });

    map.addLayer({
      id: "states-selected",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#60A5FA",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 2.5,
          0
        ]
      }
    });

    /* ── ISO / RTO layers ───────────────────────────── */

    map.addLayer({
      id: "iso-fill",
      type: "fill",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "match",
          ["get", "calculatedRiskLevel"],
          "Low Risk", "#A8D5BA",
          "Emerging Risk", "#F3E6AE",
          "Moderate Risk", "#F7C6C7",
          "High Risk", "#E57373",
          "#1E293B"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.45,
          0.30
        ]
      }
    });

    map.addLayer({
      id: "iso-line",
      type: "line",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "line-color": "#94A3B8",
        "line-width": 1.8
      }
    });

    /* ── ISO region labels ──────────────────────────── */

    map.addSource("iso-labels", {
      type: "geojson",
      data: getIsoCentroids()
    });

    map.addLayer({
      id: "iso-labels",
      type: "symbol",
      source: "iso-labels",
      layout: {
        visibility: "none",
        "text-field": ["concat", ["get", "iso"], "\n", ["to-string", ["get", "avgRiskScore"]]],
        "text-size": 13,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-allow-overlap": true
      },
      paint: {
        "text-color": "#E2E8F0",
        "text-halo-color": "rgba(10,20,50,0.8)",
        "text-halo-width": 1.5
      }
    });

    /* ── State hover + click ────────────────────────── */

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
         ISO/RTO: ${(state?.gridRegions || []).join(", ") || "\u2014"}`
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

    /* ── ISO hover + click ──────────────────────────── */

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
        .flatMap((state) => entriesByState.get(state) || [])
        .filter((entry) => entryMatchesFilters(entry, filters))
        .length;

      const riskLevel = feature.properties?.calculatedRiskLevel || "No Data";
      const avgScore = feature.properties?.avgRiskScore ?? 0;

      showHoverTooltip(
        e.point.x,
        e.point.y,
        `<strong>${isoName}</strong><br>
         Risk: ${riskLevel}<br>
         Avg Score: ${avgScore}<br>
         States: ${stateNames.length}<br>
         Signals: ${entryCount}`
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
    clearStatus();
  });
}

/* ── Sidebar widgets ──────────────────────────────────── */

function renderTopRiskStates() {
  if (!ui.topRiskList) return;
  ui.topRiskList.innerHTML = "";

  const ranked = [...stateIndex.values()]
    .filter((state) => Number.isFinite(state.riskScoreTotal) && state.state !== "National")
    .sort((a, b) => a.riskScoreTotal - b.riskScoreTotal)
    .slice(0, 5);

  ranked.forEach((state) => {
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

/* ── Bootstrap ────────────────────────────────────────── */

async function main() {
  try {
    showStatus("Loading map data...");

    const [statesGeoRes, isoGeoRes, statesApiRes, entriesApiRes] = await Promise.all([
      fetchJson(DATA_URLS.statesGeo),
      fetchJson(DATA_URLS.isoGeo),
      fetchJson(DATA_URLS.statesApi, { optional: true, fallback: [] }),
      fetchJson(DATA_URLS.entriesApi, { optional: true, fallback: [] }),
    ]);

    statesGeo = statesGeoRes?.type === "FeatureCollection"
      ? statesGeoRes
      : { type: "FeatureCollection", features: [] };

    isoGeo = isoGeoRes?.type === "FeatureCollection"
      ? isoGeoRes
      : { type: "FeatureCollection", features: [] };

    statesData = Array.isArray(statesApiRes) ? statesApiRes : (statesApiRes?.states || []);
    entriesData = Array.isArray(entriesApiRes) ? entriesApiRes : (entriesApiRes?.entries || []);

    buildIndexes();
    attachStateRiskToGeoJSON();
    attachIsoRiskToGeoJSON();
    fillFilters();
    bindUI();
    renderTopRiskStates();
    renderLastUpdated();

    if (!statesData.length || !entriesData.length) {
      showStatus("Map geometry loaded, but /api/states or /api/entries returned no usable data. Base map should still render.", true);
    }

    initMap();
    adjustMapTop();
  } catch (err) {
    console.error(err);
    showStatus(err.message, true);
  }
}

document.addEventListener("DOMContentLoaded", main);
const MAPBOX_TOKEN = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg ";

const DATA_URLS = {
  statesGeo: "./data/us-states.geojson",
  isoGeo: "./data/iso-rto.geojson",
  statesApi: "./api/states",
  entriesApi: "./api/entries",
};

const RISK_CONTEXT = {
  "High Risk": "This state faces compounding constraints across grid capacity, regulatory environment, and community opposition that make new data center siting costly, slow, or politically uncertain. Score <= -71.",
  "Moderate Risk": "This state has meaningful infrastructure or regulatory headwinds. Growth is possible but requires careful diligence on grid timelines, tariff exposure, and policy trajectory. Score -21 to -70.",
  "Emerging Risk": "This state shows early warning signals. Current conditions are workable, but the risk profile is shifting as AI compute demand grows. Monitor grid, water, and legislative trends. Score -20 to +4.",
  "Low Risk": "This state presents relatively favorable conditions for AI infrastructure siting, with supportive grid capacity, policy environment, and limited near-term constraint signals. Score >= +5.",
  "No Data": ""
};

const ui = {
  appStatus: document.getElementById("appStatus"),
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
  filterDirection: document.getElementById("filterDirection"),
  clearFiltersBtn: document.getElementById("clearFiltersBtn"),
  methodologyBtn: document.getElementById("methodologyBtn"),
  methodologyPanel: document.getElementById("methodologyPanel"),
  methodologyClose: document.getElementById("methodologyClose"),
  viewStateBtn: document.getElementById("viewStateBtn"),
  viewIsoBtn: document.getElementById("viewIsoBtn"),
  viewNationalBtn: document.getElementById("viewNationalBtn"),
};

let map = null;
let statesGeo = { type: "FeatureCollection", features: [] };
let isoGeo = { type: "FeatureCollection", features: [] };

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

/* ── Utility helpers ──────────────────────────────────── */

function showStatus(message, isError = false) {
  if (!ui.appStatus) return;
  ui.appStatus.textContent = message;
  ui.appStatus.style.display = "block";
  ui.appStatus.style.background = isError ? "#fff7ed" : "#eff6ff";
  ui.appStatus.style.borderColor = isError ? "#fdba74" : "#93c5fd";
  ui.appStatus.style.color = isError ? "#9a3412" : "#1d4ed8";
}

function clearStatus() {
  if (!ui.appStatus) return;
  ui.appStatus.style.display = "none";
  ui.appStatus.textContent = "";
}

async function fetchJson(url, { optional = false, fallback = null } = {}) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json") && !contentType.includes("geo+json")) {
      const text = await res.text();
      return JSON.parse(text);
    }

    return await res.json();
  } catch (err) {
    if (optional) {
      console.warn(`Optional fetch failed for ${url}:`, err);
      return fallback;
    }
    throw new Error(`Failed to load ${url}: ${err.message}`);
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
    .map((v) => v.trim())
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

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function getTooltipYOffset() {
  const banner = document.getElementById("onboardingBanner");
  const bannerH = (banner && banner.offsetParent !== null) ? banner.offsetHeight : 0;
  return 72 + bannerH + 16;
}

function adjustMapTop() {
  const banner = document.getElementById("onboardingBanner");
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  const bannerH = (banner && banner.offsetParent !== null) ? banner.offsetHeight : 0;
  mapEl.style.top = `${72 + bannerH}px`;
  if (map) map.resize();
}

function showHoverTooltip(x, y, html) {
  if (!ui.hoverTooltip) return;
  ui.hoverTooltip.innerHTML = html;
  ui.hoverTooltip.style.left = `${x + 16}px`;
  ui.hoverTooltip.style.top = `${y + getTooltipYOffset()}px`;
  ui.hoverTooltip.style.display = "block";
  ui.hoverTooltip.classList.remove("hover-tooltip--hidden");
}

function hideHoverTooltip() {
  if (!ui.hoverTooltip) return;
  ui.hoverTooltip.style.display = "none";
  ui.hoverTooltip.classList.add("hover-tooltip--hidden");
}

/* ── Data indexing ────────────────────────────────────── */

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
      calculatedRiskLevel: s.calculatedRiskLevel || s["Calculated Risk Level"] || "No Data",
      riskScoreTotal: Number(s.riskScoreTotal ?? s["Risk Score Total"] ?? 0),
      entryCount: Number(s.entryCount ?? s["Entry Count"] ?? 0),
      topRiskSignals: parseTopSignals(s.topRiskSignals ?? s["Top Risk Signals"]),
      gridRegions,
      summary: s.summary || s.Summary || "",
      lastUpdated: s.lastUpdated || s["Last Updated"] || "",
    };

    stateIndex.set(name, rec);

    gridRegions.forEach((iso) => {
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
      signalDirection: e.signalDirection || e["Signal Direction (linked)"] || e["Signal Direction"] || "",
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
  if (!statesGeo?.features?.length) return;

  statesGeo.features.forEach((feature) => {
    const name = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
    const state = stateIndex.get(name);

    feature.properties = feature.properties || {};
    feature.properties.calculatedRiskLevel = state?.calculatedRiskLevel || "No Data";
    feature.properties.riskScoreTotal = state?.riskScoreTotal ?? 0;
    feature.properties.entryCount = state?.entryCount ?? 0;
  });
}

function attachIsoRiskToGeoJSON() {
  if (!isoGeo?.features?.length) return;

  isoGeo.features.forEach((feature) => {
    const isoName = (feature.properties?.iso || "").trim();
    const stateNames = isoToStates.get(isoName) || [];

    if (!stateNames.length) {
      feature.properties.calculatedRiskLevel = "No Data";
      feature.properties.avgRiskScore = 0;
      return;
    }

    const scores = stateNames
      .map((name) => stateIndex.get(name)?.riskScoreTotal)
      .filter((s) => Number.isFinite(s));

    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    let riskLevel;
    if (avg <= -71) riskLevel = "High Risk";
    else if (avg <= -21) riskLevel = "Moderate Risk";
    else if (avg <= 4) riskLevel = "Emerging Risk";
    else riskLevel = "Low Risk";

    feature.properties.calculatedRiskLevel = riskLevel;
    feature.properties.avgRiskScore = Math.round(avg);
  });
}

function getIsoCentroids() {
  return {
    type: "FeatureCollection",
    features: isoGeo.features.map((f) => {
      const coords =
        f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates.flat(2)
          : f.geometry.coordinates.flat(1);
      let sumLng = 0,
        sumLat = 0,
        count = 0;
      coords.forEach(([lng, lat]) => {
        sumLng += lng;
        sumLat += lat;
        count++;
      });
      return {
        type: "Feature",
        properties: {
          iso: f.properties.iso,
          avgRiskScore: f.properties.avgRiskScore || 0,
        },
        geometry: {
          type: "Point",
          coordinates: [sumLng / count, sumLat / count],
        },
      };
    }),
  };
}

/* ── Filter helpers ───────────────────────────────────── */

function fillFilters() {
  const allEntries = [...entriesByState.values()].flat();

  if (ui.filterIso) {
    ui.filterIso.innerHTML = '<option value="">All Grid Regions</option>';
    const isoList = uniqueSorted([...isoToStates.keys()]);

    isoList.forEach((iso) => {
      const stateCount = (isoToStates.get(iso) || []).length;
      const opt = document.createElement("option");
      opt.value = iso;
      opt.textContent = `${iso} (${stateCount} states)`;
      ui.filterIso.appendChild(opt);
    });
  }

  fillSelect(ui.filterCategory, uniqueSorted(allEntries.map((e) => e.category)), "All Categories");
  fillSelect(ui.filterImpact, uniqueSorted(allEntries.map((e) => e.impactLevel)), "All Impact");
  fillSelect(ui.filterDirection, uniqueSorted(allEntries.map((e) => e.signalDirection)), "All Directions");
}

function getFilters() {
  return {
    search: String(ui.stateSearch?.value || "").trim().toLowerCase(),
    iso: String(ui.filterIso?.value || "").trim(),
    category: String(ui.filterCategory?.value || "").trim(),
    impact: String(ui.filterImpact?.value || "").trim(),
    direction: String(ui.filterDirection?.value || "").trim(),
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
  if (filters.direction && entry.signalDirection !== filters.direction) return false;

  return true;
}

/* ── Panel rendering ──────────────────────────────────── */

function renderTopSignals(items) {
  if (!ui.panelTopSignals) return;
  ui.panelTopSignals.innerHTML = "";

  if (!items.length) {
    ui.panelTopSignals.innerHTML = "<li>No top signals available.</li>";
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    ui.panelTopSignals.appendChild(li);
  });
}

function renderEntries(entries) {
  if (!ui.panelEntries || !ui.panelEntriesHint) return;

  ui.panelEntries.innerHTML = "";

  if (!entries.length) {
    ui.panelEntriesHint.textContent = "No matching resources.";
    ui.panelEntries.innerHTML = "<li>No matching entries for the current filters.</li>";
    return;
  }

  ui.panelEntriesHint.textContent = `${entries.length} matching resource${entries.length === 1 ? "" : "s"}`;

  entries.forEach((entry) => {
    const li = document.createElement("li");
    const year = entry.publishedDate ? new Date(entry.publishedDate).getFullYear() : "";
    const meta = [entry.category, entry.impactLevel, year || "", entry.sourceDomain || ""]
      .filter(Boolean)
      .join(" · ");

    li.innerHTML = `
      <div class="entry__title">
        <a href="${entry.link || "#"}" target="_blank" rel="noopener noreferrer">${entry.title || "Untitled resource"}</a>
      </div>
      <div class="entry__meta">${meta}</div>
      <div class="entry__summary">${entry.summary || ""}</div>
    `;

    ui.panelEntries.appendChild(li);
  });
}

function showPanel() {
  if (ui.panel) ui.panel.classList.remove("panel--hidden");

  /* Auto-hide the mini-panel so it doesn't overlap */
  const miniPanel = document.getElementById("topRiskPanel");
  if (miniPanel) miniPanel.classList.add("mini-panel--hidden");
}

function hidePanel() {
  if (ui.panel) ui.panel.classList.add("panel--hidden");

  /* Restore mini-panel */
  const miniPanel = document.getElementById("topRiskPanel");
  if (miniPanel) miniPanel.classList.remove("mini-panel--hidden");

  if (map && selectedStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
  }

  selectedStateId = null;
}

function getRiskBadgeClass(riskLevel) {
  const classes = {
    "High Risk": "risk-badge--high",
    "Moderate Risk": "risk-badge--moderate",
    "Emerging Risk": "risk-badge--emerging",
    "Low Risk": "risk-badge--low",
  };
  return classes[riskLevel] || "";
}

function renderStatePanel(stateName) {
  if (stateName === "National") {
    renderNationalPanel();
    return;
  }

  const state = stateIndex.get(stateName);
  if (!state) return;

  /* Restore Top Risk Signals section if hidden by National view */
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";

  currentContext = { type: "state", value: stateName };

  if (ui.panelTitle) ui.panelTitle.textContent = stateName;

  const riskBadge = state.calculatedRiskLevel
    ? `<span class="risk-badge ${getRiskBadgeClass(state.calculatedRiskLevel)}">${state.calculatedRiskLevel}</span>`
    : "";

  if (ui.panelMeta) {
    ui.panelMeta.innerHTML = [
      riskBadge,
      Number.isFinite(state.riskScoreTotal) ? `Risk score: ${state.riskScoreTotal}` : "",
      Number.isFinite(state.entryCount) ? `${state.entryCount} signals` : "",
      (state.gridRegions || []).length ? `ISO/RTO: ${state.gridRegions.join(", ")}` : ""
    ].filter(Boolean).join(" · ");
  }

  if (ui.panelRiskContext) {
    const context = RISK_CONTEXT[state.calculatedRiskLevel] || "";
    ui.panelRiskContext.textContent = context;
    ui.panelRiskContext.style.display = context ? "block" : "none";
  }

  renderTopSignals(state.topRiskSignals || []);

  const filters = getFilters();
  const entries = (entriesByState.get(stateName) || []).filter((e) => entryMatchesFilters(e, filters));
  renderEntries(entries);
  showPanel();

  if (map && map.getSource("states")) {
    if (selectedStateId !== null) {
      map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
    }

    const feature = statesGeo.features.find(
      (f) => normalizeStateName(f.properties?.NAME || f.properties?.name || "") === stateName
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
    .flatMap((state) => entriesByState.get(state) || [])
    .filter((e) => entryMatchesFilters(e, filters));

  const topSignals = stateNames
    .flatMap((state) => stateIndex.get(state)?.topRiskSignals || [])
    .slice(0, 8);

  /* Aggregate risk for the ISO region */
  const stateScores = stateNames
    .map((name) => stateIndex.get(name)?.riskScoreTotal)
    .filter((s) => Number.isFinite(s));
  const avgScore = stateScores.length
    ? Math.round(stateScores.reduce((a, b) => a + b, 0) / stateScores.length)
    : 0;

  let isoRiskLevel;
  if (avgScore <= -71) isoRiskLevel = "High Risk";
  else if (avgScore <= -21) isoRiskLevel = "Moderate Risk";
  else if (avgScore <= 4) isoRiskLevel = "Emerging Risk";
  else isoRiskLevel = "Low Risk";

  if (ui.panelTitle) ui.panelTitle.textContent = isoName;

  const riskBadge = `<span class="risk-badge ${getRiskBadgeClass(isoRiskLevel)}">${isoRiskLevel}</span>`;
  if (ui.panelMeta) {
    ui.panelMeta.innerHTML = `${riskBadge} Avg score: ${avgScore} · ${stateNames.length} states · ${allEntries.length} signals`;
  }

  if (ui.panelRiskContext) {
    const context = RISK_CONTEXT[isoRiskLevel] || "";
    ui.panelRiskContext.textContent = context
      ? `Regional average across ${stateNames.length} states. ${context}`
      : "";
    ui.panelRiskContext.style.display = context ? "block" : "none";
  }

  /* Restore Top Risk Signals section if hidden by National view */
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";

  renderTopSignals(topSignals);
  renderEntries(allEntries);
  showPanel();
}

function renderNationalPanel() {
  currentContext = { type: "national", value: "National" };

  const filters = getFilters();
  const entries = (entriesByState.get("National") || []).filter((e) => entryMatchesFilters(e, filters));

  if (ui.panelTitle) ui.panelTitle.textContent = "National Media Coverage";

  if (ui.panelMeta) {
    ui.panelMeta.innerHTML = `<span class="risk-badge risk-badge--national">National</span> ${entries.length} article${entries.length === 1 ? "" : "s"} · via Data Center Watch`;
  }

  if (ui.panelRiskContext) {
    ui.panelRiskContext.textContent = "National-level media coverage tracking how data center expansion, AI infrastructure, and community opposition are being covered across major publications.";
    ui.panelRiskContext.style.display = "block";
  }

  renderTopSignals([]);
  if (ui.panelTopSignals?.parentElement) {
    ui.panelTopSignals.parentElement.style.display = "none";
  }

  renderEntries(entries);
  showPanel();

  /* Deselect any highlighted state on the map */
  if (map && selectedStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
  }
  selectedStateId = null;
}

function refreshCurrentPanel() {
  if (!currentContext) return;
  if (currentContext.type === "state") renderStatePanel(currentContext.value);
  if (currentContext.type === "iso") renderIsoPanel(currentContext.value);
  if (currentContext.type === "national") renderNationalPanel();
}

/* ── Map helpers ──────────────────────────────────────── */

function safeSetFeatureState(source, id, state) {
  if (!map || id === undefined || id === null) return;
  if (!map.getSource(source)) return;
  map.setFeatureState({ source, id }, state);
}

function setLayerVisibility() {
  if (!map) return;

  const showStates = currentViewMode === "state";
  const showIso = currentViewMode === "iso";

  if (map.getLayer("states-fill")) map.setLayoutProperty("states-fill", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-outline")) map.setLayoutProperty("states-outline", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("states-selected")) map.setLayoutProperty("states-selected", "visibility", showStates ? "visible" : "none");
  if (map.getLayer("iso-fill")) map.setLayoutProperty("iso-fill", "visibility", showIso ? "visible" : "none");
  if (map.getLayer("iso-line")) map.setLayoutProperty("iso-line", "visibility", showIso ? "visible" : "none");
  if (map.getLayer("iso-labels")) map.setLayoutProperty("iso-labels", "visibility", showIso ? "visible" : "none");
}

function renderLastUpdated() {
  if (!ui.legendLastUpdated) return;

  const dates = [...stateIndex.values()]
    .map((s) => s.lastUpdated)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !isNaN(d));

  if (!dates.length) {
    ui.legendLastUpdated.textContent = "";
    return;
  }

  const latest = new Date(Math.max(...dates));
  ui.legendLastUpdated.textContent = `Last updated: ${latest.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/* ── UI bindings ──────────────────────────────────────── */

function bindUI() {
  ui.panelClose?.addEventListener("click", hidePanel);

  ui.onboardingClose?.addEventListener("click", () => {
    if (ui.onboardingBanner) ui.onboardingBanner.style.display = "none";
    adjustMapTop();
  });

  ui.viewStateBtn?.addEventListener("click", () => {
    currentViewMode = "state";
    ui.viewStateBtn?.classList.add("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    setLayerVisibility();
    hideHoverTooltip();
    hidePanel();
  });

  ui.viewIsoBtn?.addEventListener("click", () => {
    currentViewMode = "iso";
    ui.viewIsoBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    setLayerVisibility();
    hideHoverTooltip();
    hidePanel();
  });

  ui.viewNationalBtn?.addEventListener("click", () => {
    currentViewMode = "national";
    ui.viewNationalBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    setLayerVisibility();
    hideHoverTooltip();
    renderNationalPanel();
  });

  [ui.filterIso, ui.filterCategory, ui.filterImpact, ui.filterDirection].forEach((el) => {
    el?.addEventListener("change", refreshCurrentPanel);
  });

  ui.stateSearch?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const query = ui.stateSearch.value.trim().toLowerCase();
    if (!query) return;

    if (query === "national" || query === "media coverage") {
      ui.viewNationalBtn?.click();
      return;
    }

    if (currentViewMode === "state" || currentViewMode === "national") {
      const match = [...stateIndex.keys()].find((name) => name.toLowerCase().includes(query) && name !== "National");
      if (match) {
        renderStatePanel(match);
      } else {
        ui.stateSearch.classList.add("toolbar__input--no-match");
        setTimeout(() => ui.stateSearch.classList.remove("toolbar__input--no-match"), 1500);
      }
    } else {
      const match = [...isoToStates.keys()].find((name) => name.toLowerCase().includes(query));
      if (match) {
        renderIsoPanel(match);
      } else {
        ui.stateSearch.classList.add("toolbar__input--no-match");
        setTimeout(() => ui.stateSearch.classList.remove("toolbar__input--no-match"), 1500);
      }
    }
  });

  ui.clearFiltersBtn?.addEventListener("click", () => {
    if (ui.stateSearch) ui.stateSearch.value = "";
    if (ui.filterIso) ui.filterIso.value = "";
    if (ui.filterCategory) ui.filterCategory.value = "";
    if (ui.filterImpact) ui.filterImpact.value = "";
    if (ui.filterDirection) ui.filterDirection.value = "";

    hideHoverTooltip();
    refreshCurrentPanel();
  });

  ui.methodologyBtn?.addEventListener("click", () => {
    ui.methodologyPanel?.classList.toggle("methodology-panel--hidden");
  });

  ui.methodologyClose?.addEventListener("click", () => {
    ui.methodologyPanel?.classList.add("methodology-panel--hidden");
  });

  /* Mobile legend: tap to expand / collapse */
  const legend = document.getElementById("legend");
  if (legend) {
    legend.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        legend.classList.toggle("legend--expanded");
      }
    });
  }
}

/* ── Map initialisation ───────────────────────────────── */


/* Clean up Mapbox base style labels + background */

function applyMapStyle() {
  if (!map) return;

  var layers = map.getStyle().layers;

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];

    /* State labels: remove block caps, clean font */
    if (layer.id === "state-label") {
      map.setLayoutProperty("state-label", "text-transform", "none");
      map.setLayoutProperty("state-label", "text-font", ["DIN Pro Medium", "Arial Unicode MS Regular"]);
      map.setLayoutProperty("state-label", "text-size", 12);
      map.setLayoutProperty("state-label", "text-letter-spacing", 0.05);
      map.setPaintProperty("state-label", "text-color", "#FFFFFF");
      map.setPaintProperty("state-label", "text-halo-color", "rgba(0, 0, 0, 0.85)");
      map.setPaintProperty("state-label", "text-halo-width", 2);
    }

    /* City / settlement labels */
    if (layer.id === "settlement-major-label" || layer.id === "settlement-minor-label" || layer.id === "settlement-subdivision-label") {
      map.setLayoutProperty(layer.id, "text-font", ["DIN Pro Regular", "Arial Unicode MS Regular"]);
      map.setLayoutProperty(layer.id, "text-size", 10);
      map.setPaintProperty(layer.id, "text-color", "#E2E8F0");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(0, 0, 0, 0.8)");
      map.setPaintProperty(layer.id, "text-halo-width", 1.5);
    }

    /* Country labels */
    if (layer.id === "country-label") {
      map.setLayoutProperty(layer.id, "text-transform", "none");
      map.setLayoutProperty(layer.id, "text-font", ["DIN Pro Medium", "Arial Unicode MS Regular"]);
      map.setLayoutProperty(layer.id, "text-size", 12);
      map.setPaintProperty(layer.id, "text-color", "#94A3B8");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(10, 20, 50, 0.8)");
      map.setPaintProperty(layer.id, "text-halo-width", 1);
    }

    /* Continent / area labels */
    if (layer.id === "continent-label" || layer.id === "natural-point-label" || layer.id === "natural-line-label" || layer.id === "water-point-label" || layer.id === "water-line-label") {
      map.setLayoutProperty(layer.id, "text-font", ["DIN Pro Regular", "Arial Unicode MS Regular"]);
      map.setPaintProperty(layer.id, "text-color", "#475569");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(10, 20, 50, 0.7)");
      map.setPaintProperty(layer.id, "text-halo-width", 1);
    }

    /* Navy blue background: land */
    if (layer.id === "background") {
      map.setPaintProperty("background", "background-color", "#0F1E3D");
    }

    if (layer.type === "fill" && (layer.id === "land" || layer.id === "landcover" || layer.id === "landuse")) {
      map.setPaintProperty(layer.id, "fill-color", "#0F1E3D");
    }

    /* Navy blue background: water (darker) */
    if (layer.type === "fill" && (layer.id === "water" || layer.id.startsWith("water"))) {
      map.setPaintProperty(layer.id, "fill-color", "#091528");
    }

    /* State / admin borders: subtle */
    if (layer.id.includes("admin") && layer.type === "line") {
      map.setPaintProperty(layer.id, "line-color", "rgba(148, 163, 184, 0.12)");
    }
  }
}

function initMap() {
  if (!window.mapboxgl) {
    throw new Error("Mapbox GL JS did not load.");
  }

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("PASTE_YOUR_PUBLIC_MAPBOX_TOKEN_HERE")) {
    throw new Error("Mapbox token is still a placeholder. Add your public token at the top of script.js.");
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: [-97.5, 39.5],
    zoom: 3.4
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("load", () => {

    /* Apply navy background + clean label fonts */
    applyMapStyle();

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

    /* ── State layers ───────────────────────────────── */

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
          "#1E293B"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.92,
          0.82
        ]
      }
    });

    map.addLayer({
      id: "states-outline",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#475569",
        "line-width": 1
      }
    });

    map.addLayer({
      id: "states-selected",
      type: "line",
      source: "states",
      paint: {
        "line-color": "#60A5FA",
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 2.5,
          0
        ]
      }
    });

    /* ── ISO / RTO layers ───────────────────────────── */

    map.addLayer({
      id: "iso-fill",
      type: "fill",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "match",
          ["get", "calculatedRiskLevel"],
          "Low Risk", "#A8D5BA",
          "Emerging Risk", "#F3E6AE",
          "Moderate Risk", "#F7C6C7",
          "High Risk", "#E57373",
          "#1E293B"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false], 0.45,
          0.30
        ]
      }
    });

    map.addLayer({
      id: "iso-line",
      type: "line",
      source: "iso",
      layout: { visibility: "none" },
      paint: {
        "line-color": "#94A3B8",
        "line-width": 1.8
      }
    });

    /* ── ISO region labels ──────────────────────────── */

    map.addSource("iso-labels", {
      type: "geojson",
      data: getIsoCentroids()
    });

    map.addLayer({
      id: "iso-labels",
      type: "symbol",
      source: "iso-labels",
      layout: {
        visibility: "none",
        "text-field": ["concat", ["get", "iso"], "\n", ["to-string", ["get", "avgRiskScore"]]],
        "text-size": 13,
        "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
        "text-allow-overlap": true
      },
      paint: {
        "text-color": "#E2E8F0",
        "text-halo-color": "rgba(10,20,50,0.8)",
        "text-halo-width": 1.5
      }
    });

    /* ── State hover + click ────────────────────────── */

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
         ISO/RTO: ${(state?.gridRegions || []).join(", ") || "\u2014"}`
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

    /* ── ISO hover + click ──────────────────────────── */

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
        .flatMap((state) => entriesByState.get(state) || [])
        .filter((entry) => entryMatchesFilters(entry, filters))
        .length;

      const riskLevel = feature.properties?.calculatedRiskLevel || "No Data";
      const avgScore = feature.properties?.avgRiskScore ?? 0;

      showHoverTooltip(
        e.point.x,
        e.point.y,
        `<strong>${isoName}</strong><br>
         Risk: ${riskLevel}<br>
         Avg Score: ${avgScore}<br>
         States: ${stateNames.length}<br>
         Signals: ${entryCount}`
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
    clearStatus();
  });
}

/* ── Sidebar widgets ──────────────────────────────────── */

function renderTopRiskStates() {
  if (!ui.topRiskList) return;
  ui.topRiskList.innerHTML = "";

  const ranked = [...stateIndex.values()]
    .filter((state) => Number.isFinite(state.riskScoreTotal) && state.state !== "National")
    .sort((a, b) => a.riskScoreTotal - b.riskScoreTotal)
    .slice(0, 5);

  ranked.forEach((state) => {
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

/* ── Bootstrap ────────────────────────────────────────── */

async function main() {
  try {
    showStatus("Loading map data...");

    const [statesGeoRes, isoGeoRes, statesApiRes, entriesApiRes] = await Promise.all([
      fetchJson(DATA_URLS.statesGeo),
      fetchJson(DATA_URLS.isoGeo),
      fetchJson(DATA_URLS.statesApi, { optional: true, fallback: [] }),
      fetchJson(DATA_URLS.entriesApi, { optional: true, fallback: [] }),
    ]);

    statesGeo = statesGeoRes?.type === "FeatureCollection"
      ? statesGeoRes
      : { type: "FeatureCollection", features: [] };

    isoGeo = isoGeoRes?.type === "FeatureCollection"
      ? isoGeoRes
      : { type: "FeatureCollection", features: [] };

    statesData = Array.isArray(statesApiRes) ? statesApiRes : (statesApiRes?.states || []);
    entriesData = Array.isArray(entriesApiRes) ? entriesApiRes : (entriesApiRes?.entries || []);

    buildIndexes();
    attachStateRiskToGeoJSON();
    attachIsoRiskToGeoJSON();
    fillFilters();
    bindUI();
    renderTopRiskStates();
    renderLastUpdated();

    if (!statesData.length || !entriesData.length) {
      showStatus("Map geometry loaded, but /api/states or /api/entries returned no usable data. Base map should still render.", true);
    }

    initMap();
    adjustMapTop();
  } catch (err) {
    console.error(err);
    showStatus(err.message, true);
  }
}

document.addEventListener("DOMContentLoaded", main);

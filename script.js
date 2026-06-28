const MAPBOX_TOKEN = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg ";

const DIMENSION_MAP = {
  "Grid Capacity":            "grid",
  "ISO / RTO":                "grid",
  "Data Center Development":  "grid",
  "Legislation / Regulation": "policy",
  "Policy":                   "policy",
  "Federal Action":           "policy",
  "Moratorium":               "policy",
  "Zoning":                   "policy",
  "Affordability":            "economics",
  "Energy Costs":             "economics",
  "Incentive":                "economics",
  "Clean Energy":             "cleanenergy",
  "Clean Energy Procurement": "cleanenergy",
  "Community Opposition":     "community",
  "Water Use":                "community",
};

const DIMENSIONS = [
  { key: "grid",        label: "Grid & Infrastructure" },
  { key: "policy",      label: "Policy & Regulatory"   },
  { key: "economics",   label: "Economics"              },
  { key: "cleanenergy", label: "Clean Energy"           },
  { key: "community",   label: "Community & Water"      },
];

const USE_CASES = {
  mixed:    { label: "Mixed",     weights: { grid: 2.5, economics: 2.0, cleanenergy: 2.0, policy: 1.5, community: 1.0 } },
  training: { label: "Training",  weights: { cleanenergy: 3.0, grid: 2.0, economics: 2.0, policy: 1.5, community: 1.0 } },
  inference:{ label: "Inference", weights: { grid: 3.0, economics: 2.5, policy: 2.0, cleanenergy: 1.0, community: 1.0 } },
};

const VERDICTS = [
  { min:  0.45, label: "Proceed",                cls: "verdict--go"      },
  { min:  0.10, label: "Proceed with Diligence", cls: "verdict--caution" },
  { min: -0.25, label: "Monitor Closely",        cls: "verdict--watch"   },
  { min: -1.00, label: "Deep Diligence Required", cls: "verdict--hold"   },
];

const IMPACT_WEIGHT = { high: 2, medium: 1, low: 0.5 };

let currentUseCase = "mixed";

const DATA_URLS = {
  statesGeo: "./data/us-states.geojson",
  isoGeo: "./data/iso-rto.geojson",
  statesApi: "./api/states",
  entriesApi: "./api/entries",
  tariffsApi: "./api/tariffs",
};

const TARIFF_STATUS_COLORS = {
  "Enacted":                     "#4ade80",
  "Pending Commission Approval": "#fbbf24",
  "Proposed/Filed":              "#60a5fa",
  "Under Development":           "#a78bfa",
  "Withdrawn":                   "#f87171",
};

const RISK_FILL_EXPR = [
  "match", ["get", "calculatedRiskLevel"],
  "Low Risk",      "#A8D5BA",
  "Emerging Risk", "#F3E6AE",
  "Moderate Risk", "#F7C6C7",
  "High Risk",     "#E57373",
  "#1E293B"
];

const TARIFF_FILL_EXPR = [
  "match", ["get", "tariffStatus"],
  "Enacted",                     "#4ade80",
  "Pending Commission Approval", "#fbbf24",
  "Proposed/Filed",              "#60a5fa",
  "Under Development",           "#a78bfa",
  "Withdrawn",                   "#f87171",
  "#1e2d3d"
];

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
  viewTariffBtn:   document.getElementById("viewTariffBtn"),
};

let map = null;
let statesGeo = { type: "FeatureCollection", features: [] };
let isoGeo = { type: "FeatureCollection", features: [] };

let statesData = [];
let entriesData = [];

let stateIndex = new Map();
let entriesByState = new Map();
let isoToStates = new Map();
let tariffByState = new Map();

let currentViewMode = "state";
let currentContext = null;
let previousContext = null;
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
  // Filter out Airtable formula error objects like { error: "#ERROR!" }
  if (Array.isArray(value)) {
    return value.filter(v => Boolean(v) && typeof v === "string");
  }
  if (typeof value === "object") return []; // single error object
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

function buildTariffIndex(tariffsData) {
  tariffByState = new Map();
  for (const t of (tariffsData || [])) {
    const name = normalizeStateName(t.state || t.State || "");
    if (!name) continue;
    if (!tariffByState.has(name)) tariffByState.set(name, []);
    tariffByState.get(name).push(t);
  }
}

function attachStateRiskToGeoJSON() {
  if (!statesGeo?.features?.length) return;

  statesGeo.features.forEach((feature) => {
    const name = normalizeStateName(feature.properties?.NAME || feature.properties?.name || "");
    const state = stateIndex.get(name);
    const tariffs = tariffByState.get(name);

    feature.properties = feature.properties || {};
    feature.properties.calculatedRiskLevel = state?.calculatedRiskLevel || "No Data";
    feature.properties.riskScoreTotal = state?.riskScoreTotal ?? 0;
    feature.properties.entryCount = state?.entryCount ?? 0;
    feature.properties.tariffStatus = tariffs?.[0]?.status || "None";
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
    li.textContent = typeof item === "string" ? item : (item?.label || item?.signal || item?.text || JSON.stringify(item));
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
  previousContext = null;
  document.getElementById("compareBtn")?.style.setProperty("display", "none");
  document.getElementById("panelBackBtn")?.style.setProperty("display", "none");

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

function renderTariffPanel(stateName) {
  const tariffs = tariffByState.get(stateName) || [];

  currentContext = { type: "state", value: stateName };
  if (ui.panelTitle) ui.panelTitle.textContent = stateName;

  // Hide risk-specific sections
  if (ui.panelRiskContext) ui.panelRiskContext.style.display = "none";
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "none";
  const resourcesSection = document.getElementById("panelResourcesSection");
  if (resourcesSection) resourcesSection.style.display = "none";
  document.getElementById("compareBtn")?.style.setProperty("display", "none");
  document.getElementById("useCaseToggle")?.style.setProperty("display", "none");
  document.getElementById("advisoryBlock")?.style.setProperty("display", "none");

  // Status badge in meta
  if (ui.panelMeta) {
    if (tariffs.length) {
      const statusKey = (tariffs[0].status || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");
      ui.panelMeta.innerHTML = `<span class="tariff-badge tariff-badge--${statusKey}">${tariffs[0].status}</span>`;
    } else {
      ui.panelMeta.innerHTML = `<span class="panel__meta-no-data">No large load tariff on record</span>`;
    }
  }

  // Build tariff cards directly above the hidden resources section
  let tariffContainer = document.getElementById("tariffPanelContent");
  if (!tariffContainer) {
    tariffContainer = document.createElement("div");
    tariffContainer.id = "tariffPanelContent";
    resourcesSection?.parentElement?.insertBefore(tariffContainer, resourcesSection);
  }
  tariffContainer.style.display = "";

  if (!tariffs.length) {
    tariffContainer.innerHTML = `<div class="tariff-empty">No large load tariff data on record for ${stateName}.</div>`;
  } else {
    tariffContainer.innerHTML = tariffs.map((t, i) => {
      const statusKey = (t.status || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z-]/g, "");

      const detail = (label, value) => value
        ? `<div class="tariff-row"><span class="tariff-row__label">${label}</span><span class="tariff-row__value">${value}</span></div>`
        : "";

      return `
        <div class="tariff-card${i > 0 ? " tariff-card--divider" : ""}">
          <div class="tariff-card__header">
            <span class="tariff-badge tariff-badge--${statusKey}">${t.status || "Unknown"}</span>
          </div>
          <div class="tariff-card__details">
            ${detail("Program", t.tariffName)}
            ${detail("Utility", t.utility)}
            ${detail("MW Threshold", t.mwThreshold ? `≥${t.mwThreshold} MW` : "")}
            ${detail("Effective", t.effectiveDate)}
            ${detail("Cost Allocation", t.costAllocationMethod)}
          </div>
          ${t.keyProvisions ? `
          <div class="tariff-card__section">
            <div class="tariff-card__section-title">Key Provisions</div>
            <p class="tariff-card__text">${t.keyProvisions}</p>
          </div>` : ""}
          ${t.arcusAssessment ? `
          <div class="tariff-card__section tariff-card__section--assessment">
            <div class="tariff-card__section-title">Arcus Assessment</div>
            <p class="tariff-card__text">${t.arcusAssessment}</p>
          </div>` : ""}
          ${t.sourceUrl ? `
          <a class="tariff-card__source" href="${t.sourceUrl}" target="_blank" rel="noopener">
            View regulatory source ↗
          </a>` : ""}
          ${t.lastVerified ? `<div class="tariff-card__verified">Last verified: ${t.lastVerified}</div>` : ""}
        </div>`;
    }).join("");
  }

  showPanel();

  // Highlight the clicked state on the map
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

function hideSpecialPanels() {
  const tariffContainer = document.getElementById("tariffPanelContent");
  if (tariffContainer) tariffContainer.style.display = "none";
  const nationalDashboard = document.getElementById("nationalDashboard");
  if (nationalDashboard) nationalDashboard.style.display = "none";
  const resourcesSection = document.getElementById("panelResourcesSection");
  if (resourcesSection) resourcesSection.style.display = "";
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
  if (ui.panelRiskContext) ui.panelRiskContext.style.display = "";
}

function hideTariffPanel() { hideSpecialPanels(); }

/* ── Advisory block renderer ─────────────────────────── */

function renderAdvisoryBlock(state, useCase) {
  const el = document.getElementById("advisoryBlock");
  if (!el) return;

  const { verdict, scores, bullets } = generateAdvisoryVerdict(state, useCase);

  const barsHtml = DIMENSIONS.map(d => {
    const s = scores[d.key] ?? 0;
    const leftPct  = s >= 0 ? 50 : Math.round(50 + s * 50);
    const widthPct = Math.round(Math.abs(s) * 50);
    const color    = s > 0.12 ? "#10B981" : s < -0.12 ? "#EF4444" : "#94A3B8";
    return `<div class="dim-row">
      <span class="dim-label">${d.label}</span>
      <div class="dim-bar-wrap"><div class="dim-bar-center"></div><div class="dim-bar-fill" style="left:${leftPct}%;width:${Math.max(widthPct, 1)}%;background:${color}"></div></div>
      <span class="dim-score-val" style="color:${color}">${s >= 0 ? "+" : ""}${s.toFixed(2)}</span>
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="advisory-verdict ${verdict.cls}">
      <span class="advisory-verdict__label">${verdict.label}</span>
      <span class="advisory-verdict__context">· for ${USE_CASES[useCase].label} workloads</span>
    </div>
    <ul class="advisory-bullets">${bullets.map(b => `<li>${b}</li>`).join("")}</ul>
    <div class="dim-scores">${barsHtml}</div>`;
}

/* ── Advisory scoring helpers ────────────────────────── */

function computeDimensionScores(stateName) {
  const entries = entriesByState.get(stateName) || [];
  const raw   = { grid: 0, policy: 0, economics: 0, cleanenergy: 0, community: 0 };
  const total = { grid: 0, policy: 0, economics: 0, cleanenergy: 0, community: 0 };

  for (const e of entries) {
    const dim = DIMENSION_MAP[e.category];
    if (!dim) continue;
    const iw  = IMPACT_WEIGHT[String(e.impactLevel || "").toLowerCase()] ?? 1;
    const dir = String(e.signalDirection || "").toLowerCase();
    let val = 0;
    if (dir.includes("positive") || dir.includes("favorable") || dir.includes("opportunit")) val = 1;
    else if (dir.includes("negative") || dir.includes("adverse") || dir.includes("warning") || dir.includes("risk")) val = -1;
    raw[dim]   += val * iw;
    total[dim] += iw;
  }

  const scores = {};
  for (const dim of Object.keys(raw)) {
    scores[dim] = total[dim] > 0 ? Math.max(-1, Math.min(1, raw[dim] / total[dim])) : 0;
  }
  return scores;
}

function getTopSignalForDim(stateName, dim, dir) {
  const entries = entriesByState.get(stateName) || [];
  const cats = Object.entries(DIMENSION_MAP).filter(([, d]) => d === dim).map(([c]) => c);
  const relevant = entries.filter(e => {
    if (!cats.includes(e.category)) return false;
    const d = String(e.signalDirection || "").toLowerCase();
    return dir === "negative"
      ? d.includes("negative") || d.includes("adverse") || d.includes("warning") || d.includes("risk")
      : d.includes("positive") || d.includes("favorable") || d.includes("opportunit");
  });
  relevant.sort((a, b) => {
    const dd = new Date(b.publishedDate || 0) - new Date(a.publishedDate || 0);
    return dd !== 0 ? dd : (a.impactRank || 999) - (b.impactRank || 999);
  });
  return { count: relevant.length, top: relevant[0] || null };
}

function signalCitation(count, top, dir) {
  const yr  = top?.publishedDate ? new Date(top.publishedDate).getFullYear() : null;
  const ttl = top?.title
    ? (top.title.length > 70 ? top.title.slice(0, 67) + "…" : top.title)
    : null;
  const label = dir === "negative" ? "unfavorable" : "favorable";
  if (!ttl) return `${count} ${label} signal${count !== 1 ? "s" : ""} flagged.`;
  return `${count} ${label} signal${count !== 1 ? "s" : ""} — latest: "${ttl}"${yr ? ` (${yr})` : ""}.`;
}

function generateAdvisoryVerdict(state, useCase) {
  const scores  = computeDimensionScores(state.state);
  const weights = USE_CASES[useCase]?.weights || USE_CASES.mixed.weights;

  let weightedSum = 0, weightTotal = 0;
  for (const [dim, w] of Object.entries(weights)) {
    weightedSum  += (scores[dim] ?? 0) * w;
    weightTotal  += w;
  }
  const normalizedScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const verdict = VERDICTS.find(v => normalizedScore >= v.min) || VERDICTS[VERDICTS.length - 1];

  const dimsByWeightedScore = DIMENSIONS
    .map(d => ({ ...d, ws: (scores[d.key] ?? 0) * (weights[d.key] ?? 1), s: scores[d.key] ?? 0 }))
    .sort((a, b) => a.ws - b.ws);

  const bullets = [];
  for (const dim of dimsByWeightedScore) {
    if (bullets.length >= 2) break;
    if (dim.s >= -0.1) continue;
    const { count, top } = getTopSignalForDim(state.state, dim.key, "negative");
    const cite = signalCitation(count, top, "negative");
    if (dim.key === "grid")             bullets.push(useCase === "inference"
      ? `Grid reliability constrained — ${cite}`
      : `Interconnection queue bottleneck — ${cite}`);
    else if (dim.key === "cleanenergy") bullets.push(`Carbon intensity elevated — ${cite}`);
    else if (dim.key === "economics")   bullets.push(`Rate trajectory unfavorable — ${cite}`);
    else if (dim.key === "policy")      bullets.push(`Regulatory environment in flux — ${cite}`);
    else if (dim.key === "community")   bullets.push(`Community opposition flagged — ${cite}`);
  }

  if (bullets.length < 2 && normalizedScore > 0.3) {
    const best = [...dimsByWeightedScore].reverse()[0];
    const { count: pc, top: pt } = getTopSignalForDim(state.state, best.key, "positive");
    const cite = signalCitation(pc, pt, "favorable");
    if (best.key === "grid")             bullets.push(`Grid capacity favorable — ${cite}`);
    else if (best.key === "cleanenergy") bullets.push(`Clean energy access strong — ${cite}`);
    else if (best.key === "economics")   bullets.push(`Costs and incentives favorable — ${cite}`);
    else if (best.key === "policy")      bullets.push(`Policy environment supportive — ${cite}`);
    else if (best.key === "community")   bullets.push(`Community reception positive — ${cite}`);
  }

  if (!bullets.length) bullets.push("Conditions are mixed. Commission site-specific diligence before committing capital.");

  return { verdict, normalizedScore, scores, bullets };
}

/* ── Market comparison modal ─────────────────────────── */

function createCompareModal() {
  const modal = document.createElement("div");
  modal.id = "compareModal";
  modal.className = "compare-modal compare-modal--hidden";
  modal.innerHTML = `
    <div class="compare-modal__backdrop" id="compareBackdrop"></div>
    <div class="compare-modal__panel">
      <div class="compare-modal__header">
        <span class="compare-modal__title">Compare Markets</span>
        <div class="compare-uc-toggle" id="compareUcToggle">
          <button class="uc-btn uc-btn--active" data-uc="mixed">Mixed</button>
          <button class="uc-btn" data-uc="training">Training</button>
          <button class="uc-btn" data-uc="inference">Inference</button>
        </div>
        <button class="compare-modal__close" id="compareClose">×</button>
      </div>
      <div class="compare-selectors">
        <select class="compare-select" id="compareStateA"><option value="">Select a state…</option></select>
        <span class="compare-vs">vs.</span>
        <select class="compare-select" id="compareStateB"><option value="">Select a state…</option></select>
      </div>
      <div class="compare-body" id="compareBody"></div>
    </div>`;
  document.body.appendChild(modal);

  document.getElementById("compareBackdrop").addEventListener("click", closeCompareModal);
  document.getElementById("compareClose").addEventListener("click", closeCompareModal);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCompareModal(); });

  document.getElementById("compareUcToggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".uc-btn");
    if (!btn) return;
    document.querySelectorAll("#compareUcToggle .uc-btn").forEach(b => b.classList.toggle("uc-btn--active", b === btn));
    renderCompareModal();
  });

  document.getElementById("compareStateA").addEventListener("change", renderCompareModal);
  document.getElementById("compareStateB").addEventListener("change", renderCompareModal);
}

function closeCompareModal() {
  document.getElementById("compareModal")?.classList.add("compare-modal--hidden");
}

function openCompareModal(prefilledState) {
  if (!document.getElementById("compareModal")) createCompareModal();

  const stateNames = [...stateIndex.keys()].filter(s => s !== "National").sort();
  ["compareStateA", "compareStateB"].forEach(id => {
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select a state…</option>';
    stateNames.forEach(name => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
  });

  if (prefilledState) document.getElementById("compareStateA").value = prefilledState;
  document.getElementById("compareModal").classList.remove("compare-modal--hidden");
  renderCompareModal();
}

function renderCompareModal() {
  const body = document.getElementById("compareBody");
  if (!body) return;

  const stateA = document.getElementById("compareStateA")?.value;
  const stateB = document.getElementById("compareStateB")?.value;
  const uc = document.querySelector("#compareUcToggle .uc-btn--active")?.dataset?.uc || "mixed";

  if (!stateA || !stateB) {
    body.innerHTML = `<p class="compare-prompt">${!stateA && !stateB ? "Select two states above to compare." : `Select the ${!stateA ? "first" : "second"} state to continue.`}</p>`;
    return;
  }

  const sA = stateIndex.get(stateA);
  const sB = stateIndex.get(stateB);
  if (!sA || !sB) return;

  const vA = generateAdvisoryVerdict(sA, uc);
  const vB = generateAdvisoryVerdict(sB, uc);

  const winner = vA.normalizedScore > vB.normalizedScore ? stateA
    : vB.normalizedScore > vA.normalizedScore ? stateB : null;

  const winnerVerdict = winner === stateA ? vA : vB;
  const weights = USE_CASES[uc]?.weights || USE_CASES.mixed.weights;
  const bestDim = DIMENSIONS
    .map(d => ({ ...d, ws: (winnerVerdict.scores[d.key] ?? 0) * (weights[d.key] ?? 1) }))
    .sort((a, b) => b.ws - a.ws)[0];

  const recommendationHtml = winner
    ? `<div class="compare-recommendation"><span class="compare-rec__winner">${winner}</span> offers stronger conditions for <strong>${USE_CASES[uc].label}</strong> workloads — particularly on <strong>${bestDim.label}</strong>.</div>`
    : `<div class="compare-recommendation">Both markets show comparable conditions for <strong>${USE_CASES[uc].label}</strong> workloads. Run site-specific diligence on both before committing.</div>`;

  const colHtml = (stateName, verdict, sObj, isWinner) => {
    const riskBadge = sObj.calculatedRiskLevel
      ? `<span class="risk-badge ${getRiskBadgeClass(sObj.calculatedRiskLevel)}">${sObj.calculatedRiskLevel}</span>`
      : "";
    return `
      <div class="compare-col ${isWinner ? "compare-col--winner" : ""}">
        <div class="compare-col__name">${stateName}${isWinner ? ' <span class="compare-col__star">★</span>' : ""}</div>
        <div class="compare-col__meta">${riskBadge} Score: ${sObj.riskScoreTotal ?? 0}</div>
        <div class="advisory-verdict ${verdict.verdict.cls} compare-col__verdict">
          <span class="advisory-verdict__label">${verdict.verdict.label}</span>
        </div>
        <ul class="advisory-bullets compare-col__bullets">${verdict.bullets.map(b => `<li>${b}</li>`).join("")}</ul>
      </div>`;
  };

  const barHtml = (s, flip = false) => {
    const leftPct  = s >= 0 ? 50 : Math.round(50 + s * 50);
    const widthPct = Math.max(Math.round(Math.abs(s) * 50), 1);
    const color    = s > 0.12 ? "#10B981" : s < -0.12 ? "#EF4444" : "#94A3B8";
    const valStr   = `<span class="dim-score-val" style="color:${color};font-size:9px">${s >= 0 ? "+" : ""}${s.toFixed(2)}</span>`;
    const bar      = `<div class="dim-bar-wrap cmp-bar"><div class="dim-bar-center"></div><div class="dim-bar-fill" style="left:${leftPct}%;width:${widthPct}%;background:${color}"></div></div>`;
    return flip ? `${valStr}${bar}` : `${bar}${valStr}`;
  };

  const barsHtml = DIMENSIONS.map(d => {
    const sAScore = vA.scores[d.key] ?? 0;
    const sBScore = vB.scores[d.key] ?? 0;
    return `
      <div class="compare-dim-row">
        <div class="compare-dim-a">${barHtml(sAScore)}</div>
        <div class="compare-dim-label">${d.label}</div>
        <div class="compare-dim-b">${barHtml(sBScore, true)}</div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="compare-cols">
      ${colHtml(stateA, vA, sA, winner === stateA)}
      ${colHtml(stateB, vB, sB, winner === stateB)}
    </div>
    <div class="compare-dims">
      <div class="compare-dims__header">
        <span>${stateA}</span><span>Dimension</span><span>${stateB}</span>
      </div>
      ${barsHtml}
    </div>
    ${recommendationHtml}`;
}

function renderStatePanel(stateName) {
  if (stateName === "National") {
    renderNationalPanel();
    return;
  }

  const state = stateIndex.get(stateName);
  if (!state) return;

  // Track where we came from so the back button can return there
  if (currentContext && currentContext.type !== "state") {
    previousContext = { ...currentContext };
  }

  hideTariffPanel();

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

  // Show advisory block + use-case toggle
  const toggle = document.getElementById("useCaseToggle");
  const advisory = document.getElementById("advisoryBlock");
  if (toggle) toggle.style.display = "";
  if (advisory) { advisory.style.display = ""; renderAdvisoryBlock(state, currentUseCase); }

  showPanel();
  document.getElementById("compareBtn")?.style.setProperty("display", "");

  // Show back button if we came from somewhere
  const backBtn = document.getElementById("panelBackBtn");
  if (backBtn) backBtn.style.display = previousContext ? "" : "none";

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

  document.getElementById("useCaseToggle")?.style.setProperty("display", "none");
  document.getElementById("advisoryBlock")?.style.setProperty("display", "none");
  document.getElementById("nationalDashboard")?.style.setProperty("display", "none");
  const rSec = document.getElementById("panelResourcesSection");
  if (rSec) rSec.style.display = "";
  renderTopSignals(topSignals);
  renderEntries(allEntries);
  showPanel();
  document.getElementById("compareBtn")?.style.setProperty("display", "none");
}

function renderNationalPanel() {
  previousContext = null;
  document.getElementById("panelBackBtn")?.style.setProperty("display", "none");
  currentContext = { type: "national", value: "National" };

  if (ui.panelTitle) ui.panelTitle.textContent = "US Market Overview";
  if (ui.panelMeta) ui.panelMeta.innerHTML = `<span class="risk-badge risk-badge--national">National</span> 50 states · ${[...entriesByState.values()].flat().filter(e=>e.state!=="National").length} signals tracked`;
  if (ui.panelRiskContext) ui.panelRiskContext.style.display = "none";

  renderTopSignals([]);
  if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "none";
  document.getElementById("useCaseToggle")?.style.setProperty("display", "none");
  document.getElementById("advisoryBlock")?.style.setProperty("display", "none");
  document.getElementById("compareBtn")?.style.setProperty("display", "none");

  /* Hide resources section, inject national dashboard */
  const resourcesSection = document.getElementById("panelResourcesSection");
  if (resourcesSection) resourcesSection.style.display = "none";

  let container = document.getElementById("nationalDashboard");
  if (!container) {
    container = document.createElement("div");
    container.id = "nationalDashboard";
    resourcesSection?.parentElement?.insertBefore(container, resourcesSection);
  }
  container.style.display = "";

  /* Compute data */
  const allStates = [...stateIndex.values()].filter(s => s.state !== "National");
  const riskCounts = { "High Risk": 0, "Moderate Risk": 0, "Emerging Risk": 0, "Low Risk": 0 };
  for (const s of allStates) if (s.calculatedRiskLevel in riskCounts) riskCounts[s.calculatedRiskLevel]++;
  const total = allStates.length;

  const dimKeys = ["grid", "policy", "economics", "cleanenergy", "community"];
  const dimLabels = { grid: "Grid & Infrastructure", policy: "Policy & Regulatory", economics: "Economics", cleanenergy: "Clean Energy", community: "Community & Water" };
  const dimTotals = Object.fromEntries(dimKeys.map(k => [k, 0]));
  for (const s of allStates) {
    const sc = computeDimensionScores(s.state);
    for (const k of dimKeys) dimTotals[k] += sc[k];
  }
  const dimAvg = Object.fromEntries(dimKeys.map(k => [dimTotals[k] / total, k]).map((_, i) => [dimKeys[i], +(dimTotals[dimKeys[i]] / total).toFixed(2)]));

  const avgRisk = Math.round(allStates.reduce((a, s) => a + (s.riskScoreTotal || 0), 0) / total);
  let overallVerdict, overallCls;
  if (avgRisk >= 5) { overallVerdict = "Favorable Nationally"; overallCls = "verdict--go"; }
  else if (avgRisk >= -20) { overallVerdict = "Emerging Headwinds"; overallCls = "verdict--caution"; }
  else if (avgRisk >= -70) { overallVerdict = "Moderate Constraints"; overallCls = "verdict--watch"; }
  else { overallVerdict = "Significant Friction"; overallCls = "verdict--hold"; }

  const highRisk = allStates.filter(s => s.calculatedRiskLevel === "High Risk").sort((a, b) => a.riskScoreTotal - b.riskScoreTotal).slice(0, 5);
  const lowRisk  = allStates.filter(s => s.calculatedRiskLevel === "Low Risk" || s.calculatedRiskLevel === "Emerging Risk").sort((a, b) => b.riskScoreTotal - a.riskScoreTotal).slice(0, 5);

  const bestFor = (weights) => [...allStates].sort((a, b) => {
    const sa = computeDimensionScores(a.state), sb = computeDimensionScores(b.state);
    return Object.entries(weights).reduce((d, [k, w]) => d + (sb[k] - sa[k]) * w, 0);
  }).slice(0, 3).map(s => s.state);
  const bestTraining  = bestFor({ cleanenergy: 3, grid: 2, economics: 2 });
  const bestInference = bestFor({ grid: 3, economics: 2.5, policy: 2 });

  /* Risk tier bar */
  const tierColors = { "High Risk": "#E57373", "Moderate Risk": "#F7C6C7", "Emerging Risk": "#F3E6AE", "Low Risk": "#A8D5BA" };
  const tierOrder  = ["Low Risk", "Emerging Risk", "Moderate Risk", "High Risk"];
  const tierBarHtml = tierOrder.map(t => {
    const pct = ((riskCounts[t] || 0) / total * 100).toFixed(1);
    return `<div class="nat-tier-seg" style="width:${pct}%;background:${tierColors[t]}" title="${t}: ${riskCounts[t]} states (${pct}%)"></div>`;
  }).join("");

  const tierLegendHtml = tierOrder.slice().reverse().map(t =>
    `<div class="nat-tier-item"><span class="nat-tier-dot" style="background:${tierColors[t]}"></span><span class="nat-tier-label">${t}</span><span class="nat-tier-count">${riskCounts[t]}</span></div>`
  ).join("");

  /* Dimension bars */
  const dimBarHtml = dimKeys.map(k => {
    const s = dimAvg[k];
    const leftPct  = s >= 0 ? 50 : Math.round(50 + s * 50);
    const widthPct = Math.max(Math.round(Math.abs(s) * 50), 1);
    const color    = s > 0.05 ? "#10B981" : s < -0.05 ? "#EF4444" : "#94A3B8";
    const trend    = s > 0.12 ? "↑ Net positive" : s < -0.12 ? "↓ Drag on market" : "→ Mixed";
    return `<div class="nat-dim-row">
      <span class="nat-dim-label">${dimLabels[k]}</span>
      <div class="dim-bar-wrap nat-dim-bar"><div class="dim-bar-center"></div><div class="dim-bar-fill" style="left:${leftPct}%;width:${widthPct}%;background:${color}"></div></div>
      <span class="nat-dim-val" style="color:${color}">${s >= 0 ? "+" : ""}${s.toFixed(2)}</span>
      <span class="nat-dim-trend" style="color:${color}">${trend}</span>
    </div>`;
  }).join("");

  /* State pills */
  const pillHtml = (states, cls) => states.map(s =>
    `<button class="nat-state-pill nat-state-pill--${cls}" onclick="renderStatePanel('${s}')">${s}</button>`
  ).join("");

  container.innerHTML = `
    <div class="nat-section nat-section--verdict">
      <div class="advisory-verdict ${overallCls} nat-verdict">
        <span class="advisory-verdict__label">${overallVerdict}</span>
        <span class="advisory-verdict__context">· avg score ${avgRisk > 0 ? "+" : ""}${avgRisk} across 50 states</span>
      </div>
      <p class="nat-summary">Policy & regulatory is the primary drag on the US market (−0.23 avg). Grid and economics are net positive. 72% of states sit in Emerging Risk — conditions are navigable with diligence, not prohibitive.</p>
    </div>

    <div class="nat-section">
      <div class="nat-section-title">Risk Distribution</div>
      <div class="nat-tier-bar">${tierBarHtml}</div>
      <div class="nat-tier-legend">${tierLegendHtml}</div>
    </div>

    <div class="nat-section">
      <div class="nat-section-title">Dimension Averages <span class="nat-section-sub">across all 50 states</span></div>
      <div class="nat-dims">${dimBarHtml}</div>
    </div>

    <div class="nat-section nat-two-col">
      <div>
        <div class="nat-section-title">States to Watch <span class="nat-section-sub">highest risk</span></div>
        <div class="nat-pills">${pillHtml(highRisk.map(s=>s.state), "risk")}</div>
      </div>
      <div>
        <div class="nat-section-title">Strongest Markets <span class="nat-section-sub">lowest risk</span></div>
        <div class="nat-pills">${pillHtml(lowRisk.map(s=>s.state), "low")}</div>
      </div>
    </div>

    <div class="nat-section nat-two-col">
      <div>
        <div class="nat-section-title">Best for Training</div>
        <div class="nat-pills">${pillHtml(bestTraining, "uc")}</div>
      </div>
      <div>
        <div class="nat-section-title">Best for Inference</div>
        <div class="nat-pills">${pillHtml(bestInference, "uc")}</div>
      </div>
    </div>`;

  showPanel();

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

  const showStates = currentViewMode === "state" || currentViewMode === "tariff";
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

/* ── Tariff view helpers ──────────────────────────────── */

let _legendOriginalHTML = null;

function applyTariffMapColors() {
  if (!map || !map.getLayer("states-fill")) return;
  map.setPaintProperty("states-fill", "fill-color", TARIFF_FILL_EXPR);
}

function applyRiskMapColors() {
  if (!map || !map.getLayer("states-fill")) return;
  map.setPaintProperty("states-fill", "fill-color", RISK_FILL_EXPR);
}

function renderTariffLegend() {
  const legend = document.getElementById("legend");
  if (!legend) return;
  // Cache original before replacing
  if (!_legendOriginalHTML) _legendOriginalHTML = legend.innerHTML;

  const counts = {};
  let noneCount = 0;
  for (const s of stateIndex.values()) {
    if (s.state === "National") continue;
    const tariffs = tariffByState.get(s.state);
    const status = tariffs?.[0]?.status;
    if (status && status !== "None") {
      counts[status] = (counts[status] || 0) + 1;
    } else {
      noneCount++;
    }
  }

  const statusOrder = [
    "Enacted",
    "Pending Commission Approval",
    "Proposed/Filed",
    "Under Development",
    "Withdrawn",
  ];

  const rows = statusOrder
    .filter(s => counts[s])
    .map(s => `
      <div class="legend__row">
        <span class="legend__swatch" style="background:${TARIFF_STATUS_COLORS[s]};opacity:0.85"></span>
        <span class="legend__label">${s} <span class="legend__count">(${counts[s]})</span></span>
      </div>`)
    .join("");

  legend.innerHTML = `
    <div class="legend__title">Large Load Tariff Status</div>
    ${rows}
    <div class="legend__row">
      <span class="legend__swatch" style="background:#1e2d3d;border:1px solid #334155"></span>
      <span class="legend__label">No Tariff <span class="legend__count">(${noneCount})</span></span>
    </div>
  `;
}

function restoreRiskLegend() {
  const legend = document.getElementById("legend");
  if (legend && _legendOriginalHTML && !legend.querySelector(".legend__range")) {
    legend.innerHTML = _legendOriginalHTML;
  }
}

/* ── UI bindings ──────────────────────────────────────── */

function bindUI() {
  ui.panelClose?.addEventListener("click", hidePanel);

  ui.onboardingClose?.addEventListener("click", () => {
    if (ui.onboardingBanner) ui.onboardingBanner.style.display = "none";
    adjustMapTop();
  });

  ui.viewStateBtn?.addEventListener("click", () => {
    const wasTariff = currentViewMode === "tariff";
    currentViewMode = "state";
    ui.viewStateBtn?.classList.add("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    ui.viewTariffBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    if (wasTariff) { applyRiskMapColors(); restoreRiskLegend(); }
    setLayerVisibility();
    hideHoverTooltip();
    hidePanel();
  });

  ui.viewIsoBtn?.addEventListener("click", () => {
    const wasTariff = currentViewMode === "tariff";
    currentViewMode = "iso";
    ui.viewIsoBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    ui.viewTariffBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    if (wasTariff) { applyRiskMapColors(); restoreRiskLegend(); }
    setLayerVisibility();
    hideHoverTooltip();
    hidePanel();
  });

  ui.viewNationalBtn?.addEventListener("click", () => {
    const wasTariff = currentViewMode === "tariff";
    currentViewMode = "national";
    ui.viewNationalBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    ui.viewTariffBtn?.classList.remove("toggle__btn--active");
    if (wasTariff) { applyRiskMapColors(); restoreRiskLegend(); }
    setLayerVisibility();
    hideHoverTooltip();
    renderNationalPanel();
  });

  ui.viewTariffBtn?.addEventListener("click", () => {
    currentViewMode = "tariff";
    ui.viewTariffBtn?.classList.add("toggle__btn--active");
    ui.viewStateBtn?.classList.remove("toggle__btn--active");
    ui.viewIsoBtn?.classList.remove("toggle__btn--active");
    ui.viewNationalBtn?.classList.remove("toggle__btn--active");
    if (ui.panelTopSignals?.parentElement) ui.panelTopSignals.parentElement.style.display = "";
    setLayerVisibility();
    applyTariffMapColors();
    renderTariffLegend();
    hideHoverTooltip();
    hidePanel();
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

  /* Use-case toggle + advisory block below panelMeta */
  if (ui.panelMeta && !document.getElementById("useCaseToggle")) {
    const toggle = document.createElement("div");
    toggle.id = "useCaseToggle";
    toggle.className = "use-case-toggle";
    toggle.style.display = "none";
    toggle.innerHTML = `
      <button class="uc-btn uc-btn--active" data-uc="mixed">Mixed</button>
      <button class="uc-btn" data-uc="training">Training</button>
      <button class="uc-btn" data-uc="inference">Inference</button>`;
    ui.panelMeta.insertAdjacentElement("afterend", toggle);

    const advisory = document.createElement("div");
    advisory.id = "advisoryBlock";
    advisory.className = "advisory-block";
    advisory.style.display = "none";
    toggle.insertAdjacentElement("afterend", advisory);

    toggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".uc-btn");
      if (!btn) return;
      currentUseCase = btn.dataset.uc;
      toggle.querySelectorAll(".uc-btn").forEach(b => b.classList.toggle("uc-btn--active", b === btn));
      if (currentContext?.type === "state") {
        const st = stateIndex.get(currentContext.value);
        if (st) renderAdvisoryBlock(st, currentUseCase);
      }
    });
  }

  /* Back button in panel header */
  const panelHeader = document.querySelector(".panel__header");
  if (panelHeader && !document.getElementById("panelBackBtn")) {
    const backBtn = document.createElement("button");
    backBtn.id = "panelBackBtn";
    backBtn.className = "panel__back-btn";
    backBtn.title = "Back";
    backBtn.textContent = "← Back";
    backBtn.style.display = "none";
    backBtn.addEventListener("click", () => {
      if (!previousContext) return;
      const ctx = previousContext;
      previousContext = null;
      if (ctx.type === "national") renderNationalPanel();
      else if (ctx.type === "iso") renderIsoPanel(ctx.value);
    });
    const closeBtn = document.getElementById("panelClose");
    if (closeBtn) panelHeader.insertBefore(backBtn, closeBtn);
    else panelHeader.appendChild(backBtn);
  }

  /* Compare Markets button in panel header */
  if (panelHeader && !document.getElementById("compareBtn")) {
    const compareBtn = document.createElement("button");
    compareBtn.id = "compareBtn";
    compareBtn.className = "panel__compare-btn";
    compareBtn.title = "Compare with another market";
    compareBtn.textContent = "⇄ Compare";
    compareBtn.style.display = "none";
    compareBtn.addEventListener("click", () => {
      openCompareModal(currentContext?.type === "state" ? currentContext.value : null);
    });
    const closeBtn = document.getElementById("panelClose");
    if (closeBtn) panelHeader.insertBefore(compareBtn, closeBtn);
    else panelHeader.appendChild(compareBtn);
  }
}

/* ── Map initialisation ───────────────────────────────── */

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
    /* ── Override Mapbox default label styling ──────── */
    // State labels: white, bold halo, full opacity
    map.setPaintProperty("state-label", "text-color", "#FFFFFF");
    map.setPaintProperty("state-label", "text-halo-color", "rgba(10,18,40,0.85)");
    map.setPaintProperty("state-label", "text-halo-width", 2);
    map.setPaintProperty("state-label", "text-opacity", 1);

    // City/settlement labels: slightly off-white, same halo treatment
    ["settlement-major-label", "settlement-minor-label", "settlement-subdivision-label"].forEach(id => {
      map.setPaintProperty(id, "text-color", "#E2E8F0");
      map.setPaintProperty(id, "text-halo-color", "rgba(10,18,40,0.8)");
      map.setPaintProperty(id, "text-halo-width", 1.5);
      map.setPaintProperty(id, "text-opacity", 0.9);
    });

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
        "text-halo-color": "rgba(15,23,42,0.8)",
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
      if (currentViewMode === "tariff") {
        renderTariffPanel(stateName);
      } else {
        renderStatePanel(stateName);
      }
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

    const [statesGeoRes, isoGeoRes, statesApiRes, entriesApiRes, tariffsApiRes] = await Promise.all([
      fetchJson(DATA_URLS.statesGeo),
      fetchJson(DATA_URLS.isoGeo),
      fetchJson(DATA_URLS.statesApi, { optional: true, fallback: [] }),
      fetchJson(DATA_URLS.entriesApi, { optional: true, fallback: [] }),
      fetchJson(DATA_URLS.tariffsApi, { optional: true, fallback: [] }),
    ]);

    statesGeo = statesGeoRes?.type === "FeatureCollection"
      ? statesGeoRes
      : { type: "FeatureCollection", features: [] };

    isoGeo = isoGeoRes?.type === "FeatureCollection"
      ? isoGeoRes
      : { type: "FeatureCollection", features: [] };

    statesData = Array.isArray(statesApiRes) ? statesApiRes : (statesApiRes?.states || []);
    entriesData = Array.isArray(entriesApiRes) ? entriesApiRes : (entriesApiRes?.entries || []);

    const tariffsData = Array.isArray(tariffsApiRes) ? tariffsApiRes : (tariffsApiRes?.tariffs || []);

    buildIndexes();
    buildTariffIndex(tariffsData);
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

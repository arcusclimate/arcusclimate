/* =========================
   Arcus Map — script.js
   State + ISO/RTO views
   ========================= */

/** 1) CONFIG **/
mapboxgl.accessToken = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg";

// Your ISO/RTO tileset (you gave this)
const ISO_TILESET_URL = "mapbox://arcusclimate.7zboucdg";
const ISO_SOURCE_LAYER = "iso-rto-bcdqwz";

// State boundaries in your repo
const STATES_GEOJSON_URL = "/data/us-states.geojson";

// Airtable entries API (your Vercel function)
const ENTRIES_API_URL = "/api/entries";

// Category options (easy to change later)
const CATEGORY_OPTIONS = [
  "All",
  "Moratorium",
  "Permitting / Siting",
  "Grid / Interconnection",
  "Clean Energy",
  "Disclosure / Reporting",
  "Incentives",
  "Other",
];

function safeSetVisibility(layerId, visible) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

/** 2) DOM HELPERS **/
const $ = (sel) => document.querySelector(sel);

const el = {
  map: $("#map"),
  title: $("#region-title"),
  entries: $("#entries"),

  viewSelect: $("#viewSelect"),
  categorySelect: $("#categorySelect"),
  sortSelect: $("#sortSelect"),
  searchInput: $("#searchInput"),

  statsRegions: $("#statsRegions"),
  statsEntries: $("#statsEntries"),
};

function safeSetText(node, txt) {
  if (!node) return;
  node.textContent = txt;
}

function safeSetHTML(node, html) {
  if (!node) return;
  node.innerHTML = html;
}

/** 3) STATE **/
let map;
let entries = []; // all entries from Airtable

let viewMode = "state"; // "state" | "iso"
let selectedState = null;
let selectedIso = null;

let selectedCategory = "All";
let sortMode = "newest"; // "newest" | "oldest"
let searchQuery = "";

// map hover ids
let hoveredStateId = null;
let hoveredIsoId = null;

function normalize(s) {
  return String(s || "").trim();
}

function parseDate(d) {
  // supports "YYYY-MM-DD" (your Airtable field)
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}

/** 4) ENTRY FIELD LOGIC **/
function getEntryCategory(e) {
  // You might have Category in Airtable later; default to "Other"
  return normalize(e.Category || e.category || e.Type || "Other");
}

// This is the key: support the 4 types you listed
// - State-specific (State = "Virginia")
// - ISO-specific (ISO = "PJM")
// - Federal (no State, no ISO)
// - Multi-state (State = "Virginia, Maryland" or similar)
function getEntryScope(e) {
  const state = normalize(e.State);
  const iso = normalize(e.ISO || e.Iso || e.RTO || e["ISO/RTO"]);

  if (iso) return "iso";
  if (!state) return "federal";

  // crude multi-state detection (comma-separated)
  if (state.includes(",")) return "multi";

  return "state";
}

function entryMatchesSelection(e) {
  const scope = getEntryScope(e);

  if (viewMode === "state") {
    if (!selectedState) return false;

    if (scope === "state") {
      return normalize(e.State).toLowerCase() === selectedState.toLowerCase();
    }

    if (scope === "multi") {
      // treat comma-separated as "includes"
      const parts = normalize(e.State)
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);
      return parts.includes(selectedState.toLowerCase());
    }

    // federal + iso don't show when user clicked a state (unless you want them to)
    return false;
  }

  // ISO view
  if (viewMode === "iso") {
    if (!selectedIso) return false;

    if (scope === "iso") {
      const iso = normalize(e.ISO || e.Iso || e.RTO || e["ISO/RTO"]).toLowerCase();
      return iso === selectedIso.toLowerCase();
    }

    // optional: also show federal when ISO selected? (off by default)
    return false;
  }

  return false;
}

function entryMatchesCategory(e) {
  if (selectedCategory === "All") return true;
  return getEntryCategory(e).toLowerCase() === selectedCategory.toLowerCase();
}

function entryMatchesSearch(e) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();

  const title = normalize(e.Title).toLowerCase();
  const summary = normalize(e.Summary).toLowerCase();
  const link = normalize(e.Link).toLowerCase();

  return title.includes(q) || summary.includes(q) || link.includes(q);
}

function getFilteredEntries() {
  const filtered = entries
    .filter(entryMatchesSelection)
    .filter(entryMatchesCategory)
    .filter(entryMatchesSearch);

  filtered.sort((a, b) => {
    const da = parseDate(a.Date);
    const db = parseDate(b.Date);
    return sortMode === "oldest" ? da - db : db - da;
  });

  return filtered;
}

/** 5) SIDEBAR RENDER **/
function renderStats(filtered) {
  // Regions with activity = 1 (selected region) for now; could be expanded later
  const regionCount = (viewMode === "state" && selectedState) || (viewMode === "iso" && selectedIso) ? 1 : 0;
  safeSetText(el.statsRegions, String(regionCount));
  safeSetText(el.statsEntries, String(filtered.length));
}

function entryCard(e) {
  const title = normalize(e.Title) || "(Untitled)";
  const summary = normalize(e.Summary);
  const link = normalize(e.Link);
  const date = normalize(e.Date);
  const cat = getEntryCategory(e);

  const linkHtml = link
    ? `<a class="entry-title" href="${link}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        title
      )}</a>`
    : `<div class="entry-title">${escapeHtml(title)}</div>`;

  return `
    <div class="entry-card">
      ${linkHtml}
      ${summary ? `<div class="entry-summary">${escapeHtml(summary)}</div>` : ""}
      <div class="entry-meta">
        ${date ? `<span class="pill">${escapeHtml(date)}</span>` : ""}
        ${cat ? `<span class="pill">${escapeHtml(cat)}</span>` : ""}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSidebar() {
  const filtered = getFilteredEntries();
  renderStats(filtered);

  if (viewMode === "state") {
    safeSetText(el.title, selectedState ? selectedState : "Select a State");
  } else {
    safeSetText(el.title, selectedIso ? selectedIso : "Select an ISO / RTO");
  }

  if (!((viewMode === "state" && selectedState) || (viewMode === "iso" && selectedIso))) {
    safeSetHTML(
      el.entries,
      `<div class="empty-state">Click a region to see Arcus-tracked laws, articles, and updates.</div>`
    );
    return;
  }

  if (filtered.length === 0) {
    safeSetHTML(el.entries, `<div class="empty-state">No entries match your filters.</div>`);
    return;
  }

  safeSetHTML(el.entries, filtered.map(entryCard).join(""));
}

function render() {
  renderSidebar();
}

/** 6) CONTROLS **/
function populateCategorySelect() {
  if (!el.categorySelect) return;

  // If your Airtable has categories already, you can auto-build this later.
  el.categorySelect.innerHTML = CATEGORY_OPTIONS.map(
    (c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
  ).join("");
  el.categorySelect.value = selectedCategory;
}

function wireControls() {
  populateCategorySelect();

  if (el.viewSelect) {
    el.viewSelect.value = viewMode === "iso" ? "iso" : "state";
    el.viewSelect.addEventListener("change", () => {
      viewMode = el.viewSelect.value === "iso" ? "iso" : "state";

      // clear selection when switching modes
      selectedState = null;
      selectedIso = null;

      clearFeatureStates();
      setLayerVisibility();
      render();
    });
  }

  if (el.categorySelect) {
    el.categorySelect.addEventListener("change", () => {
      selectedCategory = el.categorySelect.value || "All";
      render();
    });
  }

  if (el.sortSelect) {
    // expects option values: "newest" / "oldest"
    el.sortSelect.value = sortMode;
    el.sortSelect.addEventListener("change", () => {
      sortMode = el.sortSelect.value === "oldest" ? "oldest" : "newest";
      render();
    });
  }

  if (el.searchInput) {
    el.searchInput.addEventListener("input", () => {
      searchQuery = normalize(el.searchInput.value);
      render();
    });
  }
}

/** 7) MAP: LAYERS + VISIBILITY **/
function layerExists(id) {
  return !!map.getLayer(id);
}

function safeSetVisibility(layerId, visible) {
  if (!layerExists(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function setLayerVisibility() {
  const showStates = viewMode === "state";
  const showIso = viewMode === "iso";

  // STATE layers
  safeSetVisibility("states-fill", showStates);
  safeSetVisibility("states-outline", showStates);

  // ISO layers
  safeSetVisibility("iso-fill", showIso);
  safeSetVisibility("iso-line", showIso);

  // Optional: make clicks feel right
  map.getCanvas().style.cursor = "";
}

function clearFeatureStates() {
  // clear state hover
  if (hoveredStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: hoveredStateId }, { hover: false });
  }
  hoveredStateId = null;

  // clear iso hover
  if (hoveredIsoId !== null && map.getSource("iso")) {
    map.setFeatureState({ source: "iso", sourceLayer: ISO_SOURCE_LAYER, id: hoveredIsoId }, { hover: false });
  }
  hoveredIsoId = null;
}

/** 8) LOAD ENTRIES **/
async function loadEntries() {
  const res = await fetch(ENTRIES_API_URL);
  const data = await res.json();

  // expected shape from your API:
  // [{ Title, Summary, Link, Date, State, Status, ISO?, Category? }, ...]
  entries = Array.isArray(data) ? data : [];
}

/** 9) INIT MAP **/
async function init() {
  wireControls();
  await loadEntries();

  const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-98.5, 39.8],
    zoom: 3,
  });

  map.addControl(new mapboxgl.NavigationControl(), "top-right");

  map.on("load", async () => {
    // --- Load State boundaries (GeoJSON) ---
    const states = await fetch(STATES_GEOJSON_URL).then((r) => r.json());
    states.features.forEach((f, idx) => (f.id = idx));

    map.addSource("states", { type: "geojson", data: states });

    map.addLayer({
      id: "states-fill",
      type: "fill",
      source: "states",
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false], "#111827",
          ["boolean", ["feature-state", "hover"], false], "#374151",
          "#e5e7eb"
        ],
        "fill-opacity": 0.18,
      },
    });

    map.addLayer({
      id: "states-outline",
      type: "line",
      source: "states",
      paint: { "line-color": "#94a3b8", "line-width": 1 },
    });

// --- Wire up the View dropdown (State vs ISO/RTO) ---
const viewSelect =
  document.getElementById("viewSelect") ||
  document.getElementById("viewMode") ||
  document.getElementById("view") ||
  document.querySelector('select[name="view"]');

if (viewSelect) {
  viewSelect.addEventListener("change", () => {
    const v = viewSelect.value;

    // supports either values: "state"/"iso" OR labels like "ISO / RTO"
    viewMode = (v === "iso" || v === "ISO / RTO") ? "iso" : "state";

    // clear selections when switching modes
    selectedStateId = null;
    selectedIsoId = null;

    setLayerVisibility();
    render(); // or whatever your refresh function is called
  });
} else {
  console.warn("View dropdown not found. Add an id to the View <select> (e.g., id='viewMode').");
}
     
    // --- ISO / RTO (Mapbox tileset vector) ---
    map.addSource("iso", {
      type: "vector",
      url: ISO_TILESET_URL,
    });

    map.addLayer({
      id: "iso-fill",
      type: "fill",
      source: "iso",
      "source-layer": ISO_SOURCE_LAYER,
      minzoom: 0,
      maxzoom: 22,
      layout: { visibility: "none" },
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false], "#1d4ed8",
          ["boolean", ["feature-state", "hover"], false], "#2563eb",
          "#2563eb"
        ],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false], 0.18,
          ["boolean", ["feature-state", "hover"], false], 0.12,
          ["interpolate", ["linear"], ["zoom"], 0, 0.04, 4, 0.06, 7, 0.08, 10, 0.10]
        ],
      },
    });

    map.addLayer({
      id: "iso-line",
      type: "line",
      source: "iso",
      "source-layer": ISO_SOURCE_LAYER,
      minzoom: 0,
      maxzoom: 22,
      layout: { visibility: "none" },
      paint: {
        "line-color": "#1d4ed8",
        "line-opacity": 0.9,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          0, 0.8,
          3, 1.2,
          6, 1.8,
          9, 2.6,
          12, 3.6
        ],
      },
    });

    // start in State view
    setLayerVisibility();
    render();

    // --- State interactions ---
    map.on("mousemove", "states-fill", (e) => {
      if (viewMode !== "state") return;
      map.getCanvas().style.cursor = "pointer";
      if (!e.features?.length) return;

      const f = e.features[0];
      const id = f.id;

      if (hoveredStateId !== null && hoveredStateId !== id) {
        map.setFeatureState({ source: "states", id: hoveredStateId }, { hover: false });
      }

      hoveredStateId = id;
      map.setFeatureState({ source: "states", id }, { hover: true });
    });

    map.on("mouseleave", "states-fill", () => {
      if (hoveredStateId !== null && map.getSource("states")) {
        map.setFeatureState({ source: "states", id: hoveredStateId }, { hover: false });
      }
      hoveredStateId = null;
      map.getCanvas().style.cursor = "";
    });


      const f = e.features[0];
      const name = f.properties?.name || f.properties?.NAME;
      if (!name) return;

      // clear previous selection (optional)
      // easiest: just redraw selected by clearing all selected flags
      // but geojson has many features, so we’ll only set selected on current feature
      // and clear previously selected by scanning selectedState
      selectedState = name;
      selectedIso = null;

      // Clear all hover
      clearFeatureStates();

      // Set selected flag on clicked feature
      // (We cannot easily clear previous selected without tracking its id; so we track selected id by state name)
      // We'll brute force by clearing previously selected via storing lastSelectedStateId:
      if (window.__lastSelectedStateId !== undefined && window.__lastSelectedStateId !== null) {
        map.setFeatureState({ source: "states", id: window.__lastSelectedStateId }, { selected: false });
      }
      window.__lastSelectedStateId = f.id;
      map.setFeatureState({ source: "states", id: f.id }, { selected: true });

      render();
    });

    // --- ISO interactions ---
    function isoFeatureId(feat) {
      // vector tiles often have `id`, otherwise use an attribute that looks stable
      return (
        feat.id ??
        feat.properties?.OBJECTID ??
        feat.properties?.ID ??
        feat.properties?.GlobalID ??
        feat.properties?.NAME ??
        null
      );
    }

    map.on("mousemove", "iso-fill", (e) => {
      if (viewMode !== "iso") return;
      map.getCanvas().style.cursor = "pointer";
      if (!e.features?.length) return;

      const f = e.features[0];
      const id = isoFeatureId(f);
      if (id === null) return;

      if (hoveredIsoId !== null && hoveredIsoId !== id) {
        map.setFeatureState(
          { source: "iso", sourceLayer: ISO_SOURCE_LAYER, id: hoveredIsoId },
          { hover: false }
        );
      }

      hoveredIsoId = id;
      map.setFeatureState({ source: "iso", sourceLayer: ISO_SOURCE_LAYER, id }, { hover: true });
    });


// --- Click handler (works even if another layer sits on top) ---
map.on("click", (e) => {
  if (viewMode === "state") {
    const feats = map.queryRenderedFeatures(e.point, { layers: ["states-fill"] });
    if (!feats.length) return;

    const f = feats[0];
    const name = f.properties?.name || f.properties?.NAME;
    if (!name) return;

    selectedState = String(name);
    selectedIso = null;

    // clear previous selected
    if (window.__lastSelectedStateId !== undefined && window.__lastSelectedStateId !== null) {
      map.setFeatureState({ source: "states", id: window.__lastSelectedStateId }, { selected: false });
    }

    window.__lastSelectedStateId = f.id;
    map.setFeatureState({ source: "states", id: f.id }, { selected: true });

    render();
    return;
  }

  if (viewMode === "iso") {
    const feats = map.queryRenderedFeatures(e.point, { layers: ["iso-fill"] });
    if (!feats.length) return;

    const f = feats[0];
    const name = f.properties?.NAME || f.properties?.name;
    if (!name) return;

    selectedIso = String(name);
    selectedState = null;

    // feature id helper
    const id =
      f.id ??
      f.properties?.OBJECTID ??
      f.properties?.ID ??
      f.properties?.GlobalID ??
      f.properties?.NAME ??
      null;

    // clear previous selected iso
    if (window.__lastSelectedIsoId !== undefined && window.__lastSelectedIsoId !== null) {
      map.setFeatureState(
        { source: "iso", sourceLayer: ISO_SOURCE_LAYER, id: window.__lastSelectedIsoId },
        { selected: false }
      );
    }

    window.__lastSelectedIsoId = id;

    if (id !== null) {
      map.setFeatureState({ source: "iso", sourceLayer: ISO_SOURCE_LAYER, id }, { selected: true });
    }

    render();
    return;
  }
});
   
    map.on("mouseleave", "iso-fill", () => {
      if (hoveredIsoId !== null && map.getSource("iso")) {
        map.setFeatureState(
          { source: "iso", sourceLayer: ISO_SOURCE_LAYER, id: hoveredIsoId },
          { hover: false }
        );
      }
      hoveredIsoId = null;
      map.getCanvas().style.cursor = "";
    });

      const f = e.features[0];
      const name = f.properties?.NAME || f.properties?.name;
      if (!name) return;

      selectedIso = String(name);
      selectedState = null;

      clearFeatureStates();

      // clear previous selected iso
      if (window.__lastSelectedIsoId !== undefined && window.__lastSelectedIsoId !== null) {
        map.setFeatureState(
          { source: "iso", sourceLayer: ISO_SOURCE_LAYER, id: window.__lastSelectedIsoId },
          { selected: false }
        );
      }

      const id = isoFeatureId(f);
      window.__lastSelectedIsoId = id;

      if (id !== null) {
        map.setFeatureState({ source: "iso", sourceLayer: ISO_SOURCE_LAYER, id }, { selected: true });
      }

      render();
    });
  });
}

/** 10) BOOT **/
init().catch((err) => {
  console.error("Init failed:", err);
  safeSetHTML(el.entries, `<div class="empty-state">Error: ${escapeHtml(String(err))}</div>`);
});

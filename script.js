mapboxgl.accessToken = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg";

async function loadEntries() {
  const res = await fetch("/api/entries");
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [-98.5, 39.8],
  zoom: 3.4,
});

map.addControl(new mapboxgl.NavigationControl(), "top-right");

let ALL_ENTRIES = [];

// UI state
let viewMode = "state";      // "state" | "iso"
let selectedRegion = null;   // state name OR iso name
let selectedCategory = "";
let sortOrder = "desc";
let searchQuery = "";

// Map selection/hover
let hoveredStateId = null;
let selectedStateId = null;

let hoveredIsoId = null;
let selectedIsoId = null;

function norm(s) {
  return (s || "").trim().toLowerCase();
}

function isPublished(e) {
  return norm(e.Status) === "published";
}

function matchesCategory(e) {
  if (!selectedCategory) return true;
  return norm(e.Category) === norm(selectedCategory);
}

function matchesSearch(e) {
  if (!searchQuery) return true;
  const hay = `${e.Title || ""} ${e.Summary || ""}`.toLowerCase();
  return hay.includes(searchQuery);
}

function allFilteredEntries() {
  return ALL_ENTRIES
    .filter(isPublished)
    .filter(matchesCategory)
    .filter(matchesSearch);
}

function getPublishedCategories(entries) {
  const set = new Set();
  for (const e of entries) {
    if (!isPublished(e)) continue;
    const c = (e.Category || "").trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function setDropdownOptions() {
  const sel = document.getElementById("categoryFilter");
  if (!sel) return;

  const keepFirst = sel.options[0];
  sel.innerHTML = "";
  sel.appendChild(keepFirst);

  const cats = getPublishedCategories(ALL_ENTRIES);
  for (const c of cats) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }

  sel.value = selectedCategory;
}

function getIsoNameFromFeatureProps(props) {
  // robust across different datasets
  return (
    props.ISO ||
    props.iso ||
    props.ISO_NAME ||
    props.iso_name ||
    props.RTO ||
    props.rto ||
    props.NAME ||
    props.name ||
    props.Operator ||
    props.operator ||
    null
  );
}

function regionEntries(regionName) {
  const filtered = allFilteredEntries();

  if (!regionName) return [];

  if (viewMode === "state") {
    return filtered.filter((e) => norm(e.State) === norm(regionName));
  }

  // ISO mode
  return filtered.filter((e) => norm(e.ISO) === norm(regionName));
}

function federalEntries() {
  // entries that are published + match category/search but have neither State nor ISO
  return allFilteredEntries().filter((e) => !norm(e.State) && !norm(e.ISO));
}

function updateStats() {
  const statStates = document.getElementById("statStates");
  const statEntries = document.getElementById("statEntries");
  if (!statStates || !statEntries) return;

  const filtered = allFilteredEntries();

  if (viewMode === "state") {
    const statesSet = new Set(filtered.map((e) => norm(e.State)).filter(Boolean));
    statStates.textContent = `${statesSet.size}`;
  } else {
    const isoSet = new Set(filtered.map((e) => norm(e.ISO)).filter(Boolean));
    statStates.textContent = `${isoSet.size}`;
  }

  statEntries.textContent = `${filtered.length}`;
}

function renderEntries(regionName) {
  const regionTitle = document.getElementById("region-title");
  const entriesEl = document.getElementById("entries");

  if (!regionName) {
    regionTitle.textContent = viewMode === "state" ? "Select a State" : "Select an ISO / RTO";
    entriesEl.innerHTML =
      `<p>Click a ${viewMode === "state" ? "state" : "region"} to see Arcus-tracked laws, articles, and updates.</p>`;
    return;
  }

  regionTitle.textContent = regionName;

  let filtered = regionEntries(regionName);
  const fed = federalEntries();

  // Sort region entries
  filtered.sort((a, b) => (a.Date || "").localeCompare(b.Date || ""));
  if (sortOrder === "desc") filtered.reverse();

  // Sort federal entries
  fed.sort((a, b) => (a.Date || "").localeCompare(b.Date || ""));
  if (sortOrder === "desc") fed.reverse();

  if (filtered.length === 0 && fed.length === 0) {
    const hints = [];
    if (selectedCategory) hints.push("switch Category back to All");
    if (searchQuery) hints.push("clear the search box");
    const hintText = hints.length
      ? `<p style="margin-top:8px;">Try: <b>${hints.join("</b> or <b>")}</b>.</p>`
      : "";
    entriesEl.innerHTML =
      `<p>No published entries found for this selection with the current filters.</p>${hintText}`;
    return;
  }

  const renderCard = (e) => {
    const safeTitle = e.Title || "(Untitled)";
    const safeSummary = e.Summary || "";
    const safeLink = e.Link || "#";
    const safeDate = e.Date ? `<div class="meta">${e.Date}</div>` : "";
    const safeCat = e.Category ? `<div class="meta">${e.Category}</div>` : "";
    const safeIso = e.ISO ? `<div class="meta">ISO: ${e.ISO}</div>` : "";
    const safeState = e.State ? `<div class="meta">State: ${e.State}</div>` : "";

    return `
      <div class="entry">
        <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
        <div style="margin-top:6px;">${safeSummary}</div>
        ${safeDate}
        ${safeCat}
        ${safeIso}
        ${safeState}
      </div>
    `;
  };

  let html = "";

  if (filtered.length) {
    html += filtered.map(renderCard).join("");
  }

  if (fed.length) {
    html += `
      <div style="margin:16px 0 6px 0; font-size:12px; color:#475569; font-weight:800; letter-spacing:.02em; text-transform:uppercase;">
        Federal / Cross-Region
      </div>
    `;
    html += fed.map(renderCard).join("");
  }

  entriesEl.innerHTML = html;
}

// ---------- MAP INTENSITY ----------
function computeCounts() {
  const counts = new Map(); // normalized region -> count

  for (const e of allFilteredEntries()) {
    const key = viewMode === "state" ? norm(e.State) : norm(e.ISO);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function bucketCount(c) {
  // 0 none, 1=1, 2=2-3, 3=4+
  if (c >= 4) return 3;
  if (c >= 2) return 2;
  if (c >= 1) return 1;
  return 0;
}

function updateStateHighlights() {
  if (!map.getSource("states")) return;

  const counts = computeCounts();
  const feats = map.querySourceFeatures("states");

  for (const f of feats) {
    const id = f.id;
    if (id === undefined || id === null) continue;

    const name = (f.properties && (f.properties.NAME || f.properties.name)) || "";
    const c = counts.get(norm(name)) || 0;

    map.setFeatureState({ source: "states", id }, { countLevel: bucketCount(c) });
  }
}

function updateIsoHighlights() {
  if (!map.getSource("iso")) return;

  const counts = computeCounts();
  const feats = map.querySourceFeatures("iso");

  for (const f of feats) {
    const id = f.id;
    if (id === undefined || id === null) continue;

    const nm = getIsoNameFromFeatureProps(f.properties || {}) || "";
    const c = counts.get(norm(nm)) || 0;

    map.setFeatureState({ source: "iso", id }, { countLevel: bucketCount(c) });
  }
}

function updateHighlights() {
  if (viewMode === "state") updateStateHighlights();
  else updateIsoHighlights();
}

// ---------- LAYER TOGGLING ----------
function setLayerVisibility() {
  const showStates = viewMode === "state";
  const stateVis = showStates ? "visible" : "none";
  const isoVis = showStates ? "none" : "visible";

  if (map.getLayer("states-fill")) map.setLayoutProperty("states-fill", "visibility", stateVis);
  if (map.getLayer("states-outline")) map.setLayoutProperty("states-outline", "visibility", stateVis);

  if (map.getLayer("iso-fill")) map.setLayoutProperty("iso-fill", "visibility", isoVis);
  if (map.getLayer("iso-outline")) map.setLayoutProperty("iso-outline", "visibility", isoVis);
}

function clearSelection() {
  // clear state selection
  if (selectedStateId !== null && map.getSource("states")) {
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
  }
  selectedStateId = null;

  // clear iso selection
  if (selectedIsoId !== null && map.getSource("iso")) {
    map.setFeatureState({ source: "iso", id: selectedIsoId }, { selected: false });
  }
  selectedIsoId = null;

  selectedRegion = null;
}

// ---------- LOAD ----------
map.on("load", async () => {
  // Load entries
  try {
    ALL_ENTRIES = await loadEntries();
  } catch (e) {
    console.error("Failed to load /api/entries", e);
    ALL_ENTRIES = [];
  }

  // Hook UI controls
  setDropdownOptions();

  const viewSel = document.getElementById("viewMode");
  const categorySel = document.getElementById("categoryFilter");
  const sortSel = document.getElementById("sortOrder");
  const searchInput = document.getElementById("searchInput");

  if (viewSel) {
    viewSel.value = viewMode;
    viewSel.addEventListener("change", () => {
      viewMode = viewSel.value || "state";
      clearSelection();
      setLayerVisibility();
      updateStats();
      updateHighlights();
      renderEntries(null);
    });
  }

  if (categorySel) {
    categorySel.addEventListener("change", () => {
      selectedCategory = categorySel.value || "";
      updateStats();
      updateHighlights();
      renderEntries(selectedRegion);
    });
  }

  if (sortSel) {
    sortSel.addEventListener("change", () => {
      sortOrder = sortSel.value || "desc";
      renderEntries(selectedRegion);
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = (searchInput.value || "").trim().toLowerCase();
      updateStats();
      updateHighlights();
      renderEntries(selectedRegion);
    });
  }

  // Initial stats + empty state
  updateStats();
  renderEntries(null);

  // Load State boundaries
  const states = await fetch("/data/us-states.geojson").then((r) => r.json());
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
        ["==", ["feature-state", "countLevel"], 3], "#60a5fa",
        ["==", ["feature-state", "countLevel"], 2], "#93c5fd",
        ["==", ["feature-state", "countLevel"], 1], "#bfdbfe",
        "#d1d5db"
      ],
      "fill-opacity": 0.40,
    },
  });

  map.addLayer({
    id: "states-outline",
    type: "line",
    source: "states",
    paint: { "line-color": "#9ca3af", "line-width": 1 },
  });

  // Load ISO/RTO boundaries (you uploaded this)
  const iso = await fetch("/data/iso-rto.geojson").then((r) => r.json());
  iso.features.forEach((f, idx) => (f.id = idx));

  map.addSource("iso", { type: "geojson", data: iso });

  map.addLayer({
    id: "iso-fill",
    type: "fill",
    source: "iso",
    paint: {
      "fill-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false], "#111827",
        ["boolean", ["feature-state", "hover"], false], "#374151",
        ["==", ["feature-state", "countLevel"], 3], "#34d399",
        ["==", ["feature-state", "countLevel"], 2], "#86efac",
        ["==", ["feature-state", "countLevel"], 1], "#bbf7d0",
        "#e5e7eb"
      ],
      "fill-opacity": 0.30,
    },
  });

  map.addLayer({
    id: "iso-outline",
    type: "line",
    source: "iso",
    paint: { "line-color": "#6b7280", "line-width": 1 },
  });

  // Start in state mode (hide ISO)
  setLayerVisibility();

  // Initial intensity
  updateHighlights();

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

  map.on("click", "states-fill", (e) => {
    if (viewMode !== "state") return;
    if (!e.features?.length) return;

    const f = e.features[0];
    const stateName = (f.properties && (f.properties.NAME || f.properties.name)) || null;

    if (selectedStateId !== null) {
      map.setFeatureState({ source: "states", id: selectedStateId }, { selected: false });
    }

    selectedStateId = f.id;
    map.setFeatureState({ source: "states", id: selectedStateId }, { selected: true });

    selectedRegion = stateName;
    renderEntries(selectedRegion);
  });

  // --- ISO interactions ---
  map.on("mousemove", "iso-fill", (e) => {
    if (viewMode !== "iso") return;
    map.getCanvas().style.cursor = "pointer";
    if (!e.features?.length) return;

    const f = e.features[0];
    const id = f.id;

    if (hoveredIsoId !== null && hoveredIsoId !== id) {
      map.setFeatureState({ source: "iso", id: hoveredIsoId }, { hover: false });
    }

    hoveredIsoId = id;
    map.setFeatureState({ source: "iso", id }, { hover: true });
  });

  map.on("mouseleave", "iso-fill", () => {
    if (hoveredIsoId !== null && map.getSource("iso")) {
      map.setFeatureState({ source: "iso", id: hoveredIsoId }, { hover: false });
    }
    hoveredIsoId = null;
    map.getCanvas().style.cursor = "";
  });

  map.on("click", "iso-fill", (e) => {
    if (viewMode !== "iso") return;
    if (!e.features?.length) return;

    const f = e.features[0];
    const nm = getIsoNameFromFeatureProps(f.properties || {}) || null;

    if (selectedIsoId !== null) {
      map.setFeatureState({ source: "iso", id: selectedIsoId }, { selected: false });
    }

    selectedIsoId = f.id;
    map.setFeatureState({ source: "iso", id: selectedIsoId }, { selected: true });

    selectedRegion = nm;
    renderEntries(selectedRegion);
  });
});

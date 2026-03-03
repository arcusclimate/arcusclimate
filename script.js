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
let hoveredId = null;
let selectedId = null;

let selectedStateName = null;
let selectedCategory = ""; // "" = All

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

  // keep the first option ("All"), rebuild the rest
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

function entriesForState(stateName) {
  return ALL_ENTRIES
    .filter(isPublished)
    .filter((e) => norm(e.State) === norm(stateName))
    .filter(matchesCategory);
}

function renderEntries(stateName) {
  const regionTitle = document.getElementById("region-title");
  const entriesEl = document.getElementById("entries");

  regionTitle.textContent = stateName ? stateName : "Select a State";

  if (!stateName) {
    entriesEl.innerHTML =
      "<p>Click a state to see Arcus-tracked laws, articles, and updates.</p>";
    return;
  }

  const filtered = entriesForState(stateName);

  if (filtered.length === 0) {
    const extra = selectedCategory
      ? `<p style="margin-top:8px;">Try switching Category back to <b>All</b>.</p>`
      : "";
    entriesEl.innerHTML =
      `<p>No published entries yet for this state${selectedCategory ? " in this category" : ""}.</p>` +
      extra;
    return;
  }

  filtered.sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));

  entriesEl.innerHTML = filtered
    .map((e) => {
      const safeTitle = e.Title || "(Untitled)";
      const safeSummary = e.Summary || "";
      const safeLink = e.Link || "#";
      const safeDate = e.Date ? `<div class="meta">${e.Date}</div>` : "";
      const safeCat = e.Category ? `<div class="meta">${e.Category}</div>` : "";

      return `
        <div class="entry">
          <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
          <div style="margin-top:6px;">${safeSummary}</div>
          ${safeDate}
          ${safeCat}
        </div>
      `;
    })
    .join("");
}

// --- Map highlighting ---
function computeActiveStates() {
  // states that have ANY published entry, optionally filtered by selectedCategory
  const set = new Set();
  for (const e of ALL_ENTRIES) {
    if (!isPublished(e)) continue;
    if (!matchesCategory(e)) continue;
    const st = (e.State || "").trim();
    if (st) set.add(norm(st));
  }
  return set; // normalized state names
}

function updateStateHighlights() {
  if (!map.getSource("states")) return;

  const active = computeActiveStates();

  // IMPORTANT: we stored each feature with id = idx.
  // We need to iterate features from the source to set feature-state.
  const feats = map.querySourceFeatures("states");
  for (const f of feats) {
    const id = f.id;
    if (id === undefined || id === null) continue;

    const name = (f.properties && (f.properties.NAME || f.properties.name)) || "";
    const hasData = active.has(norm(name));

    map.setFeatureState({ source: "states", id }, { hasData });
  }
}

map.on("load", async () => {
  // 1) Load entries from Airtable-backed API
  try {
    ALL_ENTRIES = await loadEntries();
  } catch (e) {
    console.error("Failed to load /api/entries", e);
    ALL_ENTRIES = [];
  }

  // 2) Setup dropdown
  setDropdownOptions();
  const categorySel = document.getElementById("categoryFilter");
  if (categorySel) {
    categorySel.addEventListener("change", () => {
      selectedCategory = categorySel.value || "";
      updateStateHighlights();
      renderEntries(selectedStateName);
    });
  }

  // 3) Initial sidebar
  renderEntries(null);

  // 4) Load states GeoJSON from your repo
  const states = await fetch("/data/us-states.geojson").then((r) => r.json());
  states.features.forEach((f, idx) => {
    f.id = idx;
  });

  map.addSource("states", {
    type: "geojson",
    data: states,
  });

  // 5) Layers with highlight logic: selected > hover > hasData > default
  map.addLayer({
    id: "states-fill",
    type: "fill",
    source: "states",
    paint: {
      "fill-color": [
        "case",
        ["boolean", ["feature-state", "selected"], false],
        "#111827",
        ["boolean", ["feature-state", "hover"], false],
        "#374151",
        ["boolean", ["feature-state", "hasData"], false],
        "#93c5fd", // highlighted states (light blue)
        "#d1d5db",
      ],
      "fill-opacity": 0.40,
    },
  });

  map.addLayer({
    id: "states-outline",
    type: "line",
    source: "states",
    paint: {
      "line-color": "#9ca3af",
      "line-width": 1,
    },
  });

  // Set initial highlights
  updateStateHighlights();

  map.on("mousemove", "states-fill", (e) => {
    map.getCanvas().style.cursor = "pointer";
    if (!e.features || !e.features.length) return;

    const f = e.features[0];
    const id = f.id;

    if (hoveredId !== null && hoveredId !== id) {
      map.setFeatureState({ source: "states", id: hoveredId }, { hover: false });
    }

    hoveredId = id;
    map.setFeatureState({ source: "states", id: hoveredId }, { hover: true });
  });

  map.on("mouseleave", "states-fill", () => {
    map.getCanvas().style.cursor = "";
    if (hoveredId !== null) {
      map.setFeatureState({ source: "states", id: hoveredId }, { hover: false });
    }
    hoveredId = null;
  });

  map.on("click", "states-fill", (e) => {
    if (!e.features || !e.features.length) return;
    const f = e.features[0];

    const stateName =
      (f.properties && (f.properties.NAME || f.properties.name)) || null;

    // Clear prior selection
    if (selectedId !== null) {
      map.setFeatureState({ source: "states", id: selectedId }, { selected: false });
    }

    selectedId = f.id;
    map.setFeatureState({ source: "states", id: selectedId }, { selected: true });

    selectedStateName = stateName;
    renderEntries(selectedStateName);
  });
});

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
let sortOrder = "desc";    // desc=newest
let searchQuery = "";      // text search

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

function allFilteredEntries() {
  return ALL_ENTRIES
    .filter(isPublished)
    .filter(matchesCategory)
    .filter(matchesSearch);
}

function entriesForState(stateName) {
  return allFilteredEntries().filter((e) => norm(e.State) === norm(stateName));
}

function updateStats() {
  const statStates = document.getElementById("statStates");
  const statEntries = document.getElementById("statEntries");
  if (!statStates || !statEntries) return;

  const filtered = allFilteredEntries();
  const statesSet = new Set(filtered.map((e) => norm(e.State)).filter(Boolean));

  statStates.textContent = `${statesSet.size}`;
  statEntries.textContent = `${filtered.length}`;
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

  let filtered = entriesForState(stateName);

  if (filtered.length === 0) {
    const hints = [];
    if (selectedCategory) hints.push("switch Category back to All");
    if (searchQuery) hints.push("clear the search box");
    const hintText = hints.length
      ? `<p style="margin-top:8px;">Try: <b>${hints.join("</b> or <b>")}</b>.</p>`
      : "";
    entriesEl.innerHTML =
      `<p>No published entries found for this state with the current filters.</p>${hintText}`;
    return;
  }

  filtered.sort((a, b) => (a.Date || "").localeCompare(b.Date || ""));
  if (sortOrder === "desc") filtered.reverse();

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

// --- Map intensity highlighting ---
function computeStateCounts() {
  const counts = new Map(); // normalized state -> count
  for (const e of allFilteredEntries()) {
    const st = norm(e.State);
    if (!st) continue;
    counts.set(st, (counts.get(st) || 0) + 1);
  }
  return counts;
}

function updateStateHighlights() {
  if (!map.getSource("states")) return;

  const counts = computeStateCounts();
  const feats = map.querySourceFeatures("states");

  for (const f of feats) {
    const id = f.id;
    if (id === undefined || id === null) continue;

    const name = (f.properties && (f.properties.NAME || f.properties.name)) || "";
    const c = counts.get(norm(name)) || 0;

    // Bucket counts to keep visuals simple
    let level = 0; // 0 = none
    if (c >= 1 && c <= 1) level = 1;
    else if (c >= 2 && c <= 3) level = 2;
    else if (c >= 4) level = 3;

    map.setFeatureState({ source: "states", id }, { countLevel: level });
  }
}

map.on("load", async () => {
  // 1) Load entries
  try {
    ALL_ENTRIES = await loadEntries();
  } catch (e) {
    console.error("Failed to load /api/entries", e);
    ALL_ENTRIES = [];
  }

  // 2) Hook UI controls
  setDropdownOptions();

  const categorySel = document.getElementById("categoryFilter");
  const sortSel = document.getElementById("sortOrder");
  const searchInput = document.getElementById("searchInput");

  if (categorySel) {
    categorySel.addEventListener("change", () => {
      selectedCategory = categorySel.value || "";
      updateStats();
      updateStateHighlights();
      renderEntries(selectedStateName);
    });
  }

  if (sortSel) {
    sortSel.addEventListener("change", () => {
      sortOrder = sortSel.value || "desc";
      renderEntries(selectedStateName);
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = (searchInput.value || "").trim().toLowerCase();
      updateStats();
      updateStateHighlights();
      renderEntries(selectedStateName);
    });
  }

  // 3) Initial sidebar + stats
  updateStats();
  renderEntries(null);

  // 4) Load states GeoJSON
  const states = await fetch("/data/us-states.geojson").then((r) => r.json());
  states.features.forEach((f, idx) => {
    f.id = idx;
  });

  map.addSource("states", {
    type: "geojson",
    data: states,
  });

  // 5) Layers: selected > hover > intensity > default
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

        // intensity buckets
        ["==", ["feature-state", "countLevel"], 3],
        "#60a5fa",
        ["==", ["feature-state", "countLevel"], 2],
        "#93c5fd",
        ["==", ["feature-state", "countLevel"], 1],
        "#bfdbfe",

        "#d1d5db"
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

  // initial highlights
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

mapboxgl.accessToken = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg";

// If /api/entries works, this will pull Airtable data.
// If it fails for any reason, we'll show nothing until it's fixed.
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

function renderEntries(stateName) {
  const regionTitle = document.getElementById("region-title");
  const entriesEl = document.getElementById("entries");

  regionTitle.textContent = stateName ? stateName : "Select a State";

  if (!stateName) {
    entriesEl.innerHTML =
      "<p>Click a state to see Arcus-tracked laws, articles, and updates.</p>";
    return;
  }

  const filtered = ALL_ENTRIES
    .filter((e) => (e.Status || "").toLowerCase() === "published")
    .filter((e) => (e.State || "").trim().toLowerCase() === stateName.trim().toLowerCase());

  if (filtered.length === 0) {
    entriesEl.innerHTML =
      "<p>No published entries yet for this state. Add one in Airtable and publish it.</p>";
    return;
  }

  filtered.sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));

  entriesEl.innerHTML = filtered
    .map((e) => {
      const safeTitle = e.Title || "(Untitled)";
      const safeSummary = e.Summary || "";
      const safeLink = e.Link || "#";
     const safeDate = e.Date
  ? `<div class="meta">${e.Date}</div>`
  : "";
      return `
        <div class="entry">
          <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeTitle}</a>
          <div style="margin-top:6px;">${safeSummary}</div>
          ${safeDate}
        </div>
      `;
    })
    .join("");
}

map.on("load", async () => {
  // Load Airtable entries
  try {
    ALL_ENTRIES = await loadEntries();
  } catch (e) {
    console.error("Failed to load /api/entries", e);
    ALL_ENTRIES = [];
  }

  renderEntries(null);

  // Load states GeoJSON from your own repo (reliable)
  const states = await fetch("/data/us-states.geojson").then((r) => r.json());

  // Give each feature a stable id (needed for hover/selected)
  states.features.forEach((f, idx) => {
    f.id = idx;
  });

  map.addSource("states", {
    type: "geojson",
    data: states,
  });

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
        "#d1d5db",
      ],
      "fill-opacity": 0.35,
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

    // This GeoJSON uses NAME for the state name
    const stateName = (f.properties && (f.properties.NAME || f.properties.name)) || null;

    // Clear previous selection
    if (selectedId !== null) {
      map.setFeatureState({ source: "states", id: selectedId }, { selected: false });
    }

    selectedId = f.id;
    map.setFeatureState({ source: "states", id: selectedId }, { selected: true });

    renderEntries(stateName);
  });
});

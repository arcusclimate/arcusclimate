mapboxgl.accessToken = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg";

// Sample entries for now
const SAMPLE_ENTRIES = [
  {
    Title: "Virginia Data Center Moratorium Proposal",
    Summary:
      "Proposed legislation evaluating groundwater and grid impacts of hyperscale facilities.",
    Link: "https://example.com",
    Date: "2026-03-03",
    State: "Virginia",
    Status: "Published",
  },
];

async function loadEntries() {
  try {
    const res = await fetch("/api/entries");
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : SAMPLE_ENTRIES;
  } catch (e) {
    console.warn("Using SAMPLE_ENTRIES (API not set up yet).", e);
    return SAMPLE_ENTRIES;
  }
}

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [-98.5, 39.8],
  zoom: 3.4,
});

map.addControl(new mapboxgl.NavigationControl(), "top-right");

let ALL_ENTRIES = [];

function renderEntries(stateName) {
  const regionTitle = document.getElementById("region-title");
  const entriesEl = document.getElementById("entries");

  regionTitle.textContent = stateName ? stateName : "Select a State";

  const filtered = !stateName
    ? []
    : ALL_ENTRIES.filter(
        (e) =>
          (e.Status || "").toLowerCase() === "published" &&
          (e.State || "").toLowerCase() === stateName.toLowerCase()
      );

  if (!stateName) {
    entriesEl.innerHTML =
      "<p>Click a state to see Arcus-tracked laws, articles, and updates.</p>";
    return;
  }

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
        ? `<div style="opacity:.7;font-size:12px;margin-top:6px;">${e.Date}</div>`
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
  ALL_ENTRIES = await loadEntries();
  renderEntries(null);

  // Add Mapbox's US states boundary tileset
  map.addSource("states", {
    type: "vector",
    url: "mapbox://mapbox.boundaries-adm1-v3",
  });

  // Fill layer (only USA)
  map.addLayer({
    id: "states-fill",
    type: "fill",
    source: "states",
    "source-layer": "boundaries_admin_1",
    filter: ["==", ["get", "iso_3166_1"], "US"],
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

  // Outline layer
  map.addLayer({
    id: "states-outline",
    type: "line",
    source: "states",
    "source-layer": "boundaries_admin_1",
    filter: ["==", ["get", "iso_3166_1"], "US"],
    paint: {
      "line-color": "#9ca3af",
      "line-width": 1,
    },
  });

  let hoveredId = null;

  map.on("mousemove", "states-fill", (e) => {
    map.getCanvas().style.cursor = "pointer";
    if (!e.features || !e.features.length) return;

    const f = e.features[0];
    const id = f.id;

    if (hoveredId !== null && hoveredId !== id) {
      map.setFeatureState(
        { source: "states", sourceLayer: "boundaries_admin_1", id: hoveredId },
        { hover: false }
      );
    }

    hoveredId = id;
    map.setFeatureState(
      { source: "states", sourceLayer: "boundaries_admin_1", id: hoveredId },
      { hover: true }
    );
  });

  map.on("mouseleave", "states-fill", () => {
    map.getCanvas().style.cursor = "";
    if (hoveredId !== null) {
      map.setFeatureState(
        { source: "states", sourceLayer: "boundaries_admin_1", id: hoveredId },
        { hover: false }
      );
    }
    hoveredId = null;
  });

  map.on("click", "states-fill", (e) => {
    if (!e.features || !e.features.length) return;
    const f = e.features[0];

    // Mapbox boundaries include the state name in "name_en" (usually)
    const stateName = f.properties && (f.properties.name_en || f.properties.name)
      ? (f.properties.name_en || f.properties.name)
      : null;

    // Clear previous selection (simple approach: just clear the last selected if we tracked it)
    // We'll store selectedId on window for simplicity.
    if (window.__selectedStateId != null) {
      map.setFeatureState(
        { source: "states", sourceLayer: "boundaries_admin_1", id: window.__selectedStateId },
        { selected: false }
      );
    }

    window.__selectedStateId = f.id;

    map.setFeatureState(
      { source: "states", sourceLayer: "boundaries_admin_1", id: window.__selectedStateId },
      { selected: true }
    );

    renderEntries(stateName);
  });
});

mapboxgl.accessToken = "pk.eyJ1IjoiYXJjdXNjbGltYXRlIiwiYSI6ImNtbWIzZTEydDBsdHIycW9ta2xtdGo3MWQifQ.KJVIx3qLHGebjYYAkuHRQg";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [-98.5, 39.8],
  zoom: 3.4,
});

map.addControl(new mapboxgl.NavigationControl(), "top-right");

let viewMode = "state";

map.on("load", async () => {

  // -------------------
  // LOAD STATES
  // -------------------
  const states = await fetch("/data/us-states.geojson").then(r => r.json());
  states.features.forEach((f, i) => f.id = i);

  map.addSource("states", { type: "geojson", data: states });

  map.addLayer({
    id: "states-fill",
    type: "fill",
    source: "states",
    paint: {
      "fill-color": "#cbd5e1",
      "fill-opacity": 0.5
    }
  });

  map.addLayer({
    id: "states-outline",
    type: "line",
    source: "states",
    paint: {
      "line-color": "#64748b",
      "line-width": 1
    }
  });

  // -------------------
  // LOAD ISO FROM MAPBOX TILESET
  // -------------------
map.addSource("iso", {
  type: "vector",
  url: "mapbox://arcusclimate.7zboucdg",
});

// Polygon fill (only draws if features are polygons)
map.addLayer({
  id: "iso-fill",
  type: "fill",
  source: "iso",
  "source-layer": "iso-rto-bcdqwz",
  filter: ["==", ["geometry-type"], "Polygon"],
  paint: {
    "fill-color": "#93c5fd",
    "fill-opacity": 0.35,
  },
});

// Line outline (draws polygon borders OR line features)
map.addLayer({
  id: "iso-line",
  type: "line",
  source: "iso",
  "source-layer": "iso-rto-bcdqwz",
  paint: {
    "line-color": "#1e3a8a",
    "line-width": 2,
  },
});

// Points (only draws if features are points)
map.addLayer({
  id: "iso-point",
  type: "circle",
  source: "iso",
  "source-layer": "iso-rto-bcdqwz",
  filter: ["==", ["geometry-type"], "Point"],
  paint: {
    "circle-radius": 5,
    "circle-color": "#ef4444",
    "circle-stroke-color": "#7f1d1d",
    "circle-stroke-width": 1,
  },
});

// Start with ISO hidden (if you're using a toggle)
map.setLayoutProperty("iso-fill", "visibility", "visible");
map.setLayoutProperty("iso-line", "visibility", "visible");
map.setLayoutProperty("iso-point", "visibility", "visible");

  // -------------------
  // DROPDOWN TOGGLE
  // -------------------
  const viewSel = document.getElementById("viewMode");

  if (viewSel) {
    viewSel.addEventListener("change", () => {
      viewMode = viewSel.value;

      if (viewMode === "state") {
        map.setLayoutProperty("states-fill", "visibility", "visible");
        map.setLayoutProperty("states-outline", "visibility", "visible");

        map.setLayoutProperty("iso-fill", "visibility", "none");
        map.setLayoutProperty("iso-outline", "visibility", "none");
      } else {
        map.setLayoutProperty("states-fill", "visibility", "none");
        map.setLayoutProperty("states-outline", "visibility", "none");

        map.setLayoutProperty("iso-fill", "visibility", "visible");
        map.setLayoutProperty("iso-outline", "visibility", "visible");
      }
    });
  }

});

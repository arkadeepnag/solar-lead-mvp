# Prabha Leh — live OSM rooftop extraction

This version does **not** load the old synthetic cadastral/lead GeoJSON. On startup the MapLibre map asks the OpenStreetMap Overpass API for the current viewport's mapped building footprints and any `boundary=parcel` features. Rooftop candidates are generated from the live OSM building geometry and measured with Turf.js.

Important: OpenStreetMap is not an authoritative cadastral registry. OSM itself does not generally maintain legal parcel boundaries. Therefore the app deliberately labels OSM building polygons as **roof candidates**, not legal cadastral parcels. For production/legal parcel intelligence in Leh, use the official Ladakh Land Records GIS data as the cadastral source and overlay it on this same MapLibre map.

## Run

```bash
npm install
npm run dev
```

The browser needs network access to OpenFreeMap for the basemap and an Overpass API instance for live OSM extraction.

The solar-resource grid remains a modeled demo layer; the parcel/building geometry is live OSM-derived.

## Sources
- OpenStreetMap / Overpass API
- Ladakh Land Records Web GIS: https://landrecords.ladakh.gov.in/
- MapLibre GL JS
- Turf.js
- SunCalc


## v10 live-map updates
- Search removed from the UI.
- Map is constrained to the Leh demo territory and refreshes live OSM/Overpass buildings/parcels as the viewport moves.
- The existing MapLibre 3D extrusion path is preserved.
- Solar heatmap remains visible in both 2D and 3D; it combines the modeled solar grid with live OSM roof-centroid opportunity points. MapLibre supports native heatmap layers and fill-extrusion layers.
- Every live OSM building receives a SunCalc-projected shadow polygon using the mapped/inferred building height.
- Selected rooftops can be focused directly in 3D with the 3D FOCUS control.
- The detail panel now exposes LPDD/DISCOM, modeled sanctioned kVA, tariff category and FY26-27 reference tariff fields. LPDD's 2026 tariff proposal is used only as a reference in the demo; the final JERC tariff order was issued on 18 Aug 2026, so production quoting should consume the final tariff schedule.
- WhatsApp qualification is an automatic front-end simulation with ownership, sanctioned kVA, last-three-bills and roof-photo steps, followed by qualification/dispatch. A real WhatsApp Cloud API requires a backend/webhook and credentials.

## v11 Apple/Tesla UI + 3D/heatmap fixes
- Search UI removed.
- Refined white, minimal Apple/Tesla-style visual system with restrained monochrome + lime accent.
- Native MapLibre heatmap is kept on the ground plane in 3D; the duplicate top heatmap is hidden while 3D is active so it no longer paints over building facades.
- Added a 2D building footprint layer and a low-profile 3D cadastral/massing layer for extracted parcel geometry.
- Every OSM building gets a robust parsed height from `height`, `building:levels`, or an explicit fallback; this fixes missing extrusions caused by values such as `12 m` not parsing with `Number()`.
- Every building receives a SunCalc-projected ground shadow that updates with the sun slider.
- Solar yield SVG was upgraded from a sparkline into a proper chart with grid, y-axis, monthly x-axis, area fill and data points; monthly values are normalized to the annual-generation total.


## v13.1 reliability pass
- Map sources and 3D/cadastral layers are created before Overpass returns, so slow live extraction no longer blocks the renderer.
- 3D mode uses a deterministic camera (`jumpTo`/`setPitch`/`setBearing`) and `map.resize()` after mode changes.
- Parcel outlines remain visible in both 2D and 3D; building footprints are an explicit OSM parcel proxy when parcel boundaries are absent.
- Live viewport requests use sequence guards so an older Overpass response cannot overwrite a newer viewport.
- The map now exposes an explicit loading/error state instead of looking like a broken blank 3D view.

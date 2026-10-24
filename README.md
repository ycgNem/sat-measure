# Sat Measure

Satellite measuring tool for quoting driveways, sidewalks, patios, parking lots and other flatwork.

## Use it

- **Online:** https://ycgnem.github.io/sat-measure/ (redeploys on every push to `main`).
- **Without installing anything:** run `npm run build`, then open `dist/index.html` in Chrome or Edge.
- **Dev server:** `npm install`, then `npm run dev` and open http://localhost:5180.

1. Search the address (or paste `lat, lng`), zoom in.
2. **Area** (key `A`): click each corner. Click the first corner, press Enter, or double-click to close.
3. **Line** (key `L`): for curbs, fences, edging. Priced per linear foot.
4. Drag white corners to adjust, drag the small midpoint dots to add a corner, right-click (long-press on a phone) a corner to remove it.
5. Tick **Subtract** (or name it "Exclude: …") to cut out planters, islands or buildings.
6. Set $/sq ft, $/ft and a minimum charge; the estimate updates live. **Copy summary** puts a text quote on the clipboard; **Print / PDF** prints the map and breakdown.

Jobs save automatically in the browser on that device.

## Accuracy

Areas use the WGS84 ellipsoid on a local projection (error well under 0.1% for job-sized shapes). Real-world accuracy depends on the imagery: clicking within a pixel or two of the true edge is typical, and building roofs are offset by lean in the photo, so trace ground-level edges. Checked against a soccer center circle (60 ft): measured 59.7 ft.

Imagery: Esri World Imagery. Address search: OpenStreetMap Nominatim.

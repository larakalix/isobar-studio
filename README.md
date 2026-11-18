# Isobar Studio

Generate flowing contour artwork with Astro, TypeScript, and Tailwind CSS.

## Run locally

Requires Node.js 22.23.4 or newer.

```sh
npm ci
npm run dev
```

Use `npm run check` to check the source and `npm run build` to generate the static site in `dist/`. Serve the build locally with `npm run preview`.

## Generate a pattern

- Select **New pattern** to generate a new field and use **Density** to change the number of contour levels.
- Open **Sculpt**, choose **Peak** or **Valley**, and click or tap the canvas to place a point. Drag its marker to move it, then use **Radius** and **Strength** to adjust it. **Preview 3D** shows the sculpted terrain, and **Done** hides the editing controls. Use **Undo** or `Ctrl/⌘+Z` to reverse an edit. Shared links, SVGs, and loops capture your edits. **New pattern** starts a fresh composition.
- The generator opens with **Topographic**. Open **Shape** to switch to Flow or Valleys and adjust the scale and bend of generated contours. Each variant has a starting palette. Custom Style adjustments carry across when you switch.
- Under **Shape → View**, choose **Flat**, **3D** for edge-to-edge terrain, or **Kaleidoscope** for radial symmetry. SVG downloads use the visible framing, and copied links capture the selected view. Transparent 3D SVGs keep the contours and translucent slope shading.
- Select **Animate** to evolve the pattern, then **Static** to freeze the current frame. **Export SVG** downloads the visible composition as a still image.
- Select **Export loop** and choose 8, 16, 32, or 64 seconds to download one seamless animation cycle from the current frame. The video matches the preview framing at 30 fps. The browser exports MP4 when H.264 encoding is available and WebM when VP9 or VP8 encoding is available. Loop export is available for generated patterns.
- Open **Style** to adjust line weight, line color, contrast, and background color. Custom line colors stay fixed as the background changes. **Auto** adapts line colors to the background using the Contrast slider. **Transparent SVG** exports the contours with a transparent background.
- Open **Style → Major contours** to choose how often an emphasized line appears and how much extra stroke weight it gets. Turn emphasis off for uniform line styling.
- Open **Style → Palettes** to apply a suggested background and line-color pair. You can edit either color afterward, and copied pattern links and SVG downloads capture the colors you see.
- **Copy link** saves a generated pattern, its current frame, and its settings in a URL. Opening the link restores the frame in **Static** mode.
- Choose **Import → Image to Isobars** to draw contours around a logo or silhouette. Use a PNG, SVG, JPG, or WebP up to 12 MB with transparency or a contrasting background. **Shape** opens with Flat and 3D previews, smoothing, an elevation invert toggle, and a crop you can drag or adjust with the edge sliders. **Export SVG** downloads the contours in the selected view. Images are processed in the browser.
- Choose **Import → Choose CSV** to draw a static pattern from pressure readings. Include the header `x,y,pressure` and one reading in hPa for every cell in a rectangular grid of at least 2 × 2. Coordinates may be unevenly spaced and rows can appear in any order. The app accepts files up to 1 MB with up to 16,000 readings. [Download an example CSV](public/example-pressure.csv).

The app computes contours with D3's marching squares algorithm. Pattern generation, animation, CSV processing, and SVG export run in the browser.

## Palette sources

The presets use published tokens from [21st.dev Community Themes](https://21st.dev/community/themes).

| Palette | Background token | Line token | Source |
| --- | --- | --- | --- |
| Zen Linen | Light background `#E9E4D8` | Light muted foreground `#5E5A52` | [Zen Linen](https://21st.dev/@serafimcloud/themes/zen-linen) |
| Sage Garden | Light secondary `#CED4BF` | Dark accent `#36443A` | [Sage Garden](https://21st.dev/@serafimcloud/themes/sage-garden) |
| Azure Mono | Light background `#FCFCFC` | Light primary `#2E67FF` | [Azure Mono](https://21st.dev/@serafimcloud/themes/azure-mono) |
| Catppuccin | Dark background `#181825` | Dark primary `#CBA6F7` | [Catppuccin](https://21st.dev/@serafimcloud/themes/catppuccin) |
| Solar Dusk | Dark background `#1C1917` | Dark primary `#F97316` | [Solar Dusk](https://21st.dev/@serafimcloud/themes/solar-dusk) |
| Vintage Paper | Dark background `#2D2621` | Dark primary `#C0A080` | [Vintage Paper](https://21st.dev/@serafimcloud/themes/vintage-paper) |
| Lime Frost | Dark background `#020617` | Dark primary `#AFF33E` | [Lime Frost](https://21st.dev/@serafimcloud/themes/lime-frost) |
| Elegant Luxury | Light background `#FAF7F5` | Light primary `#9B2C2C` | [Elegant Luxury](https://21st.dev/@serafimcloud/themes/elegant-luxury) |
| Supabase | Dark background `#121212` | Dark ring `#4ADE80` | [Supabase](https://21st.dev/@serafimcloud/themes/supabase) |
| Graphite Mono | Dark background `#171717` | Dark primary `#E5E5E5` | [Graphite Mono](https://21st.dev/@serafimcloud/themes/graphite-mono) |

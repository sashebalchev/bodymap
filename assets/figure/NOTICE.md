# Figure assets: sources, licences, changes

`front.svg` and `back.svg` are modified copies of one Wikimedia Commons drawing.
They are licensed under **CC BY-SA 4.0** (share-alike). Anyone who receives these two files, modified or not, gets them under the same licence. The rest of the bodymap code is a separate work and is not covered by this licence. Whether embedding the figure in a rendered picture or in the app screen makes that whole picture an "adaptation" is a legal reading nobody has checked. Take advice before relicensing or selling the app.

## Source

| Item | Value |
| --- | --- |
| File page | https://commons.wikimedia.org/wiki/File:Muscles_front_and_back.svg |
| File downloaded | https://upload.wikimedia.org/wikipedia/commons/e/ef/Muscles_front_and_back.svg (2026-11-27, sha256 56aae1c8068df6bcbbaec2faf074df82581d997afc5bd45912efc555b624e5f3) |
| Licence | Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/ |
| Author line on the file page | OpenStax and Tomas Kebert (user Nefronus) and umimeto.org |
| Provenance (file page text) | Original drawing by OpenStax (`File:1105_Anterior_and_Posterior_Views_of_Muscles.jpg`, listed on Commons as CC BY 4.0), manually redrawn and modified, especially the back view, by Tomas Kebert and umimeto.org |

The licence was read from the Commons API (`LicenseShortName`) and from the file page wikitext (`{{self|cc-by-sa-4.0}}`). It was not checked against the OpenStax book itself.

## What was changed (all by this project)

- Split the one sheet (front and back side by side) into two files and kept only the muscle drawing of each view.
- Fitted both views into the same viewBox `0 0 400 900` with one shared scale (about 2.04 times the source units) and one shared baseline, so the proportions match. Each view is centred on its own bounding box. Margin is 12 units left and right.
- Recoloured to a cool slate palette for a dark background (muscle mid slate, tendon light grey-blue, outlines dark slate). The source uses salmon and brown.
- Removed the source head. The face, skull cap, ears and chin skin are gone; everything above the lower jaw is clipped away. A plain egg-shaped head with ears and a short neck, drawn for this project, replaces them. The source neck muscles below the jaw are kept.
- Removed Inkscape and Sodipodi data, the RDF metadata block, unused gradients and path effects, and style properties the renderer does not need. Removed `<use>` references whose target was deleted.
- Prefixed every id with `f-` or `b-` so both figures can sit in one document without id clashes.
- Dropped the fixed width and height. The root keeps only the viewBox.

No raster data, scripts, fonts, filters or external references are in the files (checked by a script: well-formed XML, no `<script>`, `<image>`, `<filter>`, `<text>`, no non-fragment href or url()).

## Attribution text for the app's About screen

> Body figures: "Muscles front and back" by OpenStax and Tomas Kebert / umimeto.org, CC BY-SA 4.0, recoloured and edited.

Link target for that line: https://commons.wikimedia.org/wiki/File:Muscles_front_and_back.svg
Licence link: https://creativecommons.org/licenses/by-sa/4.0/

## Previews

`preview-front.png` and `preview-back.png` are rendered with the project's own resvg (`@resvg/resvg-wasm` 2.6.2) at 800 px wide on #0f1115. They are regenerated output of the two SVGs, under the same licence.

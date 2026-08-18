<!-- generated-by: groundrules v1.10.0 -->
# docs/media/ — Visual assets

Images, mockups, screenshots, videos, audio, diagrams — anything binary and visual.

## Conventions

- Organize by topic or feature (subfolders) as volume grows.
- Explicit names with date when relevant: `2026-05-11-onboarding-wireframe.png`.
- Prefer SVG or WebP for the web (smaller size).
- For diagrams: keep the editable source (`.excalidraw`, `.drawio`, `.fig`) next to the export.

## Avoid here

- Temporary debug screenshots → put them in `.gitignore` or delete after use.
- Heavy videos (>10 MB) → use Git LFS or external hosting.

## Specific to this project

**Never commit a screenshot of a real Nightscout instance.** It carries glucose history and
often the site URL; the URL frequently carries a token in its query string. If a visual is
needed to illustrate something, redraw it or use fabricated values.

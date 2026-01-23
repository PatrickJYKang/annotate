# Football Analysis Annotator (Web PWA) – Documentation Only

This repository currently contains the documentation for a web-based Progressive Web App (PWA) annotator for football analysis. The MVP is stills-first, with a path to video overlays using ffmpeg.wasm as a fallback for VFR/unsupported codecs.

Implementation is gated by a phase described in `MVP_Implementation_Plan.md`. No code will be added until sign-off.

## Contents
- `technical_document.md` – High-level architecture/design for the Web PWA
- `MVP_Implementation_Plan.md` – Detailed MVP plan, scope, milestones, dependencies, and risks

## Next steps (post sign-off)
- Begin M0 bootstrap per `MVP_Implementation_Plan.md` (initialize Next.js, PWA scaffold)
- Implement media playback and canvas capture with ffmpeg.wasm fallback
- Build annotation canvas and sidecar persistence
- Implement export (PNG/CSV/JSON/ZIP)

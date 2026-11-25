# Documentation Index

The implementation is authoritative. Reviewed 2026-11-24. Documentation is split into current references and historical planning records so older terminology is not mistaken for the current project.v2 product model. Development targets 0.2.4; package manifests still read 0.2.3-rc.1 and public installers remain desktop.2.

## Current references

- [User guide](../USER_GUIDE.md) — installation, project setup, capture, editing, tracking, homography, pins, presentations, export, shortcuts, and troubleshooting.
- [As-built technical reference](../technical_document.md) — current routes, storage, workflows, sidecar boundaries, and release limitations.
- [0.2.4 development status](../desktop/releases/0.2.4.md) — current additions, test evidence, limitations and the remaining release gates.
- [Annotate 0.2 scope](v0.2/v0.2-scope.md) — the original implemented product boundary, with pointers to later amendments.
- [Project v2 schema and migration decisions](v0.2/project-v2-schema-and-migration.md) — the locked frame-native on-disk and boundary contracts.
- [Annotate 0.2 implementation ledger](v0.2/implementation-plan.md) — completed implementation sequence, amendments, and verification evidence.
- [Desktop application direction](desktop-application-direction.md) — adopted post-0.2.2 and post-user-guide direction for a shared browser/Electron product, native window behavior, packaging, testing, and direct macOS distribution.
- [Python sidecar reference](../sidecar/README.md) — setup, endpoints, model discovery, and service behavior.
- [Desktop installation](../desktop/INSTALL-preview.md) and [desktop architecture/builds](../desktop/README.md) cover the currently distributed Mac and Windows previews and their verification limits.
- [Desktop implementation checklist](pre-electron-implementation-checklist.md) records completed work and remaining native release gates; development is on `main`.
- [Source development](../docs/development.md) describes the supported browser preview and test workflow.
- [Support](../docs/support.md), [versioning](../docs/versioning.md), [licence review](../docs/licence-review.md) and [distribution evidence](../docs/distribution-compliance.md) distinguish implemented safety/support work from final release approval.
- [Demo recording checklist](../docs/demo-recording-checklist.md) maps the current product workflows to the guide's video placeholders and focused tutorials.

The v0.2 plans preserve their implementation sequence and dated evidence. Their schema document includes the optional recording-field amendment. Later host behavior and release status are documented in the desktop references above; those plans are not a claim that older test counts or browser-only installation instructions describe today's build. The online guide belongs to the separate `annotate-docs` repository; changes here do not publish that website or replace its videos. Upstream licence texts, provenance records and archived build recipes are evidence, not prose to rewrite as current product instructions.

## Historical records

The files below preserve design rationale and implementation history. They are not specifications for the current application and may refer to removed marks, stills, periods, routes, prepared presentation media, or superseded storage.

- [Original MVP implementation plan](../MVP_Implementation_Plan.md)
- `D1_Project_Folder_Plan.md` through `D7_Export_Plan.md` — milestone plans for the original project.v1 application.
- `post-mvp/analysis-model/` — the earlier clip/still relationship model.
- `post-mvp/clips/` — the original clip implementation and CV integration planning trail.
- `post-mvp/metadata/` — the original metadata-screen plan.
- `post-mvp/presentation-derived-media/` — prepared-media design retained only as historical/export-oriented context; interactive 0.2 playback uses source video directly.
- `post-mvp/presentations/` — the original presentation feature plan.
- `post-mvp/tagging/` — the pre-v2 tagging schema and redesign notes.
- `post-mvp/ui-refresh/` — visual redesign plans for the project.v1 routes.
- `may1.md` — dated development journal.

When a historical record conflicts with a current reference, use the current reference and the runtime types/tests.

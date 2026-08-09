# Documentation Index

The implementation is authoritative. Documentation is split into current
references and historical planning records so older terminology is not
mistaken for the Annotate 0.2 product model.

## Current references

- [As-built technical reference](../technical_document.md) — current routes,
  storage, workflows, sidecar boundaries, and release limitations.
- [Annotate 0.2 scope](v0.2/v0.2-scope.md) — the implemented product boundary
  and explicitly deferred work.
- [Project v2 schema and migration decisions](v0.2/project-v2-schema-and-migration.md)
  — the locked frame-native on-disk and boundary contracts.
- [Annotate 0.2 implementation ledger](v0.2/implementation-plan.md) — completed
  implementation sequence, amendments, and verification evidence.
- [Python sidecar reference](../sidecar/README.md) — setup, endpoints, model
  discovery, and service behavior.

## Historical records

The files below preserve design rationale and implementation history. They are
not specifications for the current application and may refer to removed marks,
stills, periods, routes, prepared presentation media, or superseded storage.

- [Original MVP implementation plan](../MVP_Implementation_Plan.md)
- `D1_Project_Folder_Plan.md` through `D7_Export_Plan.md` — milestone plans for
  the original project.v1 application.
- `post-mvp/analysis-model/` — the earlier clip/still relationship model.
- `post-mvp/clips/` — the original clip implementation and CV integration
  planning trail.
- `post-mvp/metadata/` — the original metadata-screen plan.
- `post-mvp/presentation-derived-media/` — prepared-media design retained only
  as historical/export-oriented context; interactive 0.2 playback uses source
  video directly.
- `post-mvp/presentations/` — the original presentation feature plan.
- `post-mvp/tagging/` — the pre-v2 tagging schema and redesign notes.
- `post-mvp/ui-refresh/` — visual redesign plans for the project.v1 routes.
- `may1.md` — dated development journal.

When a historical record conflicts with a current reference, use the current
reference and the runtime types/tests.

# Tagging schema (post-MVP)

> **Historical pre-v2 schema.** The YAML/dropdown model was removed. Current projects use the coordinate-based `tagging-board.json` contract documented in the [as-built reference](../../../technical_document.md#tagging-boardjson).

This folder defines a tagging taxonomy for marks/events.

## Design intent

You want:

- A **single primary selection** via dropdown where you can stop early.
  - Example: `Offensive > Open play > Cross` (stop here)
- Optional **extra traits** via multi-select (or small single-select pickers).
  - Example: `cross.type = whipped` AND `outcome = goal` AND `goal.method = header`

Crucially, you do **not** want to model this as a relational data application. That means:

- We avoid embedding “result/outcome” deep inside the event hierarchy.
- “Outcome” is treated as a **facet** (a tag) you may or may not add.

## Source of truth

The machine-readable schema is in:

- `webapp/public/tagging/schema.yaml`

`schema.md` is a human-readable explanation only. The UI loads the YAML directly.

## Data model (recommended)

Store tags on each event as:

- `primary`: a single selected node id from the `primary_tree`
- `facets`: zero-or-more selections keyed by facet group id

Example:

```json
{
  "primary": "offensive.open_play.cross",
  "facets": {
    "cross.type": "whipped",
    "cross.origin_depth": "byline",
    "outcome.general": "goal",
    "goal.method": "header"
  }
}
```

## How the UI should interpret `schema.yaml`

- **Primary dropdown**:
  - Render the `primary_tree` as a nested dropdown/tree selector.
  - Allow selection at any depth.

- **Facet controls**:
  - When a primary node is selected, show facet groups from:
    - the selected node
    - plus any ancestors (if you implement inheritance)
  - Each facet group has a `mode`:
    - `single`: choose at most one option
    - (later) `multi`: choose many

- **Conditional facets**:
  - Some facet groups include `requires_any` (e.g. `goal.method`).
  - Only show/enable those facet groups when the requirement is satisfied.
    - Example: only show `goal.method` when `outcome.*` is `goal`.

## Offensive vs Defensive

`schema.yaml` currently mirrors the same primary actions under both:

- `phase.offensive`
- `phase.defensive`

This keeps the UX consistent while you iterate. If later you decide defensive needs different primitives (e.g. “tackle”, “interception”, “block”), you can extend the defensive subtree without changing the overall model.

# Tagging page redesign

> **Historical redesign plan.** Use the [current capture reference](../../../technical_document.md#9-capture-and-tagging) for the fixed board and multi-lane timeline behavior.

## Goal

Replace the current marks-centric `/player` page with a new **tagging page** where tags are the centre of attention. Marks are organised into collapsible folders that mirror the `primary_tree` structure from the project's tagging schema, making it immediately obvious what has been tagged, what hasn't, and how the work is distributed across categories.

---

## Legacy UI preservation

The current `/player` page (`webapp/app/player/page.tsx`) must be preserved as-is in the codebase. It does **not** need to be reachable from navigation or toggleable from the new page — just kept as a file so we can fall back to it or reference it later.

Approach:
- Rename `webapp/app/player/page.tsx` → `webapp/app/player-legacy/page.tsx`.
- The new tagging page lives at `webapp/app/player/page.tsx` (same route, drop-in replacement).
- No UI toggle between old and new. The legacy page simply exists at `/player-legacy` if anyone needs it.

---

## New page layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Back                                              toolbar / nav │
├──────────────────────────────┬───────────────────────────────────┤
│                              │                                   │
│      Video player            │   Tag folder tree (scrollable)    │
│      (compact, fixed-ratio)  │                                   │
│                              │   ▸ Offensive                     │
│                              │     ▸ Open play                   │
│                              │       ▸ Cross  (3)                │
│                              │         0:12.340                  │
│                              │         0:45.120                  │
│                              │         1:02.800                  │
│                              │       ▸ Pass   (2)                │
│                              │       ▸ Take-on (1)               │
│                              │     ▸ Set piece                   │
│                              │   ▸ Defensive                     │
│                              │   ▾ Untagged   (5)                │
│                              │     0:03.200                      │
│                              │     0:08.900                      │
│                              │     ...                           │
│                              │   ▾ Unknown tag  (1)              │
│                              │     0:22.100  [stale.removed_id]  │
│                              │                                   │
├──────────────────────────────┴───────────────────────────────────┤
│  status bar / hotkey hints                                       │
└──────────────────────────────────────────────────────────────────┘
```

### Left pane — Video player
- Same `VideoPlayerUnit` component, same hotkeys (J/K/L, arrows, M, etc.).
- Possibly slightly smaller to give more room to the tag tree on the right.
- Mark dots still rendered on the seek bar.

### Right pane — Tag folder tree
- A scrollable tree view that mirrors `primary_tree` from the schema.
- Each node in the tree is a collapsible folder showing its label and a count of marks inside (recursively).
- Marks can live at **any depth** in the tree — a mark whose primary tag matches a mid-level node sits directly under that node, not inside a child.
- An **"Untagged"** bucket collects all marks with `primary = null`.
- An **"Unknown tag"** bucket collects marks whose `primary` value does not match any node in the current schema (e.g. the schema was edited and a node was removed). These marks display the raw tag id so the user can re-tag them.
- Clicking a mark timestamp selects it and seeks the video.
- Right-clicking a mark opens the existing `TaggingMenu` dropdown for re-tagging.
- Drag-and-drop of marks between folders is a future nice-to-have, not in scope now.

---

## Folder structure derivation

The folder tree is built from the schema's `primary_tree`. Each node becomes a folder. Marks are placed into folders by matching `mark.tags.primary` against the node `id`:

- `primary = "offensive.open_play.cross"` → **Cross** folder under **Offensive > Open play**.
- `primary = "offensive.open_play"` (stopped at a mid-level) → **Open play** folder directly (not into a child).
- `primary = null` → **Untagged**.
- `primary = "some.removed.id"` (no matching node) → **Unknown tag**.

Counts on parent folders are the sum of all descendants (recursive). The Untagged and Unknown tag buckets are always visible; other folders with zero marks may be shown collapsed or dimmed.

---

## Interaction design

### Selecting a mark
- Click a mark timestamp in the tree → selects it + seeks the video.
- The selected mark is highlighted in the tree.

### Tagging a mark
- Right-click a mark → opens `TaggingMenu` at cursor (same as today).
- On confirm, the mark moves to the appropriate folder in the tree (or stays if the primary didn't change).

### Hotkeys (preserved from legacy)
- **M** — add mark at current video time (appears in Untagged).
- **Delete / Backspace** — delete selected mark.
- **C** — clear tags on selected mark (moves it to Untagged).
- **⌘Z / Ctrl+Z** — undo.
- **⌘⇧Z / Ctrl+Shift+Z** — redo.
- **J/K/L, ←/→, ,/.** — video navigation (same as today).
- **⌘←/⌘→** — jump to prev/next mark.

### Bulk operations (future)
- Not in initial scope, but the folder structure naturally supports "select all marks in this folder" for future batch re-tagging or deletion.

---

## Component plan

### New components
1. **`webapp/components/tagging/TagFolderTree.tsx`**
   - Props: `schema: TaggingSchema`, `marks`, `selectedMarkId`, callbacks for select / context-menu / etc.
   - Renders the collapsible tree with mark counts and mark timestamps.
   - Pure presentation + interaction; no data fetching, no schema loading.
   - The schema is always passed in as a prop so the component is agnostic to where the schema came from (project file, context, future editor, etc.).

### Reused components
- **`VideoPlayerUnit`** — unchanged.
- **`TaggingMenu`** — unchanged (used as context menu). Already accepts `schema` as a prop (will be refactored to do so if it currently self-fetches).

### New page
- **`webapp/app/player/page.tsx`** — the new tagging page.
  - Reads schema from the project directory (see Per-project tagging schema below).
  - Holds schema in state and passes it down as a prop to `TagFolderTree` and `TaggingMenu`.
  - Same manifest/mark mutation logic as legacy (undo/redo, add, delete, clear, save).
  - Renders `VideoPlayerUnit` + `TagFolderTree` side-by-side.

---

## Data flow

```
<project>/tagging-schema.yaml ──read──► TaggingSchema (state in page)
                                              │
                                              ├──► TagFolderTree (prop)
                                              └──► TaggingMenu   (prop)
                                                       │
manifest.marks ──────────────────────────► TagFolderTree
                                           (groups marks by primary tag
                                            into schema-derived folders)
                                                       │
                                                click / right-click
                                                       │
                                                TaggingMenu (context menu)
                                                       │
                                                  on confirm
                                                       │
                                               mutateManifest (undo-aware)
```

---

## Per-project tagging schema

Currently `schema.yaml` lives at `webapp/public/tagging/schema.yaml` and is shared globally across every project. This needs to change so that **each project carries its own tagging schema**.

### Desired state
- The schema file lives inside the project directory at the well-known path `tagging-schema.yaml` (project root).
- When the project is opened, the app reads the schema from the project folder.
- All consumers (`TaggingMenu`, `TagFolderTree`, etc.) receive the schema as a prop — they never fetch or read it themselves. This keeps them decoupled from the storage mechanism and ready for future features (in-app schema editing, multiple schemas).

### Default schema
- The current `webapp/public/tagging/schema.yaml` becomes the **default template**.
- Its contents are embedded (or fetched once at app boot) so the app can write it into a project that doesn't have one yet.

### Backwards compatibility — existing projects without a schema

When the app opens a project and `tagging-schema.yaml` is **not found** in the project directory:

1. Show a one-time prompt: _"This project does not have a tagging schema. Add the default schema?"_ with **Add default** / **Cancel** actions.
2. On **Add default**: write the default template into `<project>/tagging-schema.yaml` and continue loading normally.
3. On **Cancel**: proceed without a schema — tagging features are disabled (greyed out tree, no right-click menu). The user can add a schema later.

This means every existing project seamlessly migrates on first open after the update, with the user's explicit consent before any file is written.

### New project creation

When creating a new project, **always** write the default `tagging-schema.yaml` into the project directory alongside `manifest.json`. No prompt needed — it's part of the standard project scaffold.

### What changes in code
- `fetchTaggingSchema()` in `webapp/lib/tagging/schema.ts`: replace with `readTaggingSchema(dir: FileSystemDirectoryHandle)` that reads from the project directory (similar to `readManifest`).
- New helper: `writeDefaultTaggingSchema(dir: FileSystemDirectoryHandle)` — writes the default template into a project folder.
- Project creation flow (home page): call `writeDefaultTaggingSchema` alongside `writeManifest` when scaffolding a new project.
- Project open flow: attempt to read `tagging-schema.yaml`; if missing, trigger the backwards-compat prompt described above.
- `webapp/public/tagging/schema.yaml` stays in the repo as the default template source but is no longer loaded at runtime for tagging.

### Design considerations for future features

The following are **not in scope now** but the architecture must not prevent them:

- **In-app schema editing**: Because consumers receive the schema as a prop, a future editor can modify the schema object in state and all components re-render with the new tree. The page would then write the updated schema back to the project file. No component needs to know about file I/O.

- **Multiple schemas per project**: The well-known filename (`tagging-schema.yaml`) can later become a list of schema files recorded in the manifest, or a directory of schemas. The page would select which schema to load and pass it down. Components remain unchanged because they only see a single `TaggingSchema` prop.

- **Schema versioning / migration**: The `version` field in the schema YAML is already present. If the schema format changes, `readTaggingSchema` can detect the version and migrate. Marks referencing removed nodes surface in the "Unknown tag" bucket, giving the user a clear path to re-tag.

---

## Implementation checklist

### 1. Per-project tagging schema
- [x] Add `readTaggingSchema(dir: FileSystemDirectoryHandle): Promise<TaggingSchema | null>` to `webapp/lib/tagging/schema.ts`.
- [x] Add `writeDefaultTaggingSchema(dir: FileSystemDirectoryHandle): Promise<void>` that writes the default template from `webapp/public/tagging/schema.yaml`.
- [x] Update project creation flow (home page) to call `writeDefaultTaggingSchema` when scaffolding a new project.
- [x] Add backwards-compat prompt on project open: detect missing `tagging-schema.yaml`, show "Add default" / "Cancel" dialog, write if accepted.
- [x] Refactor `TaggingMenu` to accept `schema: TaggingSchema` as a prop instead of self-fetching.
- [x] Remove runtime usage of `fetchTaggingSchema()` (keep function for reference / tests if needed).

### 2. Legacy UI preservation
- [x] Rename `webapp/app/player/page.tsx` → `webapp/app/player-legacy/page.tsx`.
- [x] Verify `/player-legacy` route works as a fallback (quick smoke test).

### 3. TagFolderTree component
- [x] Create `webapp/components/tagging/TagFolderTree.tsx`.
- [x] Props: `schema`, `marks`, `selectedMarkId`, `onSelectMark`, `onContextMenu`.
- [x] Build tree from `schema.primary_tree`; place marks by matching `mark.tags.primary` to node ids.
- [x] Add "Untagged" bucket for `primary = null`.
- [x] Add "Unknown tag" bucket for marks whose primary doesn't match any schema node (display raw id).
- [x] Recursive mark counts on parent folders.
- [x] Collapsible folder expand/collapse.
- [x] Highlight selected mark in the tree.

### 4. New `/player` (tagging) page
- [x] Create new `webapp/app/player/page.tsx`.
- [x] Read schema from project directory on mount; hold in state.
- [x] Render `VideoPlayerUnit` (left) + `TagFolderTree` (right) side-by-side.
- [x] Pass schema as a prop to `TagFolderTree` and `TaggingMenu`.
- [x] Wire mark click → select + seek video.
- [x] Wire mark right-click → open `TaggingMenu` at cursor.
- [x] Wire `TaggingMenu` confirm → save tag selection (undo-aware).

### 5. Hotkeys and mutation logic
- [x] Port `addMarkAt`, `deleteSelectedMark`, `clearTagsOnSelectedMark` from legacy.
- [x] Port undo/redo stacks and `pushUndo` logic.
- [x] Port all keyboard shortcuts: M, Delete/Backspace, C, ⌘Z, ⌘⇧Z, J/K/L, ←/→, ,/., ⌘←/⌘→.
- [x] Verify mark appears in "Untagged" on add, moves to correct folder on tag.

### 6. Visual polish
- [x] Folder expand/collapse animation (CSS transition or similar).
- [x] Dimmed/collapsed appearance for empty folders.
- [x] Mark count badges on folder labels.
- [x] Scroll selected mark into view in the tree.
- [x] Status bar / hotkey hints at the bottom.

---

## Out of scope (for now)

- Drag-and-drop marks between folders.
- Bulk select / batch operations.
- Facet sub-grouping in the tree (tree is primary-path only; facets stay in the dropdown).
- Inline facet editing in the tree (use the dropdown).
- Search / filter within the tree.
- In-app schema editing (design accommodates it; see above).
- Multiple schemas per project (design accommodates it; see above).

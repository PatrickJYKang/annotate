# Presentations Feature

## Goal

Add a new **presentations** feature and page after stills/clips where the user can build a deck-like sequence of analysis slides.

This is not a generic PowerPoint clone. The core idea is:

- A presentation is built from existing analysis assets.
- **Stills are the initial slide type.**
- Clips can come later, but are explicitly out of scope for the first pass.
- Assets are discovered through the existing **tagging tree**, with tags inherited from the underlying **mark**, not stored redundantly on stills/clips.
- Transitions between slides can optionally be the **literal match video** between the source timestamps of the two slides.

In practical terms:

1. Show still and its annotations.
2. Optionally hide annotations and play the underlying match video.
3. Stop at the next still timestamp.
4. Show the next still and its annotations.

---

## Why this should be a separate feature/page

This should be a **new page/feature**, not a mode inside the stills page.

Reasons:

- The stills/clips page is an **asset creation and management** surface.
- The presentations surface is a **narrative composition** tool.
- The data model is different: presentation order, transition rules, per-slide display options, presenter flow.
- The UI is different: slide strip, deck canvas, presenter preview, asset browser.

Recommended routes:

- `webapp/app/presentations/page.tsx`
  - Presentation list / create / duplicate / delete.
- `webapp/app/presentation/[presentationId]/page.tsx`
  - Main presentation editor / player.

This mirrors the existing pattern of list page + dedicated editor page.

---

## v1 scope

### In scope

- Create, rename, duplicate, delete presentations.
- Build a presentation from **stills** plus simple **title slides**.
- Browse candidate moments through a **tag-tree-driven mark browser**.
- Add linked stills into a slide deck from marks, or silently materialize a linked still when a mark does not already have one.
- Reorder slides.
- Choose per-transition behavior:
  - hard cut
  - match-video transition
- Choose per-slide display behavior:
  - show annotations
  - hide annotations
  - limited annotation entry / exit animation
  - title slide template selection
  - presenter notes
- Open an in-presentation overlay mark browser to retrieve tagged moments that are not already in the deck by seeking the presentation player to the selected mark.
- Play the presentation inside the app.
- Persist presentations to disk.

### Explicitly out of scope for v1

- Using clips as slide assets.
- Arbitrary text boxes / shapes independent of the source still annotation set.
- Cross-fades, wipes, animated transforms, zoom-pan camera moves.
- Export to `.pptx`.
- Full export-to-video pipeline for presentations.
- Collaborative editing.

---

## Core mental model

A presentation is an ordered list of **slides**.

In v1, each slide is either:

- a **still slide** that points to a still
- a **title slide** chosen from a very small set of templates

Each still already has:

- a source `videoId`
- a timestamp `t_ms`
- a still image file
- zero or more saved annotations

The presentation layer adds:

- ordering
- whether annotations are shown on that slide
- limited entry / exit timing for existing annotations
- title slide content / template choice
- presenter notes
- transition behavior into the next slide

So the presentation feature is mostly a **composition layer on top of stills + marks + annotation rendering + video playback**.

---

## Critical data-source rule: tags belong to marks, not stills/clips

The user requirement is important:

- tags are **not** stored in stills/clips
- stills/clips **inherit** tags from the corresponding mark

That means the presentation asset browser must derive grouping from:

`presentation asset -> source mark -> mark.tags`

### Consequence for stills

At the moment, stills in `ProjectManifestV1` only store:

- `id`
- `videoId`
- `t_ms`
- `file`
- dimensions

They do **not** store a link back to the source mark.

This is the main prerequisite gap for the presentation feature.

### Recommendation

Extend still metadata with a migration-safe source mark binding:

```ts
stills: {
  id: string;
  videoId: string;
  t_ms: number;
  file: string;
  width?: number;
  height?: number;
  sourceMarkId?: string | null;
}[]
```

Behavior:

- When a still is created, persist the selected or newly created `sourceMarkId`.
- If no mark is selected, still creation should require the user to create or select a mark first.
- The stored field can remain nullable for migration compatibility, but after project-open repair every usable still should resolve to a mark.
- On project open, all stills should be required to link to a mark. Existing projects therefore require a backfill / migration script that attempts to populate `sourceMarkId` from an exact `(videoId, t_ms)` mark match.
- In the presentation asset browser:
  - stills with a linked mark appear under the mark's tag path
  - stills whose source mark no longer exists should be surfaced as a repair state rather than treated as normal steady-state data

This keeps tags normalized while making inheritance practical.

### Mark timestamp invariant

This source-mark approach depends on a stricter mark invariant:

- within a given `videoId`, there cannot be two marks at the same `t_ms`
- still backfill and later still creation both rely on that uniqueness

The tagging / marks flow should therefore prevent duplicate timestamps per video, and the migration script should report or resolve collisions before backfilling `sourceMarkId`.

If a project opens and some stills still cannot be linked after backfill, the project should enter a repair flow for those stills rather than silently tolerating unlinked assets.

If the presentation flow silently creates a still for a mark that does not yet have one, that creation should be idempotent at the mark level: reuse an existing linked still when present, and only create a new canonical linked still when none exists.

### Consequence for clips later

Clips already carry `startMarkId` / `endMarkId`, but for presentation browsing we will likely want a single canonical source mark or source-tag anchor when clips are introduced.

That is deferred.

---

## Presentation playback model

The presentation is visualized like a slideshow, but the transition between adjacent slides can be backed by the real match video.

For slide `A` followed by slide `B`:

- `A` is shown as a still frame.
- If `A -> B` transition mode is `cut`, switch directly to `B`.
- If transition mode is `match_video`, do this:
  1. display slide `A`
  2. optionally pause for a configured dwell time
  3. hide annotations
  4. play the actual source video from `A.still.t_ms`
  5. stop at `B.still.t_ms`
  6. show slide `B`

### Mixed-video behavior

There is no reason to restrict a presentation to one source video.

Instead:

- the deck may contain slides from multiple videos
- `match_video` only applies when two adjacent still slides come from the same `videoId`
- if adjacent slides are from different videos, the transition must fall back to `cut`

---

## Transition modes

Each edge between slide `i` and slide `i+1` should have an explicit transition config.

```ts
type PresentationTransition =
  | {
      mode: 'cut';
    }
  | {
      mode: 'match_video';
      hideAnnotationsDuringPlayback: boolean;
      playbackRate?: number;
      startOffsetMs?: number;
      endOffsetMs?: number;
    };
```

### `cut`

Immediate switch to the next slide.

### `match_video`

Play the source video between adjacent source timestamps.

Notes:

- `match_video` is only valid for still-to-still edges.
- `hideAnnotationsDuringPlayback` should default to `true` because the requested behavior is:
  - show annotations/still
  - hide annotations and play video
  - stop video at next still
  - show annotations again
- `startOffsetMs` / `endOffsetMs` allow small trims later, but can be omitted in the first implementation.

### Default transition heuristic

The user should be free to change any edge manually, but the initial default should be:

- if two adjacent still slides are from the same `videoId` and their timestamp gap is less than or equal to `5000ms`, default that edge to `match_video`
- otherwise default that edge to `cut`
- any edge involving a title slide defaults to `cut`

This `5000ms` default can be made configurable later.

---

## Slide model

Each slide should be a small discriminated union rather than one generic canvas object.

```ts
type StillSlide = {
  id: string;
  kind: 'still';
  stillId: string;
  showAnnotations: boolean;
  notes?: string;
  holdMs?: number;
  annotationCues?: {
    annotationId: string;
    enterAtMs?: number;
    exitAtMs?: number;
  }[];
};

type TitleSlide = {
  id: string;
  kind: 'title';
  template: 'title' | 'section' | 'divider';
  title: string;
  body?: string;
  notes?: string;
  holdMs?: number;
};

type PresentationSlide = StillSlide | TitleSlide;
```

Notes:

- `showAnnotations` defaults to `true`.
- Still slides do **not** get free-form text overlays or arbitrary layout editing.
- `annotationCues` are intentionally limited to entry / exit timing of existing annotations, not geometry overrides.
- Title slides are templated and intentionally narrow in scope; this feature is not a general-purpose canvas editor.
- `holdMs` can control how long the slide remains up before auto-advancing in presenter mode.

---

## Presentation data model

Recommended storage: `presentations/*.json`, discovered by directory listing just like clips.

Do **not** add presentations into `manifest.json` as embedded blobs.

Reasoning:

- same scalability argument as clips
- avoids manifest bloat
- easier duplicate/export/delete flow
- clean separation between project inventory and authored decks

Suggested schema:

```ts
export const PRESENTATION_SCHEMA_VERSION = 1;

export interface Presentation {
  schema: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  slides: PresentationSlide[];
  transitions: PresentationTransition[]; // length = max(0, slides.length - 1)
  theme?: {
    background?: string;
    panelColor?: string;
    textColor?: string;
  };
}
```

Invariant:

- `transitions[i]` is the transition from `slides[i]` to `slides[i + 1]`.

---

## Asset browser: tag-tree driven, mark-derived

The left side of the editor should expose a browser that looks structurally similar to the tagging tree, but the primary object in the tree should be the **mark**, not the still.

This matters because the analyst thinks in tagged moments first and presentation assets second.

For v1:

- the browser should show **all marks**
- each mark may expose one or more linked stills via `sourceMarkId`
- still slides are created from those linked stills
- stills that cannot be linked to marks are data-repair problems, not a normal browsing mode

### Asset derivation flow

```text
manifest.marks
  + manifest.stills
  + taggingSchema
      -> group marks into schema tree by mark.tags.primary
      -> attach linked stills to each mark via still.sourceMarkId
```

### Tree buckets

The browser should include:

- schema-derived folders from `primary_tree`
- **Untagged**
  - mark exists but `primary = null`
- **Unknown tag**
  - mark exists but its primary tag is no longer in schema
- **Missing source mark**
  - still points to a deleted or unresolved mark and should be surfaced for repair

### Tree leaf content

Each mark row in the asset browser should show:

- timestamp
- maybe mark label / period-aware time formatting
- linked still count
- optional thumbnail preview of the first linked still

Interaction:

- click mark to preview / play that moment
- add a linked still from that mark into the deck
- if a mark has no linked still, silently create one canonical linked still before inserting it into the deck
- double-click linked still to append to deck

---

## Editor page layout

Recommended editor layout:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Back | Presentation name | Play | Present | Add slide | Save status        │
├───────────────────────┬───────────────────────────────────────┬─────────────┤
│ Asset browser         │ Current slide / transition canvas     │ Inspector   │
│ (tag tree + marks)    │                                       │             │
│                       │  still image or live video playback    │ slide props │
│ tag folders           │  annotations on/off                    │ transition  │
│ linked still previews │  next/prev nav                         │ notes       │
│                       │                                       │ timing      │
├───────────────────────┴───────────────────────────────────────┴─────────────┤
│ Deck filmstrip / slide sorter                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Main regions

- **Left:** asset browser from tags
- **Center:** slide canvas / playback canvas
- **Right:** inspector for selected slide or selected transition
- **Bottom:** deck strip with reorder affordances

This should feel closer to keynote/powerpoint than to the stills page.

---

## Presenter/player behavior

The editor should support two related but distinct modes.

### 1. Edit mode

- select slide
- inspect source still or source mark
- reorder slides
- set transition mode
- toggle annotations on/off
- define limited annotation entry / exit cues
- add and edit title slides
- edit presenter notes
- scrub preview of match-video transition

### 2. Present mode

- default to full-screening the entire app
- left/right advances slides
- if next transition is `match_video`, play the video segment before landing on the next slide
- overlay UI is minimal
- a small overlay control can open a compact mark browser for ad hoc retrieval of tagged moments
- notes may optionally appear in a presenter-only pane later

For the first implementation, a simple in-app play mode is enough. True dual-screen presenter mode can wait.

### Ad hoc mark retrieval during presenting

Present mode should support an analyst workflow where the deck is interrupted by a live question.

Example:

- the current presentation is about one theme
- someone asks about corners
- the analyst opens a compact overlay browser that resembles the tagging page
- the analyst browses the mark tree and pauses the presentation player at the selected mark

This is not the same thing as adding a new slide. It is an in-presentation retrieval tool.

Implementation note:

- the retrieval action should use the same underlying player controller as `match_video` playback
- if the selected mark belongs to another `videoId`, the player should load that video and pause on the selected mark rather than trying to force a slide insertion

---

## Annotation behavior

A still slide should reuse the existing still annotation rendering path rather than inventing a new annotation format.

That means:

- presentation slides do not copy annotation geometry
- they reference the still
- rendering reads the still's annotation file and draws it using the existing annotate renderer
- per-presentation customization should be limited to annotation entry / exit timing

Per-slide option:

- `showAnnotations: true | false`
- `annotationCues[]` for limited entry / exit animation

This lets the same still appear twice in a presentation with different display timing choices if needed, without introducing a second annotation-editing model.

---

## Relationship to the existing pages

### Stills page

Remains the place where the user:

- navigates video
- creates stills
- creates clips
- manages source assets

Needed enhancement:

- when generating a still from the current frame, require a selected or newly created mark and store `sourceMarkId`
- on project open, run a migration / backfill pass that attempts exact timestamp-based linkage and require all stills to resolve to marks
- optionally add a small affordance to relink a source mark for an existing still

### Tagging page

Remains the place where the user:

- creates marks
- edits tagging
- organizes analysis points in time

The presentation asset browser should reuse the same **schema mental model** and ideally some grouping helpers as `TagFolderTree`, but it should not literally be the same component unless the abstractions line up cleanly.

### Presentation page

New place where the user:

- assembles narrative output
- orders assets
- chooses transition logic
- previews / presents the sequence

---

## Suggested component plan

### New storage/types

- `webapp/lib/types/presentation.ts`
- `webapp/lib/fs/presentationStorage.ts`

### New routes

- `webapp/app/presentations/page.tsx`
- `webapp/app/presentation/[presentationId]/page.tsx`

### New components

- `webapp/components/presentation/PresentationEditor.tsx`
- `webapp/components/presentation/PresentationDeckStrip.tsx`
- `webapp/components/presentation/PresentationAssetBrowser.tsx`
- `webapp/components/presentation/PresentationInspector.tsx`
- `webapp/components/presentation/PresentationCanvas.tsx`
- `webapp/components/presentation/PresentationPresentOverlay.tsx`

### Supporting abstractions

- a small shared presentation player controller abstraction that coordinates still display, `match_video` playback, and overlay retrieval behavior

### Potential reused pieces

- `VideoPlayerUnit`
- still annotation rendering helpers
- tag-tree grouping helpers from tagging feature
- project context / manifest loading flow

---

## Storage and persistence

Recommended file layout:

```text
presentations/
  <presentationId>.json
```

Optional future derived assets:

```text
presentation-exports/
  ...
```

### Autosave

The presentation editor should autosave on meaningful deck edits, similar to metadata.

Suggested behavior:

- debounce 500-800ms after structural edits
- save immediately on create / duplicate / delete / rename
- keep an in-memory dirty flag for UI status

---

## Slide ordering and timestamp implications

Slides should be freely reorderable even if that means their source timestamps are not chronological.

User-authored order is the primary truth. The system should not try to force chronological deck order.

However, `match_video` transitions only make sense when:

- both slides come from the same `videoId`
- the next slide's `t_ms` is later than or equal to the current slide's `t_ms`

So the editor should enforce:

- if `slide[i+1].t_ms < slide[i].t_ms`, the transition between them cannot be `match_video`
- if `slide[i]` and `slide[i+1]` are from different videos, the transition between them cannot be `match_video`
- automatically downgrade that edge to `cut`, or show validation and block the selection

This keeps the model simple and avoids reverse-video semantics in v1.

---

## Minimal viable user flow

1. User tags marks on the tagging page.
2. User creates stills on the stills page with a selected or newly created mark.
3. User opens `/presentations`.
4. User clicks **New presentation**.
5. User enters a name.
6. User sees an empty deck, a tag-tree browser of marks, and an option to add a title slide.
7. User adds linked stills from marks into the deck, with silent still creation when a chosen mark does not already have one.
8. User reorders slides freely.
9. User selects transitions between slides:
   - `cut`
   - `match video`
10. User previews the presentation.
11. During presentation, the user can open a compact overlay mark browser to retrieve other tagged moments on the fly.
12. User presents it in-app.

---

## Implementation notes / constraints

### 1. Reuse current rendering, do not fork it

Do not create a second annotation rendering system just for presentations. The presentation canvas should reuse the existing still annotation rendering path as much as possible.

### 2. Keep tags normalized

Do not write tags into presentation slides or stills. The browser should derive tag grouping live from marks.

### 3. Do not restrict decks to one video

Do not restrict the deck to one video. Restrict only the cases where `match_video` is valid.

### 4. Treat unlinked stills as repair state, not normal state

The user may already have many old stills without a source mark, but after project-open backfill those should be repaired, not treated as a normal browsing state.

### 5. Presentation data should be source-reference based

Slides reference still IDs, not copied image blobs.

### 6. Make the browser mark-first

The main organizing surface should be the tag tree of marks. Linked stills hang off marks rather than replacing them.

### 7. Do not turn this into a canvas editor

Allow simple title slides and limited annotation entry / exit animation, but do not allow arbitrary text boxes, shapes, or freeform layout editing.

### 8. Enforce unique mark timestamps per video

Backfill and future still-to-mark linkage rely on being able to resolve a still to one mark at a timestamp.

---

## Delivery sequencing note

The realistic implementation order is slightly stricter than the feature list implies.

In practice, the work should land in this dependency order:

1. **Mark / still integrity groundwork first**
   - `sourceMarkId`
   - duplicate-mark timestamp prevention
   - backfill and repair flow
   - canonical still reuse rules
2. **Presentation storage and routes second**
   - presentation types
   - persistence helpers
   - list page and editor route shell
3. **Shared player control before advanced presentation behavior**
   - both `match_video` preview and retrieval overlay depend on the same underlying player control model
4. **Basic authoring before advanced playback polish**
   - it is more realistic to get deck editing, title slides, and still insertion working before animation timing and present-mode retrieval

This avoids building the overlay, cue editor, or transition UX on top of unstable core primitives.

---

## Proposed phased implementation checklist

### Phase 1 — mark / still integrity groundwork

- [x] Add `sourceMarkId?: string | null` to still metadata in `ProjectManifestV1`.
- [x] Update still creation flow to require a selected mark and populate `sourceMarkId`.
- [x] Add a backfill / migration script for old projects that resolves `sourceMarkId` from exact `(videoId, t_ms)` mark matches.
- [x] Enforce the invariant that a given `videoId` cannot have two marks with the same `t_ms`.
- [x] On project open, require all stills to resolve to marks or enter a repair flow.
- [x] Define canonical still reuse / creation rules so silent presentation-time still creation does not create accidental duplicates.

### Phase 2 — presentation model and storage

- [x] Add presentation types and storage helpers.
- [x] Add `/presentations` route.
- [x] List presentations from `presentations/*.json`.
- [x] Create, rename, duplicate, delete.

### Phase 3 — editor shell and shared player control

- [x] Add `/presentation/[presentationId]` route.
- [x] Three-pane layout + bottom deck strip.
- [x] Load manifest, tagging schema, still thumbnails, annotations.
- [x] Introduce a shared presentation player controller abstraction for still display, `match_video`, and retrieval seeking.

### Phase 4 — basic authoring surfaces

- [x] Build a tag-tree-driven mark browser.
- [x] Group marks by primary tag and attach linked stills beneath or alongside marks.
- [x] Add Untagged / Unknown tag / Missing source mark repair surfaces.
- [x] Add linked-still insertion into the deck, mark preview / playback interactions, and silent on-the-spot still creation when a mark has no linked still.
- [x] Add/remove/reorder slides.
- [x] Slide selection.
- [x] Support templated title slides.
- [x] Inspector for notes / showAnnotations.
- [x] Transition editor for `cut` vs `match_video`.

### Phase 5 — playback and transition preview

- [x] Slide canvas for still display.
- [x] Reuse annotation rendering.
- [x] Add preview logic for `match_video` transitions using `VideoPlayerUnit` or a thinner internal player controller.
- [x] Enforce forward-only timestamp validation for video transitions.

### Phase 6 — advanced presentation behavior

- [x] Add inspector support for annotation entry-exit cues.
- [x] Execute annotation entry / exit timing during playback.
- [x] Add the compact in-presentation overlay mark browser for ad hoc retrieval only, without authorship actions.
- [x] Add full-screen present mode.

### Phase 7 — polish

- [x] Keyboard navigation.
- [x] Autosave / dirty status.
- [x] Better visual styling for deck authoring.

### Phase 8 — future expansion

- [x] Add clip slides.
- [x] Add per-transition trim controls.
- [ ] Add export-to-video.
- [ ] Add presenter notes mode / dual-screen support.

---

## Recommendation summary

Build this as a **new presentations feature** with:

- a dedicated presentations list page
- a dedicated presentation editor page
- stills-first deck authoring plus simple title slides
- a mark-first tag-tree browser derived from **marks**, not copied tags
- limited annotation entry / exit animation rather than per-presentation annotation overrides
- mixed-video decks with literal `match_video` transitions only where adjacent still slides make that valid
- silent on-the-spot still creation from marks when needed
- an in-presentation overlay for ad hoc mark retrieval only, using the shared player controller to seek/pause at the selected mark
- a small but important still-model enhancement: `sourceMarkId`
- a migration / backfill path for old projects, required mark linkage on project open, and unique mark timestamps per video

This gives a clean path from:

**mark -> tagged moment -> still -> presentation slide -> narrated sequence**

without polluting stills/clips with duplicated tag state.

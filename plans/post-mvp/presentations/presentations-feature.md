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
- Build a presentation from **stills**.
- Browse candidate stills through a **tag-tree-driven asset browser**.
- Drag stills into a slide deck.
- Reorder slides.
- Choose per-transition behavior:
  - hard cut
  - match-video transition
- Choose per-slide display behavior:
  - show annotations
  - hide annotations
  - optional custom title / notes
- Play the presentation inside the app.
- Persist presentations to disk.

### Explicitly out of scope for v1

- Using clips as slide assets.
- Arbitrary text boxes / shapes independent of the source still annotation set.
- Cross-fades, wipes, animated transforms, zoom-pan camera moves.
- Multi-video presentations.
- Export to `.pptx`.
- Full export-to-video pipeline for presentations.
- Collaborative editing.

---

## Core mental model

A presentation is an ordered list of **slides**.

In v1, each slide points to a **still**.

Each still already has:

- a source `videoId`
- a timestamp `t_ms`
- a still image file
- zero or more saved annotations

The presentation layer adds:

- ordering
- whether annotations are shown on that slide
- optional presenter title / subtitle / notes
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

Extend still metadata with an optional source mark binding:

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

- When a still is created while a mark is selected, persist `sourceMarkId`.
- If a still is created with no selected mark, leave `sourceMarkId = null`.
- Existing projects migrate naturally because the field is optional.
- In the presentation asset browser:
  - stills with a linked mark appear under the mark's tag path
  - stills with no linked mark appear under an **Unlinked assets** bucket
  - stills whose source mark no longer exists appear under **Missing source mark**

This keeps tags normalized while making inheritance practical.

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

### Important constraint for v1

To keep this sane, **all slides in a v1 presentation should belong to the same `videoId`**.

Why:

- literal-video transitions only make sense within one source video
- cross-video transitions would require falling back to cuts anyway
- this avoids complex edge cases in the first version

Recommended rule:

- A presentation has a required `videoId`.
- The first inserted slide sets it.
- Subsequent inserted stills must match the same `videoId`.

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

- `hideAnnotationsDuringPlayback` should default to `true` because the requested behavior is:
  - show annotations/still
  - hide annotations and play video
  - stop video at next still
  - show annotations again
- `startOffsetMs` / `endOffsetMs` allow small trims later, but can be omitted in the first implementation.

---

## Slide model

Each slide should reference a still plus presentation-specific display options.

```ts
type PresentationSlide = {
  id: string;
  stillId: string;
  showAnnotations: boolean;
  title?: string;
  subtitle?: string;
  notes?: string;
  holdMs?: number;
};
```

Notes:

- `showAnnotations` defaults to `true`.
- `title` / `subtitle` / `notes` are presentation-only metadata and do not modify the underlying still.
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
  videoId: string;
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

The left side of the editor should expose a browser that looks structurally similar to the tagging tree, but instead of showing raw marks it shows **presentation-eligible assets**.

For v1 that means **stills**.

### Asset derivation flow

```text
manifest.marks
  + manifest.stills
  + taggingSchema
      -> resolve still.sourceMarkId -> mark
      -> derive tag path from mark.tags.primary
      -> group stills into schema tree
```

### Tree buckets

The browser should include:

- schema-derived folders from `primary_tree`
- **Untagged**
  - linked mark exists but `primary = null`
- **Unknown tag**
  - linked mark exists but its primary tag is no longer in schema
- **Unlinked assets**
  - still has no `sourceMarkId`
- **Missing source mark**
  - still points to a deleted mark

### Tree leaf content

Each still card in the asset browser should show:

- thumbnail
- timestamp
- maybe mark label / period-aware time formatting
- annotation count

Interaction:

- drag into deck
- double-click to append to deck
- click to preview source still

---

## Editor page layout

Recommended editor layout:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Back | Presentation name | Play | Present | Add slide | Save status        │
├───────────────────────┬───────────────────────────────────────┬─────────────┤
│ Asset browser         │ Current slide / transition canvas     │ Inspector   │
│ (tag tree + stills)   │                                       │             │
│                       │  still image or live video playback    │ slide props │
│ tag folders           │  annotations on/off                    │ transition  │
│ thumbnails            │  next/prev nav                         │ notes       │
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
- inspect source still
- reorder slides
- set transition mode
- toggle annotations on/off
- edit slide title/notes
- scrub preview of match-video transition

### 2. Present mode

- full-screen or near full-screen
- left/right advances slides
- if next transition is `match_video`, play the video segment before landing on the next slide
- overlay UI is minimal
- notes may optionally appear in a presenter-only pane later

For the first implementation, a simple in-app play mode is enough. True dual-screen presenter mode can wait.

---

## Annotation behavior

A still slide should reuse the existing still annotation rendering path rather than inventing a new annotation format.

That means:

- presentation slides do not copy annotation geometry
- they reference the still
- rendering reads the still's annotation file and draws it using the existing annotate renderer

Per-slide option:

- `showAnnotations: true | false`

This lets the same still appear twice in a presentation with different display choices if needed.

---

## Relationship to the existing pages

### Stills page

Remains the place where the user:

- navigates video
- creates stills
- creates clips
- manages source assets

Needed enhancement:

- when generating a still from the current frame, store `sourceMarkId` if a mark is selected
- optionally add a small affordance to attach/detach a source mark for an existing still

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

However, `match_video` transitions only make sense when:

- both slides come from the same `videoId`
- the next slide's `t_ms` is later than or equal to the current slide's `t_ms`

So the editor should enforce:

- if `slide[i+1].t_ms < slide[i].t_ms`, the transition between them cannot be `match_video`
- automatically downgrade that edge to `cut`, or show validation and block the selection

This keeps the model simple and avoids reverse-video semantics in v1.

---

## Minimal viable user flow

1. User tags marks on the tagging page.
2. User creates stills on the stills page, preferably with a selected mark.
3. User opens `/presentations`.
4. User clicks **New presentation**.
5. User enters a name.
6. User sees an empty deck and a tag-tree asset browser of stills.
7. User drags tagged stills into the deck.
8. User reorders slides.
9. User selects transitions between slides:
   - `cut`
   - `match video`
10. User previews the presentation.
11. User presents it in-app.

---

## Implementation notes / constraints

### 1. Reuse current rendering, do not fork it

Do not create a second annotation rendering system just for presentations. The presentation canvas should reuse the existing still annotation rendering path as much as possible.

### 2. Keep tags normalized

Do not write tags into presentation slides or stills. The browser should derive tag grouping live from marks.

### 3. Keep v1 single-video

This is the biggest simplifier for literal-video transitions.

### 4. Make unlinked stills visible, not invalid

The user may already have many stills with no source mark. Those should still be usable in presentations; they just will not appear under a normal tag path.

### 5. Presentation data should be source-reference based

Slides reference still IDs, not copied image blobs.

---

## Proposed phased implementation checklist

### Phase 1 — data model groundwork

- Add `sourceMarkId?: string | null` to still metadata in `ProjectManifestV1`.
- Update still creation flow to populate it when a mark is selected.
- Add optional migration-safe handling for old projects.
- Add presentation types and storage helpers.

### Phase 2 — presentations list page

- Add `/presentations` route.
- List presentations from `presentations/*.json`.
- Create, rename, duplicate, delete.

### Phase 3 — editor scaffold

- Add `/presentation/[presentationId]` route.
- Three-pane layout + bottom deck strip.
- Load manifest, tagging schema, still thumbnails, annotations.

### Phase 4 — asset browser

- Build tag-tree-driven still browser.
- Group by source mark primary tag.
- Add Untagged / Unknown tag / Unlinked assets / Missing source mark buckets.
- Drag-drop or double-click add-to-deck.

### Phase 5 — deck editing

- Add/remove/reorder slides.
- Slide selection.
- Inspector for title / notes / showAnnotations.
- Transition editor for `cut` vs `match_video`.

### Phase 6 — playback / preview

- Slide canvas for still display.
- Reuse annotation rendering.
- Add preview logic for `match_video` transitions using `VideoPlayerUnit` or a thinner internal player controller.
- Enforce forward-only timestamp validation for video transitions.

### Phase 7 — polish

- Keyboard navigation.
- Autosave / dirty status.
- Full-screen present mode.
- Better visual styling for deck authoring.

### Phase 8 — future expansion

- Add clip slides.
- Add per-transition trim controls.
- Add export-to-video.
- Add multi-video presentations.
- Add presenter notes mode / dual-screen support.

---

## Open questions

1. Should a still be allowed to link to multiple marks, or is one canonical `sourceMarkId` enough?
   - Recommendation: one canonical source mark in v1.

2. Should unlinked stills be assignable to a mark after creation?
   - Recommendation: yes, lightweight relink affordance on stills page.

3. Should slide titles/notes live inside the presentation file or a separate presenter-notes layer?
   - Recommendation: keep them inside the presentation file.

4. Should the asset browser show clips immediately, even if they cannot yet be added?
   - Recommendation: no. Keep v1 browser stills-only to avoid muddy UX.

5. Should match-video transitions show overlays such as score/clock?
   - Recommendation: no additional overlays in v1 beyond the base video.

---

## Recommendation summary

Build this as a **new presentations feature** with:

- a dedicated presentations list page
- a dedicated presentation editor page
- stills-first deck authoring
- tag-tree asset browsing derived from **marks**, not copied tags
- optional literal match-video transitions between adjacent stills
- single-video restriction in v1
- a small but important still-model enhancement: `sourceMarkId`

This gives a clean path from:

**mark -> tagged moment -> still -> presentation slide -> narrated sequence**

without polluting stills/clips with duplicated tag state.

# Presentation Derived Media Serving

## Goal

Remove the reload-heavy feeling from presentation authoring and playback by stopping the app from using the original imported videos as the default serving asset for latency-sensitive presentation workflows.

The practical objective is:

- authoring interactions should feel fast enough to use repeatedly without waiting on deep seeks into large originals
- present mode should feel prepared, deterministic, and polished rather than depending on live random access into large originals
- the system should introduce one clear derived-media subsystem rather than a pile of ad hoc generated files and fallbacks

---

## What this plan is and is not

### This plan is

- a concrete post-MVP technical plan for introducing derived media into the presentations feature
- a plan for the first real serving-model change, not another round of player-reuse tuning
- a plan that distinguishes **editor/authoring** workflows from **present** workflows
- a plan that defines the missing subsystem details: jobs, ownership, resolver behavior, preparation closure, fallback rules, and file lifecycle

### This plan is not

- a full export-to-video pipeline for presentations
- an MSE / custom streaming plan
- a promise to build the final hybrid architecture in one pass
- a commitment that every presentation interaction must be solved by video assets alone

---

## Technical conclusion

The right technical direction is a **derived media serving layer** with two intentionally different asset classes:

1. **Preview proxies** for fast editor-side timeline access
2. **Prepared exact motion assets** for present-quality playback

The originals remain the source of truth and long-term archival media.

### Core rule

The app should stop assuming that any latency-sensitive presentation workflow plays directly from an original imported video.

Instead, the app resolves a playback asset based on:

- workflow
- readiness
- quality requirements
- whether degraded playback is allowed

---

## Product-surface split

### Editor / authoring surface

This includes:

- clicking stills for context
- retrieval / mark preview during authoring
- clip authoring preview inside presentations
- transition inspection / preview during editing

Editor priorities:

- seek speed
- responsiveness
- low friction
- tolerance for lower fidelity
- tolerance for controlled degraded fallback

### Present surface

This includes:

- actual present mode playback
- polished transition playback
- clip slide playback during present mode
- any motion asset that should feel intentional rather than best-effort

Present priorities:

- reliability
- exactness of windowing
- stable quality expectations
- explicit preparation state
- no accidental degraded fallback

---

## First implementation shape

### Phase 1 subsystem

Build one derived-media subsystem with two asset types:

- **per-video preview proxy**
- **presentation-owned exact motion asset**

That subsystem is enough to support the first real serving-model change without building a fully general media compiler.

### Why this split

- preview proxies preserve the current `videoId + startMs + endMs` model for editor interactions
- exact motion assets provide deterministic present playback for authored motion units
- the two asset classes solve different workflow standards instead of forcing one compromise asset type to do both jobs

---

## Asset classes

## 1. Preview proxy

A preview proxy is a seek-friendly derivative for one source video.

Intended use:

- editor-side retrieval
- still click context
- clip preview in authoring
- transition preview in authoring when no exact prepared asset is ready yet

Preview proxies are **not** the default present-mode serving asset.

### Important constraint

Do **not** generate a preview proxy for every imported video by default.

Generate proxies only for videos that are actually referenced by the active presentation or current authoring workflow, and only after the generation trigger policy says a full proxy is warranted.

### Initial generation rule

A video becomes **proxy-eligible** when at least one of these is true:

- a slide in the active presentation references that `videoId`
- a playable `match_video` transition in the active presentation references that `videoId`
- authoring retrieval is opened for a mark/still from that `videoId`

Proxy eligibility does **not** always mean “generate a full-video proxy immediately.”

### Large-source generation gate

For small and medium referenced videos, generating a proxy on first meaningful use is acceptable in v1.

For v1, treat a source as large if either of these is true:

- source duration is greater than 20 minutes
- source byte size is greater than 1.5 GB

If a source is large, full-video proxy generation should not start on first touch. Instead, require at least one of these triggers:

- a second meaningful touch for the same `videoId` in the same open project session
- at least three authored references to that `videoId` in the active presentation, counting slides, clip slides, and playable `match_video` transitions
- explicit preparation action such as `Prepare presentation` or a future editor-media preparation action

If duration metadata is unavailable, file size alone may trigger the large-source gate.

This keeps Phase 1 from turning one light interaction with a pathological source into a full transcode.

### Deferred optimization rule

If source duration or file size is very large and usage is extremely sparse, it may later be worth replacing full-video proxies with a presentation-scoped preview bundle. That is a later optimization, not the first subsystem.

## 2. Exact motion asset

An exact motion asset is a prepared, standalone, presentation-owned media file for one authored motion unit.

For v1 of this subsystem, motion units are:

- playable `match_video` transitions
- clip slides used during present mode

Exact motion assets are intended for:

- transition preview when available
- transition playback during present mode
- clip slide playback during present mode

These assets are exact enough that present mode can depend on them without silently degrading to preview-quality behavior.

---

## Workflow-to-asset routing

This must be explicit in code. The player should not infer it ad hoc.

| Workflow | Preferred asset | Allowed fallback | Notes |
| --- | --- | --- | --- |
| Authoring still click / context regain | Preview proxy | Original source while proxy job is queued | Fallback allowed because fidelity is secondary to responsiveness |
| Authoring retrieval / mark preview | Preview proxy | Original source while proxy job is queued | Retrieval in authoring is editor behavior |
| Authoring clip slide preview | Preview proxy | Original source while proxy job is queued | Exact prepared clip asset not required in editor |
| Authoring transition preview | Exact motion asset | Preview proxy | Transition preview may be degraded in editor if exact asset is not ready |
| Present-mode transition playback | Exact motion asset | No silent fallback | Present should block or show explicit degraded state if not prepared |
| Present-mode clip slide playback | Exact motion asset | No silent fallback | Same rule as transitions |
| Present-mode still slide | Still image | None needed | No motion serving issue |
| Present-time retrieval | Disabled in prepared present mode | Explicit degraded/off-deck mode only | Do not route prepared present retrieval through proxies or originals |

### Key rule

**Present mode must not silently fall back to preview proxies.**

If required exact motion assets are missing, present mode should do one of:

- block and ask the user to prepare the presentation
- offer an explicit degraded present mode

The degraded path must be intentional and visible, not accidental.

---

## Prepared presentation closure

`Prepare presentation` must mean something exact.

For a given presentation, preparation is complete only when all required present-mode motion assets are ready.

### Required prepared asset closure

For v1, the closure includes:

- every playable `match_video` transition in the deck
- every clip slide in the deck

### Explicitly excluded from present closure in v1

- authoring retrieval
- off-deck mark exploration
- editor-only context previews

Present-time retrieval is excluded from prepared-present closure in v1. If retrieval is ever offered while presenting, it must switch the session into an explicit degraded/off-deck mode rather than borrowing the prepared path.

### Preparation status

Preparation should return one of:

- **ready** — all required present assets exist and match current keys
- **degraded** — some required assets missing or stale
- **failed** — one or more required assets failed generation

Present mode should key off this status rather than guessing from individual files on demand.

---

## Resolver layer

Add a dedicated resolver layer between presentation logic and the player.

The player should receive a resolved playback asset, not raw assumptions about originals.

### Minimum resolver contract

```ts
type PlaybackWorkflow =
  | 'authoring_context'
  | 'authoring_retrieval'
  | 'authoring_clip_preview'
  | 'authoring_transition_preview'
  | 'present_transition'
  | 'present_clip'
  | 'present_retrieval';

type ResolvedPlaybackAsset = {
  assetId: string;
  assetClass: 'original' | 'preview_proxy' | 'exact_motion';
  readiness: 'ready' | 'queued' | 'running' | 'failed' | 'missing' | 'stale';
  qualityClass: 'exact' | 'degraded';
  safeForPresent: boolean;
  sourceVideoId?: string;
  objectUrl?: string | null;
  durationMs?: number;
  sourceFingerprint?: string;
  generationKey?: string;
  fallbackFromAssetId?: string | null;
  failureReason?: string;
};
```

### Why this needs more than `objectUrl`

The calling code needs to know:

- whether the asset is exact or degraded
- whether it is safe to use in present mode
- whether it is stale
- whether a job is already in flight
- what it fell back from

Without that, the app will drift into implicit fallback behavior.

---

## Derived media jobs

This subsystem needs a real job model.

### Job types

For v1:

- `preview_proxy_generate`
- `exact_motion_generate`

### Job identity

Every job must have a deterministic dedupe key.

Examples:

- preview proxy key = source fingerprint + preview profile version
- exact motion key = presentation id + source fingerprint + exact motion spec + output profile version

### Job states

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `obsolete`

### Required behaviors

- dedupe identical in-flight requests
- avoid generating the same asset twice concurrently
- cancel or mark obsolete jobs whose inputs are no longer current
- write outputs to temp paths first, then atomically promote on success
- recheck obsolescence after validation and immediately before promotion
- reject corrupt partial outputs on next open
- expose progress and failure state to UI

### Obsolescence rules

A job becomes obsolete if its generation key no longer matches the latest request.

Examples:

- transition trim changed while job was running
- presentation changed and removed the transition
- user switched output profile version

An obsolete job may be:

- cancelled if supported by the generator boundary
- or allowed to finish and then discarded without promotion

Hard invariant: a successful generator process does **not** automatically earn promotion. Right before promotion, the generation subsystem must re-read the latest generation key / authored state. If the request is obsolete at that moment, the temp output is discarded and the index must not be updated to `ready`.

### Concurrency rules

Start conservative.

Recommended v1 limits:

- interactive authoring: one exact motion generation at a time
- interactive authoring: one preview proxy generation at a time
- interactive authoring: global maximum of two concurrent media jobs
- explicit `Prepare presentation`: up to two concurrent exact motion generations
- explicit `Prepare presentation`: do not start new preview proxy jobs as part of present closure

The goal is to avoid crushing the machine during authoring.

This gives `Prepare presentation` a small but real throughput advantage over live authoring without letting it fan out into unbounded ffmpeg work.

---

## Asset ownership and storage model

Ownership must be explicit so cleanup is not guesswork.

## Preview proxy ownership

Preview proxies are **project-owned** and shared across presentations within the same project.

Reason:

- they derive from one source video
- they are editor-serving assets rather than authored presentation semantics
- sharing them avoids duplicate proxy generation for multiple decks using the same video

### Preview proxy storage

```text
derived-media/
  preview-proxies/
    proxy-<sourceFingerprint>-<profileVersion>.mp4
```

## Exact motion asset ownership

Exact motion assets are **presentation-owned** in v1.

Reason:

- they encode authored motion units tied to one presentation deck
- ownership and cleanup are simpler when scoped to one presentation
- cross-presentation dedupe can be deferred

### Exact motion storage

```text
derived-media/
  presentations/
    <presentationId>/
      motion-assets/
        motion-<generationKey>.mp4
      index.json
```

### Why not globally dedupe exact motion assets yet

Because v1 should prefer simpler cleanup and clearer ownership over clever reuse.

---

## Cache keys and invalidation

All derived assets should be content-addressed by generation key.

## Source fingerprint

A source fingerprint should include enough information to detect meaningful source changes.

Recommended v1 starting point:

- source file path within project
- file size
- file last modified timestamp

Do **not** include a content hash in v1. If real projects reveal stale-derived-media mismatches that this weak heuristic misses, add a cheap content hash later behind an explicit migration or profile-version bump.

This is a knowingly weak v1 heuristic, not a durable long-term media identity model. It is acceptable as an initial staleness detector, but the team should not treat it as authoritative if real-world projects expose stale-derived-media mismatches.

## Preview proxy key

Preview proxy key should include:

- source fingerprint
- preview profile version

## Exact motion key

Exact motion key should include:

- presentation id
- motion kind (`transition` or `clip_slide`)
- source fingerprint
- exact start/end boundaries
- playback-rate-relevant semantics if output timing depends on them
- output profile version
- generator version

### Exact motion stale conditions

An exact motion asset becomes stale if any of these change:

- source fingerprint
- start/end boundaries
- transition trim parameters
- clip slide boundaries
- output profile version
- generation pipeline version

### Cleanup rule

In v1, cleanup can be simple:

- orphan old exact motion assets on key change
- remove orphaned presentation-owned assets during next `Prepare presentation`
- optionally add project-level cleanup later

---

## Proxy profile: pin it tightly

The preview proxy profile must be specific enough that implementation cannot drift into ineffective proxies.

### Preview proxy v1 profile

- container: `mp4`
- video codec: `h264`
- pixel format: `yuv420p`
- max output size: fit within `1280x720`, preserve aspect ratio
- frame rate: preserve source frame rate initially
- GOP target: keyframe at least every `0.5s`
- scene-cut keyframes: start with scene-cut suppression during initial profiling if it improves predictability, but keep this empirical rather than a permanent doctrine
- audio: removed entirely for preview proxies in v1
- quality target: tuned for fast seeking and low decode cost, not archival quality

### Why strip audio in preview proxies

- reduces file size
- reduces decode / mux complexity
- avoids editor-preview autoplay/audio-policy complications
- authoring retrieval and context regain do not require full audio fidelity

Preview proxies in v1 are visually authoritative, not audio-authoritative. If users need to judge audio timing for an authoring workflow, exact motion preview must remain available and should not be silently replaced by proxy playback.

If audio is later shown to matter for editor workflows broadly, add a separate preview-audio profile rather than weakening the v1 constraint.

### Exact motion v1 profile

- container: `mp4`
- video codec: `h264`
- pixel format: `yuv420p`
- trim: exact by re-encode
- frame rate: preserve source frame rate initially
- audio: retain present-compatible audio when source has audio, encoded to a predictable supported format if needed
- quality target: good enough for present mode, not just editor preview

---

## Object URL and file lifecycle

This app plays local files via browser object URLs, so lifecycle rules matter.

### Rules

- object URLs are created lazily on first resolve of a ready asset
- object URLs are cached by `assetId` within the current session
- repeated playback of the same asset reuses the same object URL
- the session registry must track active use with lease / ref-count-like discipline rather than best-effort cleanup
- object URLs are revoked on explicit cache eviction, project close, or app teardown only after active-use count reaches zero
- if an asset becomes stale and a new asset replaces it, the old URL is released and revoked only after no active consumers remain attached

Active use includes visible players, hidden preloaded players, and any other component still attached to the same URL.

### Session reopen behavior

- derived media files persist on disk
- object URLs do not persist across sessions
- on reopen, ready assets are rediscovered from storage/index metadata and object URLs are recreated lazily

---

## FFmpeg sidecar boundary

This is the first real media-derivation subsystem, so the app boundary must be explicit.

The webapp should not build shell commands directly inside UI components.

### Required boundary

Introduce a single generation boundary, conceptually something like:

```ts
generateDerivedMedia(request) -> {
  jobId,
  generationKey,
  outputPath,
  progress,
  cancel(),
  status,
}
```

### v1 ownership decision

The existing host-side sidecar service should own derived-media generation in v1.

The webapp submits typed job requests to the sidecar. The sidecar spawns and supervises ffmpeg child processes, keeps per-job cancellation handles, writes temp outputs, performs atomic promotion, and updates job/index state. Cancellation should first attempt graceful termination and then force-kill after a short timeout if the child process does not exit.

This boundary is responsible for:

- invoking ffmpeg in the host environment
- reporting progress/errors back to the webapp
- temp-file handling and atomic promotion
- cancellation hooks where possible
- returning the final output path only when the asset is complete and valid

### Progress model

The webapp should use a phase-oriented progress model rather than pretending every ffmpeg job has a trustworthy numeric percentage.

Recommended v1 job phases:

- `queued`
- `probing`
- `running`
- `finalizing`
- `ready`
- `failed`
- `cancelled`
- `obsolete`

While a job is in `running`, expose an approximate percent only when ffmpeg emits parseable time-based progress against a known target duration. Otherwise show indeterminate progress with the current phase label.

For `Prepare presentation`, show aggregate closure progress as `ready assets / required assets` plus the label of the currently running asset, rather than trying to sum raw ffmpeg percentages across jobs.

### UI components should not know

- ffmpeg command line details
- temp-file layout
- promotion rules
- cancellation implementation details

Those belong in the generation subsystem.

---

## Present-mode rules

Present mode should be deterministic.

### Present-mode asset policy

- still slides use still images
- clip slides use exact motion assets
- playable `match_video` transitions use exact motion assets
- present-time retrieval is disabled in prepared present mode in v1
- if required exact assets are missing, present mode is not fully prepared

### Degraded present mode

If a degraded present mode is allowed, it must be explicit.

Examples:

- `Present (prepared)`
- `Present anyway (degraded)`

The degraded mode should visibly warn that:

- some motion assets are missing
- playback may use preview-quality assets or originals
- quality/latency are not guaranteed

If retrieval while presenting is later offered, it should live only inside this explicit degraded/off-deck mode.

Do not silently degrade the prepared path.

---

## Editor-mode rules

Editor mode should prioritize fast context and low friction.

### Editor asset policy

- retrieval and context regain prefer preview proxies
- transition preview prefers exact motion if ready, otherwise preview proxy
- clip preview prefers preview proxy
- original source is only a temporary fallback while proxy generation is pending or failed
- if a workflow requires users to judge audio timing, exact motion preview should remain available rather than letting silent proxy preview become the de facto path

### Non-video aids

Non-video editor aids are worth keeping in scope later:

- dense thumbnails
- short image neighborhoods
- contact-sheet preview windows

These are complementary optimizations and should not block the derived-media subsystem.

---

## Rollout plan

## Phase 1: resolver and preview proxies

Deliverables:

- resolver layer introduced
- preview proxy storage/index created
- preview proxy generation job path created
- authoring retrieval/context/clip-preview routed to preview proxies
- controlled fallback to originals while proxy jobs are pending

Success criteria:

- repeated authoring retrieval no longer feels like repeated fresh loads from originals
- preview proxy jobs are deduped and stable
- stale or failed proxies do not crash playback routing

## Phase 2: exact motion assets and preparation

Deliverables:

- exact motion generation for transitions and clip slides
- presentation-owned motion-asset index
- `Prepare presentation` action with real closure semantics
- present mode checks preparation status before starting
- present-mode transitions and clip slides route only to exact motion assets in prepared mode

Success criteria:

- present mode is deterministic about readiness
- transitions and clip slides do not depend on live deep seeks into originals
- missing exact assets are surfaced explicitly rather than hidden behind accidental fallback

## Phase 3: follow-up optimizations

Possible follow-ups:

- better cleanup / GC tooling
- degraded present mode UX
- presentation-scoped preview bundle if proxy cost proves too blunt
- non-video editor aids for retrieval/context
- narrower exact mark-window assets if retrieval still feels too slow after proxies

---

## Resolved technical decisions

These questions are resolved for v1 and should be treated as implementation constraints unless real-world testing forces revision.

- [x] Large-source proxy gate: treat a source as large when duration is greater than 20 minutes or byte size is greater than 1.5 GB. Large sources only start full-video proxy generation on second meaningful touch, at three authored references in the active presentation, or on explicit preparation.
- [x] `Prepare presentation` includes clip slides in the first exact-motion closure.
- [x] FFmpeg ownership: the host-side sidecar owns process spawning, progress reporting, cancellation, temp outputs, and atomic promotion.
- [x] Progress model: use phase-based reporting with approximate percentages only when ffmpeg emits trustworthy duration-based progress; `Prepare presentation` also shows aggregate `ready / required` closure progress.
- [x] Source fingerprinting: stay with the weak v1 heuristic of `path + size + mtime`; do not add a content hash initially.
- [x] Concurrency: interactive authoring stays capped at two total media jobs, while explicit `Prepare presentation` may run up to two exact-motion jobs concurrently and should not launch new preview-proxy work as part of present closure.

---

## Implementation checklist

### 1. Resolver and shared derived-media types

- [x] 1.1. Create a new shared module such as `webapp/lib/presentation/playbackAssetResolver.ts` that exports:

- `PlaybackWorkflow`
- `ResolvedPlaybackAsset`
- resolver entry points for authoring retrieval, authoring transition preview, authoring clip preview, present transition playback, and present clip playback

- [x] 1.2. Create a new shared module such as `webapp/lib/presentation/derivedMediaTypes.ts` for the stable metadata types used by storage, jobs, and routing so those types do not live inside React components.

- [x] 1.3. Add enough fields to the resolved asset contract to support routing decisions without implicit assumptions:

- `assetId`
- `assetClass`
- `readiness`
- `qualityClass`
- `safeForPresent`
- `generationKey`
- `sourceVideoId`
- `sourceFingerprint`
- `durationMs`
- `objectUrl`
- `failureReason`
- `fallbackFromAssetId`

- [x] 1.4. Update presentation-facing code so `PresentationCanvas.tsx` no longer assumes `videoUrlById[videoId]` is the final playback source for all workflows.

- [x] 1.5. Identify and update every workflow entry point that currently chooses playback directly from original video URLs:

- `PresentationEditor.tsx`
- `PresentationAuthoringEditor.tsx`
- `PresentationCanvas.tsx`
- `playerController.ts`

- [x] 1.6. Make the routing table explicit in code rather than scattered across components:

- authoring retrieval prefers preview proxy
- authoring clip preview prefers preview proxy
- authoring transition preview prefers exact motion, then preview proxy
- prepared present transition requires exact motion
- prepared present clip slide requires exact motion

### 2. Source fingerprinting and derived-media keys

- [x] 2.1. Define a v1 source fingerprint function in a non-React module, likely under `webapp/lib/presentation/derivedMediaKeys.ts`.

- [x] 2.2. For v1, make the source fingerprint deterministic from a knowingly weak heuristic such as:

- project-relative source video path
- file size
- file last modified timestamp

- [ ] 2.3. Document in code comments and metadata handling that this fingerprint is a v1 staleness heuristic, not a stable long-term media identity.

- [x] 2.4. Define a preview proxy generation key that includes:

- source fingerprint
- preview profile version

- [x] 2.5. Define an exact motion generation key for transitions that includes:

- presentation id
- source fingerprint
- motion kind = `transition`
- from slide index or stable transition identity
- exact start and end bounds
- output profile version
- generator version

- [x] 2.6. Define an exact motion generation key for clip slides that includes:

- presentation id
- source fingerprint
- motion kind = `clip_slide`
- clip id
- exact clip start and end bounds
- output profile version
- generator version

- [x] 2.7. Make all storage lookups and stale checks use these generation keys rather than mutable slide state alone.

### 3. Preview proxy storage and metadata

- [x] 3.1. Create project-owned preview proxy storage under:

```text
derived-media/
  preview-proxies/
```

- [x] 3.2. Add an index file for preview proxies, for example:

```text
derived-media/
  preview-proxies/
    index.json
```

- [x] 3.3. Record per-proxy metadata in the index:

- `assetId`
- `generationKey`
- `sourceVideoId`
- `sourceFingerprint`
- `relativePath`
- `status`
- `profileVersion`
- `createdAt`
- `lastUsedAt`
- `byteSize`
- `durationMs`
- `error`

- [x] 3.4. Define exact file naming for preview proxies, for example `proxy-<generationKey>.mp4`, so there is no ambiguity about ownership.

- [x] 3.5. Ensure preview proxies are shared across presentations within the same project and are not duplicated per presentation in v1.

- [x] 3.6. Only request preview proxy generation for `videoId`s that are actually referenced by:

- slides in the active presentation
- playable transitions in the active presentation
- authoring retrieval actions currently in use

- [x] 3.7. Add a large-source generation gate so proxy-eligible videos above configured duration/size thresholds require a second touch or explicit preparation before full-video proxy generation starts.

### 4. Exact motion asset storage and metadata

- [x] 4.1. Create presentation-owned exact motion storage under:

```text
derived-media/
  presentations/
    <presentationId>/
      motion-assets/
      index.json
```

- [x] 4.2. Add an index file per presentation that records one row per exact motion asset.

- [x] 4.3. Record per-asset metadata in the presentation index:

- `assetId`
- `generationKey`
- `motionKind`
- `transitionOrClipId`
- `sourceVideoId`
- `sourceFingerprint`
- `relativePath`
- `status`
- `profileVersion`
- `createdAt`
- `lastUsedAt`
- `byteSize`
- `durationMs`
- `error`

- [x] 4.4. Keep exact motion assets presentation-owned in v1 even if two presentations could theoretically share identical windows.

- [x] 4.5. Define exact file naming for motion assets, for example `motion-<generationKey>.mp4`.

- [x] 4.6. Treat exact motion assets as stale whenever the stored generation key no longer matches the latest authored transition or clip-slide request.

### 5. Generation boundary and job model

- [ ] 5.1. Create one host-side generation boundary for derived media instead of letting UI components assemble ffmpeg invocations.

- [x] 5.2. Define a job request shape that includes:

- job kind
- generation key
- source video reference
- desired output path
- profile version
- exact bounds if applicable

- [x] 5.3. Define job states centrally:

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `obsolete`

- [x] 5.4. Dedupe identical in-flight jobs by generation key so two UI callers cannot generate the same proxy or motion asset at once.

- [x] 5.5. Add obsolescence checks so a running transition-generation job is discarded or cancelled if the user changes transition trims before completion.

- [ ] 5.6. Write all generator outputs to temp files first, validate success, recheck current generation key, then atomically promote to final path and update the index.

- [ ] 5.7. On startup or project open, scan for temp or partial files from interrupted jobs and remove or ignore them.

- [x] 5.8. Limit concurrency conservatively in v1:

- no more than one preview proxy generation at a time
- no more than one exact motion generation at a time
- or a shared maximum of two media-generation jobs total

- [x] 5.9. Expose job progress and terminal errors to the webapp using a stable status shape rather than raw process output.

- [ ] 5.10. Treat index update plus file promotion as one logical commit boundary so a completed job cannot leave a “ghost ready” asset behind.

### 6. Proxy profile and exact motion profile

- [x] 6.1. Pin the preview proxy profile in one place, not in scattered call sites.

- [ ] 6.2. For v1 preview proxies, require:

- `mp4` container
- `h264` video codec
- `yuv420p` pixel format
- max dimensions constrained to `1280x720` while preserving aspect ratio
- source frame rate preserved initially
- keyframe interval no greater than `0.5s`
- start with a scene-cut policy chosen during initial profiling and record it in the profile version rather than treating one setting as sacred
- audio removed entirely

- [x] 6.3. Define a profile version string so future profile changes automatically invalidate stale proxies.

- [x] 6.4. Pin the exact motion profile in one place as well.

- [ ] 6.5. For v1 exact motion assets, require:

- exact trim by re-encode
- `mp4` container
- `h264` video codec
- `yuv420p` pixel format
- source frame rate preserved initially
- present-compatible audio retained or re-encoded predictably when source audio exists

- [x] 6.6. Define a separate exact-motion profile version so present-quality assets can evolve independently from preview proxies.

### 7. Editor-side routing changes

- [x] 7.1. Route authoring retrieval to the resolver first instead of directly selecting original object URLs from `videoUrlById`.

- [x] 7.2. Route still-click context regain to preview proxy assets when available.

- [x] 7.3. Route authoring clip preview to preview proxy assets when available.

- [x] 7.4. Route authoring transition preview to exact motion assets if ready; otherwise route to preview proxy assets as an explicitly degraded authoring path.

- [x] 7.5. Keep original imported media as a temporary editor-only fallback while proxy generation is pending or has failed.

- [x] 7.6. Ensure the UI can distinguish between:

- exact preview
- degraded preview through proxy
- temporary original fallback

- [x] 7.7. For authoring workflows where audio timing matters, keep exact motion preview reachable and do not allow silent proxy preview to silently become the default judgment path.

### 8. Present-mode routing and preparation

- [x] 8.1. Define present closure precisely in code for v1:

- all playable `match_video` transitions
- all clip slides

- [x] 8.2. Implement `Prepare presentation` so it queues any missing or stale exact motion assets needed for that closure.

- [x] 8.3. Record preparation status per presentation as one of:

- `ready`
- `degraded`
- `failed`

- [x] 8.4. In prepared present mode, route transitions only to ready exact motion assets.

- [x] 8.5. In prepared present mode, route clip slides only to ready exact motion assets.

- [x] 8.6. If required exact motion assets are missing, block present mode or require the user to enter an explicitly degraded present mode.

- [x] 8.7. Do not silently fall back from prepared present mode to preview proxies.

- [x] 8.8. Disable present-time retrieval in prepared present mode in v1.

- [x] 8.9. If retrieval while presenting is later added, route it only through an explicit degraded/off-deck mode outside the prepared closure.

### 9. Object URL lifecycle and in-session caching

- [x] 9.1. Add a session-level object URL registry keyed by derived-media `assetId`, not just by `videoId`, and track active-use leases or ref-counts per asset.

- [x] 9.2. Reuse object URLs for repeated playback of the same preview proxy or exact motion asset during the same session.

- [x] 9.3. Revoke object URLs only after active-use count reaches zero when:

- the project closes
- the asset is evicted from the registry
- a stale asset is replaced and is no longer in active use

- [x] 9.4. Reopen derived files lazily from disk on the next session instead of eagerly materializing all object URLs at startup.

- [x] 9.5. Ensure resolver code can recover from a revoked or stale object URL by recreating it from the persisted file metadata.

- [x] 9.6. Count hidden preloaded players and visible players as active consumers of the same asset so URL revocation cannot race against playback handoff.

### 10. Cleanup and stale-asset management

- [x] 10.1. During `Prepare presentation`, remove or mark orphaned exact motion assets in the presentation folder whose generation keys are no longer referenced by the current deck.

- [x] 10.2. On project open, validate preview proxy and exact motion index entries against files on disk and mark missing outputs as `missing` or `stale`.

- [x] 10.3. If a generator run fails, persist the failure state in index metadata instead of repeatedly retrying blindly on every render.

- [x] 10.4. Add a deliberate retry path for failed assets rather than treating every resolver call as a fresh generation request.

- [x] 10.5. Defer aggressive global GC until after the core subsystem is stable; only perform obvious local cleanup in v1.

### 11. Verification checklist

- [x] 11.1. Verify that repeated authoring retrieval on a large source video reuses the same preview proxy asset instead of repeatedly seeking into the original.

- [x] 11.2. Verify that repeated authoring transition preview uses the exact motion asset when ready and only degrades to proxy when exact motion is unavailable.

- [x] 11.3. Verify that prepared present mode refuses silent degraded fallback when an exact motion asset is missing.

- [x] 11.4. Verify that clip slides in present mode resolve through exact motion assets, not originals.

- [x] 11.5. Verify that rapid transition trim edits obsolete the previous in-flight exact motion jobs instead of surfacing stale outputs.

- [x] 11.6. Verify that obsolete jobs cannot promote stale outputs after a final generation-key recheck at promotion time.

- [x] 11.7. Verify that switching presentations during generation does not leak object URLs, orphan temp outputs, or continue routing old job state into the active deck.

- [x] 11.8. Verify that project reopen can rediscover persisted preview proxies and exact motion assets without rebuilding object URLs eagerly.

- [x] 11.9. Verify that failed generation produces actionable UI state and does not trap the app in infinite retry loops.

- [x] 11.10. Verify that very large sparse sources do not immediately trigger full proxy generation on first light interaction when the large-source gate should defer it.

- [x] 11.11. Verify that index/file divergence is reconciled correctly on startup when files exist without ready index state or ready index state exists without a valid file.

---

## Recommended order of attack

If implementation starts immediately, the order should be:

1. resolver layer
2. preview proxy job + storage + routing
3. exact motion job + storage + routing
4. `Prepare presentation` semantics
5. cleanup and degraded-mode polish

That sequence introduces one subsystem cleanly instead of building multiple partial media paths at once.

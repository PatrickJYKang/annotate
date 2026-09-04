'use client';

import { useMemo, useState, type ReactNode } from 'react';

type GuideLink = {
  id: string;
  label: string;
  summary: string;
  keywords: string;
};

type GuideGroup = {
  label: string;
  links: GuideLink[];
};

const GUIDE_GROUPS: GuideGroup[] = [
  {
    label: 'Start here',
    links: [
      { id: 'orientation', label: 'Overview', summary: 'Project structure and the clip, pin, and presentation model.', keywords: 'overview introduction model' },
      { id: 'first-project', label: 'First project workflow', summary: 'From an empty project to a presentation.', keywords: 'setup create import demonstration tutorial' },
      { id: 'installation', label: 'Install and run', summary: 'Launching, browser support, and local services.', keywords: 'install launch chromium chrome sidecar' },
    ],
  },
  {
    label: 'Workflows',
    links: [
      { id: 'capture', label: 'Capture and tag', summary: 'Turn passages of play into overlapping clips.', keywords: 'board modifier facet timeline tagging' },
      { id: 'clip-editor', label: 'Edit a clip', summary: 'Draw and animate tactical objects.', keywords: 'keyframe timeline box circle arrow lob poly shadow' },
      { id: 'tracking', label: 'Track and correct', summary: 'Track players and repair continuity errors.', keywords: 'tracking yolo ocsort retrack player highlight overlap' },
      { id: 'pins', label: 'Pins and annotations', summary: 'Freeze important frames and animate explanations.', keywords: 'still annotation set entrance animation' },
      { id: 'presentations', label: 'Presentation authoring', summary: 'Create and play sequences of clips, pins, and title cards.', keywords: 'slides deck present transition match video' },
      { id: 'export-recovery', label: 'Export and recovery', summary: 'Reports, images, trash, and integrity checks.', keywords: 'png csv json backup restore missing' },
    ],
  },
  {
    label: 'Reference',
    links: [
      { id: 'workspace-map', label: 'Workspace map', summary: 'Where each kind of work happens.', keywords: 'dashboard capture editor presentation metadata' },
      { id: 'drawing-tools', label: 'Drawing tools', summary: 'Tool behavior and coordinate systems.', keywords: 'select highlight text style pitch image' },
      { id: 'homography', label: 'Homography', summary: 'Pitch-space drawing and calibration.', keywords: 'pnlcalib pitch grid compute show delete' },
      { id: 'keyboard', label: 'Keyboard shortcuts', summary: 'Transport, editing, and presentation keys.', keywords: 'hotkeys commands space delete undo' },
      { id: 'glossary', label: 'Glossary', summary: 'Definitions of Annotate concepts.', keywords: 'terms definitions clip pin keyframe facet' },
      { id: 'project-files', label: 'Project files', summary: 'Local storage and safe backup behavior.', keywords: 'folder project json media analysis exports trash' },
      { id: 'troubleshooting', label: 'Troubleshooting', summary: 'Common failures and first checks.', keywords: 'offline popup slow broken error model' },
    ],
  },
];

const WORKFLOW_STEPS = [
  {
    title: 'Create the project',
    location: 'Opening screen',
    action: 'Choose Create New Project, enter the match details you know, and select a parent folder.',
    result: 'Annotate creates a normal project directory and opens its dashboard.',
  },
  {
    title: 'Import a video',
    location: 'Dashboard · Videos',
    action: 'Choose Import video and select the match file. Leave the launcher terminal open while media is prepared.',
    result: 'The video appears in the project with its own native frame rate and resolution.',
  },
  {
    title: 'Capture a clip',
    location: 'Capture player',
    action: 'Open the video, press a board button at the first frame of the passage, add any modifiers, then press the same button at the final frame.',
    result: 'A tagged clip appears in the relevant timeline lane and clip tree.',
  },
  {
    title: 'Add clip annotations',
    location: 'Clip editor',
    action: 'Open the clip, draw a highlight or tactical shape, then move it later in time to create another position keyframe. Use Track when a player needs frame-by-frame following.',
    result: 'The clip now has an animated tactical layer over the original match footage.',
  },
  {
    title: 'Add a pin annotation',
    location: 'Clip editor · Pins',
    action: 'Seek to the frame that requires a separate annotation and choose Add pin. Draw the pin annotation and optionally assign entrance animations.',
    result: 'The pin can pause clip playback or be used directly in a presentation.',
  },
  {
    title: 'Create a presentation',
    location: 'Presentations',
    action: 'Create a presentation, then drag clips and pins from the source browser into the slide deck. Reorder them and add title cards where needed.',
    result: 'Present mode plays the sequence full-screen using the original project media.',
  },
  {
    title: 'Export and back up',
    location: 'Dashboard · Export',
    action: 'Export the report when still images or clip data are needed. Back up the complete project folder rather than individual internal files.',
    result: 'Reports are written under exports/report and the authored project remains portable as one folder.',
  },
];

const DRAWING_TOOLS = [
  ['Select', 'Image or pitch', 'Select, move, resize, rotate, or box-select objects. Shift-click adds to a selection.'],
  ['Box', 'Image or pitch', 'A rectangular area. In Draw: pitch it stays fixed to the pitch plane as the camera moves.'],
  ['Circle', 'Image or pitch', 'An elliptical area with resize and rotation handles. Pitch mode behaves like Box.'],
  ['Highlight', 'Image', 'A player marker. It can be named, tracked, and used as an anchor for linked shapes.'],
  ['Shadow', 'Image', 'A defensive cover shadow with direct radius, direction, and spread handles.'],
  ['Arrow', 'Image', 'A directional action. Either endpoint can attach to a highlight.'],
  ['Lob', 'Image', 'A curved pass path with the same highlight-linking behavior as Arrow.'],
  ['Poly', 'Image', 'A closed area or open line. Vertices can attach independently to highlights.'],
  ['Text', 'Image', 'Static explanatory text. Style belongs to the object rather than individual keyframes.'],
];

const SHORTCUTS = [
  ['Capture', 'Board hotkey', 'Toggle the assigned clip range or modifier.'],
  ['Capture', 'Escape', 'Cancel re-tagging or the most recently started active range.'],
  ['Capture', 'Delete / Backspace', 'Move the selected clip to project trash.'],
  ['Clip editor', 'Space', 'Play, pause, trigger a pin animation, or resume from a pin.'],
  ['Clip editor', 'Left / Right', 'Step exactly one source-video frame.'],
  ['Clip editor', 'K', 'Add or replace a position keyframe at the current frame.'],
  ['Clip editor', 'Delete / Backspace', 'Delete the selected keyframe.'],
  ['Clip editor', 'Shift + Delete / Backspace', 'Delete the selected object.'],
  ['Clip editor', 'Cmd/Ctrl + Z', 'Undo the last editor change.'],
  ['Clip editor', 'Cmd/Ctrl + Shift + Z', 'Redo the last editor change. Ctrl + Y also works.'],
  ['Clip or pin editor', 'Enter', 'Finish a closed polygon.'],
  ['Clip or pin editor', 'Shift + Enter', 'Finish an open polygon line.'],
  ['Pin editor', 'Hold Left / Right', 'Preview up to five seconds around the pin.'],
  ['Pin editor', 'Space', 'Return to the exact editable pin frame.'],
  ['Present mode', 'Left / Right', 'Move backward, trigger the next animation, or advance.'],
  ['Present mode', 'Space / click', 'Trigger the next animation or resume a paused clip.'],
  ['Present mode', 'Escape', 'Exit full-screen presentation playback.'],
];

const GLOSSARY = [
  ['Annotation set', 'One independently saved frozen-frame explanation attached to a pin. A pin may contain several alternative sets.'],
  ['Board', 'The fixed spatial arrangement of capture buttons and modifiers used to tag passages during video review.'],
  ['Clip', 'A frame-bounded passage of play. Clips may overlap and remain independent even when they use the same source video.'],
  ['Coordinate mode', 'The space in which object geometry is stored: image pixels or pitch coordinates projected through homography.'],
  ['Facet / modifier', 'Additional structured information attached to a clip, such as outcome or phase detail.'],
  ['Homography', 'A frame-by-frame mapping between the visible image and the football pitch plane.'],
  ['Keyframe', 'An exact source-video frame where an animated object stores authored geometry or visibility.'],
  ['Object', 'A shape in the animated clip layer, such as a highlight, arrow, polygon, or text label.'],
  ['Pin', 'An important exact frame inside a clip. Pins own frozen-frame annotation sets and can pause clip playback.'],
  ['Presentation', 'An ordered sequence of clips, pins, and title cards with playback and transition settings.'],
  ['Source frame', 'The absolute frame number in an imported video. Annotate uses frames rather than approximate timestamps for authored timing.'],
  ['Tag', 'The primary board classification that describes what a captured clip represents.'],
  ['Tracking', 'Automatic player following that creates highlight position keyframes. Human reacquisition corrects losses or identity changes.'],
  ['Visibility keyframe', 'A show or hide event for an animated clip object. It does not store position.'],
];

const TROUBLESHOOTING = [
  ['A project folder will not open', 'Use a current Chromium browser and grant read/write access when asked. Safari and Firefox do not provide the required folder API.'],
  ['The sidecar is offline', 'Keep the launcher terminal open. Restart Annotate and confirm ports 3000 and 8321 are not already occupied. Check .runtime/app.log in the install folder.'],
  ['A pin opens nowhere', 'Allow pop-ups for localhost:3000 or 127.0.0.1:3000, then choose Add pin or Open pin again.'],
  ['The first tracking run cannot load', 'The first tracking action downloads the YOLO model. Confirm internet access and write access to the install folder.'],
  ['Homography is unavailable', 'Run scripts/setup-pnlcalib.sh from the install folder, restart Annotate, and verify the sidecar health indicator.'],
  ['Video import is slow', 'Compatible constant-frame-rate H.264 MP4 is preserved or remuxed. Other codecs and variable-frame-rate media require a full transcode. Canceling safely removes temporary import files.'],
  ['Tracking changes player during an overlap', 'Stop at the last trusted frame, choose Re-track from here, select the correct provisional player, and continue. Cancel leaves the original tail intact.'],
  ['The integrity report lists a missing item', 'Restore it from .trash when possible, or remove the broken presentation reference. Annotate reports the path rather than silently rewriting authored work.'],
];

function Section({ id, title, children, bordered = true }: {
  id: string;
  title: string;
  children: ReactNode;
  bordered?: boolean;
}) {
  return (
    <section id={id} className={`scroll-mt-6 py-10 ${bordered ? 'border-t border-border' : 'pt-0'}`}>
      <h2 className="mb-5 text-xl font-semibold text-primary">{title}</h2>
      {children}
    </section>
  );
}

function DemoPlaceholder({ id, number, title, description, duration }: {
  id: string;
  number: string;
  title: string;
  description: string;
  duration: string;
}) {
  return (
    <figure className="my-7" data-testid="guide-video-placeholder" data-video-id={id}>
      <div className="flex aspect-video items-center justify-center border border-border bg-black px-8 text-center">
        <div className="max-w-md">
          <span className="font-mono text-[11px] text-muted">DEMO {number} · {duration}</span>
          <p className="mb-1 mt-3 text-base font-semibold text-primary">{title}</p>
          <p className="m-0 text-sm leading-6 text-secondary">Video placeholder</p>
        </div>
      </div>
      <figcaption className="border-x border-b border-border px-3 py-2 text-xs leading-5 text-secondary">
        {description}
      </figcaption>
    </figure>
  );
}

function GuideTable({ headings, rows }: { headings: string[]; rows: string[][] }) {
  return (
    <div className="my-6 overflow-x-auto border-y border-border">
      <table className="w-full min-w-[620px] border-collapse text-left text-sm">
        <thead className="bg-surface text-xs text-secondary">
          <tr>{headings.map((heading) => <th key={heading} className="border-b border-border px-3 py-2 font-semibold">{heading}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join(':')} className="border-b border-border/70 last:border-b-0">
              {row.map((cell, index) => (
                <td key={`${index}:${cell}`} className={`px-3 py-3 align-top leading-5 ${index === 0 ? 'font-medium text-primary' : 'text-secondary'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GuideNavigation({
  normalizedQuery,
  searchResults,
  ariaLabel,
  className,
}: {
  normalizedQuery: string;
  searchResults: GuideLink[];
  ariaLabel: string;
  className: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      {normalizedQuery ? (
        <div>
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase text-muted">
            {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
          </p>
          {searchResults.length ? searchResults.map((entry) => (
            <a key={entry.id} href={`#${entry.id}`} className="block border-t border-border/60 px-2 py-2.5 first:border-t-0 hover:bg-hover">
              <span className="block text-sm font-medium text-primary">{entry.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">{entry.summary}</span>
            </a>
          )) : (
            <p className="px-2 py-3 text-xs leading-5 text-muted">No indexed section matches this search.</p>
          )}
        </div>
      ) : GUIDE_GROUPS.map((group) => (
        <div key={group.label} className="mb-5 last:mb-0">
          <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase text-muted">{group.label}</p>
          {group.links.map((entry) => (
            <a key={entry.id} href={`#${entry.id}`} className="block px-2 py-1.5 text-sm text-secondary hover:bg-hover hover:text-primary">
              {entry.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

export default function UserGuide() {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return GUIDE_GROUPS.flatMap((group) => group.links).filter((entry) => (
      `${entry.label} ${entry.summary} ${entry.keywords}`.toLowerCase().includes(normalizedQuery)
    ));
  }, [normalizedQuery]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-canvas" data-testid="user-guide">
      <div className="mx-auto grid min-h-full w-full max-w-[1480px] grid-cols-1 lg:grid-cols-[230px_minmax(0,900px)] 2xl:grid-cols-[230px_minmax(0,900px)_210px]">
        <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:h-[calc(100dvh-var(--app-header-height))] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="p-4">
            <label htmlFor="guide-search" className="mb-1.5 block text-[11px] font-semibold text-secondary">Search guide</label>
            <input
              id="guide-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tracking, pins, shortcuts…"
              className="w-full"
            />
          </div>
          <GuideNavigation
            normalizedQuery={normalizedQuery}
            searchResults={searchResults}
            ariaLabel="User guide"
            className="hidden border-t border-border px-2 py-3 lg:block"
          />
          <details className="border-t border-border lg:hidden" open={normalizedQuery ? true : undefined}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-primary">Browse sections</summary>
            <GuideNavigation
              normalizedQuery={normalizedQuery}
              searchResults={searchResults}
              ariaLabel="Mobile user guide"
              className="border-t border-border px-2 py-3"
            />
          </details>
        </aside>

        <article className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <header className="mb-10 border-b border-border pb-8">
            <h1 className="m-0 text-[30px] font-semibold leading-tight text-primary sm:text-[36px]">Annotate User Guide</h1>
            <p className="mb-0 mt-4 max-w-3xl text-base leading-7 text-secondary">
              Documentation for project setup, clip capture, annotation, tracking, pins, presentations, export, and project storage.
            </p>
          </header>

          <Section id="orientation" title="Overview" bordered={false}>
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>Annotate is a local application for football video analysis. A project contains imported videos, captured clips, frame pins, annotation data, presentations, exports, caches, and recoverable trash.</p>
              <p>Clip annotations are keyframed objects rendered over video. Pin annotations are documents attached to one exact source frame and may include entrance animations. Tracking generates highlight keyframes, while homography provides pitch coordinates for boxes and circles.</p>
              <p>Project data is stored in the selected project folder. The browser communicates with a Python sidecar on the same computer for video import, tracking, homography, and export operations.</p>
            </div>
            <div className="mt-7 grid border-y border-border sm:grid-cols-3">
              {[
                ['Clip', 'A half-open frame range within one imported video.'],
                ['Pin', 'One exact frame within a clip, with zero or more annotation sets.'],
                ['Presentation', 'An ordered sequence of clips, pins, and title cards.'],
              ].map(([title, body], index) => (
                <div key={title} className={`px-4 py-4 ${index ? 'border-t border-border sm:border-l sm:border-t-0' : ''}`}>
                  <h3 className="mb-1 mt-0 text-sm font-semibold text-primary">{title}</h3>
                  <p className="m-0 text-xs leading-5 text-secondary">{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="first-project" title="First project workflow">
            <p className="mb-6 text-sm leading-7 text-secondary">The following procedure creates a project, captures and annotates one clip, adds a pin, and places the resulting material in a presentation. Advanced styling and tracking correction are covered in later sections.</p>
            <ol className="m-0 list-none p-0">
              {WORKFLOW_STEPS.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
                  <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="m-0 text-base font-semibold text-primary">{step.title}</h3>
                      <span className="font-mono text-[11px] text-muted">{step.location}</span>
                    </div>
                    <p className="mb-1 mt-2 text-sm leading-6 text-secondary">{step.action}</p>
                    <p className="m-0 text-xs leading-5 text-muted"><strong className="font-medium text-secondary">Result:</strong> {step.result}</p>
                  </div>
                </li>
              ))}
            </ol>
            <DemoPlaceholder
              id="first-project"
              number="01"
              title="Complete first-project workflow"
              description="Reserved for a 60–90 second recording of project creation, video import, clip capture, pin annotation, and presentation authoring."
              duration="60–90 SEC"
            />
          </Section>

          <Section id="installation" title="Install and run">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>Use the quick-install command in the repository README. The installer creates a Desktop launcher and opens Annotate in a supported Chromium browser. Keep the launcher terminal open; closing it stops the web app and its local Python sidecar.</p>
              <p>Annotate currently supports Chrome, Edge, Brave, Arc, and Chromium. Safari and Firefox cannot grant the project-folder access the app requires. The browser may ask you to renew folder permission after a restart.</p>
              <p>Application logs are stored at <code className="font-mono text-xs text-primary">&lt;install-folder&gt;/.runtime/app.log</code>. The web interface normally runs at <code className="font-mono text-xs text-primary">http://localhost:3000</code> and the sidecar at <code className="font-mono text-xs text-primary">http://127.0.0.1:8321</code>.</p>
            </div>
          </Section>

          <Section id="capture" title="Capture and tag clips">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>The tag board is a fixed working surface rather than a menu. Press a main button once to start a clip and press the same button again to stop it. Active captures appear on the timeline before they are finished, and different clip types may overlap.</p>
              <p>Modifiers add structured details to the active capture. Their availability can change with the selected main tag, but the board itself remains in place. There is no automatic pre-roll or post-roll: the pressed frames become the clip boundaries.</p>
              <p>Click a clip in the timeline or tree to select it and seek to its start. While paused, choose <strong className="text-primary">Retag selected</strong> to change its classification, or drag it onto another tree group. <strong className="text-primary">Open editor</strong> opens the clip in a separate tab.</p>
              <p>The capture timeline uses separate group lanes and packs overlaps into subtracks. Click or drag to seek, scroll horizontally to move through time, and zoom between frame-level inspection and the whole match. Manual scrolling pauses automatic playhead following for five seconds.</p>
            </div>
          </Section>

          <Section id="clip-editor" title="Edit a clip">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>The clip editor combines the original video, animated tactical objects, a properties inspector, and a frame-native keyframe timeline. Playback never leaves the clip’s current in/out range.</p>
              <p>Drawing an object creates its first position keyframe. Move or transform it on another frame to add a new keyframe automatically; Annotate interpolates geometry between those authored positions. Color, line width, opacity, pattern, name, and other style properties belong to the object as a whole and are not keyframed.</p>
              <p>Use Select to click an object or drag an empty region for box selection. Shift-click adds objects in either the viewer or object list. Cmd-click on macOS or Ctrl-click on Linux subtracts them. Merge is available for selected objects of the same type when their position keyframes do not overlap.</p>
              <p>Choose <strong className="text-primary">Trim</strong> to move either boundary inward. Apply commits the range; Cancel leaves it untouched; Undo trim restores the previous bounds until another clip edit is committed.</p>
            </div>
            <h3 className="mb-3 mt-7 text-base font-semibold text-primary">Keyframe rules</h3>
            <ul className="space-y-2 pl-5 text-sm leading-6 text-secondary">
              <li>Position keyframes align to exact source-video frames.</li>
              <li>Manual and correction keyframes can be dragged horizontally; tracked keyframes are fixed.</li>
              <li>Delete removes selected keyframes. Shift+Delete removes selected objects.</li>
              <li>An object must retain at least one position keyframe.</li>
              <li>Visibility keyframes show or hide an object without changing its position.</li>
            </ul>
          </Section>

          <Section id="tracking" title="Track a player and correct mistakes">
            <ol className="space-y-3 pl-5 text-sm leading-7 text-secondary">
              <li>Seek to a clear frame and choose <strong className="text-primary">Track</strong>.</li>
              <li>Select the correct provisional player highlight, then choose <strong className="text-primary">Start</strong>. Choose Stop instead when only one manual frame is needed.</li>
              <li>Tracked frames appear live in the timeline. When continuity is lost, the tracked highlight hides and provisional candidates return.</li>
              <li>Move through the video until the player is identifiable, select the matching candidate, then choose <strong className="text-primary">Continue</strong>. Annotate fills the missing span linearly and resumes.</li>
              <li>For an identity switch or bad tail, stop at the last trusted frame and choose <strong className="text-primary">Re-track from here</strong>. Done replaces the provisional tail; Cancel restores the original.</li>
            </ol>
            <p className="mt-5 text-sm leading-7 text-secondary">Tracking uses image coordinates and does not require homography. Tracker IDs are continuity hints, not permanent player identity, so human correction remains expected around overlaps, camera cuts, and players leaving the frame.</p>
            <DemoPlaceholder
              id="tracking-correction"
              number="02"
              title="Track, lose, reacquire, and re-track"
              description="Reserved for a short correction demonstration showing candidate selection, a continuity loss, Continue, and replacement of an incorrect tracked tail."
              duration="45–60 SEC"
            />
          </Section>

          <Section id="pins" title="Pins, annotation sets, and animations">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>A pin identifies one exact frame inside a clip. Add one from the clip editor to open its frozen-frame editor in a new tab. A pin may contain multiple named annotation sets when the same moment needs alternative explanations.</p>
              <p>The pin editor uses the same drawing tools as the clip editor. Hold Left or Right to inspect up to five seconds of surrounding video; annotations hide and editing locks away from the pin frame. Space returns to the exact editable frame.</p>
              <p>Open <strong className="text-primary">Animations</strong> to assign one entrance effect per selected shape: Appear, Fade, Grow, or Wipe. Steps can run On click, With previous, or After previous, with editable delay, duration, and sequence order. Shapes without an entrance animation remain static.</p>
              <p>Clicking a pin marker in the clip timeline displays its annotation. Play starts the first annotation animation when one exists; otherwise it resumes the clip. A later Play, Space, or canvas click advances pending cues before returning to the clip.</p>
              <p><strong className="text-primary">Import into clip</strong> copies the active annotation set into the animated clip layer at the pin frame. Linked highlights remain linked, but the pin-owned entrance sequence is not converted into clip keyframes.</p>
            </div>
          </Section>

          <Section id="presentations" title="Create and play a presentation">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>Create a presentation from the dashboard or Presentations page. The authoring workspace contains an asset browser, live preview, horizontal slide deck, and inspector.</p>
              <p>Browse sources by tag or chronologically. Click an asset to preview it; drag a clip or pin into the deck to add it. Drag slide thumbnails to reorder them, and use Add title for title, section, or divider cards.</p>
              <p>Clip slides play original project video with animated clip annotations. Pin slides use the exact frozen source frame and selected annotation sets. Pin animation clicks are consumed before a clip resumes or a presentation advances.</p>
              <p>Cut changes directly to the next scene. Match video is available between forward-ordered pins from the same video and plays the intervening source footage. Present mode removes the editor UI and fills the viewport.</p>
            </div>
            <DemoPlaceholder
              id="presentation-authoring"
              number="03"
              title="Presentation authoring and playback"
              description="Reserved for a recording of asset preview, drag-to-add, slide reordering, pin animation playback, a match-video transition, and Present mode."
              duration="45–60 SEC"
            />
          </Section>

          <Section id="export-recovery" title="Export, recover, and inspect">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p><strong className="text-primary">Export report</strong> writes clip JSON, clip CSV, and one native-resolution PNG for every pin annotation set to <code className="font-mono text-xs text-primary">exports/report/</code>. Static PNGs show the completed annotation state rather than one instant of an entrance animation.</p>
              <p>Clip, pin, and annotation-set deletion first copies recoverable data into <code className="font-mono text-xs text-primary">.trash/</code>. Use the immediate Undo action when available. Empty trash permanently removes retained recovery operations.</p>
              <p>The dashboard integrity report lists missing media, unreadable documents, and unresolved presentation references. It is diagnostic: Annotate does not guess how to rewrite authored work.</p>
            </div>
          </Section>

          <Section id="workspace-map" title="Workspace map">
            <GuideTable headings={['Workspace', 'Purpose', 'Primary output']} rows={[
              ['Dashboard', 'Create/open projects, import video, edit match metadata, manage presentations, export, and inspect integrity.', 'Project configuration and reports'],
              ['Capture player', 'Watch a full video and tag overlapping passages with the fixed board.', 'Clips'],
              ['Clip editor', 'Animate tactical objects, track players, compute homography, trim inward, and add pins.', 'Clip annotations and pins'],
              ['Pin editor', 'Create one or more annotation sets and entrance-animation sequences on an exact frame.', 'Annotation documents'],
              ['Presentation editor', 'Arrange clips, pins, and title cards into an authored sequence.', 'Presentation'],
              ['Present mode', 'Play the sequence without authoring controls.', 'Full-screen playback'],
              ['Match details', 'Maintain teams, players, coaches, score, competition, venue, and other match metadata.', 'Project metadata'],
            ]} />
          </Section>

          <Section id="drawing-tools" title="Drawing tools and coordinates">
            <GuideTable headings={['Tool', 'Coordinates', 'Behavior']} rows={DRAWING_TOOLS} />
            <p className="text-sm leading-7 text-secondary">Arrow, Lob, Shadow, and individual Poly vertices can attach to highlights. Attached geometry follows its highlight through manual or tracked motion. Only Box and Circle use pitch coordinates; all other tools remain in image coordinates.</p>
          </Section>

          <Section id="homography" title="Homography and pitch drawing">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p><strong className="text-primary">Compute H</strong> runs PnLCalib across the clip, rejects implausible solutions, and interpolates usable matrices between sampled frames. Results are cached by source video and range.</p>
              <p>When homography is available, Box and Circle default to <strong className="text-primary">Draw: pitch</strong>. Their geometry and transform handles operate on the pitch plane, then project through the camera view for each frame.</p>
              <p><strong className="text-primary">Show H</strong> overlays the projected pitch grid for inspection. Recompute replaces the cached range; Delete H removes it and returns drawing to image coordinates. Pin calibration offers the same automatic solver plus a Manual H fallback for one frame.</p>
            </div>
          </Section>

          <Section id="keyboard" title="Keyboard shortcuts">
            <GuideTable headings={['Context', 'Shortcut', 'Action']} rows={SHORTCUTS} />
            <p className="text-xs leading-5 text-muted">Shortcuts are ignored while focus is inside a text input, text area, or select control.</p>
          </Section>

          <Section id="glossary" title="Glossary">
            <dl className="m-0 border-y border-border">
              {GLOSSARY.map(([term, definition]) => (
                <div key={term} className="grid border-b border-border/70 py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-5">
                  <dt className="text-sm font-semibold text-primary">{term}</dt>
                  <dd className="m-0 mt-1 text-sm leading-6 text-secondary sm:mt-0">{definition}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="project-files" title="Project files and backups">
            <div className="space-y-4 text-sm leading-7 text-secondary">
              <p>A project is an ordinary directory. Its manifest is <code className="font-mono text-xs text-primary">project.json</code>; source media lives under <code className="font-mono text-xs text-primary">media/</code>; clips and their annotation documents live under <code className="font-mono text-xs text-primary">analysis/</code>; presentations, exports, caches, and trash use their corresponding folders.</p>
              <p>Do not rename or move internal files while a project is open. To back up or move a project, close it and copy the complete folder. Videos are copied into the project, so storage must accommodate both the source file and project copy during import.</p>
              <p>Annotate 0.2 projects use the <code className="font-mono text-xs text-primary">project.v2</code> model and are not compatible with Annotate 0.1. Keep a pinned 0.1 installation for older projects.</p>
            </div>
          </Section>

          <Section id="troubleshooting" title="Troubleshooting">
            <div className="border-y border-border">
              {TROUBLESHOOTING.map(([problem, response]) => (
                <details key={problem} className="group border-b border-border/70 last:border-b-0">
                  <summary className="cursor-pointer list-none px-1 py-3 text-sm font-medium text-primary marker:hidden">
                    <span className="mr-2 inline-block w-3 font-mono text-muted group-open:hidden">+</span>
                    <span className="mr-2 hidden w-3 font-mono text-muted group-open:inline-block">−</span>
                    {problem}
                  </summary>
                  <p className="mb-4 ml-5 mt-0 pr-4 text-sm leading-6 text-secondary">{response}</p>
                </details>
              ))}
            </div>
          </Section>

        </article>

        <aside className="hidden border-l border-border bg-surface 2xl:block">
          <div className="sticky top-0 p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase text-muted">On this page</p>
            <nav aria-label="On this page" className="space-y-1 text-xs">
              {[
                ['first-project', 'First project'],
                ['capture', 'Capture'],
                ['clip-editor', 'Clip editor'],
                ['tracking', 'Tracking'],
                ['pins', 'Pins'],
                ['presentations', 'Presentations'],
                ['keyboard', 'Shortcuts'],
                ['glossary', 'Glossary'],
              ].map(([id, label]) => (
                <a key={id} href={`#${id}`} className="block py-1 text-secondary hover:text-primary">{label}</a>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </main>
  );
}

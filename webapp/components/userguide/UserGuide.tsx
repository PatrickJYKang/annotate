'use client';

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import { guideContent } from './content';
import type { GuideContent, GuideLink, TutorialId } from './content/types';
import { tutorialVideo } from './videos';

// Order of the tutorials in the index and their numbering.
const TUTORIAL_ORDER: TutorialId[] = [
  'first-project',
  'capture-tagging',
  'clip-editing',
  'clip-trimming',
  'basic-tracking',
  'tracking-correction',
  'tracking-refinements',
  'pin-annotation',
  'pin-animations',
  'homography',
  'presentation-authoring',
  'export-recovery',
];

// Renders the content markup: **bold** UI labels, `code`, and [text](url) links.
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="text-primary">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={index} className="break-all font-mono text-xs text-primary">{part.slice(1, -1)}</code>;
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="text-primary underline">{link[1]}</a>;
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function Prose({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="space-y-4 text-sm leading-7 text-secondary">
      {paragraphs.map((paragraph) => <p key={paragraph}><RichText text={paragraph} /></p>)}
    </div>
  );
}

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

function Subheading({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 mt-7 text-base font-semibold text-primary">{children}</h3>;
}

function TutorialVideo({ id, content }: { id: TutorialId; content: GuideContent }) {
  const { locale } = useLocale();
  const tutorial = content.tutorials[id];
  const number = String(TUTORIAL_ORDER.indexOf(id) + 1).padStart(2, '0');
  // Streamed from the online guide in the current language; a notice replaces it when offline.
  const video = tutorialVideo(id, locale);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <figure id={`video-${id}`} className="my-7 scroll-mt-6" data-testid="guide-video" data-video-id={id}>
      <div className="flex items-baseline justify-between gap-3 border-x border-t border-border bg-surface px-3 py-2">
        <span className="text-sm font-semibold text-primary">{tutorial.title}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted">{content.ui.video} {number}</span>
      </div>
      {failedSrc === video.src ? (
        <div className="flex aspect-[1440/930] items-center justify-center border border-border bg-black px-8 text-center">
          <p className="m-0 max-w-sm text-sm leading-6 text-secondary">{content.ui.videoOffline}</p>
        </div>
      ) : (
        <video
          key={video.src}
          className="block aspect-[1440/930] w-full border border-border bg-black"
          src={video.src}
          poster={video.poster}
          aria-label={tutorial.title}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailedSrc(video.src)}
        />
      )}
      <figcaption className="border-x border-b border-border px-3 py-2 text-xs leading-5 text-secondary">
        {tutorial.description}
      </figcaption>
    </figure>
  );
}

function TutorialIndex({ content }: { content: GuideContent }) {
  return (
    <ol className="m-0 grid list-none gap-px border border-border bg-border p-0 sm:grid-cols-2">
      {TUTORIAL_ORDER.map((id, index) => (
        <li key={id} className="bg-canvas">
          <a href={`#video-${id}`} className="flex h-full gap-3 px-4 py-3 hover:bg-hover">
            <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
            <span>
              <span className="block text-sm font-medium text-primary">{content.tutorials[id].title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">{content.tutorials[id].description}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
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
  content,
  normalizedQuery,
  searchResults,
  ariaLabel,
  className,
}: {
  content: GuideContent;
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
            {content.ui.resultCount(searchResults.length)}
          </p>
          {searchResults.length ? searchResults.map((entry) => (
            <a key={entry.id} href={`#${entry.id}`} className="block border-t border-border/60 px-2 py-2.5 first:border-t-0 hover:bg-hover">
              <span className="block text-sm font-medium text-primary">{entry.label}</span>
              <span className="mt-0.5 block text-xs leading-5 text-muted">{entry.summary}</span>
            </a>
          )) : (
            <p className="px-2 py-3 text-xs leading-5 text-muted">{content.ui.noResults}</p>
          )}
        </div>
      ) : content.groups.map((group) => (
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
  const { locale } = useLocale();
  const content = guideContent(locale);
  const english = guideContent('en');
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    // Match the current language and the English keywords, so English terms still work.
    const englishKeywords = new Map(english.groups.flatMap((group) => group.links).map((link) => [link.id, link.keywords]));
    return content.groups.flatMap((group) => group.links).filter((entry) => (
      `${entry.label} ${entry.summary} ${entry.keywords} ${englishKeywords.get(entry.id) ?? ''}`.toLowerCase().includes(normalizedQuery)
    ));
  }, [content, english, normalizedQuery]);

  const { overview, firstProject, clipEditor, tracking, pins } = content;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto bg-canvas" data-testid="user-guide">
      <div className="mx-auto grid min-h-full w-full max-w-[1480px] grid-cols-1 lg:grid-cols-[230px_minmax(0,900px)] 2xl:grid-cols-[230px_minmax(0,900px)_210px]">
        <aside className="border-b border-border bg-surface lg:sticky lg:top-0 lg:h-[calc(100dvh-var(--app-header-height))] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="p-4">
            <label htmlFor="guide-search" className="mb-1.5 block text-[11px] font-semibold text-secondary">{content.ui.searchLabel}</label>
            <input
              id="guide-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={content.ui.searchPlaceholder}
              className="w-full"
            />
          </div>
          <GuideNavigation
            content={content}
            normalizedQuery={normalizedQuery}
            searchResults={searchResults}
            ariaLabel={content.ui.navigationLabel}
            className="hidden border-t border-border px-2 py-3 lg:block"
          />
          <details className="border-t border-border lg:hidden" open={normalizedQuery ? true : undefined}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-primary">{content.ui.browseSections}</summary>
            <GuideNavigation
              content={content}
              normalizedQuery={normalizedQuery}
              searchResults={searchResults}
              ariaLabel={content.ui.mobileNavigationLabel}
              className="border-t border-border px-2 py-3"
            />
          </details>
        </aside>

        <article className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <header className="mb-10 border-b border-border pb-8">
            <h1 className="m-0 text-[30px] font-semibold leading-tight text-primary sm:text-[36px]">{content.title}</h1>
            <p className="mb-0 mt-4 max-w-3xl text-base leading-7 text-secondary">{content.lede}</p>
          </header>

          <Section id="orientation" title={overview.title} bordered={false}>
            <Prose paragraphs={overview.paragraphs} />
            <div className="mt-7 grid border-y border-border sm:grid-cols-3">
              {overview.cards.map(([title, body], index) => (
                <div key={title} className={`px-4 py-4 ${index ? 'border-t border-border sm:border-l sm:border-t-0' : ''}`}>
                  <h3 className="mb-1 mt-0 text-sm font-semibold text-primary">{title}</h3>
                  <p className="m-0 text-xs leading-5 text-secondary">{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="videos" title={content.videos.title}>
            <p className="mb-5 text-sm leading-7 text-secondary"><RichText text={content.videos.intro} /></p>
            <TutorialIndex content={content} />
          </Section>

          <Section id="first-project" title={firstProject.title}>
            <p className="mb-6 text-sm leading-7 text-secondary">{firstProject.intro}</p>
            <ol className="m-0 list-none p-0">
              {firstProject.steps.map((step, index) => (
                <li key={step.title} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-t border-border py-5 first:border-t-0 first:pt-0">
                  <span className="font-mono text-xs text-muted">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="m-0 text-base font-semibold text-primary">{step.title}</h3>
                      <span className="font-mono text-[11px] text-muted">{step.location}</span>
                    </div>
                    <p className="mb-1 mt-2 text-sm leading-6 text-secondary"><RichText text={step.action} /></p>
                    <p className="m-0 text-xs leading-5 text-muted"><strong className="font-medium text-secondary">{content.ui.result}</strong> {step.result}</p>
                  </div>
                </li>
              ))}
            </ol>
            <TutorialVideo id="first-project" content={content} />
          </Section>

          <Section id="installation" title={content.installation.title}>
            <Prose paragraphs={content.installation.paragraphs} />
          </Section>

          <Section id="capture" title={content.capture.title}>
            <Prose paragraphs={content.capture.paragraphs} />
            <TutorialVideo id="capture-tagging" content={content} />
          </Section>

          <Section id="clip-editor" title={clipEditor.title}>
            <Prose paragraphs={clipEditor.paragraphs} />
            <TutorialVideo id="clip-editing" content={content} />
            <Subheading>{clipEditor.trimTitle}</Subheading>
            <p className="text-sm leading-7 text-secondary"><RichText text={clipEditor.trim} /></p>
            <TutorialVideo id="clip-trimming" content={content} />
            <Subheading>{clipEditor.keyframeTitle}</Subheading>
            <ul className="space-y-2 pl-5 text-sm leading-6 text-secondary">
              {clipEditor.keyframeRules.map((rule) => <li key={rule}><RichText text={rule} /></li>)}
            </ul>
          </Section>

          <Section id="tracking" title={tracking.title}>
            <ol className="space-y-3 pl-5 text-sm leading-7 text-secondary">
              {tracking.steps.map((step) => <li key={step}><RichText text={step} /></li>)}
            </ol>
            <TutorialVideo id="basic-tracking" content={content} />
            <Subheading>{tracking.correctTitle}</Subheading>
            <Prose paragraphs={tracking.correct} />
            <TutorialVideo id="tracking-correction" content={content} />
            <Subheading>{tracking.namesTitle}</Subheading>
            <Prose paragraphs={tracking.names} />
            <TutorialVideo id="tracking-refinements" content={content} />
          </Section>

          <Section id="pins" title={pins.title}>
            <Prose paragraphs={pins.paragraphs} />
            <TutorialVideo id="pin-annotation" content={content} />
            <Subheading>{pins.animateTitle}</Subheading>
            <Prose paragraphs={pins.animate} />
            <TutorialVideo id="pin-animations" content={content} />
          </Section>

          <Section id="homography" title={content.homography.title}>
            <Prose paragraphs={content.homography.paragraphs} />
            <TutorialVideo id="homography" content={content} />
          </Section>

          <Section id="presentations" title={content.presentations.title}>
            <Prose paragraphs={content.presentations.paragraphs} />
            <TutorialVideo id="presentation-authoring" content={content} />
          </Section>

          <Section id="export-recovery" title={content.exportRecovery.title}>
            <Prose paragraphs={content.exportRecovery.paragraphs} />
            <TutorialVideo id="export-recovery" content={content} />
          </Section>

          <Section id="workspace-map" title={content.workspaceMap.title}>
            <GuideTable headings={content.workspaceMap.headings} rows={content.workspaceMap.rows} />
          </Section>

          <Section id="drawing-tools" title={content.drawingTools.title}>
            <GuideTable headings={content.drawingTools.headings} rows={content.drawingTools.rows} />
            <p className="text-sm leading-7 text-secondary"><RichText text={content.drawingTools.note} /></p>
          </Section>

          <Section id="keyboard" title={content.keyboard.title}>
            <GuideTable headings={content.keyboard.headings} rows={content.keyboard.rows} />
            <p className="text-xs leading-5 text-muted">{content.keyboard.note}</p>
          </Section>

          <Section id="glossary" title={content.glossary.title}>
            <dl className="m-0 border-y border-border">
              {content.glossary.entries.map(([term, definition]) => (
                <div key={term} className="grid border-b border-border/70 py-3 last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-5">
                  <dt className="text-sm font-semibold text-primary">{term}</dt>
                  <dd className="m-0 mt-1 text-sm leading-6 text-secondary sm:mt-0">{definition}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="project-files" title={content.projectFiles.title}>
            <Prose paragraphs={content.projectFiles.paragraphs} />
          </Section>

          <Section id="troubleshooting" title={content.troubleshooting.title}>
            <div className="border-y border-border">
              {content.troubleshooting.entries.map(([problem, response]) => (
                <details key={problem} className="group border-b border-border/70 last:border-b-0">
                  <summary className="cursor-pointer list-none px-1 py-3 text-sm font-medium text-primary marker:hidden">
                    <span className="mr-2 inline-block w-3 font-mono text-muted group-open:hidden">+</span>
                    <span className="mr-2 hidden w-3 font-mono text-muted group-open:inline-block">−</span>
                    {problem}
                  </summary>
                  <p className="mb-4 ml-5 mt-0 pr-4 text-sm leading-6 text-secondary"><RichText text={response} /></p>
                </details>
              ))}
            </div>
          </Section>

        </article>

        <aside className="hidden border-l border-border bg-surface 2xl:block">
          <div className="sticky top-0 p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase text-muted">{content.ui.onThisPage}</p>
            <nav aria-label={content.ui.onThisPage} className="space-y-1 text-xs">
              {content.onThisPage.map(([id, label]) => (
                <a key={id} href={`#${id}`} className="block py-1 text-secondary hover:text-primary">{label}</a>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </main>
  );
}

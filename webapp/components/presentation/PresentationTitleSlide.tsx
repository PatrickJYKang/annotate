"use client";

import type { TitleSlide } from '../../lib/types/presentation';

interface PresentationTitleSlideProps {
  slide: TitleSlide;
  compact?: boolean;
}

export default function PresentationTitleSlide({
  slide,
  compact = false,
}: PresentationTitleSlideProps) {
  const titleClass = compact
    ? 'text-[17px] leading-[1.08]'
    : 'text-[clamp(2.5rem,6vw,6.5rem)] leading-[0.98]';
  const bodyClass = compact
    ? 'mt-2 line-clamp-2 text-[8px] leading-tight'
    : 'mt-7 max-w-3xl text-[clamp(1rem,1.8vw,1.7rem)] leading-relaxed';

  if (slide.template === 'section') {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center bg-[#101722] px-[10%] text-center text-[#f1f4f7]"
        data-testid="presentation-title-slide"
        data-title-template="section"
      >
        <span className={`${compact ? 'mb-3 w-8' : 'mb-10 w-24'} h-px bg-[#67aaf0]`} />
        <h1 className={`m-0 max-w-5xl font-semibold ${titleClass}`}>{slide.title}</h1>
        {slide.body && <p className={`${bodyClass} text-[#aab5c3]`}>{slide.body}</p>}
        <span className={`${compact ? 'mt-3 w-8' : 'mt-10 w-24'} h-px bg-[#67aaf0]`} />
      </div>
    );
  }

  if (slide.template === 'divider') {
    return (
      <div
        className="grid h-full w-full grid-cols-[30%_70%] bg-[#0b1018] text-[#f1f4f7]"
        data-testid="presentation-title-slide"
        data-title-template="divider"
      >
        <div className="flex items-end bg-[#dce5ee] p-[14%] text-[#0b1018]">
          <span className={`${compact ? 'text-[9px]' : 'text-2xl'} font-semibold tabular-nums`}>{'//'}</span>
        </div>
        <div className="flex min-w-0 flex-col justify-center border-l border-[#364354] px-[11%] text-left">
          <h1 className={`m-0 font-semibold ${titleClass}`}>{slide.title}</h1>
          {slide.body && <p className={`${bodyClass} text-[#9ca9b8]`}>{slide.body}</p>}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col justify-end bg-[#0b1018] text-left text-[#f1f4f7]"
      data-testid="presentation-title-slide"
      data-title-template="title"
    >
      <div className={`${compact ? 'mx-4 mb-3 border-l-2 pl-3' : 'mx-[9%] mb-[8%] border-l-4 pl-8'} border-[#67aaf0]`}>
        <h1 className={`m-0 max-w-5xl font-semibold ${titleClass}`}>{slide.title}</h1>
        {slide.body && <p className={`${bodyClass} text-[#9ca9b8]`}>{slide.body}</p>}
      </div>
    </div>
  );
}

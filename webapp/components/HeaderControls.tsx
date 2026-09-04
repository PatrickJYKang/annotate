'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useCallback } from 'react';
import { SUPPORTED_LOCALES, useLocale, type Locale } from '../lib/i18n';

export default function HeaderControls() {
  const { locale, setLocale, t } = useLocale();
  const pathname = usePathname();
  const toggleBrowserFullscreen = useCallback(() => {
    const doc: any = document;
    const isFs = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (isFs) {
      if (doc.exitFullscreen) doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    } else {
      const el: any = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    }
  }, []);

  return (
    <>
      <h1><Link href="/">{t('app.title')}</Link></h1>
      <div className="flex items-stretch">
        <Link
          href="/userguide"
          aria-current={pathname === '/userguide' ? 'page' : undefined}
          className={`flex min-h-[37px] items-center border-l border-border px-4 text-xs no-underline ${
            pathname === '/userguide'
              ? 'bg-selected text-primary'
              : 'text-secondary hover:bg-hover hover:text-primary'
          }`}
        >
          {t('header.userGuide')}
        </Link>
        <label className="sr-only" htmlFor="app-locale">{t('header.locale')}</label>
        <select
          id="app-locale"
          aria-label={t('header.locale')}
          className="min-h-[37px] border-0 border-l border-border bg-transparent px-3 text-xs text-secondary"
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {SUPPORTED_LOCALES.map((candidate) => (
            <option key={candidate} value={candidate}>{t(`locale.${candidate}`)}</option>
          ))}
        </select>
        <button
          onClick={toggleBrowserFullscreen}
          title={t('header.fullscreen')}
          className="button-quiet self-stretch border-0 border-l border-solid border-border px-4 py-0 text-xs"
        >
          {t('header.fullscreen')}
        </button>
      </div>
    </>
  );
}

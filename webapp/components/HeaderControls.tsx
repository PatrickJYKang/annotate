'use client';

import React, { useCallback } from 'react';

export default function HeaderControls() {
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
    <button onClick={toggleBrowserFullscreen} title="Fullscreen" className="self-stretch border-0 border-l border-solid border-border px-4 py-0 text-base">Fullscreen</button>
  );
}

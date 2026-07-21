"use client";

import type { ComponentProps } from 'react';
import {
  Panel as ResizablePanel,
  PanelGroup as ResizablePanelGroup,
  PanelResizeHandle as ResizablePanelResizeHandle,
} from 'react-resizable-panels';

type PanelsProps = ComponentProps<typeof ResizablePanelGroup> & {
  autoSaveId: string;
};

export function Panels({ className = '', ...props }: PanelsProps) {
  return (
    <ResizablePanelGroup
      {...props}
      className={`min-h-0 min-w-0 ${className}`}
    />
  );
}

export function Panel({ className = '', ...props }: ComponentProps<typeof ResizablePanel>) {
  return (
    <ResizablePanel
      {...props}
      className={`min-h-0 min-w-0 overflow-hidden ${className}`}
    />
  );
}

type PanelResizeHandleProps = ComponentProps<typeof ResizablePanelResizeHandle> & {
  direction: 'horizontal' | 'vertical';
};

export function PanelResizeHandle({
  className = '',
  direction,
  ...props
}: PanelResizeHandleProps) {
  return (
    <ResizablePanelResizeHandle
      {...props}
      className={`group relative z-10 shrink-0 bg-border outline-none transition-colors hover:bg-accent focus-visible:bg-accent ${
        direction === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      } ${className}`}
    >
      <span className={`pointer-events-none absolute bg-secondary/70 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${
        direction === 'horizontal'
          ? 'bottom-1/2 left-1/2 h-8 w-px -translate-x-1/2 translate-y-1/2'
          : 'left-1/2 top-1/2 h-px w-8 -translate-x-1/2 -translate-y-1/2'
      }`} />
    </ResizablePanelResizeHandle>
  );
}

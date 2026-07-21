"use client";

import type { StrokePattern, Tool } from './Editor';
import ColorLinkToggle from './ColorLinkToggle';
import { useT } from '../../lib/i18n';

interface AnnotateToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  strokePattern: StrokePattern;
  onStrokePatternChange: (pattern: StrokePattern) => void;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  fillColor: string;
  onFillColorChange: (color: string) => void;
  colorsLinked: boolean;
  onColorsLinkedChange: (linked: boolean) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  fillOpacity: number;
  onFillOpacityChange: (opacity: number) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  textHighlight: boolean;
  onTextHighlightChange: (enabled: boolean) => void;
  disabled?: boolean;
  canAutoCalibrate?: boolean;
  isAutoCalibrating?: boolean;
  onAutoCalibrate?: () => void;
  hasHomography?: boolean;
  showHomography?: boolean;
  onShowHomographyChange?: (show: boolean) => void;
  onDeleteHomography?: () => void;
  status?: string | null;
  statusWarning?: boolean;
}

const TOOLS: Array<{ id: Exclude<Tool, 'calibrate'>; label: string }> = [
  { id: 'select', label: 'Select' },
  { id: 'box', label: 'Box' },
  { id: 'circle', label: 'Circle' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'lob', label: 'Lob' },
  { id: 'poly', label: 'Poly' },
  { id: 'text', label: 'Text' },
];

export default function AnnotateToolbar({
  tool,
  onToolChange,
  strokePattern,
  onStrokePatternChange,
  strokeColor,
  onStrokeColorChange,
  fillColor,
  onFillColorChange,
  colorsLinked,
  onColorsLinkedChange,
  strokeWidth,
  onStrokeWidthChange,
  fillOpacity,
  onFillOpacityChange,
  fontSize,
  onFontSizeChange,
  textHighlight,
  onTextHighlightChange,
  disabled = false,
  canAutoCalibrate = false,
  isAutoCalibrating = false,
  onAutoCalibrate,
  hasHomography = false,
  showHomography = false,
  onShowHomographyChange,
  onDeleteHomography,
  status = null,
  statusWarning = false,
}: AnnotateToolbarProps) {
  const t = useT();
  const hasStroke = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly', 'text'].includes(tool);
  const hasWidth = ['box', 'circle', 'highlight', 'shadow', 'arrow', 'lob', 'poly'].includes(tool);
  const hasPattern = hasWidth;
  const hasFill = ['box', 'circle', 'highlight', 'shadow', 'poly'].includes(tool);
  const hasFont = tool === 'text';
  const toolClass = (candidate: Tool) => `shrink-0 border-0 border-r border-solid border-border px-3 py-2 text-sm ${
    candidate === tool ? 'bg-active text-white' : 'bg-surface text-primary'
  }`;

  return (
    <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-border bg-surface">
      {TOOLS.map((entry) => (
        <button
          key={entry.id}
          className={toolClass(entry.id)}
          aria-pressed={tool === entry.id}
          disabled={disabled}
          onClick={() => onToolChange(entry.id)}
        >
          {t(`tool.${entry.id}`)}
        </button>
      ))}
      <button
        className="shrink-0 border-0 border-r border-solid border-border px-3 py-2 text-sm"
        disabled={disabled || !canAutoCalibrate || isAutoCalibrating}
        onClick={onAutoCalibrate}
      >
        <span className="flex items-center gap-2">
          {isAutoCalibrating && <span className="spinner h-3 w-3 border-2" aria-hidden="true" />}
          {isAutoCalibrating ? t('annotation.calibrating') : t('annotation.calibrate')}
        </span>
      </button>
      <button
        className={toolClass('calibrate')}
        aria-pressed={tool === 'calibrate'}
        disabled={disabled}
        onClick={() => onToolChange('calibrate')}
      >
        {t('annotation.manualHomography')}
      </button>
      <button
        className="shrink-0 border-0 border-r border-solid border-border px-3 py-2 text-sm"
        disabled={disabled || !hasHomography}
        aria-pressed={showHomography}
        onClick={() => onShowHomographyChange?.(!showHomography)}
      >
        {showHomography ? t('annotation.hideHomography') : t('annotation.showHomography')}
      </button>
      <button
        className="shrink-0 border-0 border-r border-solid border-border px-3 py-2 text-sm"
        disabled={disabled || !hasHomography}
        onClick={onDeleteHomography}
      >
        {t('annotation.deleteHomography')}
      </button>
      {status && (
        <div className={`flex shrink-0 items-center border-r border-border px-3 text-xs ${statusWarning ? 'text-warning' : 'text-muted'}`}>
          {status}
        </div>
      )}

      {hasStroke && (
        <div className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs">
          <span className="text-muted">{t('annotation.stroke')}</span>
          <input
            aria-label={t('annotation.strokeColor')}
            type="color"
            value={strokeColor}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value || '#000000';
              onStrokeColorChange(value);
              if (colorsLinked) onFillColorChange(value);
            }}
          />
          {hasFill && (
            <>
              <ColorLinkToggle
                linked={colorsLinked}
                disabled={disabled}
                onToggle={() => {
                  const linked = !colorsLinked;
                  onColorsLinkedChange(linked);
                  if (linked) onFillColorChange(strokeColor);
                }}
              />
              <span className="text-muted">{t('annotation.fill')}</span>
              <input
                aria-label={t('annotation.fillColor')}
                type="color"
                value={fillColor}
                disabled={disabled}
                onChange={(event) => {
                  const value = event.target.value || '#000000';
                  onFillColorChange(value);
                  if (colorsLinked) onStrokeColorChange(value);
                }}
              />
            </>
          )}
        </div>
      )}
      {hasWidth && (
        <label className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs text-muted">
          {t('annotation.width')}
          <input
            className="w-12"
            type="number"
            min={1}
            max={16}
            value={strokeWidth}
            disabled={disabled}
            onChange={(event) => onStrokeWidthChange(Math.max(1, Math.min(16, Number(event.target.value) || 1)))}
          />
        </label>
      )}
      {hasPattern && (
        <label className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs text-muted">
          {t('annotation.style')}
          <select
            value={strokePattern}
            disabled={disabled}
            onChange={(event) => onStrokePatternChange(event.target.value as StrokePattern)}
          >
            <option value="solid">{t('annotation.patternSolid')}</option>
            <option value="dashed">{t('annotation.patternDashed')}</option>
            <option value="dotted">{t('annotation.patternDotted')}</option>
            <option value="dashdot">{t('annotation.patternDashdot')}</option>
          </select>
        </label>
      )}
      {hasFill && (
        <label className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs text-muted">
          {t('annotation.opacity')}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(fillOpacity * 100)}
            disabled={disabled}
            onChange={(event) => onFillOpacityChange(Number(event.target.value) / 100)}
          />
          {Math.round(fillOpacity * 100)}%
        </label>
      )}
      {hasFont && (
        <label className="flex shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs text-muted">
          {t('annotation.size')}
          <input
            className="w-14"
            type="number"
            min={1}
            max={300}
            value={fontSize}
            disabled={disabled}
            onChange={(event) => onFontSizeChange(Math.max(1, Math.min(300, Number(event.target.value) || 48)))}
          />
        </label>
      )}
      {hasFont && (
        <label className="flex shrink-0 items-center gap-1.5 px-3 text-xs text-muted">
          <input
            type="checkbox"
            checked={textHighlight}
            disabled={disabled}
            onChange={(event) => onTextHighlightChange(event.target.checked)}
          />
          {t('annotation.textHighlight')}
        </label>
      )}
    </div>
  );
}

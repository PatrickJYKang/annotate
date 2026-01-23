"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { computePersonForegroundCutout } from "../../lib/segmentation/personSegmentation";
import { computeEdgeForegroundCutout } from "../../lib/segmentation/edgeSegmentation";

export default function SegmentationTestPage() {
  const [fileError, setFileError] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);

  const [method, setMethod] = useState<'edge' | 'ml'>('edge');

  const [maxDim, setMaxDim] = useState(720);

  const [edgePercentile, setEdgePercentile] = useState(0.92);
  const [dilateRadius, setDilateRadius] = useState(0);
  const [closeIterations, setCloseIterations] = useState(0);
  const [fillHoles, setFillHoles] = useState(true);
  const [maxComponentAreaFrac, setMaxComponentAreaFrac] = useState(0.25);

  const [internalResolution, setInternalResolution] = useState<"low" | "medium" | "high" | "full">("medium");
  const [segmentationThreshold, setSegmentationThreshold] = useState(0.7);
  const [foregroundThresholdProbability, setForegroundThresholdProbability] = useState(0.5);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const cutoutRef = useRef<HTMLCanvasElement | null>(null);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    setRatio(null);
    const f = e.target.files?.[0] || null;
    if (!f) return;
    const url = URL.createObjectURL(f);
    setImgUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const canRun = useMemo(() => {
    return !!imgUrl && !busy;
  }, [imgUrl, busy]);

  const run = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return;

    setBusy(true);
    setFileError(null);
    setRatio(null);

    try {
      const orig = originalRef.current;
      if (orig) {
        orig.width = w;
        orig.height = h;
        const ctx = orig.getContext("2d") as CanvasRenderingContext2D | null;
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0);
        }
      }

      const res = method === 'edge'
        ? await computeEdgeForegroundCutout(img, w, h, {
          maskMaxDim: maxDim,
          edgePercentile,
          dilateRadius,
          closeIterations,
          fillHoles,
          maxComponentAreaFrac,
        })
        : await computePersonForegroundCutout(img, w, h, {
          maskMaxDim: maxDim,
          internalResolution,
          segmentationThreshold,
          foregroundThresholdProbability,
        });

      if (!res) {
        setFileError(method === 'edge'
          ? "Edge segmentation failed (canvas readback error)."
          : "ML segmentation failed (model not loaded or inference error). Check the console and ensure deps are installed.");
        return;
      }

      setRatio(res.ratio);

      const maskCanvas = maskRef.current;
      if (maskCanvas) {
        maskCanvas.width = res.mask.width;
        maskCanvas.height = res.mask.height;
        const mctx = maskCanvas.getContext("2d") as CanvasRenderingContext2D | null;
        if (mctx) {
          mctx.putImageData(res.mask, 0, 0);
        }
      }

      const cutoutCanvas = cutoutRef.current;
      if (cutoutCanvas) {
        cutoutCanvas.width = res.w;
        cutoutCanvas.height = res.h;
        const cctx = cutoutCanvas.getContext("2d") as CanvasRenderingContext2D | null;
        if (cctx) {
          cctx.clearRect(0, 0, res.w, res.h);
          cctx.drawImage(res.cutout, 0, 0);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [closeIterations, dilateRadius, edgePercentile, fillHoles, foregroundThresholdProbability, internalResolution, maxComponentAreaFrac, maxDim, method, segmentationThreshold]);

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <input type="file" accept="image/*" onChange={onPick} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 0.9 }}>
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
            style={{ padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.2)", color: "white" }}
          >
            <option value="edge">Edge</option>
            <option value="ml">ML (BodyPix)</option>
          </select>
        </label>
        <button
          onClick={run}
          disabled={!canRun}
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: canRun ? "rgba(59,130,246,0.9)" : "rgba(107,114,128,0.6)", color: "white" }}
        >
          {busy ? "Running…" : "Run segmentation"}
        </button>
        {ratio != null && (
          <div style={{ opacity: 0.9, fontSize: 13 }}>
            Foreground ratio: {Math.round(ratio * 10000) / 100}%
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
          maskMaxDim
          <input
            type="number"
            value={maxDim}
            min={128}
            max={2048}
            step={64}
            onChange={(e) => setMaxDim(Math.max(128, Math.min(2048, Number(e.target.value) || 720)))}
            style={{ padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.2)", color: "white" }}
          />
        </label>

        {method === 'ml' ? (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
              internalResolution
              <select
                value={internalResolution}
                onChange={(e) => setInternalResolution(e.target.value as any)}
                style={{ padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.2)", color: "white" }}
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="full">full</option>
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
              segmentationThreshold ({segmentationThreshold.toFixed(2)})
              <input
                type="range"
                min={0.05}
                max={0.95}
                step={0.01}
                value={segmentationThreshold}
                onChange={(e) => setSegmentationThreshold(Number(e.target.value))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
              foregroundThresholdProbability ({foregroundThresholdProbability.toFixed(2)})
              <input
                type="range"
                min={0.05}
                max={0.95}
                step={0.01}
                value={foregroundThresholdProbability}
                onChange={(e) => setForegroundThresholdProbability(Number(e.target.value))}
              />
            </label>
          </>
        ) : (
          <>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
              edgePercentile ({edgePercentile.toFixed(2)})
              <input
                type="range"
                min={0.7}
                max={0.99}
                step={0.01}
                value={edgePercentile}
                onChange={(e) => setEdgePercentile(Number(e.target.value))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
              dilateRadius ({dilateRadius})
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={dilateRadius}
                onChange={(e) => setDilateRadius(Number(e.target.value))}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
              closeIterations ({closeIterations})
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                value={closeIterations}
                onChange={(e) => setCloseIterations(Number(e.target.value))}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9 }}>
              <input type="checkbox" checked={fillHoles} onChange={(e) => setFillHoles(e.target.checked)} />
              fillHoles
            </label>
          </>
        )}
      </div>

      {method === 'edge' && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, opacity: 0.9 }}>
            maxComponentAreaFrac ({maxComponentAreaFrac.toFixed(2)})
            <input
              type="range"
              min={0.05}
              max={0.9}
              step={0.01}
              value={maxComponentAreaFrac}
              onChange={(e) => setMaxComponentAreaFrac(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {fileError && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "rgba(255,255,255,0.92)" }}>
          {fileError}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Original</div>
          <canvas ref={originalRef} style={{ width: "100%", background: "rgba(0,0,0,0.25)", borderRadius: 8 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Mask (alpha = person probability)</div>
          <canvas ref={maskRef} style={{ width: "100%", background: "rgba(0,0,0,0.25)", borderRadius: 8 }} />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Cutout</div>
          <canvas ref={cutoutRef} style={{ width: "100%", background: "rgba(0,0,0,0.25)", borderRadius: 8 }} />
        </div>
      </div>

      {imgUrl && (
        <img
          ref={imgRef}
          src={imgUrl}
          alt="Segmentation input"
          onLoad={() => {
            setFileError(null);
            setRatio(null);
          }}
          style={{ display: "none" }}
        />
      )}
    </div>
  );
}

export type EdgeSegmentationOptions = {
  maxDim?: number;
  maskMaxDim?: number;
  cutoutMaxDim?: number;
  edgePercentile?: number;
  dilateRadius?: number;
  closeIterations?: number;
  fillHoles?: boolean;
  minComponentArea?: number;
  maxComponentAreaFrac?: number;
  suppressLongThin?: boolean;
  longThinAspect?: number;
  longThinMaxAreaFrac?: number;
};

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v | 0));
}

function dilateBinarySquare(src: Uint8Array<ArrayBufferLike>, w: number, h: number, r: number): Uint8Array<ArrayBufferLike> {
  if (r <= 0) return new Uint8Array(src);
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const win = 2 * r + 1;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) {
      const xx = clampInt(x, 0, w - 1);
      sum += src[row + xx] ? 1 : 0;
    }
    tmp[row + 0] = sum > 0 ? 1 : 0;
    for (let x = 1; x < w; x++) {
      const xAdd = clampInt(x + r, 0, w - 1);
      const xSub = clampInt(x - r - 1, 0, w - 1);
      sum += src[row + xAdd] ? 1 : 0;
      sum -= src[row + xSub] ? 1 : 0;
      tmp[row + x] = sum > 0 ? 1 : 0;
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const yy = clampInt(y, 0, h - 1);
      sum += tmp[yy * w + x] ? 1 : 0;
    }
    out[0 * w + x] = sum > 0 ? 1 : 0;
    for (let y = 1; y < h; y++) {
      const yAdd = clampInt(y + r, 0, h - 1);
      const ySub = clampInt(y - r - 1, 0, h - 1);
      sum += tmp[yAdd * w + x] ? 1 : 0;
      sum -= tmp[ySub * w + x] ? 1 : 0;
      out[y * w + x] = sum > 0 ? 1 : 0;
    }
  }

  return out;
}

function erodeBinarySquare(src: Uint8Array<ArrayBufferLike>, w: number, h: number, r: number): Uint8Array<ArrayBufferLike> {
  if (r <= 0) return new Uint8Array(src);
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const win = 2 * r + 1;
  const need = win;

  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) {
      const xx = clampInt(x, 0, w - 1);
      sum += src[row + xx] ? 1 : 0;
    }
    tmp[row + 0] = sum === need ? 1 : 0;
    for (let x = 1; x < w; x++) {
      const xAdd = clampInt(x + r, 0, w - 1);
      const xSub = clampInt(x - r - 1, 0, w - 1);
      sum += src[row + xAdd] ? 1 : 0;
      sum -= src[row + xSub] ? 1 : 0;
      tmp[row + x] = sum === need ? 1 : 0;
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const yy = clampInt(y, 0, h - 1);
      sum += tmp[yy * w + x] ? 1 : 0;
    }
    out[0 * w + x] = sum === need ? 1 : 0;
    for (let y = 1; y < h; y++) {
      const yAdd = clampInt(y + r, 0, h - 1);
      const ySub = clampInt(y - r - 1, 0, h - 1);
      sum += tmp[yAdd * w + x] ? 1 : 0;
      sum -= tmp[ySub * w + x] ? 1 : 0;
      out[y * w + x] = sum === need ? 1 : 0;
    }
  }

  return out;
}

function fillHoles(mask: Uint8Array<ArrayBufferLike>, w: number, h: number): Uint8Array<ArrayBufferLike> {
  const visited = new Uint8Array(w * h);
  const qx: number[] = [];
  const qy: number[] = [];

  const push = (x: number, y: number) => {
    const idx = y * w + x;
    if (visited[idx]) return;
    if (mask[idx]) return;
    visited[idx] = 1;
    qx.push(x);
    qy.push(y);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (qx.length) {
    const x = qx.pop() as number;
    const y = qy.pop() as number;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }

  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) {
    if (!mask[i] && !visited[i]) out[i] = 1;
  }
  return out;
}

function suppressComponents(mask: Uint8Array<ArrayBufferLike>, w: number, h: number, opts: Required<Pick<EdgeSegmentationOptions, 'minComponentArea' | 'maxComponentAreaFrac' | 'suppressLongThin' | 'longThinAspect' | 'longThinMaxAreaFrac'>>): Uint8Array<ArrayBufferLike> {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(w * h);
  const q: number[] = [];
  const maxLongThinArea = Math.max(1, Math.floor(w * h * opts.longThinMaxAreaFrac));
  const maxComponentArea = Math.max(1, Math.floor(w * h * opts.maxComponentAreaFrac));

  for (let i = 0; i < out.length; i++) {
    if (!out[i] || seen[i]) continue;
    let area = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const comp: number[] = [];

    q.push(i);
    seen[i] = 1;

    while (q.length) {
      const idx = q.pop() as number;
      comp.push(idx);
      const y = Math.floor(idx / w);
      const x = idx - y * w;
      area++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;

      const tryPush = (nx: number, ny: number) => {
        const nidx = ny * w + nx;
        if (seen[nidx] || !out[nidx]) return;
        seen[nidx] = 1;
        q.push(nidx);
      };

      if (x > 0) tryPush(x - 1, y);
      if (x + 1 < w) tryPush(x + 1, y);
      if (y > 0) tryPush(x, y - 1);
      if (y + 1 < h) tryPush(x, y + 1);
    }

    const bw = Math.max(1, maxX - minX + 1);
    const bh = Math.max(1, maxY - minY + 1);
    const aspect = Math.max(bw / bh, bh / bw);

    const drop = area < opts.minComponentArea
      || area > maxComponentArea
      || (opts.suppressLongThin && aspect >= opts.longThinAspect && area <= maxLongThinArea);
    if (drop) {
      for (let j = 0; j < comp.length; j++) {
        out[comp[j]] = 0;
      }
    }
  }

  return out;
}

export async function computeEdgeForegroundCutout(
  image: CanvasImageSource,
  width: number,
  height: number,
  opts?: EdgeSegmentationOptions,
): Promise<null | { cutout: HTMLCanvasElement; mask: ImageData; ratio: number; w: number; h: number; maskW: number; maskH: number }> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const maskMaxDim = Math.max(64, Math.min(2048, opts?.maskMaxDim ?? opts?.maxDim ?? 720));
  const maskScale = Math.min(1, maskMaxDim / Math.max(w, h));
  const mw = Math.max(1, Math.round(w * maskScale));
  const mh = Math.max(1, Math.round(h * maskScale));

  const cutoutMaxDim = Math.max(64, Math.min(4096, opts?.cutoutMaxDim ?? Math.min(4096, Math.max(w, h))));
  const cutoutScale = Math.min(1, cutoutMaxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * cutoutScale));
  const ch = Math.max(1, Math.round(h * cutoutScale));

  const maskInput = document.createElement('canvas');
  maskInput.width = mw;
  maskInput.height = mh;
  const ctx = maskInput.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, mw, mh);

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(0, 0, mw, mh);
  } catch {
    return null;
  }

  const d = imgData.data;
  const gray = new Uint8Array(mw * mh);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    gray[p] = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0;
  }

  const blurred = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let sum = 0;
      let cnt = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = clampInt(y + oy, 0, mh - 1);
        for (let ox = -1; ox <= 1; ox++) {
          const xx = clampInt(x + ox, 0, mw - 1);
          sum += gray[yy * mw + xx];
          cnt++;
        }
      }
      blurred[y * mw + x] = (sum / cnt) | 0;
    }
  }

  const mags = new Uint16Array(mw * mh);
  const hist = new Uint32Array(2041);
  for (let y = 1; y < mh - 1; y++) {
    for (let x = 1; x < mw - 1; x++) {
      const i = y * mw + x;
      const a00 = blurred[(y - 1) * mw + (x - 1)];
      const a01 = blurred[(y - 1) * mw + x];
      const a02 = blurred[(y - 1) * mw + (x + 1)];
      const a10 = blurred[y * mw + (x - 1)];
      const a12 = blurred[y * mw + (x + 1)];
      const a20 = blurred[(y + 1) * mw + (x - 1)];
      const a21 = blurred[(y + 1) * mw + x];
      const a22 = blurred[(y + 1) * mw + (x + 1)];
      const gx = (-a00 + a02) + (-2 * a10 + 2 * a12) + (-a20 + a22);
      const gy = (-a00 - 2 * a01 - a02) + (a20 + 2 * a21 + a22);
      const mag = Math.min(2040, (Math.abs(gx) + Math.abs(gy)) | 0);
      mags[i] = mag;
      hist[mag]++;
    }
  }

  const pct = Math.max(0.5, Math.min(0.999, opts?.edgePercentile ?? 0.92));
  const total = Math.max(1, (mw - 2) * (mh - 2));
  const targetBelow = Math.floor(total * pct);
  let cum = 0;
  let thresh = 0;
  for (let v = 0; v < hist.length; v++) {
    cum += hist[v];
    if (cum >= targetBelow) {
      thresh = v;
      break;
    }
  }

  const edges = new Uint8Array(mw * mh);
  for (let i = 0; i < mags.length; i++) {
    edges[i] = mags[i] >= thresh ? 1 : 0;
  }

  const dilateR = Math.max(0, Math.min(24, opts?.dilateRadius ?? 2));
  const closeIts = Math.max(0, Math.min(6, opts?.closeIterations ?? 1));
  let mask: Uint8Array<ArrayBufferLike> = edges;

  mask = dilateBinarySquare(mask, mw, mh, dilateR);
  for (let k = 0; k < closeIts; k++) {
    mask = erodeBinarySquare(dilateBinarySquare(mask, mw, mh, 1), mw, mh, 1);
  }

  if (opts?.fillHoles ?? true) {
    mask = fillHoles(mask, mw, mh);
  }

  const filtered = suppressComponents(mask, mw, mh, {
    minComponentArea: Math.max(1, opts?.minComponentArea ?? Math.floor(mw * mh * 0.00025)),
    maxComponentAreaFrac: Math.max(0.01, Math.min(0.95, opts?.maxComponentAreaFrac ?? 0.25)),
    suppressLongThin: opts?.suppressLongThin ?? true,
    longThinAspect: Math.max(2, opts?.longThinAspect ?? 14),
    longThinMaxAreaFrac: Math.max(0.00001, Math.min(0.1, opts?.longThinMaxAreaFrac ?? 0.01)),
  });

  let fgCount = 0;
  const maskImageData = new ImageData(mw, mh);
  const md = maskImageData.data;
  for (let i = 0, p = 0; i < md.length; i += 4, p++) {
    const a = filtered[p] ? 255 : 0;
    md[i] = 0;
    md[i + 1] = 0;
    md[i + 2] = 0;
    md[i + 3] = a;
    if (a) fgCount++;
  }
  const ratio = fgCount / (mw * mh);

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = mw;
  maskCanvas.height = mh;
  const mctx = maskCanvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!mctx) return null;
  mctx.putImageData(maskImageData, 0, 0);

  let maskForCutout = maskCanvas;
  if (cw !== mw || ch !== mh) {
    const hi = document.createElement('canvas');
    hi.width = cw;
    hi.height = ch;
    const hctx = hi.getContext('2d') as CanvasRenderingContext2D | null;
    if (!hctx) return null;
    hctx.imageSmoothingEnabled = true;
    hctx.clearRect(0, 0, cw, ch);
    hctx.drawImage(maskCanvas, 0, 0, cw, ch);
    maskForCutout = hi;
  }

  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const octx = out.getContext('2d') as CanvasRenderingContext2D | null;
  if (!octx) return null;
  octx.drawImage(image, 0, 0, cw, ch);
  octx.globalCompositeOperation = 'destination-in';
  octx.drawImage(maskForCutout, 0, 0);
  octx.globalCompositeOperation = 'source-over';

  return { cutout: out, mask: maskImageData, ratio, w: cw, h: ch, maskW: mw, maskH: mh };
}

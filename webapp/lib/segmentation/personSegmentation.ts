export type PersonSegmentationOptions = {
  maxDim?: number;
  maskMaxDim?: number;
  cutoutMaxDim?: number;
  internalResolution?: 'low' | 'medium' | 'high' | 'full' | number;
  segmentationThreshold?: number;
  foregroundThresholdProbability?: number;
};

let bodySegmentationPromise: Promise<any> | null = null;
let segmenterPromise: Promise<any> | null = null;

async function loadBodySegmentation() {
  if (!bodySegmentationPromise) {
    bodySegmentationPromise = (async () => {
      const tf = await import('@tensorflow/tfjs-core');
      await import('@tensorflow/tfjs-converter');
      await import('@tensorflow/tfjs-backend-webgl');
      try {
        await (tf as any).setBackend('webgl');
      } catch {
      }
      try {
        await (tf as any).ready();
      } catch {
      }
      return import('@tensorflow-models/body-segmentation');
    })();
  }
  return bodySegmentationPromise;
}

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const bodySegmentation = await loadBodySegmentation();
      const model = bodySegmentation.SupportedModels.BodyPix;
      const segmenterConfig = {
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.75,
        quantBytes: 2,
      };
      return bodySegmentation.createSegmenter(model, segmenterConfig);
    })();
  }
  return segmenterPromise;
}

export async function computePersonForegroundCutout(
  image: CanvasImageSource,
  width: number,
  height: number,
  opts?: PersonSegmentationOptions,
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

  const input = document.createElement('canvas');
  input.width = mw;
  input.height = mh;
  const ictx = input.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ictx) return null;
  ictx.drawImage(image, 0, 0, mw, mh);

  const segmenter = await getSegmenter();
  const segmentationConfig = {
    multiSegmentation: false,
    segmentBodyParts: false,
    internalResolution: opts?.internalResolution ?? 'medium',
    segmentationThreshold: opts?.segmentationThreshold ?? 0.7,
    flipHorizontal: false,
  };

  let people: any;
  try {
    people = await segmenter.segmentPeople(input, segmentationConfig);
  } catch {
    return null;
  }

  const bodySegmentation = await loadBodySegmentation();
  const foregroundColor = { r: 0, g: 0, b: 0, a: 255 };
  const backgroundColor = { r: 0, g: 0, b: 0, a: 0 };

  let maskImageData: ImageData;
  try {
    maskImageData = await bodySegmentation.toBinaryMask(
      people,
      foregroundColor,
      backgroundColor,
      false,
      opts?.foregroundThresholdProbability ?? 0.5,
    );
  } catch {
    return null;
  }

  let fgCount = 0;
  const d = maskImageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] >= 128) fgCount++;
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

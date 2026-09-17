import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { resolveResourceLayout, sidecarEnvironment } from '../core/resource-layout.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const resourceRoot = path.resolve(process.argv[2]);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotate-bundle-check-'));
try {
  const layout = await resolveResourceLayout(resourceRoot, temporary);
  const env = sidecarEnvironment(layout, { token: 'a'.repeat(64), origins: ['http://127.0.0.1:39999'],
    inherited: { HOME: temporary, PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin',
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) } });
  env.ANNOTATE_CHECK_VIDEO = path.join(root, 'webapp/e2e/fixtures/clip-editor-project/media/retrieval-sample.mp4');
  const source = `
import os, subprocess, json, time
import cv2, torch, torchvision, numpy, scipy, fastapi, supervision
from annotate_sidecar.routes.health import _check_capabilities
from annotate_sidecar.services.calibration.providers.pnlcalib import PnLCalibCalibrationProvider
from ultralytics import YOLO
started = time.monotonic()
caps = _check_capabilities()
assert caps['models']['pnlcalib'], caps
assert caps['models']['yolo'], caps
for name in ['ffmpeg', 'ffprobe']:
    subprocess.run([name, '-version'], check=True, stdout=subprocess.DEVNULL)
video = os.environ['ANNOTATE_CHECK_VIDEO']
cap = cv2.VideoCapture(video)
ok, frame = cap.read()
cap.release()
assert ok
result = YOLO(os.environ['ANNOTATE_TRACKING_MODEL']).predict(frame, device='cpu', verbose=False)
assert len(result) == 1
frames = PnLCalibCalibrationProvider().estimate_range(video, 0, 0, fps=25)
assert len(frames) == 1, frames
output = os.path.join(os.environ['TMPDIR'], 'export.mp4')
subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-t', '0.25', '-c:v', 'libx264', '-threads', '2', output], check=True)
assert os.path.getsize(output) > 0
print(json.dumps({'python': __import__('sys').version, 'torch': torch.__version__, 'capabilities': caps, 'homography_frames': len(frames), 'seconds': time.monotonic() - started}))
`;
  const child = spawn(layout.resources.python, ['-c', source], { cwd: temporary, env, stdio: 'inherit' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Runtime check exited ${code}`))); });
} finally { await rm(temporary, { recursive: true, force: true }); }

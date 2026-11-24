import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolveResourceLayout, sidecarEnvironment } from '../core/resource-layout.mjs';

// Real-footage regression fixture: a match longer than frame 17137 and 600080ms.
// Keep media local; the report retains hashes and model outputs, not video pixels.
const [original, candidate, video] = process.argv.slice(2);
if (!original || !candidate || !video) throw new Error('Usage: node desktop/scripts/check-opencv-parity.mjs <original-runtime> <candidate-runtime> <football.mp4>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const parent = path.join(root, 'desktop/build');
await mkdir(parent, { recursive: true });
const report = await mkdtemp(path.join(parent, 'opencv-parity-'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'annotate-cv-parity-'));
try {
  const results = [];
  for (const runtime of [original, candidate]) {
    const layout = await resolveResourceLayout(path.resolve(runtime), temporary);
    const env = sidecarEnvironment(layout, { token: 'a'.repeat(64), origins: ['http://127.0.0.1:39999'], inherited: { HOME: temporary, PATH: '/usr/bin:/bin' } });
    env.VIDEO = path.resolve(video);
    const started = performance.now();
    const run = spawnSync(layout.resources.python, ['-c', `
import cv2, os, json, random, dataclasses, hashlib
import numpy as np
import torch
random.seed(0); np.random.seed(0); torch.manual_seed(0); torch.set_num_threads(2)
from annotate_sidecar.ultralytics_runtime import load_ultralytics
model=load_ultralytics().YOLO(os.environ['ANNOTATE_TRACKING_MODEL'])
cap=cv2.VideoCapture(os.environ['VIDEO']); assert cap.isOpened()
frames=[]; detections=[]
for index in [0,300,16483,16484,16485,17137]:
 cap.set(cv2.CAP_PROP_POS_FRAMES,index); ok,frame=cap.read(); assert ok
 frames.append({'index':index,'shape':frame.shape,'sha256':hashlib.sha256(frame.tobytes()).hexdigest()})
 detections.append(model.predict(frame,device='cpu',verbose=False)[0].boxes.data.tolist())
cap.release()
from annotate_sidecar.vendor.trackers.core.ultralytics_ocsort import UltralyticsOCSORTCore
core=UltralyticsOCSORTCore(model_name=os.environ['ANNOTATE_TRACKING_MODEL'])
tracks=core.track_video_range(os.environ['VIDEO'],659320,661280,fps=25)
assert len(tracks)==50
from annotate_sidecar.services.calibration.providers.pnlcalib import PnLCalibCalibrationProvider
homographies=PnLCalibCalibrationProvider().estimate_range(os.environ['VIDEO'],600000,600080,fps=25)
assert len(homographies)==3 and all(f.method!='failed' for f in homographies)
print('RESULT:'+json.dumps({'cv2':cv2.__file__,'frames':frames,'detections':detections,'tracks':[dataclasses.asdict(f) for f in tracks],'homography':[dataclasses.asdict(f) for f in homographies]}))
`], { cwd: temporary, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const result = JSON.parse(run.stdout.split('\n').find(line => line.startsWith('RESULT:')).slice(7));
    results.push({ runtime: path.resolve(runtime), seconds: (performance.now() - started) / 1000, ...result });
  }
  const output = path.join(report, 'results.json');
  await writeFile(output, JSON.stringify(results, null, 2) + '\n');
  assert.deepEqual(results[0].frames, results[1].frames);
  assert.deepEqual(results[0].detections, results[1].detections);
  assert.deepEqual(results[0].tracks, results[1].tracks);
  const check = spawnSync(path.join(candidate, 'python/bin/python3.12'), ['-c', `
import json,sys,numpy as np
a,b=json.load(open(sys.argv[1]))
pts=np.array([[u,v,1] for u in range(0,106,15) for v in range(0,69,17)]).T
errors=[]
for h,j in zip(a['homography'],b['homography']):
 assert h['tMs']==j['tMs'] and h['method']==j['method']
 x=np.linalg.inv(np.array(h['matrix']).reshape(3,3))@pts
 y=np.linalg.inv(np.array(j['matrix']).reshape(3,3))@pts
 error=float(np.linalg.norm(x[:2]/x[2]-y[:2]/y[2],axis=0).max())
 assert np.isfinite(error) and error < 0.0001, error
 errors.append(error)
print(json.dumps(errors))
`, output], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr + check.stdout);
  const summary = { passed: true, decodedFramesEqual: 6, detectionsEqual: true, trackingFramesEqual: 50, maxPitchGridPixelErrors: JSON.parse(check.stdout), seconds: results.map(result => result.seconds) };
  await writeFile(path.join(report, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ report, ...summary }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }

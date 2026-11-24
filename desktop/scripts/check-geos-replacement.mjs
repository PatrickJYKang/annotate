// Build and load a modified LGPL library in an isolated package copy.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256File } from '../core/resource-layout.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (process.platform !== 'darwin' || process.arch !== 'arm64' || !process.argv[2]) throw new Error('Usage on Apple Silicon: node desktop/scripts/check-geos-replacement.mjs <candidate-runtime>');
const runtime = path.resolve(process.argv[2]);
const original = path.join(runtime, 'python/lib/python3.12/site-packages/shapely');
const directory = await mkdtemp(path.join(root, 'desktop/build/geos-replacement-'));
const input = JSON.parse(await readFile(path.join(root, 'desktop/compliance/sources.lock.json'), 'utf8')).archives.find(item => item.name === 'shapely-geos');
const archive = path.join(root, 'desktop/build/downloads', input.filename);
assert.equal(await sha256File(archive), input.sha256);
const before = {};
for (const name of await readdir(path.join(original, '.dylibs'))) before[name] = await sha256File(path.join(original, '.dylibs', name));
const commands = [];
const run = (command, args, options = {}) => {
  commands.push({ command, args });
  return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
};
try {
  run('tar', ['-xf', archive, '-C', directory]);
  const source = path.join(directory, 'geos-3.13.1');
  const file = path.join(source, 'capi/geos_ts_c.cpp');
  const text = await readFile(file, 'utf8');
  const statement = 'snprintf(version, 256, "%s", GEOS_CAPI_VERSION);';
  assert.equal(text.split(statement).length, 2);
  // A unique version suffix proves the modified library, not the original, loaded.
  await writeFile(file, text.replace(statement, 'snprintf(version, 256, "%s-annotate-replacement-test", GEOS_CAPI_VERSION);'));
  const build = path.join(directory, 'build');
  await writeFile(path.join(directory, 'configure.log'), run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=ON', '-DBUILD_TESTING=OFF', '-DBUILD_BENCHMARKS=OFF', '-DBUILD_DOCUMENTATION=OFF', '-DCMAKE_INSTALL_NAME_DIR=@loader_path']));
  await writeFile(path.join(directory, 'build.log'), run('cmake', ['--build', build, '--parallel', '2']));
  const copy = path.join(directory, 'site-packages/shapely');
  await mkdir(path.dirname(copy));
  await cp(original, copy, { recursive: true });
  for (const name of Object.keys(before)) {
    const destination = path.join(copy, '.dylibs', name);
    await cp(path.join(build, 'lib', name), destination);
    run('install_name_tool', ['-id', `@loader_path/${name}`, destination]);
    if (name === 'libgeos_c.1.19.2.dylib') {
      run('install_name_tool', ['-change', '@rpath/libgeos.3.13.1.dylib', '@loader_path/libgeos.3.13.1.dylib', destination]);
      run('install_name_tool', ['-delete_rpath', path.join(build, 'lib'), destination]);
    }
    run('codesign', ['--force', '--sign', '-', destination]);
  }
  const probe = String.raw`
import ctypes, json, os, sys
import shapely
from shapely.geometry import Point, Polygon, LineString
from shapely.ops import unary_union
expected, marker = sys.argv[1:]
assert os.path.realpath(os.path.dirname(shapely.__file__)) == os.path.realpath(expected)
dyld = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
dyld._dyld_image_count.restype = ctypes.c_uint32
dyld._dyld_get_image_name.argtypes = [ctypes.c_uint32]
dyld._dyld_get_image_name.restype = ctypes.c_char_p
loaded = [dyld._dyld_get_image_name(i).decode() for i in range(dyld._dyld_image_count())]
libraries = [p for p in loaded if '/libgeos' in p]
assert len(libraries) == 2 and all(os.path.realpath(p).startswith(os.path.realpath(expected) + os.sep) for p in libraries), libraries
library = ctypes.CDLL(next(p for p in libraries if '/libgeos_c.' in p))
library.GEOSversion.restype = ctypes.c_char_p
version = library.GEOSversion().decode()
assert marker in version if marker else 'annotate-replacement-test' not in version, version
square = Polygon([(0,0), (2,0), (2,2), (0,2)])
other = Polygon([(1,1), (3,1), (3,3), (1,3)])
assert square.contains(Point(1,1)) and square.covers(Point(0,0))
assert square.intersection(other).area == 1
assert unary_union([square, other]).area == 7
assert LineString([(0,0), (1,1), (2,2)]).simplify(0.01).length > 2.8
assert 3.13 < Point(0,0).buffer(1).area < 3.15
print(json.dumps({'version': version, 'loadedLibraries': libraries, 'checks': ['contains', 'covers', 'intersection', 'union', 'simplify', 'buffer']}))
`;
  const check = (location, marker) => JSON.parse(run(path.join(runtime, 'python/bin/python3'), ['-c', probe, location, marker], { cwd: directory, env: { ...process.env, PYTHONPATH: path.dirname(location), PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' } }));
  const baseline = check(original, '');
  const modified = check(copy, 'annotate-replacement-test');
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ input, baseline, modified, originalLibrariesUnchanged: true, scope: 'Mac component replacement; not final notarized app or native Windows testing.' }, null, 2) + '\n');
  console.log(`PASS: modified GEOS library loaded; six geometry operations passed. Report: ${directory}/report.json`);
} finally {
  for (const [name, hash] of Object.entries(before)) assert.equal(await sha256File(path.join(original, '.dylibs', name)), hash);
  await writeFile(path.join(directory, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
}

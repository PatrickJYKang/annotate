import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('desktop icon includes high-resolution PNG, Mac ICNS and multiresolution Windows ICO', async () => {
  const png = await readFile(new URL('../icons/annotate.png', import.meta.url));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);

  const icns = await readFile(new URL('../icons/annotate.icns', import.meta.url));
  assert.equal(icns.subarray(0, 4).toString(), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const types = new Set();
  let offset = 8;
  while (offset < icns.length) {
    const size = icns.readUInt32BE(offset + 4);
    assert.ok(size >= 8 && offset + size <= icns.length);
    types.add(icns.subarray(offset, offset + 4).toString());
    offset += size;
  }
  assert.equal(offset, icns.length);
  assert.ok(types.has('ic10'), 'Mac icon must include 1024px artwork');

  const ico = await readFile(new URL('../icons/annotate.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = [];
  for (let index = 0; index < ico.readUInt16LE(4); index++) {
    const entry = 6 + 16 * index;
    const width = ico[entry] || 256;
    assert.equal(ico[entry + 1] || 256, width);
    const bytes = ico.readUInt32LE(entry + 8);
    const start = ico.readUInt32LE(entry + 12);
    assert.ok(bytes > 0 && start >= 6 + 16 * ico.readUInt16LE(4) && start + bytes <= ico.length);
    sizes.push(width);
  }
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 32, 48, 64, 128, 256]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machoEvidence, sameMachOBuild } from '../scripts/macho-evidence.mjs';

function fixture() {
  const bytes = Buffer.alloc(32 + 24 + 152 + 4);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x100000c, 4);
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(176, 20);
  bytes.writeUInt32LE(0x1b, 32);
  bytes.writeUInt32LE(24, 36);
  bytes.fill(42, 40, 56);
  bytes.writeUInt32LE(0x19, 56);
  bytes.writeUInt32LE(152, 60);
  bytes.writeUInt32LE(1, 120);
  bytes.write('__text', 128);
  bytes.write('__TEXT', 144);
  bytes.writeBigUInt64LE(4n, 168);
  bytes.writeUInt32LE(208, 176);
  bytes.writeUInt32LE(0x80000400, 192);
  bytes.writeUInt32LE(0xd65f03c0, 208);
  return bytes;
}

test('identifies relocated Mach-O builds by UUID and instruction bytes, not filename', () => {
  const bytes = fixture();
  const actual = machoEvidence(bytes);
  assert.equal(actual.uuid, '2a'.repeat(16));
  assert.equal(actual.instructions[0].section, '__text');
  assert.equal(sameMachOBuild(actual, machoEvidence(bytes)), true);
  bytes[208] ^= 1;
  assert.equal(sameMachOBuild(actual, machoEvidence(bytes)), false);
  bytes[208] ^= 1;
  bytes[40] ^= 1;
  assert.equal(sameMachOBuild(actual, machoEvidence(bytes)), false);
  assert.equal(sameMachOBuild({ ...actual, instructions: [] }, { ...actual, instructions: [] }), false);
});

test('rejects truncated tables, unsupported binaries and out-of-range sections', () => {
  assert.throws(() => machoEvidence(Buffer.alloc(100)), /thin/);
  assert.throws(() => machoEvidence(fixture().subarray(0, 100)), /command table/);
  let bytes = fixture();
  bytes.writeUInt32LE(0xffff, 36);
  assert.throws(() => machoEvidence(bytes), /command size/);
  bytes = fixture();
  bytes.writeUInt32LE(1000, 176);
  assert.throws(() => machoEvidence(bytes), /instruction range/);
  bytes = fixture();
  bytes.writeUInt32LE(1000, 120);
  assert.throws(() => machoEvidence(bytes), /sections/);
});

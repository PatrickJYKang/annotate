import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complianceOpenGates } from '../scripts/prepare-compliance.mjs';

test('Windows runtime entitlement does not incorrectly block a Mac-only review', () => {
  const mac = complianceOpenGates('darwin-arm64', { noticesCurrent: true }, [{ notices: ['LICENSE'] }]);
  assert.equal(mac.some(gate => /Windows|Microsoft|PnLCalib/.test(gate)), false);
  assert.ok(mac.some(gate => /corresponding-source/.test(gate)));
  const windows = complianceOpenGates('win32-x64', { noticesCurrent: false }, [{ notices: [] }]);
  for (const required of ['Windows', 'Microsoft', 'PnLCalib', 'Missing package']) assert.ok(windows.some(gate => gate.includes(required)));
  assert.ok(windows.some(gate => gate.includes('Microsoft runtime redistribution verification')));
  assert.ok(windows.some(gate => gate.includes('file/version scope')));
  const controlled = complianceOpenGates('darwin-arm64', { noticesCurrent: true }, [{ notices: ['LICENSE'] }], { controlledOpenCV: {} });
  assert.deepEqual(controlled, ['Final packaged-app source/rebuild and replacement verification']);
  const checkedWindows = complianceOpenGates('win32-x64', { noticesCurrent: true }, [{ notices: ['LICENSE'] }], { microsoftRuntime: { filesVerified: true }, controlledWindowsFFmpeg: {} });
  assert.equal(checkedWindows.some(gate => /Microsoft|linked-library/.test(gate)), false);
  assert.ok(checkedWindows.some(gate => /Native Windows/.test(gate)));
});

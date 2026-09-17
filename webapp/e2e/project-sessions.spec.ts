import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

test('an editor reuses live project access without a permission click, including refresh', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(page, path.resolve('e2e/fixtures/clip-editor-project'), {
    renewPermissionInEditor: true,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await page.getByTestId('clip-tree-row-clip-sequence').click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  const editor = await popup;
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  const sessionId = new URL(editor.url()).searchParams.get('projectSession');
  expect(sessionId).toBeTruthy();
  expect(await editor.evaluate(() => window.opener)).toBeNull();
  await editor.reload();
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  await expect(editor.getByText('Press broken through midfield', { exact: true })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Reconnect project' })).toHaveCount(0);
  expect(await editor.evaluate(() => sessionStorage.getItem('test-permission-attempts'))).toBeNull();
  expect(new URL(editor.url()).searchParams.get('projectSession')).toBe(sessionId);
});

test('an editor reconnects an expired stored folder when no authorized tab remains', async ({ page, context }) => {
  // OPFS grants permission implicitly; model the external-folder activation requirement.
  await installOpfsDirectoryPickerFixture(page, path.resolve('e2e/fixtures/clip-editor-project'), {
    renewPermissionInEditor: true,
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByRole('heading', { name: 'Clip editor fixture' })).toBeVisible();
  const sessionId = await page.evaluate(() => sessionStorage.getItem('annotate:project-session'));
  expect(sessionId).toBeTruthy();
  await page.close();
  const editor = await context.newPage();
  await editor.goto(`/clip/clip-sequence?projectSession=${sessionId}`);
  const reconnect = editor.getByRole('button', { name: 'Reconnect project' });
  await expect(reconnect).toBeVisible();
  await expect(editor.getByText('No project is open.')).toHaveCount(0);
  expect(await editor.evaluate(() => sessionStorage.getItem('test-permission-attempts'))).toBeNull();
  await reconnect.click();
  await expect(reconnect).toBeVisible();
  await expect(editor.getByRole('alert').filter({ hasText: 'Reconnect' })).toBeVisible();
  await reconnect.click();
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  expect(await editor.evaluate(() => sessionStorage.getItem('test-permission-without-activation'))).toBeNull();
  expect(await editor.evaluate(() => sessionStorage.getItem('test-permission-attempts'))).toBe('2');
  expect(new URL(editor.url()).searchParams.get('projectSession')).toBe(sessionId);
  await editor.reload();
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  await expect(editor.getByText('Press broken through midfield', { exact: true })).toBeVisible();
  expect(await editor.evaluate(() => sessionStorage.getItem('test-permission-attempts'))).toBe('2');
});

test('an editor keeps its original project after another project is opened, including refresh', async ({ page, context }) => {
  await installOpfsDirectoryPickerFixture(page, path.resolve('e2e/fixtures/clip-editor-project'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Open capture player' }).click();
  await page.getByTestId('clip-tree-row-clip-sequence').click();
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  const editor = await popup;
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  const originalId = new URL(editor.url()).searchParams.get('projectSession');
  expect(originalId).toBeTruthy();

  const second = await context.newPage();
  await second.goto('/');
  // Build another real OPFS project with the same clip IDs and distinguish its label.
  await second.evaluate(async () => {
    const storage = await navigator.storage.getDirectory();
    const source = await storage.getDirectoryHandle('clip-editor-project');
    const destination = await storage.getDirectoryHandle('different-project', { create: true });
    const copy = async (from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle) => {
      for await (const [name, entry] of from.entries()) {
        if (entry.kind === 'directory') await copy(entry, await to.getDirectoryHandle(name, { create: true }));
        else {
          const output = await (await to.getFileHandle(name, { create: true })).createWritable();
          await output.write(await entry.getFile());
          await output.close();
        }
      }
    };
    await copy(source, destination);
    const manifestFile = await destination.getFileHandle('project.json');
    const manifest = JSON.parse(await (await manifestFile.getFile()).text());
    manifest.name = 'Second project';
    const writer = await manifestFile.createWritable();
    await writer.write(JSON.stringify(manifest));
    await writer.close();
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => destination });
  });
  // Close this tab's first project, then explicitly open the second folder.
  await second.getByRole('button', { name: 'Close project', exact: true }).click();
  await second.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(second.getByRole('heading', { name: 'Second project' })).toBeVisible();

  await editor.reload();
  await expect(editor.getByTestId('clip-editor')).toBeVisible();
  expect(new URL(editor.url()).searchParams.get('projectSession')).toBe(originalId);
  await editor.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(editor.getByRole('heading', { name: 'Clip editor fixture' })).toBeVisible();
  await editor.reload();
  await expect(editor.getByRole('heading', { name: 'Clip editor fixture' })).toBeVisible();

  // An unavailable explicit session must never fall through to the recent project.
  const missing = await context.newPage();
  await missing.goto('/clip/clip-sequence?projectSession=missing-session');
  await expect(missing.getByTestId('clip-editor')).toHaveCount(0);
  await missing.goto('/?projectSession=missing-session');
  await expect(missing.getByText(/project session is unavailable/)).toBeVisible();
});

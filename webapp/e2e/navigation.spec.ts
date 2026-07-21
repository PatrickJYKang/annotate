import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  installOpfsDirectoryPickerFixture,
  setOpfsProjectPermission,
} from './support/fsAccessFixture';

const fixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');

async function openProject(page: import('@playwright/test').Page): Promise<void> {
  await installOpfsDirectoryPickerFixture(page, fixture);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByTestId('project-dashboard')).toBeVisible();
}

test('navigates both dashboard wings and restores every deep route', async ({ page }) => {
  await openProject(page);

  await expect(page.getByRole('heading', { name: 'Analysis', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Presentations', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Match info' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Empty Trash' })).toBeVisible();

  await page.getByTestId('video-card-video-main').getByRole('button', { name: /Open player/ }).click();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Match info' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('capture-player')).toBeVisible();

  await page.getByTestId('clip-tree-row-clip-sequence').click();
  const editorPagePromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open editor' }).click();
  page = await editorPagePromise;
  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Player', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Player', exact: true }).click();
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.getByTestId('project-dashboard')).toBeVisible();

  await page.getByLabel('New presentation name').fill('Navigation review');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  let card = page.locator('[data-testid^="presentation-card-"]').filter({ hasText: 'Navigation review' });
  await expect(card).toHaveCount(1);

  await card.getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel('Rename Navigation review').fill('Navigation review renamed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  card = page.locator('[data-testid^="presentation-card-"]').filter({ hasText: 'Navigation review renamed' });
  await expect(card).toHaveCount(1);

  await card.getByRole('button', { name: 'Duplicate' }).click();
  const copy = page.locator('[data-testid^="presentation-card-"]').filter({ hasText: 'Navigation review renamed copy' });
  await expect(copy).toHaveCount(1);
  await copy.getByRole('button', { name: 'Delete' }).click();
  await copy.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(copy).toHaveCount(0);

  await card.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('presentation-editor')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('presentation-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByTestId('project-dashboard')).toBeVisible();

  await page.goto('/presentations');
  await expect(page.getByTestId('presentations-list')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('presentations-list')).toBeVisible();
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.getByTestId('project-dashboard')).toBeVisible();
});

test('clears a denied persisted handle and allows an explicit reopen', async ({ page }) => {
  await openProject(page);
  await setOpfsProjectPermission(page, fixture, 'denied');
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText(/permission is unavailable/)).toBeVisible();
  const keys = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('annotate-db', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = database.transaction('handles', 'readonly').objectStore('handles').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
  expect(keys).not.toContain('project');

  await setOpfsProjectPermission(page, fixture, 'granted');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await expect(page.getByTestId('project-dashboard')).toBeVisible();
});

test('clears a structurally stale persisted handle without partial project state', async ({ page }) => {
  await openProject(page);
  await page.evaluate(async () => {
    const project = await (window as Window & {
      showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker();
    await project.removeEntry('project.json');
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByText('Missing project.json.')).toBeVisible();
  await expect(page.getByTestId('project-dashboard')).toHaveCount(0);
});

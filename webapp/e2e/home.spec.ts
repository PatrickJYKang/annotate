import { expect, test } from '@playwright/test';

test('homepage renders the project chooser', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Open or create a project folder to get started.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create New Project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Existing Project' })).toBeVisible();
});

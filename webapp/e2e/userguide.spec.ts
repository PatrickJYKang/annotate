import { expect, test } from '@playwright/test';

test('opens the indexed user guide from the header and searches its reference', async ({ page }) => {
  await page.goto('/');

  const guideLink = page.getByRole('link', { name: 'User guide' });
  await expect(guideLink).toBeVisible();
  await guideLink.click();

  await expect(page).toHaveURL(/\/userguide$/);
  await expect(guideLink).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('user-guide')).toBeVisible();
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Annotate User Guide',
  })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'User guide' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'First project workflow' })).toBeVisible();
  await expect(page.getByTestId('guide-video-placeholder')).toHaveCount(3);
  await expect(page.getByText('Keyframe', { exact: true })).toBeVisible();

  const search = page.getByLabel('Search guide');
  await search.fill('tracking');
  const desktopIndex = page.getByRole('navigation', { name: 'User guide' });
  await expect(desktopIndex.getByText('1 result', { exact: true })).toBeVisible();
  const trackingResult = desktopIndex.getByRole('link', { name: /Track and correct/ });
  await expect(trackingResult).toBeVisible();
  await trackingResult.click();
  await expect(page).toHaveURL(/\/userguide#tracking$/);
  await expect(page.getByRole('heading', { name: 'Track a player and correct mistakes' })).toBeInViewport();

  await page.locator('#app-locale').selectOption('fr');
  await expect(page.getByRole('link', { name: 'Guide d’utilisation' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Annotate', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('keeps the guide readable on a narrow screen without leading with the full index', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/userguide');

  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Annotate User Guide',
  })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'User guide' })).toBeHidden();
  const browse = page.getByText('Browse sections', { exact: true });
  await expect(browse).toBeVisible();
  await browse.click();
  await expect(page.getByRole('navigation', { name: 'Mobile user guide' })).toBeVisible();

  const guideBounds = await page.getByTestId('user-guide').boundingBox();
  expect(guideBounds?.width).toBeLessThanOrEqual(390);
});

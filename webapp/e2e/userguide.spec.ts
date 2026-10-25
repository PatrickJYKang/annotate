import { expect, test } from '@playwright/test';

const ONLINE_GUIDE = 'https://patrickjykang.github.io/annotate-docs/';

test('links the header user guide button to the online guide in the current language', async ({ page }) => {
  await page.goto('/');

  const guideLink = page.getByRole('link', { name: 'User guide', exact: true });
  await expect(guideLink).toBeVisible();
  await expect(guideLink).toHaveAttribute('href', `${ONLINE_GUIDE}?lang=en`);
  await expect(guideLink).toHaveAttribute('target', '_blank');

  for (const [locale, label] of [['fr', 'Guide d’utilisation'], ['es', 'Guía de usuario'], ['zh-CN', '用户指南']] as const) {
    await page.locator('#app-locale').selectOption(locale);
    await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('href', `${ONLINE_GUIDE}${locale}/`);
  }

  // Opening the guide leaves the app where it was.
  await page.locator('#app-locale').selectOption('en');
  await page.context().route(`${ONLINE_GUIDE}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Annotate User Guide</title>' }));
  const popup = page.waitForEvent('popup');
  await guideLink.click();
  expect((await popup).url()).toBe(`${ONLINE_GUIDE}?lang=en`);
  await expect(page).toHaveURL(/\/$/);
});

test('removes the bundled guide route', async ({ page }) => {
  const response = await page.goto('/userguide');
  expect(response?.status()).toBe(404);
});

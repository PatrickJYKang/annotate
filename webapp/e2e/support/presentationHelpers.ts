import type { Locator, Page } from '@playwright/test';

export function presentationMarkRow(page: Page, pattern: RegExp): Locator {
  return page.getByRole('button', { name: pattern }).first();
}

export async function activatePresentationMarkRow(page: Page, pattern: RegExp): Promise<void> {
  const row = presentationMarkRow(page, pattern);
  await row.scrollIntoViewIfNeeded();
  await row.evaluate((element: HTMLButtonElement) => {
    element.click();
  });
}

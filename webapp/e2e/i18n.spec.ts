import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { installOpfsDirectoryPickerFixture } from './support/fsAccessFixture';

const fixture = path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project');

async function expectNoRawTranslationKeys(page: Page): Promise<void> {
  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/\b(?:app|header|locale|common|project|player|tagBoard|tagTree|video|annotation|clip|pin|timeline|tool|presentation|metadata|export)\.[A-Za-z][A-Za-z0-9.-]*/);
}

test('switches to French and Spanish and persists the selected locale', async ({ page }) => {
  await page.goto('/');

  const locale = page.locator('#app-locale');
  await locale.selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('heading', { name: 'Projets' })).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await locale.selectOption('es');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await page.reload();
  await expect(page.locator('#app-locale')).toHaveValue('es');
  await expect(page.getByRole('heading', { name: 'Proyectos' })).toBeVisible();
});

test('switches every primary route to zh-CN and persists locale-dependent interpolation', async ({ page }) => {
  await installOpfsDirectoryPickerFixture(page, fixture);
  await page.goto('/');

  const locale = page.locator('#app-locale');
  await locale.selectOption('zh-CN');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: 'Annotate' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '项目' })).toBeVisible();
  await page.getByRole('button', { name: '打开现有项目' }).click();

  await expect(page.getByTestId('project-dashboard')).toBeVisible();
  await expect(page.getByRole('heading', { name: '分析', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '演示文稿', exact: true })).toBeVisible();
  await expect(page.getByTestId('integrity-summary')).toContainText('0 个错误 · 0 个警告');
  await expectNoRawTranslationKeys(page);

  await page.reload();
  await expect(page.locator('#app-locale')).toHaveValue('zh-CN');
  await expect(page.getByTestId('project-dashboard')).toBeVisible();

  await page.goto('/player');
  await expect(page.getByTestId('capture-player')).toBeVisible();
  await expect(page.getByTestId('tag-board')).toBeVisible();
  await expect(page.getByTestId('tag-board-mode')).toHaveText('采集');
  await expect(page.getByText(/第 0 帧 \/ 共 49 帧/)).toBeVisible();
  await expect(page.getByText('Offensive - open play', { exact: true }).first()).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await page.goto('/clip/clip-sequence');
  await expect(page.getByTestId('clip-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: '选择', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '帧标记' })).toBeVisible();
  await expect(page.getByText(/第 5 帧 · 片段 5–44/)).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await page.goto('/presentation/presentation-sequence');
  await expect(page.getByTestId('presentation-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回', exact: true })).toBeVisible();
  await expect(page.getByText('片段和帧标记', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '检查器' })).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await page.goto('/presentations');
  await expect(page.getByTestId('presentations-list')).toBeVisible();
  await expect(page.getByRole('heading', { name: '演示文稿' })).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await page.goto('/metadata');
  await expect(page.getByRole('heading', { name: '比赛详情' })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即保存' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '主队' })).toBeVisible();
  await expectNoRawTranslationKeys(page);

  await page.locator('#app-locale').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Match Details' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#app-locale')).toHaveValue('en');
  await expect(page.getByRole('heading', { name: 'Match Details' })).toBeVisible();
});

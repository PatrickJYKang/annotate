import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installDirectoryPickerFixture } from './support/fsAccessFixture';

test('does not replace active metadata typing with an older save result', async ({ page }) => {
  await installDirectoryPickerFixture(
    page,
    path.resolve(process.cwd(), 'e2e/fixtures/clip-editor-project'),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Existing Project' }).click();
  await page.getByRole('button', { name: 'Match info' }).click();

  await page.evaluate(async () => {
    (window as Window & { __manifestWriteEvents?: string[] }).__manifestWriteEvents = [];
    const project = (window as Window & {
      __playwrightProjectHandle?: FileSystemDirectoryHandle;
    }).__playwrightProjectHandle;
    if (!project) throw new Error('Project fixture handle is unavailable.');

    const file = await project.getFileHandle('project.json');
    const prototype = Object.getPrototypeOf(file) as {
      createWritable: () => Promise<FileSystemWritableFileStream>;
    };
    const createWritable = prototype.createWritable;
    prototype.createWritable = async function delayedCreateWritable() {
      const writable = await createWritable.call(this);
      const close = writable.close.bind(writable);
      writable.close = async () => {
        (window as Window & { __manifestWriteEvents?: string[] })
          .__manifestWriteEvents?.push('close-start');
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        await close();
        (window as Window & { __manifestWriteEvents?: string[] })
          .__manifestWriteEvents?.push('close-end');
      };
      return writable;
    };
  });

  const coach = page.getByLabel('Coach').first();
  await coach.fill('A');
  await page.waitForFunction(() => (
    (window as Window & { __manifestWriteEvents?: string[] })
      .__manifestWriteEvents?.includes('close-start')
  ));
  await coach.pressSequentially('lex', { delay: 40 });
  await expect(coach).toHaveValue('Alex');
  await coach.evaluate((element) => {
    const input = element as HTMLInputElement;
    const state = window as Window & {
      __metadataValueSamples?: string[];
      __stopMetadataSampling?: () => void;
    };
    state.__metadataValueSamples = [];
    const timer = window.setInterval(() => {
      state.__metadataValueSamples?.push(input.value);
    }, 10);
    state.__stopMetadataSampling = () => window.clearInterval(timer);
  });
  await page.waitForFunction(() => (
    ((window as Window & { __manifestWriteEvents?: string[] }).__manifestWriteEvents ?? [])
      .filter((event) => event === 'close-end').length >= 2
  ));
  const samples = await page.evaluate(() => {
    const state = window as Window & {
      __metadataValueSamples?: string[];
      __stopMetadataSampling?: () => void;
    };
    state.__stopMetadataSampling?.();
    return state.__metadataValueSamples ?? [];
  });
  expect(samples).not.toContain('A');
  await expect(coach).toHaveValue('Alex');
  const persistedCoach = await page.evaluate(async () => {
    const project = (window as Window & {
      __playwrightProjectHandle?: FileSystemDirectoryHandle;
    }).__playwrightProjectHandle;
    if (!project) throw new Error('Project fixture handle is unavailable.');
    const file = await (await project.getFileHandle('project.json')).getFile();
    const saved = JSON.parse(await file.text()) as {
      matchInfo?: { homeTeam?: { coach?: string | null } };
    };
    return saved.matchInfo?.homeTeam?.coach ?? null;
  });
  expect(persistedCoach).toBe('Alex');
});

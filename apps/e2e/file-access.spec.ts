import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openReview, play, startDemo } from './demo.js';

// Bao's ID documents: in the demo he has sent revision 1, a PDF, for Lan to review.
const FILE = 'id-card.pdf';

const activity = (page: Page) => page.getByRole('region', { name: 'Activity' });

test("who sees a new hire's file: HR; IT, the manager, another new hire and another sandbox get a 404 (AT-26, AT-27, AT-28, BR-P02, BR-P03)", async ({
  page,
  browser,
}) => {
  let onboarding = '';
  // GET /api/files/:id/download-url, as Lan's review asked for it.
  let fileLink = '';
  // No link to the file for whoever may not see it, as if there were no such file.
  const noLink = async (as: Page) => {
    expect((await as.request.get(fileLink)).status()).toBe(404);
  };
  // Nor the onboarding: its page has nothing to show.
  const seesNeither = async (as: Page) => {
    await as.goto(onboarding);
    await expect(as.getByText('Onboarding not found')).toBeVisible();
    await noLink(as);
  };

  await test.step('Lan downloads the file from her review, and the activity shows revision 1', async () => {
    await startDemo(page);
    await openReview(page, 'Bao Ho');
    const [link, download] = await Promise.all([
      page.waitForResponse('**/api/files/*/download-url'),
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Download ${FILE}` }).click(),
    ]);
    expect(link.ok()).toBe(true);
    fileLink = new URL(link.url()).pathname;
    expect(download.suggestedFilename()).toBe(FILE);
    const pdf = await readFile(await download.path());
    expect(pdf.toString('latin1', 0, 5)).toBe('%PDF-');
    await page.goto('/onboardings');
    await page
      .getByRole('link', { name: /Bao Ho/ })
      .first()
      .click();
    await expect(
      activity(page).getByText(
        'Bao Ho submitted revision 1 of Upload ID documents',
      ),
    ).toBeVisible();
    onboarding = page.url();
  });

  await test.step('Huy, IT with a task in it, and Minh, the manager, see the onboarding but not the file (AT-27)', async () => {
    for (const person of ['Huy Le, IT', 'Minh Nguyen, manager']) {
      await play(page, person);
      await page.goto(onboarding);
      // Loaded, with what anyone who sees the onboarding sees, and no revision.
      await expect(
        activity(page).getByText('Minh Nguyen completed Welcome meeting'),
      ).toBeVisible();
      await expect(activity(page).getByText('revision')).toHaveCount(0);
      await noLink(page);
    }
  });

  await test.step('Duc, IT with nothing in it, and Chi, another new hire, see neither (AT-26)', async () => {
    for (const person of ['Duc Tran, IT', 'Chi Dang, new hire']) {
      await play(page, person);
      await seesNeither(page);
    }
  });

  await test.step('HR of another sandbox sees neither (AT-28)', async () => {
    const other = await browser.newContext();
    const guest = await other.newPage();
    await startDemo(guest);
    await seesNeither(guest);
    await other.close();
  });
});

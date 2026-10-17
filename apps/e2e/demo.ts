import { expect, type Page } from '@playwright/test';

// The demo controls (PLAN §10): closed, a pill that says who the guest plays.
export const pill = (page: Page) =>
  page.getByRole('button', { name: /^Demo controls:/ });

export async function island(page: Page) {
  await pill(page).click();
  return page.getByRole('dialog', { name: 'Demo controls' });
}

/** Try demo: a sandbox of its own, signed in as its HR, Lan. */
export async function startDemo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Start a demo instead' }).click();
  await page.waitForURL('**/dashboard');
  await expect(pill(page)).toHaveAccessibleName(/viewing as Lan Pham, HR$/);
}

/** Plays someone else, as "Duc Tran, IT": the app loads their first page. */
export async function play(page: Page, person: string) {
  const controls = await island(page);
  await controls.getByRole('button', { name: person, exact: true }).click();
  await expect(pill(page)).toHaveAccessibleName(
    new RegExp(`viewing as ${person}$`),
  );
}

// A card on My tasks of a task for one new hire: Lan and Minh have An's and Bao's.
export const card = (page: Page, title: string, hire: string) =>
  page
    .getByRole('list', { name: 'Tasks to do' })
    .getByRole('button')
    .filter({ hasText: title })
    .filter({ hasText: hire });

/** Opens HR's review of a new hire's ID documents, from My tasks. */
export async function openReview(page: Page, hire: string) {
  await page.goto('/tasks');
  await card(page, 'Review ID documents', hire).click();
  await page.getByRole('button', { name: 'Review documents' }).click();
}

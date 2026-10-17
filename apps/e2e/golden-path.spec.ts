import { expect, test, type Page } from '@playwright/test';

// What An uploads. The API looks at the first bytes only (BR-P04).
const PDF = {
  name: 'id-card-front.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
};
// 1 × 1 px, so the review drawer has an image to preview.
const PNG = {
  name: 'id-card-back.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
};
const PASSWORD = 'golden-path-e2e';
const REASON = 'The photo of the back is missing.';

// The demo controls (PLAN §10): closed, a pill that says who the guest plays.
const pill = (page: Page) =>
  page.getByRole('button', { name: /^Demo controls:/ });

async function island(page: Page) {
  await pill(page).click();
  return page.getByRole('dialog', { name: 'Demo controls' });
}

/** Plays someone else, as "Duc Tran, IT": the app loads their first page. */
async function play(page: Page, person: string) {
  const controls = await island(page);
  await controls.getByRole('button', { name: person, exact: true }).click();
  await expect(pill(page)).toHaveAccessibleName(
    new RegExp(`viewing as ${person}$`),
  );
}

/** Moves the business date with one of the island's controls, `times` over. */
async function moveDate(page: Page, control: string | RegExp, times = 1) {
  const controls = await island(page);
  for (let i = 0; i < times; i++) {
    const [advanced] = await Promise.all([
      page.waitForResponse('**/api/demo/clock/advance'),
      controls.getByRole('button', { name: control }).click(),
    ]);
    expect(advanced.ok()).toBe(true);
    // The control spins until the page shows the new date.
    await expect(controls).toHaveAttribute('aria-busy', 'false');
  }
  await page.keyboard.press('Escape');
}

// A card on My tasks of a task for An; Lan, Duc and Minh have Bao's too.
const card = (page: Page, title: string) =>
  page
    .getByRole('list', { name: 'Tasks to do' })
    .getByRole('button')
    .filter({ hasText: title })
    .filter({ hasText: 'An Vo' });

async function completeOnMyTasks(page: Page, ...titles: string[]) {
  await page.goto('/tasks');
  for (const title of titles) {
    await card(page, title).click();
    await page.getByRole('button', { name: 'Mark complete' }).click();
    await expect(card(page, title)).toHaveCount(0);
  }
}

async function openReview(page: Page) {
  await page.goto('/tasks');
  await card(page, 'Review ID documents').click();
  await page.getByRole('button', { name: 'Review documents' }).click();
}

// One of An's tasks on the portal, its work under it. Exact, as a task waiting for another
// names it ("Waits for Set up dev environment").
const portalTask = (page: Page, title: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByText(title, { exact: true }) });

async function completeOnPortal(page: Page, ...titles: string[]) {
  for (const title of titles) {
    const complete = portalTask(page, title).getByRole('button', {
      name: 'Mark complete',
    });
    await complete.click();
    await expect(complete).toHaveCount(0);
  }
}

test('golden path, from Try demo to a finished onboarding (PLAN §11, AT-10, AT-15)', async ({
  page,
}) => {
  let anOnboarding = '';

  await test.step('1 · Try demo signs in as HR in a sandbox of its own', async () => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Start a demo instead' }).click();
    await page.waitForURL('**/dashboard');
    await expect(pill(page)).toHaveAccessibleName(/viewing as Lan Pham, HR$/);
  });

  await test.step("2 · Lan activates An's draft, with Duc for IT's two tasks", async () => {
    await page.goto('/onboardings');
    await page.getByRole('link', { name: /An Vo/ }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Review and activate' }),
    ).toBeVisible();
    const pick = page.getByRole('button', { name: 'Pick someone' });
    await expect(pick).toHaveCount(2);
    for (const left of [1, 0]) {
      await pick.first().click();
      await page.getByRole('option', { name: /Duc Tran/ }).click();
      await expect(pick).toHaveCount(left);
    }
    await page.getByRole('button', { name: 'Activate onboarding' }).click();
    await expect(page.getByText('Activated just now')).toBeVisible();
    anOnboarding = page.url();
  });

  await test.step('3 · An accepts the invitation from the mock inbox', async () => {
    const controls = await island(page);
    await controls.getByRole('link', { name: 'Mock inbox' }).click();
    await page
      .getByRole('button')
      .filter({ hasText: 'To An Vo' })
      .filter({ hasText: "You're invited" })
      .click();
    await page.getByRole('link', { name: 'Accept invitation' }).click();
    await page.getByLabel('Create a password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Type it again', { exact: true }).fill(PASSWORD);
    await page
      .getByRole('button', { name: 'Create account and continue' })
      .click();
    await page.waitForURL('**/my-onboarding');
    await expect(page.getByRole('heading', { name: /^Hi An,/ })).toBeVisible();
    // What comes before day 1 is open; day 1 waits for its date.
    await expect(
      portalTask(page, 'Upload ID documents').getByLabel('Upload files'),
    ).toBeAttached();
    await expect(
      portalTask(page, 'Security awareness training').getByText(/^Opens /),
    ).toBeVisible();
  });

  await test.step('4 · An uploads a PDF of the ID and submits it', async () => {
    const upload = portalTask(page, 'Upload ID documents');
    await upload.getByLabel('Upload files').setInputFiles(PDF);
    await upload.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(upload.getByText('In review', { exact: true })).toBeVisible();
  });

  await test.step('5 · Lan requests changes, saying why', async () => {
    await play(page, 'Lan Pham, HR');
    await openReview(page);
    await page.getByPlaceholder('What should An fix?').fill(REASON);
    const [rejected] = await Promise.all([
      page.waitForResponse('**/api/tasks/*/reject'),
      page.getByRole('button', { name: 'Request changes' }).click(),
    ]);
    expect(rejected.ok()).toBe(true);
  });

  await test.step('6 · An reads why, adds the back and submits revision 2', async () => {
    await play(page, 'An Vo, new hire');
    const upload = portalTask(page, 'Upload ID documents');
    await expect(upload.getByText(REASON)).toBeVisible();
    await upload.getByLabel('Upload files').setInputFiles(PNG);
    await upload.getByRole('button', { name: 'Submit revision 2' }).click();
    await expect(upload.getByText('In review', { exact: true })).toBeVisible();
  });

  await test.step('7 · Lan approves revision 2, which opens a task for Duc', async () => {
    await play(page, 'Lan Pham, HR');
    await openReview(page);
    const [approved] = await Promise.all([
      page.waitForResponse('**/api/tasks/*/approve'),
      page.getByRole('button', { name: 'Approve revision 2' }).click(),
    ]);
    expect(approved.ok()).toBe(true);
    await play(page, 'Duc Tran, IT');
    await page.goto('/notifications');
    await expect(
      page
        .getByRole('region', { name: 'Notifications, newest first' })
        .getByRole('listitem')
        .filter({ hasText: 'Create work accounts is open' })
        .filter({ hasText: 'Review ID documents is done. For An Vo' }),
    ).toBeVisible();
  });

  await test.step('8 · On the start date, IT, the manager and An do their tasks', async () => {
    await moveDate(page, /^Jump to /);
    await completeOnMyTasks(page, 'Prepare laptop', 'Create work accounts');
    await play(page, 'Minh Nguyen, manager');
    await completeOnMyTasks(
      page,
      'Assign an onboarding buddy',
      'Welcome meeting',
    );
    await play(page, 'An Vo, new hire');
    await expect(
      page.getByRole('heading', { name: 'Hi An, today is your first day' }),
    ).toBeVisible();
    await completeOnPortal(
      page,
      'Sign the employee handbook',
      'Set up dev environment',
      'Security awareness training',
    );
  });

  await test.step('9 · Four days on, Minh checks in and An does the last task', async () => {
    await moveDate(page, '+1 day', 4);
    await play(page, 'Minh Nguyen, manager');
    await completeOnMyTasks(page, 'Week-one check-in');
    await play(page, 'An Vo, new hire');
    await completeOnPortal(page, 'Ship your first pull request');
    await expect(
      page.getByRole('heading', { name: "You're all set, An" }),
    ).toBeVisible();
  });

  await test.step('10 · Lan sees it done: the dashboard, the onboarding, its activity', async () => {
    await play(page, 'Lan Pham, HR');
    await expect(page.getByText('1 active · 2 completed')).toBeVisible();
    await page.goto(anOnboarding);
    await expect(page.getByText('11 of 11').first()).toBeVisible();
    await expect(page.getByText('An Vo finished onboarding')).toBeVisible();
  });
});

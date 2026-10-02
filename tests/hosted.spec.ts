import { test, expect, Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4312';
const commit = 'a'.repeat(40);
async function signIn(page: Page) {
  await page.route(origin + '/auth/github?**', async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const url = new URL(response.headers()['location']);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL('/auth/github/callback', origin);
    callback.searchParams.set('state', url.searchParams.get('state')!);
    callback.searchParams.set('code', 'alice');
    // Keep the real state cookie while replacing the external consent page with a local fixture.
    await route.fulfill({
      response,
      status: 200,
      contentType: 'text/html',
      body: `<a href="${callback.href.replaceAll('&', '&amp;')}">Continue as test viewer</a>`,
    });
  });
  await page.getByRole('link', { name: 'Sign in with GitHub' }).first().click();
  await page.getByRole('link', { name: 'Continue as test viewer' }).click();
}

test('uses GitHub for installation, reads a branch, and preserves workspace identity through navigation and sharing', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Your specs, ready to share.' })).toBeVisible();
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Open your team’s artifacts.' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Connect repositories on GitHub' }).first(),
  ).toHaveAttribute('href', 'https://github.com/apps/fixture-desk/installations/new');
  await page.getByRole('button', { name: 'Choose a repository' }).click();
  await page.getByLabel('GitHub repository', { exact: true }).fill('acme/roadmap');
  await page.getByLabel('Branch or commit').focus();
  await expect(page.locator('#branches option')).toHaveCount(2);
  await page.getByLabel('Branch or commit').fill('feature/review');
  await page.getByLabel('Artifact folder').fill('docs/openspec');
  await page.getByRole('button', { name: 'Open repository' }).click();
  await expect(page.locator('.repository-context')).toContainText('feature/review');
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Review sharing' }) })
    .click();
  await expect(page.locator('.prose')).toContainText('Read the committed proposal');
  await page.locator('.prose').getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  expect(new URL(page.url()).searchParams.get('repo')).toBe('acme/roadmap');
  expect(new URL(page.url()).searchParams.get('folder')).toBe('docs/openspec');
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
    'href',
    `https://github.com/acme/roadmap/blob/${commit}/docs/openspec/changes/review-sharing/tasks.md`,
  );
  await page.reload();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(shared).searchParams.get('ref')).toBe(commit);
  expect(new URL(shared).searchParams.get('path')).toBe('changes/review-sharing/tasks.md');
  await page.goto(shared);
  await expect(page.locator('.repository-context')).toContainText('Pinned revision');
  await page.getByLabel('Search all artifacts').fill('proposal');
  expect(new URL(page.url()).searchParams.get('repo')).toBe('acme/roadmap');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Your specs, ready to share.' })).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a fresh viewer signs in and returns to the exact shared artifact; hosted UI fits a phone', async ({
  page,
}) => {
  const url = new URL('/artifact', origin);
  url.search = new URLSearchParams({
    provider: 'github',
    repo: 'acme/roadmap',
    ref: commit,
    folder: 'openspec',
    path: 'changes/review-sharing/tasks.md',
  }).toString();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url.href);
  await signIn(page);
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.locator('.repository-context')).toContainText('Pinned revision');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.locator('.project-picker summary').click();
  await expect(page.getByLabel('GitHub repository', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/hosted-mobile.png', fullPage: true });
});

import { test, expect } from '@playwright/test';

// The pictures of the README, taken from the sample workspace: `npm run screenshots`.
const picture = (name: string) => `docs/screenshots/${name}.png`;

test('overview', async ({ page }) => {
  // Tall enough for the changes in review and the active changes.
  await page.setViewportSize({ width: 1280, height: 1210 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Active changes 2' })).toBeVisible();
  await page.screenshot({ path: picture('overview') });
});
test('behaviour changes', async ({ page }) => {
  await page.goto('/#/change?id=changes%2Fadd-project-invitations');
  await expect(page.locator('.requirement.modified ins').first()).toBeVisible();
  await page.screenshot({ path: picture('behaviour-changes') });
});
test('review threads', async ({ page }) => {
  await page.goto('/#/change?id=.pulls%2F128%2Fchanges%2Flet-editors-invite-viewers');
  const modified = page.locator('.requirement.modified');
  await expect(modified.getByRole('link', { name: 'Reply on GitHub' })).toBeVisible();
  // The heading stops below the top bar, the requirement itself would start behind it.
  await modified.getByRole('heading', { level: 3 }).evaluate((heading) => heading.scrollIntoView());
  await page.screenshot({ path: picture('review-threads') });
});
test('search', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search all artifacts').fill('invite');
  await expect(page.getByRole('region', { name: 'Search results' })).toBeVisible();
  await page.screenshot({ path: picture('search') });
});
test('reader', async ({ page }) => {
  await page.goto('/#/artifact?path=specs%2Fprojects%2Faccess%2Fspec.md');
  await expect(page.getByLabel('On this page')).toBeVisible();
  await page.screenshot({ path: picture('reader') });
});

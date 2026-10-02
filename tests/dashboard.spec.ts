import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let repository: string;
test.beforeAll(async () => {
  repository = await mkdtemp(path.join(os.tmpdir(), 'openspec-ui-'));
  await mkdir(path.join(repository, 'openspec/changes/nested-change/specs/domain/feature'), {
    recursive: true,
  });
  await writeFile(path.join(repository, 'openspec/config.yaml'), 'schema: spec-driven');
  await writeFile(
    path.join(repository, 'openspec/changes/nested-change/proposal.md'),
    '# A local change\n\nUnique searchable phrase.\n\n[Read the spec](specs/domain/feature/spec.md)',
  );
  await writeFile(
    path.join(repository, 'openspec/changes/nested-change/tasks.md'),
    '# Tasks\n\n- [x] First\n- [ ] Second',
  );
  await writeFile(
    path.join(repository, 'openspec/changes/nested-change/specs/domain/feature/spec.md'),
    '# Nested capability\n\n## ADDED Requirements\n\n### Requirement: Read safely\n\n<script>window.injected=true</script>\n\n![external](https://example.com/tracker.png)',
  );
});
test.afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
});

test('reads the sample change, navigates between artifacts and switches to source', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer view of what’s next.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview.png', fullPage: true });
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Add project invitations' }) })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Project invitations', exact: true }),
  ).toBeVisible();
  await page.locator('.prose').getByRole('link', { name: 'design', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitation design' })).toBeVisible();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.source-view')).toContainText('# Invitation design');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('link', { name: 'tasks.md', exact: false }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(9);
  await page.screenshot({ path: 'test-results/reader.png', fullPage: true });
  for (const checkbox of await page.getByRole('checkbox').all())
    await expect(checkbox).toBeDisabled();
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: 'Archive' })
    .click();
  await expect(page.getByRole('heading', { name: 'Add project roles' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('opens a local repository, resolves nested links, searches content and refreshes tasks', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.project-picker summary').click();
  await page.getByLabel('Repository or openspec folder').fill(repository);
  await page.getByRole('button', { name: 'Open folder', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Nested change' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'No published specifications yet' }),
  ).toBeVisible();
  await page.getByLabel('Search all artifacts').fill('Unique searchable phrase');
  await expect(page.getByRole('heading', { name: /Search results/ })).toBeVisible();
  await page
    .getByRole('link')
    .filter({ has: page.locator('strong', { hasText: 'Proposal' }) })
    .click();
  await page.locator('.prose').getByRole('link', { name: 'Read the spec' }).click();
  await expect(page.getByRole('heading', { name: 'Nested capability' })).toBeVisible();
  await expect(page.locator('.prose img')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { injected?: boolean }).injected),
  ).toBeUndefined();
  await page.getByRole('link', { name: /tasks.md/ }).click();
  await writeFile(
    path.join(repository, 'openspec/changes/nested-change/tasks.md'),
    '# Tasks\n\n- [x] First\n- [x] Second',
  );
  await page.getByRole('button', { name: 'Refresh workspace' }).click();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
});
test('recovers from an invalid path', async ({ page }) => {
  await page.goto('/');
  await page.locator('.project-picker summary').click();
  await page.getByLabel('Repository or openspec folder').fill('/does-not-exist');
  await page.getByRole('button', { name: 'Open folder', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('could not be opened');
  await page.getByRole('button', { name: 'Open sample workspace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clearer view of what’s next.' })).toBeVisible();
});
test('fits a phone screen and keeps navigation usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer view of what’s next.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('navigation').getByRole('link', { name: 'Specifications' }).click();
  await page.getByRole('link', { name: /projects\/access/ }).click();
  await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

const cli = path.resolve('dist/cli/main.js');
const local = 'http://127.0.0.1:4312';
const servers: ChildProcess[] = [];

/** Starts the CLI on a folder and waits until it listens. */
function serve(folder: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, folder, '--port', String(port)]);
    servers.push(child);
    let errors = '';
    child.stderr.on('data', (chunk) => (errors += chunk));
    child.stdout.on('data', (chunk) => String(chunk).includes('Open http') && resolve());
    child.on('exit', () => reject(new Error('The CLI stopped: ' + errors)));
  });
}

/** A static host without any fallback page, like GitHub Pages. */
function host(root: string, port: number): Promise<Server> {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
  };
  const server = createServer((request, response) => {
    let file = path.join(root, decodeURIComponent(new URL(request.url!, 'http://host').pathname));
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'text/plain' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

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
  await serve(repository, 4312);
});
test.afterAll(async () => {
  for (const server of servers) server.kill();
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
  await expect(page.locator('.sidebar')).toContainText('Sample workspace');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'A clearer view of what’s next.' })).toBeVisible();
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
  await page.getByLabel('Related artifacts').getByRole('link', { name: 'Tasks' }).click();
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
test('shows a specification as requirements and scenarios, and links to its headings', async ({
  page,
}) => {
  await page.goto('/#/artifact?path=specs%2Fprojects%2Faccess%2Fspec.md');
  const requirement = page.locator('.prose .requirement').first();
  await expect(
    requirement.getByRole('heading', { name: 'Requirement Viewers have read access' }),
  ).toBeVisible();
  await expect(requirement.locator('.normative')).toHaveText('SHALL');
  await expect(requirement.locator('.scenario .step-keyword')).toHaveText(['WHEN', 'THEN']);
  // A short window, so that the last requirement starts below the fold.
  await page.setViewportSize({ width: 1440, height: 500 });
  const last = page.getByRole('heading', { name: 'Requirement Owners manage membership' });
  await expect(last).not.toBeInViewport();
  await page
    .getByLabel('On this page')
    .getByRole('link', { name: 'Owners manage membership' })
    .click();
  await expect(last).toBeInViewport();
  await expect(page).toHaveURL(/#requirement-owners-manage-membership$/);
  await page.reload();
  await expect(last).toBeInViewport();
});
test('hides completed tasks on request and remembers the choice', async ({ page }) => {
  await page.goto('/#/artifact?path=changes%2Fadd-project-invitations%2Ftasks.md');
  const hide = page.getByRole('switch', { name: 'Hide completed' });
  await expect(page.getByRole('checkbox')).toHaveCount(9);
  await hide.click();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await expect(page.getByText('2.2 Display pending invitations')).toBeVisible();
  await page.reload();
  await expect(hide).toBeChecked();
  await expect(page.getByRole('checkbox')).toHaveCount(4);
  await hide.click();
  await expect(page.getByRole('checkbox')).toHaveCount(9);
});
test('reads a local repository, resolves nested links, searches content and refreshes tasks', async ({
  page,
}) => {
  await page.goto(local);
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
  await page.getByLabel('Related artifacts').getByRole('link', { name: 'Tasks' }).click();
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
test('reports a workspace that disappeared and recovers when it is back', async ({ page }) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'openspec-ui-'));
  const proposal = path.join(folder, 'openspec/changes/short-lived/proposal.md');
  try {
    await mkdir(path.dirname(proposal), { recursive: true });
    await writeFile(proposal, '# Short lived');
    await serve(folder, 4314);
    await page.goto('http://127.0.0.1:4314');
    await expect(page.getByRole('heading', { name: 'Short lived' })).toBeVisible();
    await rm(folder, { recursive: true });
    await page.getByRole('button', { name: 'Refresh workspace' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be opened');
    await mkdir(path.dirname(proposal), { recursive: true });
    await writeFile(proposal, '# Short lived');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { name: 'Short lived' })).toBeVisible();
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test('an exported site works under a subpath on a plain static host', async ({ page }) => {
  const site = await mkdtemp(path.join(os.tmpdir(), 'openspec-site-'));
  const github = {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'acme/roadmap',
    GITHUB_REF_NAME: 'main',
    GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
    GITHUB_WORKSPACE: repository,
  };
  const exported = (args: string[], env = {}) =>
    spawnSync(process.execPath, [cli, 'export', ...args], { env: { ...process.env, ...env } });
  expect(exported(['--demo', '--out', path.join(site, 'specs')]).status).toBe(0);
  expect(exported([repository, '--out', path.join(site, 'team/roadmap')], github).status).toBe(0);
  const server = await host(site, 4313);
  try {
    await page.goto('http://127.0.0.1:4313/specs/');
    await expect(
      page.getByRole('heading', { name: 'A clearer view of what’s next.' }),
    ).toBeVisible();
    await expect(page.getByText('At the published revision')).toBeVisible();
    await page
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name: 'Add project invitations' }) })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Project invitations', exact: true }),
    ).toBeVisible();
    expect(page.url()).toContain('/specs/#/artifact?path=');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Project invitations', exact: true }),
    ).toBeVisible();
    await page.locator('.prose').getByRole('link', { name: 'design', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Invitation design' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Workspace navigation' })
      .getByRole('link', { name: 'Archive' })
      .click();
    await expect(page.getByRole('heading', { name: 'Add project roles' })).toBeVisible();

    await page.goto('http://127.0.0.1:4313/team/roadmap/');
    await expect(page.locator('.repository-context')).toHaveText('acme/roadmap · main · 0123456');
    await expect(page.locator('.sidebar')).toContainText('GitHub repository');
    await page
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name: 'Nested change' }) })
      .click();
    await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
      'href',
      `https://github.com/acme/roadmap/blob/${github.GITHUB_SHA}/openspec/changes/nested-change/proposal.md`,
    );
  } finally {
    server.close();
    await rm(site, { recursive: true, force: true });
  }
});
test('fits a phone screen and keeps navigation usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A clearer view of what’s next.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: 'Specifications' })
    .click();
  await page.getByRole('link', { name: /projects\/access/ }).click();
  await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from '../cli/workspace.model';

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
  await page.getByLabel('Related artifacts').getByRole('link', { name: 'Proposal' }).click();
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
  await expect(page.getByRole('region', { name: 'In review' })).toHaveCount(0);
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
    await expect(page.getByRole('heading', { name: 'Behaviour changes' })).toBeVisible();
    expect(page.url()).toContain('/specs/#/change?id=');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Owners manage membership' })).toBeVisible();
    await page.getByLabel('Related artifacts').getByRole('link', { name: 'Proposal' }).click();
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
    await page.getByLabel('Related artifacts').getByRole('link', { name: 'Proposal' }).click();
    await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
      'href',
      `https://github.com/acme/roadmap/blob/${github.GITHUB_SHA}/openspec/changes/nested-change/proposal.md`,
    );
  } finally {
    server.close();
    await rm(site, { recursive: true, force: true });
  }
});
test('shows what a change does to the requirements of the published specs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  const card = page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Add project invitations' }) });
  await expect(card.getByRole('listitem')).toHaveText(['2 added', '1 modified']);
  await card.click();
  await expect(page).toHaveURL(/#\/change\?id=changes%2Fadd-project-invitations$/);
  await expect(page.getByRole('heading', { name: 'Behaviour changes' })).toBeVisible();
  await expect(page.locator('.document-meta')).toHaveText(/2 added\s*1 modified/);
  await page.screenshot({ path: 'test-results/change.png', fullPage: true });

  const access = page.getByRole('region', { name: 'projects/access' });
  const modified = access.locator('.requirement.modified');
  await expect(modified.getByRole('heading', { level: 3 })).toHaveText(
    'modified Owners manage membership',
  );
  await expect(modified.locator('del')).toHaveText(['is']);
  await expect(modified.locator('ins:not(.part)')).toHaveText([
    ', including invitations,',
    'and pending invitations are',
  ]);
  // Not by colour alone.
  await expect(modified.locator('ins').first()).toHaveCSS('text-decoration-line', 'underline');
  await expect(modified.locator('del')).toHaveCSS('text-decoration-line', 'line-through');
  const scenario = modified.locator('ins.part');
  await expect(scenario).toContainText('Added');
  await expect(scenario).toContainText('An owner opens project settings');

  const membership = page.getByRole('region', { name: 'projects/membership' });
  await expect(membership).toContainText('New capability');
  await expect(membership.getByRole('link', { name: 'Published spec' })).toHaveCount(0);
  const added = membership.locator('.requirement.added').first();
  await expect(added).toContainText('Owners can invite teammates');
  await expect(added).toContainText('A new teammate is invited');
  await expect(added.locator('.normative')).toHaveText('SHALL');

  await access.getByRole('link', { name: 'Published spec' }).click();
  await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible();
  await page.goBack();
  const outline = page.getByLabel('Related artifacts');
  await expect(outline.getByRole('link', { name: 'Behaviour changes' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await outline.getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(9);
  await outline.getByRole('link', { name: 'Behaviour changes' }).click();
  await page.reload();
  await expect(modified.getByRole('heading', { level: 3 })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: 'Changes' })
    .click();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Improve workspace search' }) })
    .click();
  await expect(page).toHaveURL(
    /#\/artifact\?.*path=changes%2Fimprove-workspace-search%2Fproposal\.md$/,
  );
  await page.goto('/#/change?id=changes%2Fnone');
  await expect(page.getByRole('heading', { name: 'Change not found' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('notes what the published spec lacks or already has, and shows markup as text', async ({
  page,
}) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'openspec-ui-'));
  const write = async (file: string, lines: string[]) => {
    await mkdir(path.dirname(path.join(folder, file)), { recursive: true });
    await writeFile(path.join(folder, file), lines.join('\n'));
  };
  try {
    await write('openspec/specs/billing/spec.md', [
      '# Billing',
      '## Requirements',
      '### Requirement: Invoices are monthly',
      'The system SHALL send invoices monthly.',
      '### Requirement: Old name',
      'The system SHALL keep it.',
      '### Requirement: Refunds are manual',
      'The system SHALL refund on request.',
      '### Requirement: Reminders are sent',
      'The system SHALL remind.',
      '#### Scenario: A week passes',
      '- **WHEN** a week passes',
      '#### Scenario: A month passes',
      '- **WHEN** a month passes',
    ]);
    await write('openspec/changes/rework-billing/specs/billing/spec.md', [
      '## ADDED Requirements',
      '### Requirement: Invoices are monthly',
      'The system SHALL send invoices monthly.',
      '<script>window.injected=true</script>',
      '![external](https://example.com/tracker.png)',
      '## MODIFIED Requirements',
      '### Requirement: Unknown requirement',
      'The system SHALL do something new.',
      '### Requirement: New name',
      'The system SHALL keep it.',
      '### Requirement: Reminders are sent',
      'The system SHALL remind.',
      '#### Scenario: A week passes',
      '- **WHEN** a week passes',
      '## REMOVED Requirements',
      '### Requirement: Refunds are manual',
      '**Reason**: Refunds are automatic now.',
      '',
      '**Migration**: Nothing to do.',
      '## RENAMED Requirements',
      '- FROM: `### Requirement: Old name`',
      '- TO: `### Requirement: New name`',
      '- FROM: `### Requirement: Missing`',
      '- TO: `### Requirement: Found`',
    ]);
    await serve(folder, 4315);
    await page.goto('http://127.0.0.1:4315');
    const card = page
      .getByRole('link')
      .filter({ has: page.getByRole('heading', { name: 'Rework billing' }) });
    await expect(card.getByRole('listitem')).toHaveText([
      '1 added',
      '3 modified',
      '1 removed',
      '1 renamed',
    ]);
    await card.click();
    const requirement = (name: string) =>
      page.locator('.requirement').filter({ has: page.getByRole('heading', { name }) });

    const exists = requirement('Invoices are monthly');
    await expect(exists).toContainText('already exists in the published spec');
    await expect(exists).toContainText('<script>window.injected=true</script>');
    await expect(exists).toContainText('[Image: external]');
    await expect(page.locator('.changes img')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { injected?: boolean }).injected),
    ).toBeUndefined();

    const unknown = requirement('Unknown requirement');
    await expect(unknown).toContainText('Not found in the published spec.');
    await expect(unknown).toContainText('The system SHALL do something new.');

    const renamed = requirement('New name');
    await expect(renamed).toContainText('Previously “Old name”');
    await expect(renamed).toContainText('No difference from the published spec.');

    const dropped = requirement('Reminders are sent').locator('del.part');
    await expect(dropped).toContainText('Removed');
    await expect(dropped).toContainText('A month passes');

    const removed = requirement('Refunds are manual');
    await expect(removed.locator('del.part')).toHaveText('The system SHALL refund on request.');
    await expect(removed).toContainText('Refunds are automatic now.');
    await expect(removed).toContainText('Nothing to do.');

    const missing = requirement('Found');
    await expect(missing).toContainText('Previously “Missing”');
    await expect(missing).toContainText('“Missing” was not found in the published spec.');
    await page.screenshot({ path: 'test-results/change-notes.png', fullPage: true });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
test('lists the changes of open pull requests apart, with their review threads', async ({
  page,
}) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  await page.goto('/');
  const review = page.getByRole('region', { name: 'In review' });
  await expect(review.getByRole('heading', { level: 2 })).toHaveText('In review 1');
  await expect(review).toContainText(/Pull requests read \w+ \d+, \d{4}, \d\d:\d\d/);
  const card = review
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'Let editors invite viewers' }) });
  await expect(card.getByRole('listitem')).toHaveText([
    '1 added',
    '1 modified',
    '1 renamed',
    '1 open thread',
  ]);
  const pull = review.getByRole('link', { name: 'PR #128 Let editors invite viewers by mara' });
  await expect(pull).toHaveAttribute('href', 'https://github.example/atlas/atlas/pull/128');
  await expect(pull).toHaveAttribute('target', '_blank');
  // The changes of the branch itself keep their own section and their count.
  await expect(page.getByRole('heading', { name: 'Active changes 2' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', {
      name: 'Changes',
    }),
  ).toHaveText(/Changes\s*3/);
  await page
    .getByRole('navigation', { name: 'Workspace navigation' })
    .getByRole('link', { name: 'Archive' })
    .click();
  await expect(page.getByRole('heading', { name: 'Let editors invite viewers' })).toHaveCount(0);
  await page.goBack();

  await card.click();
  await expect(page).toHaveURL(
    /#\/change\?id=\.pulls%2F128%2Fchanges%2Flet-editors-invite-viewers$/,
  );
  const heading = page.locator('.reader-heading');
  await expect(heading).toContainText('Change in review');
  await expect(
    heading.getByRole('link', { name: 'PR #128 Let editors invite viewers' }),
  ).toHaveAttribute('href', 'https://github.example/atlas/atlas/pull/128');
  await expect(heading).toContainText('by mara');
  await expect(heading).toContainText('1 open thread');
  await page.screenshot({ path: 'test-results/review.png', fullPage: true });

  const requirement = (name: string) =>
    page.locator('.requirement').filter({ has: page.getByRole('heading', { name }) });
  const modified = requirement('Owners manage membership');
  await expect(modified.locator('del')).toHaveText(['membership management']);
  await expect(modified.locator('ins').first()).toHaveText('role changes and removals');
  const open = modified.locator('app-review-thread details');
  await expect(open).toHaveAttribute('open', '');
  await expect(open.locator('summary')).toHaveText(/Open thread\s*2 comments/);
  await expect(open).toContainText('Can an editor also revoke an invitation they sent');
  await expect(open.locator('strong')).toHaveText(['ivo', 'mara']);
  const reply = open.getByRole('link', { name: 'Reply on GitHub' });
  await expect(reply).toHaveAttribute(
    'href',
    'https://github.example/atlas/atlas/pull/128#discussion_r1',
  );
  await expect(reply).toHaveAttribute('target', '_blank');

  const resolved = requirement('Editors can invite viewers').locator('app-review-thread details');
  await expect(resolved).not.toHaveAttribute('open');
  await expect(resolved.locator('summary')).toHaveText(/Resolved thread\s*2 comments/);
  await expect(resolved.getByText('"Refuses" was vague')).toBeHidden();
  await resolved.locator('summary').click();
  await expect(resolved.getByText('"Refuses" was vague')).toBeVisible();

  const discussion = page.getByRole('region', { name: 'Discussion' });
  await expect(discussion.locator('summary')).toHaveText(
    /Resolved thread\s*Proposal · line 5\s*2 comments/,
  );
  await expect(requirement('Viewers can read documents')).toContainText(
    'Previously “Viewers have read access”',
  );
  // Read-only: nothing to type into and nothing to press.
  await expect(
    page.locator('app-review-thread').locator('button, input, textarea, select, [contenteditable]'),
  ).toHaveCount(0);

  // The documents of the pull request open in the reader, and link to the published branch.
  await page.getByLabel('Related artifacts').getByRole('link', { name: 'Proposal' }).click();
  await expect(page.locator('.reader-heading')).toContainText('Change in review');
  await expect(page.locator('.document-path')).toHaveText(
    'changes/let-editors-invite-viewers/proposal.md',
  );
  await expect(
    page.locator('.document-meta').getByRole('link', { name: 'PR #128' }),
  ).toHaveAttribute('href', 'https://github.example/atlas/atlas/pull/128');
  await page.locator('.prose').getByRole('link', { name: 'access spec' }).click();
  await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible();
  await page.goBack();
  await page.locator('.prose').getByRole('link', { name: 'requirements' }).click();
  await expect(page.getByRole('heading', { name: 'Access changes', exact: true })).toBeVisible();
  await expect(page.locator('.document-meta').getByRole('link', { name: 'PR #128' })).toBeVisible();

  await page.getByLabel('Search all artifacts').fill('bottleneck');
  const result = page.getByRole('region', { name: 'Search results' }).getByRole('link');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('PR #128');
  await expect(result.locator('small')).toHaveText(
    'changes/let-editors-invite-viewers/proposal.md',
  );
  await page.getByLabel('Search all artifacts').fill('.pulls');
  await expect(page.getByRole('heading', { name: 'No matching artifacts' })).toBeVisible();
  await page.goto('/#/artifact?path=config.yaml');
  await expect(page.getByLabel('Related artifacts').getByRole('link')).toHaveText(['config.yaml']);
  // Everything came with the page: the browser asked nobody else.
  expect([...origins]).toEqual(['http://127.0.0.1:4311']);
});
test('shows drafts, long threads and comment markup safely, and says when nothing is in review', async ({
  page,
}) => {
  const site = await mkdtemp(path.join(os.tmpdir(), 'openspec-site-'));
  const commit = '0123456789abcdef0123456789abcdef01234567';
  // A published site is a workspace.json next to the dashboard: adjust the sample's.
  const publish = async (name: string, adjust: (workspace: Workspace) => void) => {
    const out = path.join(site, name);
    expect(spawnSync(process.execPath, [cli, 'export', '--demo', '--out', out]).status).toBe(0);
    const workspace: Workspace = JSON.parse(
      await readFile(path.join(out, 'workspace.json'), 'utf8'),
    );
    adjust(workspace);
    await writeFile(path.join(out, 'workspace.json'), JSON.stringify(workspace));
  };
  await publish('review', (workspace) => {
    workspace.source = {
      provider: 'github',
      repository: 'atlas/atlas',
      ref: 'main',
      commit,
      committedAt: null,
      folder: 'openspec',
      url: 'https://github.example/atlas/atlas',
    };
    const pulls = workspace.pullRequests!;
    const [thread] = pulls[0].threads;
    thread.omitted = 4;
    thread.comments[0].body =
      'See <script>window.injected=true</script> ![shot](https://example.com/shot.png), [the spec](../spec.md) and [the docs](https://example.com/docs).';
    pulls[0].threads[1].resolved = false;
    // More pull requests, each with a change that is only a proposal so far.
    const general = { ...thread, line: null, requirement: null, omitted: 0 };
    const add = (
      number: number,
      name: string,
      title: string,
      extra: { draft?: boolean; resolved?: boolean; outdated?: boolean } = {},
    ) => {
      const proposal = `.pulls/${number}/changes/${name}/proposal.md`;
      workspace.documents.push({
        ...workspace.documents.find((doc) => doc.pullRequest === 128 && doc.title === 'Proposal')!,
        path: proposal,
        content: `# ${title}\n\nOnly a proposal so far.`,
        pullRequest: number,
      });
      workspace.changes.push({
        ...workspace.changes.find((change) => change.pullRequest === 128)!,
        id: `.pulls/${number}/changes/${name}`,
        name,
        title,
        status: 'Draft',
        completed: 0,
        total: 0,
        documents: [proposal],
        deltas: [],
        pullRequest: number,
      });
      pulls.push({
        ...pulls[0],
        number,
        title,
        url: 'https://github.example/atlas/atlas/pull/' + number,
        changes: [`.pulls/${number}/changes/${name}`],
        // One thread on the proposal, when the pull request has any.
        threads: 'resolved' in extra ? [{ ...general, ...extra, path: proposal }] : [],
        draft: 'draft' in extra,
      });
    };
    add(129, 'tidy-names', 'Tidy names', { draft: true, resolved: false, outdated: true });
    add(130, 'settled-names', 'Settled names', { resolved: true });
    add(131, 'quiet-names', 'Quiet names');
  });
  await publish('empty', (workspace) => {
    workspace.documents = workspace.documents.filter((doc) => doc.pullRequest === undefined);
    workspace.changes = workspace.changes.filter((change) => change.pullRequest === undefined);
    workspace.pullRequests = [];
  });
  const server = await host(site, 4316);
  try {
    await page.goto('http://127.0.0.1:4316/empty/');
    await expect(page.getByRole('region', { name: 'In review' })).toContainText(
      'No open pull request changes the specs.',
    );

    await page.goto('http://127.0.0.1:4316/review/');
    const card = (title: string) =>
      page.getByRole('link').filter({ has: page.getByRole('heading', { name: title }) });
    // The review status: open threads, all resolved, or none to speak of.
    await expect(card('Let editors invite viewers').locator('.review')).toHaveText(
      '2 open threads',
    );
    await expect(card('Settled names').locator('.review')).toHaveText('All threads resolved');
    await expect(card('Quiet names').getByRole('listitem')).toHaveCount(0);
    await card('Settled names').click();
    await expect(page.locator('.reader-heading')).toContainText('All threads resolved');
    await page.goBack();
    await card('Quiet names').click();
    await expect(page.locator('.changes')).toContainText('This change has no spec changes yet.');
    await expect(page.locator('.reader-heading .review')).toHaveCount(0);
    await page.goBack();
    const draft = card('Tidy names');
    await expect(draft).toContainText('Draft pull request');
    await draft.click();
    // A change without spec changes still has a page, for its pull request and its threads.
    await expect(page.locator('.reader-heading')).toContainText('Draft');
    await expect(page.locator('.changes')).toContainText('This change has no spec changes yet.');
    await expect(page.getByRole('region', { name: 'Discussion' }).locator('summary')).toHaveText(
      /Open thread\s*Proposal\s*Outdated\s*2 comments/,
    );

    await page.goto(
      'http://127.0.0.1:4316/review/#/change?id=.pulls%2F128%2Fchanges%2Flet-editors-invite-viewers',
    );
    const thread = page
      .locator('.requirement')
      .filter({ has: page.getByRole('heading', { name: 'Owners manage membership' }) })
      .locator('app-review-thread');
    await expect(thread.locator('summary')).toHaveText(/Open thread\s*6 comments/);
    await expect(thread.getByRole('link', { name: '4 more comments on GitHub' })).toHaveAttribute(
      'href',
      'https://github.example/atlas/atlas/pull/128#discussion_r1',
    );
    await expect(thread).toContainText('<script>window.injected=true</script>');
    await expect(thread).toContainText('[Image: shot]');
    await expect(thread.locator('img')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { injected?: boolean }).injected),
    ).toBeUndefined();
    // Only web links stay links in a comment.
    await expect(thread.getByRole('link', { name: 'the spec' })).toHaveCount(0);
    await expect(thread.getByRole('link', { name: 'the docs' })).toHaveAttribute(
      'href',
      'https://example.com/docs',
    );

    await page.getByLabel('Related artifacts').getByRole('link', { name: 'Proposal' }).click();
    await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
      'href',
      'https://github.example/atlas/atlas/blob/4f9d2c7a1b8e3d6f5a0c9b8e7d6c5b4a3f2e1d0c/openspec/changes/let-editors-invite-viewers/proposal.md',
    );
    await page.goto(
      'http://127.0.0.1:4316/review/#/artifact?path=specs%2Fprojects%2Faccess%2Fspec.md',
    );
    await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
      'href',
      `https://github.example/atlas/atlas/blob/${commit}/openspec/specs/projects/access/spec.md`,
    );
  } finally {
    server.close();
    await rm(site, { recursive: true, force: true });
  }
});
test('offers a comment link beside each requirement of a real pull request', async ({
  page,
  context,
}) => {
  const requirement = (name: string) =>
    page.locator('.requirement').filter({ has: page.getByRole('heading', { name }) });
  // The sample's pull request is fictional, so its links only show where they would be.
  await page.goto('/#/change?id=.pulls%2F128%2Fchanges%2Flet-editors-invite-viewers');
  const examples = page.getByRole('button', { name: 'Comment on GitHub' });
  await expect(examples).toHaveCount(3);
  for (const example of await examples.all()) {
    await expect(example).toBeDisabled();
    await expect(example).toHaveAccessibleDescription(
      'PR #128 is fictional, so “Comment on GitHub” is disabled in this sample.',
    );
  }
  await expect(page.getByRole('link', { name: 'Comment on GitHub' })).toHaveCount(0);
  // Changes on disk and published specs have no pull request to comment on.
  await page.goto('/#/change?id=changes%2Fadd-project-invitations');
  await expect(requirement('Owners manage membership')).toBeVisible();
  await expect(page.getByText('Comment on GitHub')).toHaveCount(0);
  await expect(page.getByText('How to comment')).toHaveCount(0);
  await page.goto('/#/artifact?path=specs%2Fprojects%2Faccess%2Fspec.md');
  await expect(page.getByRole('heading', { name: 'Project access', exact: true })).toBeVisible();
  await expect(page.getByText('Comment on GitHub')).toHaveCount(0);

  // A site published from a real repository, under a subpath.
  const site = await mkdtemp(path.join(os.tmpdir(), 'openspec-site-'));
  const out = path.join(site, 'team/specs');
  expect(spawnSync(process.execPath, [cli, 'export', '--demo', '--out', out]).status).toBe(0);
  const workspace: Workspace = JSON.parse(await readFile(path.join(out, 'workspace.json'), 'utf8'));
  workspace.isDemo = false;
  workspace.source = {
    provider: 'github',
    repository: 'atlas/atlas',
    ref: 'main',
    commit: '0123456789abcdef0123456789abcdef01234567',
    committedAt: null,
    folder: 'openspec',
    url: 'https://github.example/atlas/atlas',
  };
  const [pull] = workspace.pullRequests!;
  const diff = pull.url + '/files#diff-5ac1';
  const spec = 'changes/let-editors-invite-viewers/specs/projects/access/spec.md';
  pull.reviewFiles = [{ path: '.pulls/128/' + spec, url: diff, added: false }];
  // The same change in a second pull request, exported before diff locations were read.
  const copy = (from: string) => from.replace('.pulls/128/', '.pulls/132/');
  workspace.documents.push(
    ...workspace.documents
      .filter((doc) => doc.pullRequest === 128)
      .map((doc) => ({ ...doc, path: copy(doc.path), pullRequest: 132 })),
  );
  const change = workspace.changes.find((change) => change.pullRequest === 128)!;
  workspace.changes.push({
    ...change,
    id: copy(change.id),
    documents: change.documents.map(copy),
    deltas: change.deltas.map((delta) => ({ ...delta, path: copy(delta.path) })),
    pullRequest: 132,
  });
  const { reviewFiles: _, ...older } = pull;
  workspace.pullRequests!.push({
    ...older,
    number: 132,
    url: 'https://github.example/atlas/atlas/pull/132',
    changes: [copy(change.id)],
    threads: [],
  });
  await writeFile(path.join(out, 'workspace.json'), JSON.stringify(workspace));
  await context.route('https://github.example/**', (route) => route.fulfill({ body: 'GitHub' }));
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  const server = await host(site, 4317);
  try {
    const review =
      'http://127.0.0.1:4317/team/specs/#/change?id=.pulls%2F128%2Fchanges%2Flet-editors-invite-viewers';
    await page.goto(review);
    const comment = (name: string) =>
      requirement(name).getByRole('link', { name: 'Comment on GitHub' });
    // Current threads establish lines within two requirements of the modified spec.
    await expect(comment('Owners manage membership')).toHaveAttribute('href', diff + 'R28');
    await expect(comment('Editors can invite viewers')).toHaveAttribute('href', diff + 'R17');
    await expect(requirement('Owners manage membership').locator('.comment-action')).toHaveText(
      'Comment on GitHub',
    );
    await expect(
      requirement('Owners manage membership').getByRole('link', { name: 'Reply on GitHub' }),
    ).toHaveAttribute('href', 'https://github.example/atlas/atlas/pull/128#discussion_r1');
    // A renamed requirement without a thread opens the diff of its delta document.
    await expect(comment('Viewers can read documents')).toHaveAttribute('href', diff);
    await expect(requirement('Viewers can read documents').locator('.comment-action')).toHaveText(
      /Comment on GitHub\s*Opens the diff of the spec\. Find “Viewers can read documents” there\./,
    );
    await expect(page.locator('#fictional-pull')).toHaveCount(0);
    const guide = page.locator('.comment-guide details');
    await expect(guide).not.toHaveAttribute('open');
    await guide.getByText('How to comment').click();
    await expect(guide).toContainText('In Files changed, select a line of the spec');
    await expect(guide).toContainText('Post it as a single comment.');
    await expect(guide).toContainText('GitHub account with read access to the repository');
    await expect(guide).toContainText('after the next CI publication');
    await expect(guide).toContainText('a linked location may have moved');
    await page.screenshot({ path: 'test-results/comment-links.png', fullPage: true });

    const link = comment('Owners manage membership');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const [tab] = await Promise.all([page.waitForEvent('popup'), link.click()]);
    await expect(tab).toHaveURL(diff + 'R28');
    await tab.close();
    await expect(page).toHaveURL(review);

    // Without a diff location, Files changed opens, with what to look for.
    await page.goto(
      'http://127.0.0.1:4317/team/specs/#/change?id=.pulls%2F132%2Fchanges%2Flet-editors-invite-viewers',
    );
    await expect(comment('Owners manage membership')).toHaveAttribute(
      'href',
      'https://github.example/atlas/atlas/pull/132/files',
    );
    await expect(requirement('Owners manage membership').locator('.comment-action')).toHaveText(
      /^Comment on GitHub\s*No direct link to this spec is available\. In Files changed, find openspec\/changes\/let-editors-invite-viewers\/specs\/projects\/access\/spec\.md and “Owners manage membership”\.$/,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.comment-guide')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: 'test-results/comment-links-phone.png', fullPage: true });
    // The dashboard sent nothing anywhere: commenting happens on GitHub.
    expect([...origins]).toEqual(['http://127.0.0.1:4317']);
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
  await page.goto('/#/change?id=changes%2Fadd-project-invitations');
  await expect(page.getByRole('heading', { name: 'Owners manage membership' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/#/change?id=.pulls%2F128%2Fchanges%2Flet-editors-invite-viewers');
  await expect(page.getByText('Can an editor also revoke')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'In review' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

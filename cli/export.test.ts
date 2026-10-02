import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { exportSite } from './export.ts';
import { demoDir } from './paths.ts';
import type { Workspace } from './workspace.model.ts';

let folder: string;
let appDir: string;
let repository: string;
const github = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'acme/roadmap',
  GITHUB_REF_NAME: 'main',
  GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
  GITHUB_SERVER_URL: 'https://github.example',
};
const published = async (out: string): Promise<Workspace> =>
  JSON.parse(await readFile(path.join(out, 'workspace.json'), 'utf8'));

before(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'openspec-export-'));
  appDir = path.join(folder, 'app');
  repository = path.join(folder, 'roadmap');
  await mkdir(path.join(appDir, 'media'), { recursive: true });
  await writeFile(path.join(appDir, 'index.html'), '<app-root></app-root>');
  await writeFile(path.join(appDir, 'media/logo.svg'), '<svg/>');
  await mkdir(path.join(repository, 'docs/openspec/changes/first'), { recursive: true });
  await writeFile(path.join(repository, 'docs/openspec/changes/first/proposal.md'), 'Why.');
});
after(() => rm(folder, { recursive: true, force: true }));

test('writes the dashboard and a workspace without machine details', async () => {
  const { out } = await exportSite({
    input: 'docs',
    out: 'site',
    appDir,
    cwd: repository,
    env: {},
  });
  assert.equal(out, path.join(repository, 'site'));
  assert.equal(await readFile(path.join(out, 'index.html'), 'utf8'), '<app-root></app-root>');
  assert.equal(await readFile(path.join(out, 'media/logo.svg'), 'utf8'), '<svg/>');
  const text = await readFile(path.join(out, 'workspace.json'), 'utf8');
  assert.equal(text.includes(folder), false);
  const workspace: Workspace = JSON.parse(text);
  assert.deepEqual(
    [workspace.name, workspace.root, workspace.isDemo],
    ['docs', 'docs/openspec', false],
  );
  assert.equal('source' in workspace, false);
  assert.equal(workspace.documents[0].modified, null);
  assert.equal(workspace.changes[0].modified, null);
});

test('adds the revision when running in GitHub Actions', async () => {
  const env = { ...github, GITHUB_WORKSPACE: repository };
  const { out } = await exportSite({ input: 'docs', out: 'site', appDir, cwd: repository, env });
  const workspace = await published(out);
  assert.deepEqual(workspace.source, {
    provider: 'github',
    repository: 'acme/roadmap',
    ref: 'main',
    commit: github.GITHUB_SHA,
    committedAt: null,
    folder: 'docs/openspec',
    url: 'https://github.example/acme/roadmap',
  });
  assert.equal(workspace.root, 'docs/openspec');
});

test('exports the sample workspace without a revision', async () => {
  const out = path.join(folder, 'sample-site');
  await exportSite({ input: demoDir, demo: true, out, appDir, cwd: repository, env: github });
  const workspace = await published(out);
  assert.deepEqual([workspace.name, workspace.root, workspace.isDemo], ['Atlas', 'openspec', true]);
  assert.equal('source' in workspace, false);
  assert.equal(workspace.changes.length, 3);
});

test('fails clearly when there is nothing to export', async () => {
  const options = { out: 'site', appDir, cwd: folder, env: {} };
  await assert.rejects(exportSite({ ...options, input: '.' }), /No openspec folder found/);
  await assert.rejects(
    exportSite({ ...options, input: 'roadmap/docs', appDir: path.join(folder, 'none') }),
    /dashboard build is missing/,
  );
});

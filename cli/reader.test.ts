import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { demoDir } from './paths.ts';
import { checkSize, readWorkspace, WorkspaceError } from './reader.ts';

test('reads the demo workspace and its task progress', async () => {
  const workspace = await readWorkspace(demoDir, { demo: true });
  assert.equal(workspace.name, 'Atlas');
  assert.equal(workspace.isDemo, true);
  assert.equal(workspace.changes.length, 3);
  assert.equal(workspace.changes.filter((change) => change.archived).length, 1);
  const active = workspace.changes.find((change) => change.name === 'add-project-invitations')!;
  assert.deepEqual([active.completed, active.total, active.status], [5, 9, 'In progress']);
  assert.ok(
    active.documents.includes('changes/add-project-invitations/specs/projects/membership/spec.md'),
  );
  assert.equal(workspace.specs[0].capability, 'projects/access');
  assert.equal(workspace.specs[0].requirements, 2);
  assert.ok(workspace.documents.every((doc) => doc.modified));
});

test('skips symbolic links and hidden files, and reports invalid YAML', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'openspec-local-'));
  try {
    await mkdir(path.join(folder, 'openspec/.hidden'), { recursive: true });
    await writeFile(path.join(folder, 'private.md'), 'outside');
    await symlink(path.join(folder, 'private.md'), path.join(folder, 'openspec/linked.md'));
    await writeFile(path.join(folder, 'openspec/config.yaml'), 'schema: [');
    await writeFile(path.join(folder, 'openspec/.hidden/note.md'), 'hidden');
    await writeFile(path.join(folder, 'openspec/image.png'), 'not an artifact');
    const workspace = await readWorkspace(folder);
    assert.equal(workspace.name, path.basename(folder));
    assert.equal(workspace.documents.length, 1);
    assert.equal(workspace.warnings.length, 2);
    assert.ok(workspace.warnings.includes('Skipped symbolic link: linked.md'));
    assert.deepEqual((await readWorkspace(path.join(folder, 'openspec'))).changes, []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('rejects folders that cannot be a workspace', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'openspec-empty-'));
  try {
    await assert.rejects(readWorkspace(folder), /No openspec folder found/);
    await assert.rejects(readWorkspace(path.join(folder, 'missing')), /could not be opened/);
    await assert.rejects(readWorkspace(' '), WorkspaceError);
    let nested = path.join(folder, 'openspec');
    for (let depth = 0; depth < 21; depth++) nested = path.join(nested, 'd');
    await mkdir(nested, { recursive: true });
    await assert.rejects(readWorkspace(folder), /folder depth/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('rejects oversized workspaces', async () => {
  assert.throws(() => checkSize(2_000_001, 2_000_001, 1), WorkspaceError);
  assert.throws(() => checkSize(1, 20_000_001, 1), WorkspaceError);
  assert.throws(() => checkSize(1, 1, 2001), WorkspaceError);
  checkSize(2_000_000, 20_000_000, 2000);
  const folder = await mkdtemp(path.join(tmpdir(), 'openspec-large-'));
  try {
    await mkdir(path.join(folder, 'openspec'));
    await writeFile(path.join(folder, 'openspec/large.md'), 'x'.repeat(2_000_001));
    await assert.rejects(readWorkspace(folder), /Workspace too large/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

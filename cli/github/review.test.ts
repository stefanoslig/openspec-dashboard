import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Thread } from './api.ts';
import { reviewFiles, threadsOf } from './review.ts';

type Comment = Thread['comments']['nodes'][number];
const comment = (id: number, login: string | null = 'ivo'): Comment => ({
  author: login === null ? null : { login },
  body: 'Comment ' + id,
  createdAt: '2026-10-02T08:00:00Z',
  url: 'https://github.example/acme/roadmap/pull/7#discussion_r' + id,
});
const thread = (path: string, comments: Comment[], extra: Partial<Thread> = {}): Thread => ({
  isResolved: false,
  isOutdated: false,
  path,
  line: 5,
  diffSide: 'RIGHT',
  subjectType: 'LINE',
  comments: { totalCount: comments.length, nodes: comments },
  ...extra,
});
const changed = (path: string, changeType = 'ADDED') => ({ path, changeType });
const document = (path: string) => ({ path, content: '', modified: null });

test('keeps the threads on the documents of the change folders, with a line only on the new side of a current diff', () => {
  const delta = 'docs/openspec/changes/add-x/specs/area/spec.md';
  const threads = threadsOf(
    [
      thread(delta, [comment(1), comment(2, null)], {
        comments: { totalCount: 5, nodes: [comment(1), comment(2, null)] },
      }),
      thread(delta, [comment(3)], { isOutdated: true, isResolved: true }),
      thread(delta, [comment(4)], { diffSide: 'LEFT' }),
      thread('docs/openspec/changes/add-x/proposal.md', [comment(5)], {
        subjectType: 'FILE',
        line: null,
      }),
      thread('src/app.ts', [comment(6)]),
      thread('docs/openspec/changes/gone/proposal.md', [comment(7)]),
      thread('docs/openspec/changes/add-x-later/proposal.md', [comment(8)]),
      thread(delta, []),
    ],
    ['changes/add-x'],
    'docs/openspec/',
  );
  assert.deepEqual(
    threads.map((item) => [item.path, item.line, item.resolved, item.outdated, item.omitted]),
    [
      ['changes/add-x/specs/area/spec.md', 5, false, false, 3],
      ['changes/add-x/specs/area/spec.md', null, true, true, 0],
      ['changes/add-x/specs/area/spec.md', null, false, false, 0],
      ['changes/add-x/proposal.md', null, false, false, 0],
    ],
  );
  assert.equal(threads[0].url, 'https://github.example/acme/roadmap/pull/7#discussion_r1');
  assert.deepEqual(threads[0].comments, [
    {
      author: 'ivo',
      body: 'Comment 1',
      createdAt: '2026-10-02T08:00:00Z',
      url: 'https://github.example/acme/roadmap/pull/7#discussion_r1',
    },
    {
      author: 'ghost',
      body: 'Comment 2',
      createdAt: '2026-10-02T08:00:00Z',
      url: 'https://github.example/acme/roadmap/pull/7#discussion_r2',
    },
  ]);
});

test('links each changed document to its diff, named after the SHA-256 of its path', () => {
  const change = 'docs/openspec/changes/add-roles/';
  const url = 'https://github.example/acme/roadmap/pull/5';
  const files = reviewFiles(
    {
      url,
      changed: [
        changed(change + 'proposal.md'),
        changed(change + 'design.md', 'MODIFIED'),
        changed(change + 'specs/projects/access/spec.md', 'RENAMED'),
        changed(change + 'old.md', 'DELETED'),
        changed('src/app.ts', 'MODIFIED'),
      ],
      documents: [
        document('changes/add-roles/.openspec.yaml'),
        document('changes/add-roles/design.md'),
        document('changes/add-roles/proposal.md'),
        document('changes/add-roles/specs/projects/access/spec.md'),
      ],
    },
    'docs/openspec/',
  );
  const diff = (path: string) =>
    url +
    '/files#diff-' +
    createHash('sha256')
      .update(change + path)
      .digest('hex');
  // In the order of the documents; the unchanged metadata has none.
  assert.deepEqual(files, [
    { path: 'changes/add-roles/design.md', url: diff('design.md'), added: false },
    { path: 'changes/add-roles/proposal.md', url: diff('proposal.md'), added: true },
    {
      path: 'changes/add-roles/specs/projects/access/spec.md',
      url: url + '/files#diff-a396d9beb8d0699974db716da3e767c7606971541bbf3ffec9bfc2c8a66a462e',
      added: false,
    },
  ]);
});

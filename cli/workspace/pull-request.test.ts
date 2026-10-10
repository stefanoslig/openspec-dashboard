import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pullRequestOf, pullRequestPrefix } from './pull-request.ts';
import type { Change, PullRequestInput } from './model.ts';

const delta = '.pulls/7/changes/add-x/specs/area/spec.md';
const change: Change = {
  id: '.pulls/7/changes/add-x',
  name: 'add-x',
  title: 'Add x',
  archived: false,
  schema: 'spec-driven',
  status: 'Draft',
  completed: 0,
  total: 0,
  summary: '',
  modified: null,
  documents: ['.pulls/7/changes/add-x/proposal.md', delta],
  deltas: [
    {
      path: delta,
      capability: 'area',
      published: null,
      requirements: [
        { kind: 'added', name: 'First', text: '', previous: null, line: 2, endLine: 4 },
        { kind: 'added', name: 'Second', text: '', previous: null, line: 6, endLine: 6 },
      ],
    },
  ],
  pullRequest: 7,
};
const thread = (path: string, line: number | null) => ({
  url: 'https://github.example/thread',
  path,
  line,
  resolved: false,
  outdated: false,
  comments: [],
  omitted: 0,
});
const pull: PullRequestInput = {
  number: 7,
  title: 'Pull request 7',
  url: 'https://github.example/pull/7',
  author: 'mara',
  draft: true,
  branch: 'add-x',
  commit: 'sha7',
  updatedAt: '2026-10-02T10:00:00Z',
  files: [{ path: 'changes/add-x/proposal.md', content: '', modified: null }],
  threads: [
    thread('changes/add-x/specs/area/spec.md', 2),
    thread('changes/add-x/specs/area/spec.md', 4),
    thread('changes/add-x/specs/area/spec.md', 5),
    thread('changes/add-x/specs/area/spec.md', 6),
    thread('changes/add-x/specs/area/spec.md', null),
    thread('changes/add-x/proposal.md', 3),
    thread('changes/other/proposal.md', 1),
    thread('specs/area/spec.md', 2),
  ],
};

test('names the prefix of the documents of a pull request', () => {
  assert.equal(pullRequestPrefix(7), '.pulls/7/');
});

test('keeps the details and the ids of the changes, without the files', () => {
  const result = pullRequestOf(pull, [change]);
  assert.deepEqual(
    { ...result, threads: [] },
    {
      number: 7,
      title: 'Pull request 7',
      url: 'https://github.example/pull/7',
      author: 'mara',
      draft: true,
      branch: 'add-x',
      commit: 'sha7',
      updatedAt: '2026-10-02T10:00:00Z',
      changes: ['.pulls/7/changes/add-x'],
      threads: [],
    },
  );
  assert.equal('reviewFiles' in result, false);
});

test('pins the threads on the documents of the changes to the requirement at their line', () => {
  const { threads } = pullRequestOf(pull, [change]);
  assert.deepEqual(
    threads.map((item) => [item.path, item.line, item.requirement]),
    [
      [delta, 2, 'First'],
      [delta, 4, 'First'],
      [delta, 5, null],
      [delta, 6, 'Second'],
      [delta, null, null],
      ['.pulls/7/changes/add-x/proposal.md', 3, null],
    ],
  );
  assert.deepEqual(Object.keys(threads[0]), [
    'url',
    'path',
    'line',
    'resolved',
    'outdated',
    'comments',
    'omitted',
    'requirement',
  ]);
});

test('keeps the review files of the documents of the changes, under the prefix', () => {
  const review = (path: string, added = true) => ({
    path,
    url: `https://github.example/pull/7/files#${path}`,
    added,
  });
  const reviewFiles = [
    review('changes/add-x/proposal.md'),
    // Not documents of the change: the published spec, and one that was not read.
    review('specs/area/spec.md', false),
    review('changes/add-x/tasks.md'),
  ];
  assert.deepEqual(pullRequestOf({ ...pull, reviewFiles }, [change]).reviewFiles, [
    { ...review('changes/add-x/proposal.md'), path: '.pulls/7/changes/add-x/proposal.md' },
  ]);
  assert.deepEqual(pullRequestOf({ ...pull, reviewFiles: [] }, [change]).reviewFiles, []);
});

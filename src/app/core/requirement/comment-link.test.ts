import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PullRequest, ReviewThread } from '../../../../cli/workspace/model.ts';
import { commentLink } from './comment-link.ts';

const delta = (number: number) => `.pulls/${number}/changes/add-x/specs/area/spec.md`;
const thread = (line: number | null, extra: Partial<ReviewThread> = {}): ReviewThread => ({
  url: 'https://github.example/acme/roadmap/pull/7#discussion_r' + line,
  path: delta(7),
  line,
  requirement: null,
  resolved: false,
  outdated: false,
  comments: [],
  omitted: 0,
  ...extra,
});
const pull = (
  number: number,
  extra: Partial<PullRequest> = {},
): Pick<PullRequest, 'url' | 'threads' | 'reviewFiles'> => ({
  url: 'https://github.example/acme/roadmap/pull/' + number,
  threads: [],
  reviewFiles: [
    {
      path: delta(number),
      url: `https://github.example/acme/roadmap/pull/${number}/files#diff-${number}`,
      added: false,
    },
  ],
  ...extra,
});
// Lines 5 to 14 of the delta document.
const requirement = { line: 5, endLine: 14 };

test('targets the heading of a requirement in a document the pull request adds', () => {
  const added = pull(7);
  added.reviewFiles![0].added = true;
  assert.deepEqual(commentLink(added, delta(7), requirement), {
    url: 'https://github.example/acme/roadmap/pull/7/files#diff-7R5',
    target: 'line',
  });
});

test('targets the first current thread line within a requirement of a modified document', () => {
  const threads = [
    thread(3),
    thread(12),
    thread(15),
    thread(9),
    thread(6, { path: '.pulls/7/changes/add-x/proposal.md' }),
  ];
  assert.deepEqual(commentLink(pull(7, { threads }), delta(7), requirement), {
    url: 'https://github.example/acme/roadmap/pull/7/files#diff-7R9',
    target: 'line',
  });
});

test('opens the diff of a modified document without a current line within the requirement', () => {
  // An outdated thread's line belongs to an older diff; a thread on a file has no line.
  const threads = [thread(8, { outdated: true }), thread(null), thread(20)];
  assert.deepEqual(commentLink(pull(7, { threads }), delta(7), requirement), {
    url: 'https://github.example/acme/roadmap/pull/7/files#diff-7',
    target: 'file',
  });
});

test('opens Files changed when the document is not in the diff or the snapshot predates it', () => {
  assert.deepEqual(commentLink(pull(7, { reviewFiles: [] }), delta(7), requirement), {
    url: 'https://github.example/acme/roadmap/pull/7/files',
    target: 'pull',
  });
  const older = pull(7, { threads: [thread(9)] });
  delete older.reviewFiles;
  assert.deepEqual(commentLink(older, delta(7), requirement), {
    url: 'https://github.example/acme/roadmap/pull/7/files',
    target: 'pull',
  });
});

test('keeps a change name that two pull requests share with its own pull request', () => {
  const first = pull(7, { threads: [thread(9)] });
  const second = pull(8);
  // Each pull request knows only its own documents, under its own prefix.
  assert.deepEqual(commentLink(first, delta(7), requirement).url, `${first.url}/files#diff-7R9`);
  assert.deepEqual(commentLink(second, delta(8), requirement), {
    url: 'https://github.example/acme/roadmap/pull/8/files#diff-8',
    target: 'file',
  });
  assert.equal(commentLink(second, delta(7), requirement).url, second.url + '/files');
});

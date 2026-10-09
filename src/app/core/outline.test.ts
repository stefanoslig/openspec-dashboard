import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Artifact, Change } from '../../../cli/workspace.model.ts';
import { outlineOf, outlineOfSpecs, outlineOfWorkspace } from './outline.ts';

const doc = (path: string, extra: Partial<Artifact> = {}): Artifact => ({
  path,
  title: path.split('/').pop()!.replace(/\.md$/, ''),
  content: '',
  format: path.endsWith('.yaml') ? 'yaml' : 'markdown',
  modified: null,
  revision: '',
  completed: 0,
  total: 0,
  requirements: 0,
  scenarios: 0,
  summary: '',
  ...extra,
});
const change: Change = {
  id: 'changes/add-x',
  name: 'add-x',
  title: 'Add X',
  archived: false,
  schema: 'spec-driven',
  status: 'In progress',
  completed: 2,
  total: 5,
  summary: '',
  modified: null,
  documents: [
    'changes/add-x/proposal.md',
    'changes/add-x/specs/area/spec.md',
    'changes/add-x/tasks.md',
    'changes/add-x/.openspec.yaml',
    'changes/add-x/missing.md',
  ],
  deltas: [],
};
const documents = [
  doc('changes/add-x/proposal.md', { title: 'Proposal' }),
  doc('changes/add-x/specs/area/spec.md'),
  doc('changes/add-x/tasks.md', { title: 'Tasks', completed: 2, total: 5 }),
  doc('changes/add-x/.openspec.yaml'),
  doc('specs/area/spec.md'),
  doc('specs/other/spec.md'),
  doc('README.md'),
  doc('.pulls/7/notes.md', { pullRequest: 7 }),
];

test('groups the documents of a change in their order and leaves out ones that are not loaded', () => {
  assert.deepEqual(outlineOf(change, documents), [
    {
      title: 'In this change',
      entries: [
        { path: 'changes/add-x/proposal.md', label: 'Proposal' },
        { path: 'changes/add-x/tasks.md', label: 'Tasks', note: '2 / 5' },
      ],
    },
    {
      title: 'Spec changes',
      entries: [{ path: 'changes/add-x/specs/area/spec.md', label: 'area' }],
    },
    {
      title: 'Other files',
      entries: [{ path: 'changes/add-x/.openspec.yaml', label: '.openspec.yaml' }],
    },
  ]);
});

test('leaves out groups without documents', () => {
  const bare = { ...change, documents: ['changes/add-x/proposal.md'] };
  assert.deepEqual(
    outlineOf(bare, documents).map((group) => group.title),
    ['In this change'],
  );
});

test('lists the published specifications by capability', () => {
  assert.deepEqual(outlineOfSpecs(documents), [
    {
      title: 'Specifications',
      entries: [
        { path: 'specs/area/spec.md', label: 'area' },
        { path: 'specs/other/spec.md', label: 'other' },
      ],
    },
  ]);
});

test('lists the loose workspace files without specs, changes and pull request documents', () => {
  assert.deepEqual(outlineOfWorkspace(documents), [
    { title: 'Workspace files', entries: [{ path: 'README.md', label: 'README.md' }] },
  ]);
});

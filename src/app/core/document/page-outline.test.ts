import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapseOutline, pageOutline, type PageHeading } from './page-outline.ts';

/** A requirement, or a scenario of the requirement `parent`. */
const heading = (id: string, parent = ''): PageHeading => ({
  id,
  text: id,
  depth: parent ? 4 : 3,
  kind: parent ? 'scenario' : 'requirement',
  level: parent ? 1 : 0,
  parent,
});
const headings = [
  heading('r1'),
  heading('r1-s1', 'r1'),
  heading('r2'),
  heading('r2-s1', 'r2'),
  heading('r2-s2', 'r2'),
  heading('r3'),
  heading('r3-s1', 'r3'),
];
const ids = (list: PageHeading[]) => list.map((item) => item.id);

test('leaves out the document title and gives scenarios their requirement', () => {
  assert.deepEqual(
    pageOutline([
      { id: 'title', text: 'Title', depth: 1 },
      { id: 'added', text: 'Requirements', depth: 2, kind: 'added' },
      { id: 'r', text: 'Requirement: R', depth: 3, kind: 'requirement' },
      { id: 's', text: 'Scenario: S', depth: 4, kind: 'scenario' },
    ]),
    [
      { id: 'added', text: 'Added requirements', depth: 2, kind: 'added', level: 0, parent: '' },
      { id: 'r', text: 'Requirement: R', depth: 3, kind: 'requirement', level: 1, parent: '' },
      { id: 's', text: 'Scenario: S', depth: 4, kind: 'scenario', level: 2, parent: 'r' },
    ],
  );
});

test('keeps a short outline whole', () => {
  assert.equal(collapseOutline(headings, 'r1-s1', headings.length), headings);
});

test('past the limit, keeps the requirements and the scenarios of the one being read', () => {
  const open = ['r1', 'r2', 'r2-s1', 'r2-s2', 'r3'];
  assert.deepEqual(ids(collapseOutline(headings, 'r2-s2', 3)), open);
  assert.deepEqual(ids(collapseOutline(headings, 'r2', 3)), open);
});

test('past the limit, shows no scenarios while no heading is being read', () => {
  assert.deepEqual(ids(collapseOutline(headings, '', 3)), ['r1', 'r2', 'r3']);
});

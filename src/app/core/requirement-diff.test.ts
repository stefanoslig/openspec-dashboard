import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffRequirement } from './requirement-diff.ts';

const published = [
  '### Requirement: Invitations expire',
  '',
  'The system SHALL expire an invitation after seven days.',
  '',
  '#### Scenario: An old link is opened',
  '',
  '- **WHEN** a person opens an invitation after it expired',
  '- **THEN** the system explains that the invitation is no longer available',
  '',
  '#### Scenario: A link is opened in time',
  '',
  '- **WHEN** a person opens an invitation within seven days',
  '- **THEN** the person joins the project',
].join('\n');
const text = (line: { segments: { text: string }[] }) =>
  line.segments.map((segment) => segment.text).join('');

test('marks the words of a changed phrase and leaves the rest alone', () => {
  const parts = diffRequirement(
    published,
    published
      .replace('after seven days.', 'after fourteen days.')
      .replace(
        '**WHEN** a person opens an invitation within',
        'WHEN a person opens an invitation in',
      ),
  );
  assert.deepEqual(
    parts.map((part) => [part.name, part.kind]),
    [
      ['', 'changed'],
      ['An old link is opened', 'same'],
      ['A link is opened in time', 'changed'],
    ],
  );
  assert.deepEqual(parts[0].lines, [
    {
      kind: 'changed',
      keyword: '',
      segments: [
        { text: 'The system SHALL expire an invitation after ', kind: 'same' },
        { text: 'seven', kind: 'removed' },
        { text: 'fourteen', kind: 'added' },
        { text: ' days.', kind: 'same' },
      ],
    },
  ]);
  assert.equal(
    parts[1].markdown,
    '#### Scenario: An old link is opened\n\n- **WHEN** a person opens an invitation after it expired\n- **THEN** the system explains that the invitation is no longer available',
  );
  assert.deepEqual(
    parts[2].lines.map((line) => [line.kind, line.keyword, text(line)]),
    [
      ['changed', 'WHEN', 'a person opens an invitation withinin seven days'],
      ['same', 'THEN', 'the person joins the project'],
    ],
  );
});

test('marks added and dropped scenarios as a whole, matching by name in any order', () => {
  const [, first, second] = published.split('#### ');
  const parts = diffRequirement(
    published,
    [
      '### Requirement: Renamed, which does not matter here',
      'The system SHALL expire an invitation after seven days.',
      '#### Scenario: A revoked link is opened',
      '- **THEN** it is refused',
      '#### ' + second.trim() + ' ####',
    ].join('\n'),
  );
  assert.deepEqual(
    parts.map((part) => [part.name, part.kind]),
    [
      ['', 'same'],
      ['An old link is opened', 'removed'],
      ['A revoked link is opened', 'added'],
      ['A link is opened in time', 'changed'],
    ],
  );
  assert.equal(parts[1].markdown, '#### ' + first.trim());
  assert.equal(
    parts[2].markdown,
    '#### Scenario: A revoked link is opened\n\n- **THEN** it is refused',
  );
  const moved = diffRequirement(
    published,
    ['### Requirement: X', '', '#### ' + second, '#### ' + first].join('\n'),
  );
  assert.deepEqual(
    moved.map((part) => [part.name, part.kind]),
    [
      ['', 'changed'],
      ['A link is opened in time', 'same'],
      ['An old link is opened', 'same'],
    ],
  );
  assert.deepEqual(
    moved[0].lines.map((line) => line.kind),
    ['removed'],
  );
});

test('reports identical texts as unchanged, whatever their spacing and emphasis', () => {
  const respaced =
    published
      .replace(/\n\n/g, '\n')
      .replace(/\*\*/g, '')
      .replace(/ SHALL /, '  SHALL   ') + '\n\n';
  for (const next of [published, respaced])
    assert.ok(diffRequirement(published, next).every((part) => part.kind === 'same'));
  assert.deepEqual(diffRequirement('### Requirement: Bare', '### Requirement: Bare'), []);
});

test('joins the changed words of a reworded phrase', () => {
  const [statement] = diffRequirement(
    '### Requirement: R\nThe system SHALL reserve membership management for project owners.',
    '### Requirement: R\nThe system SHALL reserve role changes and removals, in full, for project owners.',
  );
  assert.deepEqual(statement.lines[0].segments, [
    { text: 'The system SHALL reserve ', kind: 'same' },
    { text: 'membership management', kind: 'removed' },
    { text: 'role changes and removals, in full,', kind: 'added' },
    { text: ' for project owners.', kind: 'same' },
  ]);
});

test('shows rewritten lines whole instead of interleaving their words', () => {
  const [statement] = diffRequirement(
    '### Requirement: R\nThe system SHALL keep an audit trail of every change.\n- **WHEN** a user saves\n- one\n- two',
    '### Requirement: R\nAdministrators MAY export reports as CSV files.\n- **THEN** a user saves\n- one',
  );
  assert.deepEqual(
    statement.lines.map((line) => [line.kind, line.keyword, text(line)]),
    [
      ['removed', '', 'The system SHALL keep an audit trail of every change.'],
      ['added', '', 'Administrators MAY export reports as CSV files.'],
      ['removed', 'WHEN', 'a user saves'],
      ['added', 'THEN', 'a user saves'],
      ['same', '', 'one'],
      ['removed', '', 'two'],
    ],
  );
});

test('does not read a heading inside a code fence as a scenario', () => {
  const requirement =
    '### Requirement: R\nText.\n\n#### Scenario: Real\n\n```md\n#### Scenario: Example\n```\n\nAfter.';
  const parts = diffRequirement(requirement, requirement.replace('After.', 'Later.'));
  assert.deepEqual(
    parts.map((part) => [part.name, part.kind]),
    [
      ['', 'same'],
      ['Real', 'changed'],
    ],
  );
  // The lines of the example stay, its fence markers do not.
  assert.deepEqual(
    parts[1].lines.map((line) => [line.kind, text(line)]),
    [
      ['same', 'Scenario: Example'],
      ['removed', 'After.'],
      ['added', 'Later.'],
    ],
  );
});

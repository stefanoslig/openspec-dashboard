import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDelta, publishedRequirements } from './delta.ts';

const names = (blocks: { name: string }[]) => blocks.map((block) => block.name);

test('reads the four delta sections with the lines of each block', () => {
  const delta = parseDelta(
    [
      '# Access changes', // 1
      '',
      '## ADDED Requirements', // 3
      '',
      '### Requirement: Guests can browse', // 5
      'The system SHALL let guests browse.',
      '',
      '#### Scenario: A guest opens the catalogue', // 8
      '- **WHEN** a guest opens the catalogue',
      '- **THEN** the catalogue is shown', // 10
      '',
      '### Requirement: Guests can search', // 12
      'The system SHALL let guests search.',
      '',
      '## MODIFIED Requirements', // 15
      '',
      '### Requirement: Owners manage membership', // 17
      'The system SHALL reserve membership for owners.',
      '',
      '## REMOVED Requirements', // 20
      '',
      '### Requirement: Legacy export', // 22
      '**Reason**: Replaced.',
      '**Migration**: Use the new export.', // 24
      '',
      '## RENAMED Requirements', // 26
      '',
      '- FROM: `### Requirement: Viewers have read access`', // 28
      '- TO: `### Requirement: Viewers can read documents`', // 29
      '',
    ].join('\n'),
  );
  assert.deepEqual(delta.added, [
    {
      name: 'Guests can browse',
      text: '### Requirement: Guests can browse\nThe system SHALL let guests browse.\n\n#### Scenario: A guest opens the catalogue\n- **WHEN** a guest opens the catalogue\n- **THEN** the catalogue is shown',
      line: 5,
      endLine: 10,
    },
    {
      name: 'Guests can search',
      text: '### Requirement: Guests can search\nThe system SHALL let guests search.',
      line: 12,
      endLine: 13,
    },
  ]);
  assert.deepEqual(delta.modified, [
    {
      name: 'Owners manage membership',
      text: '### Requirement: Owners manage membership\nThe system SHALL reserve membership for owners.',
      line: 17,
      endLine: 18,
    },
  ]);
  assert.deepEqual(delta.removed, [
    {
      name: 'Legacy export',
      text: '**Reason**: Replaced.\n**Migration**: Use the new export.',
      line: 22,
      endLine: 24,
    },
  ]);
  assert.deepEqual(delta.renamed, [
    {
      from: 'Viewers have read access',
      to: 'Viewers can read documents',
      line: 28,
      endLine: 29,
    },
  ]);
});

test('ignores fenced examples and requirements outside the delta sections', () => {
  const delta = parseDelta(
    [
      '### Requirement: Above every section',
      '',
      '## Notes',
      '### Requirement: Under another section',
      '',
      '## ADDED Requirements',
      '### Requirement: Real',
      'Text.',
      '```md',
      '## REMOVED Requirements',
      '### Requirement: Example only',
      '```',
      'After the example.',
      '~~~~',
      '```',
      '### Requirement: Still an example',
      '~~~~',
    ].join('\n'),
  );
  assert.deepEqual(names(delta.added), ['Real']);
  assert.deepEqual([delta.added[0].line, delta.added[0].endLine], [7, 17]);
  assert.deepEqual([delta.modified, delta.removed, delta.renamed], [[], [], []]);
});

test('merges repeated section titles in any case', () => {
  const delta = parseDelta(
    [
      '## ADDED Requirements',
      '### Requirement: One',
      '## Modified requirements',
      '### Requirement: Two',
      '## added REQUIREMENTS',
      '### Requirement: Three',
      '## ADDED  Requirements',
      '### Requirement: Double space is another title',
    ].join('\n'),
  );
  assert.deepEqual(names(delta.added), ['One', 'Three']);
  assert.deepEqual(names(delta.modified), ['Two']);
});

test('reads removals written as headers and as bullets', () => {
  const delta = parseDelta(
    [
      '## REMOVED Requirements',
      '- `### Requirement: Quoted bullet`',
      '* ### Requirement: Plain bullet',
      '### Requirement: Header without a reason',
      '',
      '### Requirement: Header with a reason',
      '',
      '**Reason**: No longer needed.',
      '',
    ].join('\n'),
  );
  assert.deepEqual(delta.removed, [
    { name: 'Quoted bullet', text: '', line: 2, endLine: 2 },
    { name: 'Plain bullet', text: '', line: 3, endLine: 3 },
    { name: 'Header without a reason', text: '', line: 4, endLine: 4 },
    { name: 'Header with a reason', text: '**Reason**: No longer needed.', line: 6, endLine: 8 },
  ]);
});

test('pairs renames and ignores the ones without a partner', () => {
  const delta = parseDelta(
    [
      '## RENAMED Requirements',
      'FROM: ### Requirement: Plain old',
      'TO: ### Requirement: Plain new',
      '* FROM: `### Requirement: Starred old`',
      '',
      '* TO: `### Requirement: Starred new`',
      '- TO: `### Requirement: No from before it`',
      '- FROM: `### Requirement: Displaced`',
      '- FROM: `### Requirement: Kept old`',
      '- TO: `### Requirement: Kept new`',
      '- FROM: `### Requirement: Never finished`',
    ].join('\n'),
  );
  assert.deepEqual(delta.renamed, [
    { from: 'Plain old', to: 'Plain new', line: 2, endLine: 3 },
    { from: 'Starred old', to: 'Starred new', line: 4, endLine: 6 },
    { from: 'Kept old', to: 'Kept new', line: 9, endLine: 10 },
  ]);
});

test('normalizes names, line endings and a byte order mark', () => {
  const delta = parseDelta(
    '﻿## ADDED Requirements\r\n###Requirement:   Closed heading ###  \r\nText.\r\n### requirement: Keeps C#\r\n',
  );
  assert.deepEqual(delta.added, [
    {
      name: 'Closed heading',
      text: '###Requirement:   Closed heading ###  \nText.',
      line: 2,
      endLine: 3,
    },
    { name: 'Keeps C#', text: '### requirement: Keeps C#', line: 4, endLine: 4 },
  ]);
});

test('reads the requirements of a published spec from its Requirements section', () => {
  const spec = [
    '# Access',
    '',
    '## Purpose',
    '### Requirement: Not in the requirements section',
    '',
    '## Requirements',
    '',
    '### Requirement: First',
    'The system SHALL do one thing.',
    '',
    '#### Scenario: It happens',
    '- **WHEN** asked',
    '',
    '### Requirement: Second',
    'The system SHALL do another.',
    '',
    '## Notes',
    '### Requirement: After the section',
  ].join('\n');
  assert.deepEqual(publishedRequirements(spec), [
    {
      name: 'First',
      text: '### Requirement: First\nThe system SHALL do one thing.\n\n#### Scenario: It happens\n- **WHEN** asked',
      line: 8,
      endLine: 12,
    },
    {
      name: 'Second',
      text: '### Requirement: Second\nThe system SHALL do another.',
      line: 14,
      endLine: 15,
    },
  ]);
  assert.deepEqual(publishedRequirements('### Requirement: No section at all'), []);
});

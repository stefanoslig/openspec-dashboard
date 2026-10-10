import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectMarkdown } from './markdown-info.ts';

test('counts actual tasks and headings', () => {
  assert.deepEqual(
    inspectMarkdown(
      '- [x] Done\n- [ ] Pending\n  - [X] Nested\n\n~~~md\n- [ ] Example\n~~~\n\n### Requirement: Read\n#### Scenario: Open',
    ),
    { completed: 2, total: 3, requirements: 1, scenarios: 1, summary: '' },
  );
  assert.equal(
    inspectMarkdown('# Proposal\n\nRead this **proposal**.').summary,
    'Read this proposal.',
  );
  assert.equal(inspectMarkdown('### **Requirement:** `Scenario:` bold').requirements, 1);
  assert.equal(inspectMarkdown('x'.repeat(300)).summary.length, 240);
});

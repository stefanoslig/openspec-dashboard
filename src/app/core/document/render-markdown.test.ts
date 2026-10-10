import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from './render-markdown.ts';

test('gives headings ids from their text, numbers repeats and falls back for empty ones', () => {
  const content = [
    '# Title',
    '',
    '## Hello, World!',
    '',
    '## Hello, World!',
    '',
    '## ???',
    '',
    '## The *quick* `fox`',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<h1 id="title">Title</h1><h2 id="hello-world">Hello, World! <a class="anchor" href="#hello-world" aria-hidden="true" tabindex="-1">#</a></h2><h2 id="hello-world-1">Hello, World! <a class="anchor" href="#hello-world-1" aria-hidden="true" tabindex="-1">#</a></h2><h2 id="section">??? <a class="anchor" href="#section" aria-hidden="true" tabindex="-1">#</a></h2><h2 id="the-quick-fox">The <em>quick</em> <code>fox</code> <a class="anchor" href="#the-quick-fox" aria-hidden="true" tabindex="-1">#</a></h2>',
    headings: [
      {
        id: 'title',
        text: 'Title',
        depth: 1,
      },
      {
        id: 'hello-world',
        text: 'Hello, World!',
        depth: 2,
      },
      {
        id: 'hello-world-1',
        text: 'Hello, World!',
        depth: 2,
      },
      {
        id: 'section',
        text: '???',
        depth: 2,
      },
      {
        id: 'the-quick-fox',
        text: 'The quick fox',
        depth: 2,
      },
    ],
  });
});

test('wraps requirements and scenarios in sections that end at the next heading of the same or a higher level', () => {
  const content = [
    '# Spec',
    '',
    '## Purpose',
    '',
    'This text SHALL not be emphasized.',
    '',
    '### Requirement: Owners manage membership',
    '',
    'The system SHALL reserve it and MUST NOT share it; `MAY` is code.',
    '',
    '#### Scenario: An editor opens settings',
    '',
    '- **WHEN** an editor opens the people settings',
    '- **THEN** membership MUST NOT change',
    '',
    '### Requirement: Another',
    '',
    'Text MAY apply.',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<h1 id="spec">Spec</h1><h2 id="purpose">Purpose <a class="anchor" href="#purpose" aria-hidden="true" tabindex="-1">#</a></h2><p>This text SHALL not be emphasized.</p>\n<section class="requirement"><h3 id="requirement-owners-manage-membership"><span class="kind">Requirement</span> Owners manage membership <a class="anchor" href="#requirement-owners-manage-membership" aria-hidden="true" tabindex="-1">#</a></h3><p>The system <strong class="normative">SHALL</strong> reserve it and <strong class="normative negative">MUST NOT</strong> share it; <code>MAY</code> is code.</p>\n<section class="scenario"><h4 id="scenario-an-editor-opens-settings"><span class="kind">Scenario</span> An editor opens settings <a class="anchor" href="#scenario-an-editor-opens-settings" aria-hidden="true" tabindex="-1">#</a></h4><ul class="steps"><li class="step-when"><span class="step-keyword">WHEN</span> <div class="step-text">an editor opens the people settings</div></li><li class="step-then"><span class="step-keyword">THEN</span> <div class="step-text">membership <strong class="normative negative">MUST NOT</strong> change</div></li></ul></section></section><section class="requirement"><h3 id="requirement-another"><span class="kind">Requirement</span> Another <a class="anchor" href="#requirement-another" aria-hidden="true" tabindex="-1">#</a></h3><p>Text <strong class="normative">MAY</strong> apply.</p>\n</section>',
    headings: [
      {
        id: 'spec',
        text: 'Spec',
        depth: 1,
      },
      {
        id: 'purpose',
        text: 'Purpose',
        depth: 2,
      },
      {
        id: 'requirement-owners-manage-membership',
        text: 'Owners manage membership',
        depth: 3,
        kind: 'requirement',
      },
      {
        id: 'scenario-an-editor-opens-settings',
        text: 'An editor opens settings',
        depth: 4,
        kind: 'scenario',
      },
      {
        id: 'requirement-another',
        text: 'Another',
        depth: 3,
        kind: 'requirement',
      },
    ],
  });
});

test('wraps the delta groups of a change in delta sections', () => {
  const content = [
    '# Access changes',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: New one',
    '',
    'Body SHALL hold.',
    '',
    '## MODIFIED Requirements',
    '',
    '### Requirement: Changed',
    '',
    'Body.',
    '',
    '## REMOVED Requirements',
    '',
    '- `### Requirement: Old`',
    '',
    '## RENAMED Requirements',
    '',
    '- FROM: `### Requirement: Old name`',
    '- TO: `### Requirement: New name`',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<h1 id="access-changes">Access changes</h1><section class="delta delta-added"><h2 id="added-requirements"><span class="kind">Added</span> Requirements <a class="anchor" href="#added-requirements" aria-hidden="true" tabindex="-1">#</a></h2><section class="requirement"><h3 id="requirement-new-one"><span class="kind">Requirement</span> New one <a class="anchor" href="#requirement-new-one" aria-hidden="true" tabindex="-1">#</a></h3><p>Body <strong class="normative">SHALL</strong> hold.</p>\n</section></section><section class="delta delta-modified"><h2 id="modified-requirements"><span class="kind">Modified</span> Requirements <a class="anchor" href="#modified-requirements" aria-hidden="true" tabindex="-1">#</a></h2><section class="requirement"><h3 id="requirement-changed"><span class="kind">Requirement</span> Changed <a class="anchor" href="#requirement-changed" aria-hidden="true" tabindex="-1">#</a></h3><p>Body.</p>\n</section></section><section class="delta delta-removed"><h2 id="removed-requirements"><span class="kind">Removed</span> Requirements <a class="anchor" href="#removed-requirements" aria-hidden="true" tabindex="-1">#</a></h2><ul><li><code>### Requirement: Old</code></li></ul></section><section class="delta delta-renamed"><h2 id="renamed-requirements"><span class="kind">Renamed</span> Requirements <a class="anchor" href="#renamed-requirements" aria-hidden="true" tabindex="-1">#</a></h2><ul class="steps"><li class="step-from"><span class="step-keyword">FROM</span> <div class="step-text"><code>Old name</code></div></li><li class="step-to"><span class="step-keyword">TO</span> <div class="step-text"><code>New name</code></div></li></ul></section>',
    headings: [
      {
        id: 'access-changes',
        text: 'Access changes',
        depth: 1,
      },
      {
        id: 'added-requirements',
        text: 'Requirements',
        depth: 2,
        kind: 'added',
      },
      {
        id: 'requirement-new-one',
        text: 'New one',
        depth: 3,
        kind: 'requirement',
      },
      {
        id: 'modified-requirements',
        text: 'Requirements',
        depth: 2,
        kind: 'modified',
      },
      {
        id: 'requirement-changed',
        text: 'Changed',
        depth: 3,
        kind: 'requirement',
      },
      {
        id: 'removed-requirements',
        text: 'Requirements',
        depth: 2,
        kind: 'removed',
      },
      {
        id: 'renamed-requirements',
        text: 'Requirements',
        depth: 2,
        kind: 'renamed',
      },
    ],
  });
});

test('renders bold scenario steps, with or without a colon, and keeps AND and BUT in the clause before them', () => {
  const content = [
    '- **GIVEN** a user',
    '- **and** a session',
    '- **WHEN:** they sign in',
    '- **BUT** not twice',
    '- **THEN** it works',
    '- **FROM** `### Requirement: Kept whole`',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<ul class="steps"><li class="step-given"><span class="step-keyword">GIVEN</span> <div class="step-text">a user</div></li><li class="step-given"><span class="step-keyword">AND</span> <div class="step-text">a session</div></li><li class="step-when"><span class="step-keyword">WHEN</span> <div class="step-text">they sign in</div></li><li class="step-when"><span class="step-keyword">BUT</span> <div class="step-text">not twice</div></li><li class="step-then"><span class="step-keyword">THEN</span> <div class="step-text">it works</div></li><li class="step-from"><span class="step-keyword">FROM</span> <div class="step-text"><code>### Requirement: Kept whole</code></div></li></ul>',
    headings: [],
  });
});

test('renders plain scenario steps', () => {
  const content = [
    '- GIVEN a user',
    '- WHEN they sign in',
    '- THEN it works',
    '- AND it is logged',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<ul class="steps"><li class="step-given"><span class="step-keyword">GIVEN</span> <div class="step-text">a user</div></li><li class="step-when"><span class="step-keyword">WHEN</span> <div class="step-text">they sign in</div></li><li class="step-then"><span class="step-keyword">THEN</span> <div class="step-text">it works</div></li><li class="step-then"><span class="step-keyword">AND</span> <div class="step-text">it is logged</div></li></ul>',
    headings: [],
  });
});

test('renders a list as plain when any item is not a step', () => {
  const content = ['- WHEN something', '- something else', '', '3. third', '4. fourth'].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<ul><li>WHEN something</li><li>something else</li></ul><ol start="3"><li>third</li><li>fourth</li></ol>',
    headings: [],
  });
});

test('counts the tasks under each heading below the title, nested ones included', () => {
  const content = [
    '# Tasks',
    '',
    '- [ ] top level task',
    '',
    '## Phase 1',
    '',
    '- [x] done one',
    '- [ ] open one',
    '  - [x] nested done',
    '- plain item',
    '',
    '## Phase 2',
    '',
    '- [ ] a',
    '- [x] b',
    '',
    '### Detail',
    '',
    'No tasks here.',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<h1 id="tasks">Tasks</h1><ul class="tasks"><li class="task"><span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="false" aria-label="Incomplete task"></span>top level task</li></ul><h2 id="phase-1">Phase 1 <span class="task-count">2 / 3</span> <a class="anchor" href="#phase-1" aria-hidden="true" tabindex="-1">#</a></h2><ul><li class="task done"><span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="true" aria-label="Completed task">✓</span>done one</li><li class="task"><span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="false" aria-label="Incomplete task"></span>open one<ul class="tasks"><li class="task done"><span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="true" aria-label="Completed task">✓</span>nested done</li></ul></li><li>plain item</li></ul><h2 id="phase-2">Phase 2 <span class="task-count">1 / 2</span> <a class="anchor" href="#phase-2" aria-hidden="true" tabindex="-1">#</a></h2><ul class="tasks"><li class="task"><span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="false" aria-label="Incomplete task"></span>a</li><li class="task done"><span class="task-checkbox" role="checkbox" aria-disabled="true" aria-checked="true" aria-label="Completed task">✓</span>b</li></ul><h3 id="detail">Detail <a class="anchor" href="#detail" aria-hidden="true" tabindex="-1">#</a></h3><p>No tasks here.</p>\n',
    headings: [
      {
        id: 'tasks',
        text: 'Tasks',
        depth: 1,
      },
      {
        id: 'phase-1',
        text: 'Phase 1',
        depth: 2,
      },
      {
        id: 'phase-2',
        text: 'Phase 2',
        depth: 2,
      },
      {
        id: 'detail',
        text: 'Detail',
        depth: 3,
      },
    ],
  });
});

test('emphasizes normative words everywhere when the content is a requirement body', () => {
  const content = ['It SHALL work and SHOULD NOT fail.', '', '## Later', '', 'It MAY stop.'].join(
    '\n',
  );
  assert.deepEqual(renderMarkdown(content, { requirement: true }), {
    html: '<p>It <strong class="normative">SHALL</strong> work and <strong class="normative negative">SHOULD NOT</strong> fail.</p>\n<h2 id="later">Later <a class="anchor" href="#later" aria-hidden="true" tabindex="-1">#</a></h2><p>It <strong class="normative">MAY</strong> stop.</p>\n',
    headings: [
      {
        id: 'later',
        text: 'Later',
        depth: 2,
      },
    ],
  });
});

test('opens web links in a new tab, keeps relative links and shows other schemes as text', () => {
  const content = [
    '## Links',
    '',
    '[web](https://example.com/docs) [mail](mailto:a@example.com) [rel](../spec.md#top) [ftp](ftp://host/file)',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '<h2 id="links">Links <a class="anchor" href="#links" aria-hidden="true" tabindex="-1">#</a></h2><p><a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">web</a> <a href="mailto:a@example.com" target="_blank" rel="noopener noreferrer">mail</a> <a href="../spec.md#top">rel</a> ftp</p>\n',
    headings: [
      {
        id: 'links',
        text: 'Links',
        depth: 2,
      },
    ],
  });
});

test('standalone: relative links become text and headings get no anchor', () => {
  const content = ['## Links', '', '[web](https://example.com/docs) [rel](../spec.md#top)'].join(
    '\n',
  );
  assert.deepEqual(renderMarkdown(content, { standalone: true }), {
    html: '<h2 id="links">Links</h2><p><a href="https://example.com/docs" target="_blank" rel="noopener noreferrer">web</a> rel</p>\n',
    headings: [
      {
        id: 'links',
        text: 'Links',
        depth: 2,
      },
    ],
  });
});

test('shows raw html as text and images as placeholders', () => {
  const content = [
    '<script>window.x = 1</script>',
    '',
    'a <b>bold</b> c ![shot](https://example.com/shot.png)',
  ].join('\n');
  assert.deepEqual(renderMarkdown(content), {
    html: '&lt;script&gt;window.x = 1&lt;/script&gt;<p>a &lt;b&gt;bold&lt;/b&gt; c <span class="image-placeholder">[Image: shot]</span></p>\n',
    headings: [],
  });
});

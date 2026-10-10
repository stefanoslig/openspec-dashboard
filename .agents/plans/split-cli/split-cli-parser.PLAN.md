# Split brief: cli/parser.ts

You are refactoring `cli/parser.ts` in `/Users/stefanoslignos/Personal_Projects/openspec-dashboard`
for readability, behaviour unchanged. The owner found it unreadable: 334 lines, 19 lint warnings,
and `buildWorkspace` is 174 lines of closures sharing mutable state (`warnings`, `documents`,
`changes`, `changeTimes`, a memo map).

Read `AGENTS.md` and `.agents/docs/code-conventions.md` first. `cli/` is Node only: no Angular
imports. Sibling imports carry the `.ts` extension (`node --test` runs the sources directly).

## Concerns the file mixes

1. Markdown inspection: task and heading counts, the 240-character summary (`walk`, `plainText`,
   `inspectMarkdown`).
2. YAML configuration reading (`scalarText`, `configuration`).
3. Naming and ordering helpers (`humanize`, `labels`, `order`, `ordinal`).
4. Turning files into artifacts (the `artifacts` closure: title, format, revision hash, counts).
5. Workspace settings from `config.yaml`, with two warnings and the `spec-driven` default.
6. Memoised lookup of published specs and their requirement texts (`published`).
7. Delta derivation: what a change's delta specs do to the published requirements (`deltasOf`).
8. Change grouping and construction (`changesOf`, `changeOf`): path depth, per-change schema,
   times, status, document rank, archived flag.
9. Pull request merging: prefixed documents, dropping pull requests without changes, pinning
   threads to requirements, filtering review files.
10. Workspace assembly: newest-first sort, the specs list, the final object.

## Target shape

Every new module lives in `cli/` with a test beside it (`import assert from 'node:assert/strict'`,
`import { test } from 'node:test'`). Keep every existing comment whose fact still holds, beside the
code it explains.

- `cli/markdown-info.ts` — `MarkdownInfo`, `inspectMarkdown(content)`; `walk` and `plainText`
  private. `walk` loses its depth-3 nesting, for example through a helper that returns the token
  lists to descend into (list items; table header and row cells' tokens; a token's own tokens).
  Test: move "counts actual tasks and headings" from `parser.test.ts` verbatim.
- `cli/configuration.ts` — `configuration(content): Map<string, string | null>` with today's
  semantics (throws the first YAML error of any document; top-level scalar keys of the first
  document only; a non-scalar value becomes `null`; a non-map root gives an empty map), and
  `workspaceSettings(documents: Artifact[]): { schema: string; warnings: string[] }`: finds the
  document whose path matches `/^config\.ya?ml$/`, warns
  `config.yaml could not be parsed. Its source is still available in Artifacts.` when
  `configuration` throws, warns the external store sentence (copy it verbatim from today's line 186)
  when the map has a `store` key, schema from the `schema` key or `spec-driven`. Test: map, non-map
  root, invalid YAML throws, both warnings, default and explicit schema.
- `cli/artifact.ts` — `humanize`, `ordinal` as guard clauses (still code-unit order, keep the
  locale comment), `artifactsOf(files: ArtifactFile[], prefix = '', pullRequest?: number): Artifact[]`
  sorted by path with `ordinal`, same fields as today: title from the `labels` map by file name
  without extension, else `humanize`; `format` markdown or yaml by a case-insensitive `.md` check;
  `modified` as ISO string or `null`; `revision` sha256 of the content; counts and summary from
  `inspectMarkdown` of the content for markdown and of `''` otherwise; the `pullRequest` key only
  when given. Test: move "humanizes names"; add artifactsOf: title lookup, yaml zero counts, sort,
  key absent.
- `cli/spec-delta.ts` — the `Published` type, `publishedSpecs(documents: Artifact[]): Published`
  (today's memoised closure as a factory; the memo stays inside), and
  `deltasOf(id, docs, published): SpecDelta[]` as small named steps for added, modified, removed
  and renamed instead of one 36-line arrow. Keep the rename comment. Test: each kind;
  rename-then-modify merged under the new name with `previousName` and the old text as `previous`;
  documents outside `<id>/specs/<capability>/spec.md` ignored; a document with no requirement
  changes dropped; sorted by line; `published` path or `null`.
- `cli/change.ts` — `changesOf(docs, prefix, context, pull?)` returning
  `{ changes: Change[]; times: Map<string, number | null>; warnings: string[] }` instead of
  pushing into shared arrays; `times` holds exactly what `changeTimes` holds today for these
  changes (the epoch of the newest time, `null` when none); `context` carries the workspace
  `schema`, the `modified` map (path to epoch) and the `Published` lookup. `statusOf(completed,
  total)` as guard clauses: total 0 → `Draft`, completed equal to total → `Complete`, completed
  above 0 → `In progress`, else `Planned`. Document order by `order` rank then `ordinal`, as today.
  `newestFirst(changes, times): Change[]` with today's comparator: missing time counts as minus
  infinity, equal times fall back to `ordinal(id)`, newer first. Sort by the epoch values, never by
  the ISO strings: they lose sub-millisecond order. Test: grouping depth for `changes/<id>` and
  `changes/archive/<id>`, loose files ignored, the status table, the `Invalid metadata in <name>.`
  warning, archived change has no deltas, a pull request change is never archived, times from
  `pull.updatedAt` versus file times, `newestFirst` with undated changes and ties.
- `cli/pull-request.ts` — `pullRequestOf(pull: PullRequestInput, docs: Artifact[], changes:
  Change[]): PullRequest` (today's lines 278-306) with the thread pinning and the review-file
  filter as named helpers, no nested ternary: a thread outside the owned documents is dropped; a
  thread with a line is pinned to the requirement of the delta at its path whose `line..endLine`
  spans it, `requirement` is the name or `null`; `reviewFiles` is filtered to owned documents with
  the prefix added, and the key is absent when the input has none (keep that comment). Test: each
  of those.
- `cli/parser.ts` keeps `BuildOptions` and `buildWorkspace`, about 50 lines, as steps separated
  by a blank line and opened by a one-line comment: artifacts, settings, published specs, changes,
  pull requests, ordering, assembly. No closures over shared state. If nothing outside
  `parser.test.ts` imports `humanize`, `inspectMarkdown` or `MarkdownInfo` from `parser.ts` (grep
  `src`, `cli`, `tests`; today nothing does), drop them from `parser.ts` and point the tests at
  the new modules.
- `cli/parser.test.ts` keeps its five `buildWorkspace` tests unchanged as the integration net.

## Conventions

From `.agents/docs/code-conventions.md`, applied to Node code:

- The lint limits in `eslint.config.js` are the floor: in a file you touch every warning counts as
  an error. Split, never raise a limit or disable a rule.
- One concern per module. Data shaping, parsing and classification are pure functions with a test
  beside them.
- A long function reads as steps separated by a blank line, each opened by a one-line comment;
  helpers above their first caller; parameters and return values instead of closures over shared
  mutable state.
- A name says what a thing is, not how it works; no one-word name for a number; no `read`, `data`
  or `result` for something with a meaning.
- One level of ternary at most; otherwise guard clauses or a lookup table.
- Comments give a non-obvious why or an invariant, in one or two lines, as a colleague would write
  them; never narrate what changed.
- Types both sides use stay in `cli/workspace.model.ts`; a module's private types stay private.

## Behaviour to preserve

- Titles come from the labels map or the humanised file name, a leading `YYYY-MM-DD-` stripped —
  covered by "humanizes names" and "groups changes, orders documents and derives status".
- Task, requirement and scenario counts and the 240-character summary from the first top-level
  paragraph, emphasis markers removed; YAML documents get zeros and an empty summary — covered by
  "counts actual tasks and headings".
- `documents` holds the artifacts from disk sorted by path in code-unit order, followed by the
  artifacts of each kept pull request in input order, each group sorted by path — not covered
  (snapshot check below).
- Unparsable `config.yaml` warns and keeps `spec-driven`; a `store` key warns; `schema` sets the
  workspace schema — covered by "orders undated changes by id and reports configuration problems".
- `warnings` order: the options' warnings, then the config warnings, then the metadata warnings of
  the changes from disk in grouping order, then those of each kept pull request in input order —
  partly covered by the same test; snapshot check.
- Changes are grouped under `changes/<name>` and `changes/archive/<name>`; files directly in those
  folders are ignored — covered by "groups changes...".
- Per-change schema from `.openspec.yaml`, invalid metadata warns with the change name — covered.
- Status Draft, Planned, In progress, Complete — covered.
- Documents ordered refine, proposal, design, tasks, then by path — covered.
- Change time from its files, or from the pull request's `updatedAt` when it has one; newest
  first; undated last; ties by id — covered by "orders undated changes by id...".
- Archived changes have no deltas; a pull request change is never archived; others get added,
  modified, removed and renamed entries sorted by line, rename-then-modify merged — covered by
  "matches the requirement changes of a change to the published spec".
- Pull requests: `.pulls/<n>/` prefix on paths; one without changes is dropped with its documents;
  threads pinned to the requirement spanning their line; threads outside the owned documents
  dropped; `reviewFiles` filtered and absent when the input had none — covered by "adds the
  changes and review threads of pull requests" and "keeps the diffs of the documents with their
  pull request".
- The `specs` list: path, capability, requirement and scenario counts of `specs/**/spec.md` from
  disk — covered by snapshot check.
- `loadedAt` from `options.now` or now; `isDemo` defaults to false; `source` and `pullRequests`
  keys only when given — covered by the buildWorkspace tests.

## Verification, in this order

1. `npm test` — type-checks the whole tree and runs every test; must pass.
2. `npx eslint --max-warnings 0 <every file you created or changed>` — zero problems.
3. Snapshot check, byte-identical output for the same input. Scratch dir
   `S=/private/tmp/claude-501/-Users-stefanoslignos-Personal-Projects-openspec-dashboard/dca260e3-168b-445e-9c29-cd7042034772/scratchpad/split-cli`
   holds `before-demo.json` and `before-own.json`, taken before any edit. Run from the repo root:

   ```
   node --input-type=module -e "
   import { readWorkspace } from './cli/reader.ts';
   import { writeFileSync } from 'node:fs';
   const demo = await readWorkspace('demo', { demo: true }); delete demo.loadedAt;
   const own = await readWorkspace('.'); delete own.loadedAt;
   writeFileSync('$S/after-demo-parser.json', JSON.stringify(demo, null, 1));
   writeFileSync('$S/after-own-parser.json', JSON.stringify(own, null, 1));"
   diff "$S/before-demo.json" "$S/after-demo-parser.json" && diff "$S/before-own.json" "$S/after-own-parser.json" && echo identical
   ```

Do not run `npm run build`, `npm start`, `npm run dev` or `npm run test:ui`: they share `dist/`
and fixed ports with the main session, which runs them.

## Hard constraints

- No git command that writes (add, commit, stash, checkout, restore, reset, branch). Read-only git
  is fine.
- Do not run `npm install`; do not edit `package.json`, any `tsconfig*.json`, `eslint.config.js`
  or `angular.json`.
- Stay within `cli/parser.ts`, `cli/parser.test.ts` and the new modules and tests named above.
  Another implementer is editing `cli/github.ts` and new `cli/github-*.ts` files at the same time:
  never touch those. If `npm test` reports a type error in a file that is not yours, wait a minute
  and re-run before judging.
- Verify against the code and the test output, never against your own earlier reasoning.

## Report back

Every file created or changed with its line count (`wc -l`); the exact tail of the `npm test`
output; the lint command and its result; the snapshot diff result; every behaviour you could not
preserve exactly, with the reason. Paste the final `cli/parser.ts` in full.

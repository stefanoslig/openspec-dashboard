# Split brief: cli/github.ts

You are refactoring `cli/github.ts` in `/Users/stefanoslignos/Personal_Projects/openspec-dashboard`
for readability, behaviour unchanged. The owner found it unreadable: 363 lines, 13 lint warnings,
and `readPullRequests` is 183 lines with a cognitive complexity of 41, holding two async closures
and three loops that mutate shared arrays.

Read `AGENTS.md` and `.agents/docs/code-conventions.md` first. `cli/` is Node only: no Angular
imports. Sibling imports carry the `.ts` extension (`node --test` runs the sources directly).

## Concerns the file mixes

1. GraphQL transport: request headers, response decoding, failure wording (`client`).
2. The query texts (`files`, `threads`, `list`, `more`).
3. Listing the open pull requests page by page, de-duplicated, capped at 200, counting forks.
4. Fetching the remaining pages of one connection of one pull request (`rest`).
5. Looking up git objects in batches of 50 aliased fields (`objects`).
6. Choosing which pull requests count: their change folders from the changed files
   (`changeFolders`), skipping forks and pull requests without a change folder.
7. Walking the change folders at the head commit, level by level for all pull requests at once,
   with five skip rules and their warnings.
8. Fetching blob texts and warning about what GitHub cannot return as text.
9. Shaping the output: thread filtering and the line rule, ghost authors, omitted counts, review
   files with diff anchors (`reviewFiles`).

## Target shape

Every new module lives in `cli/` with a test beside it (`import assert from 'node:assert/strict'`,
`import { test } from 'node:test'`). Keep every existing comment whose fact still holds, beside the
code it explains. Constants move next to their users.

- `cli/github-api.ts` — how we talk to GitHub. Exports GitHub's response types (`Page`,
  `ChangedFile`, `Thread`, `Entry`, and today's `Node` renamed `PullRequestNode`), a `GitHubApi`
  holding the query function plus `owner` and `name`, and:
  - `connect(options): GitHubApi` — today's `client` plus the `repository.split('/')`.
  - `failureMessage(...)` — a pure function producing today's error text from the status, the
    status text and the decoded body (lines 123-131), tested directly: 403 with message gets the
    permissions sentence; 401 too; a rate-limit message does not; a 200 body with `errors` gives
    `GitHub answered: <message>.`; an error of type `FORBIDDEN` gets the permissions sentence; a 502
    with an HTML body gives `GitHub answered 502: Bad Gateway.`.
  - `listOpenPullRequests(api, branch): Promise<{ nodes: PullRequestNode[]; listed: number;
    total: number }>` — today's do-while: pages of 25 ordered by update time, `listed` counts
    nodes before de-duplication, stops when there is no next page or `listed` reaches 200, keeps
    the first occurrence of a number.
  - `remainingPages<T>(api, number, key, first): Promise<T[]>` — today's `rest`.
  - `gitObjects<T>(api, by, fields, keys): Promise<Map<string, T | null>>` — today's `objects`,
    unique keys, 50 per request, aliases `o0..`, variables `v0..`.
  - The query texts beside the functions that send them.
- `cli/github-documents.ts` — which documents a pull request brings.
  - `changeFolders(changed, prefix)` verbatim, pure.
  - A pure verdict for one tree entry at one depth, returning descend, read, ignore, or the
    warning phrase to prefix the path with (`Skipped symbolic link`,
    `Skipped a folder below the supported depth (20)`, `Skipped a document larger than 2 MB`), in
    today's rule order: symbolic link mode (`0o120000` or `120000`); hidden name other than
    `.openspec.yaml` ignored; tree descends while depth is below 20; non-blob or non-artifact
    ignored; size above `maxFileBytes` warns; else read. Tested per rule.
  - `documentsAt(api, prefix, wanted): Promise<{ files: Map<number, ArtifactFile[]>; warnings:
    string[] }>` where each wanted item names a pull request number, its head commit and its
    change folders: today's level-by-level walk (lines 268-303) and the blob fetch (305-322). The
    warning text is `<phrase> in pull request #<number>: <path>`; the blob warning is
    `Skipped a document GitHub could not return as text in pull request #<number>: <path>`.
    Imports `isArtifact` and `maxFileBytes` from `./reader.ts` as today.
- `cli/github-review.ts` — what the review says about those documents, both pure:
  - `threadsOf(threads, folders, prefix)` — today's filter and map (lines 336-359): only threads
    with at least one comment whose path starts with `prefix + folder + '/'` for one of the change
    folders; `url` of the first comment; path without the prefix; `line` only when `subjectType`
    is `LINE`, `diffSide` is `RIGHT` and the thread is not outdated (keep that comment); `author`
    falls back to `ghost`; `omitted` is `totalCount` minus the comments returned.
  - `reviewFiles(...)` — today's function with at most three parameters (group the pull request's
    url, changed files and documents in one object). Keep the SHA-256 anchor comment.
  - Test: the line rule in its three failing variants, a thread outside the folders, an anchor.
- `cli/github.ts` keeps `GitHubOptions` (define or re-export it here; nothing else imports it
  today) and `readPullRequests(options)` as steps separated by a blank line and opened by a
  one-line comment: connect; list, with the two warnings (`Only the <listed> most recently
  updated open pull requests were read; <total - listed> were not.` when total exceeds listed;
  `1 pull request from a fork was skipped.` or `<n> pull requests from forks were skipped.`);
  candidates; documents; shape. A small `toPullRequest` helper builds each `PullRequestInput`
  (author `ghost` fallback, `draft`, `branch`, `commit`, `updatedAt`, `files`, `threads`,
  `reviewFiles`). No closures over shared mutable state.
- `cli/github.test.ts` stays unchanged; it imports only `readPullRequests` from `./github.ts`.

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

## Behaviour to preserve

The tests count requests and read their variables, so the request order is behaviour:

1. The list query page after page with the `after` cursor until no next page or 200 listed.
2. For each listed node in order, skipping forks and nodes whose `files` is null without any
   request: the remaining pages of its `files`; then, only when it has change folders, the
   remaining pages of its `reviewThreads`.
3. One tree request per depth level for all candidates at once, 50 expressions per request, items
   in the order they became pending; the expression is `<headRefOid>:<prefix><directory>`.
4. One blob request for all blobs, 50 per request, in blob order.

The warnings array is compared whole: cap warning, fork warning, tree-walk warnings in encounter
order, blob warnings in blob order.

- Open pull requests targeting the branch, newest updated first, pages of 25, at most 200, with
  the "were not" warning — covered by "follows the pages of pull requests, files and threads, up
  to 200 pull requests".
- A pull request listed twice across pages is read once — covered by the same test.
- Fork pull requests are skipped and counted, singular and plural wording — singular covered by
  "reads the changes a pull request adds to or modifies, at its head commit"; plural not covered.
- Only added or modified files under `changes/<name>/` or `changes/archive/<name>/` make a pull
  request count; one without such a folder is dropped — covered by "reads the changes...".
- Tree walk: symlink warning, hidden entries skipped except `.openspec.yaml`, 2 MB warning,
  non-text warning — covered by "reads the changes...". The depth-20 warning is not covered.
- Review files link each changed document to its diff anchor without extra requests; unchanged and
  skipped documents have none; `added` from the change type — covered by "links the documents a
  pull request changes to their diffs, without more requests".
- Output fields and the thread rules — covered by "reads the changes..." and "links the
  documents...".
- Every failure message, trailing `.`, `:` and whitespace normalised to one period, the
  permissions hint except on rate limits, `GitHub could not be reached: <message>` with the cause
  when fetch throws, `GitHub answered with something other than GraphQL data.` for a non-GraphQL
  body — covered by "explains why GitHub could not be read".

## Verification, in this order

1. `npm test` — type-checks the whole tree and runs every test; must pass.
2. `npx eslint --max-warnings 0 <every file you created or changed>` — zero problems.

Do not run `npm run build`, `npm start`, `npm run dev` or `npm run test:ui`: they share `dist/`
and fixed ports with the main session, which runs them.

## Hard constraints

- No git command that writes (add, commit, stash, checkout, restore, reset, branch). Read-only git
  is fine.
- Do not run `npm install`; do not edit `package.json`, any `tsconfig*.json`, `eslint.config.js`
  or `angular.json`.
- Stay within `cli/github.ts` and the new `cli/github-*.ts` modules and tests named above. Do not
  edit `cli/github.test.ts`, `cli/reader.ts`, `cli/export.ts` or `cli/workspace.model.ts`. Another
  implementer is editing `cli/parser.ts` and new `cli/*.ts` modules at the same time: never touch
  those. If `npm test` reports a type error in a file that is not yours, wait a minute and re-run
  before judging.
- Verify against the code and the test output, never against your own earlier reasoning.

## Report back

Every file created or changed with its line count (`wc -l`); the exact tail of the `npm test`
output; the lint command and its result; every behaviour you could not preserve exactly, with the
reason. Paste the final `cli/github.ts` in full.

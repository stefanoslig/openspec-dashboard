# Design

## Context

Motivation and scope: see `proposal.md`. Requirements: see `specs/`.

Current state that shapes the approach:

- `cli/reader.ts` reads `.md`/`.yaml`/`.yml` files of one `openspec/` folder from disk (limits: 2 MB per file, 2,000 files, 20 MB, depth 20; symbolic links and dot-names other than `.openspec.yaml` are skipped). `cli/parser.ts` `buildWorkspace(files, options)` turns them into the `Workspace` of `cli/workspace.model.ts`. The local server builds it per request; `cli/export.ts` builds it once and writes `workspace.json` next to the prebuilt Angular app.
- The parser only counts `Requirement:`/`Scenario:` headings (via the `marked` lexer). Delta sections are styled by `src/app/core/render-markdown.ts` but not understood.
- `Workspace.source` (repository, ref, commit, folder) exists only when `GITHUB_ACTIONS=true`.
- The Angular app has two routes: `/` (dashboard, `?view=`) and `/artifact?path=` (reader). Documents are addressed by `Artifact.path`, relative to the openspec folder. Hash routing and a relative base make the export work under any URL path.
- Runtime dependencies of the package are `marked` and `yaml` only; everything the browser needs is bundled at build time, so it is a dev dependency.
- OpenSpec's delta rules were read from `@fission-ai/openspec` 1.14.0, `dist/core/parsers/requirement-blocks.js`.
- GitHub GraphQL fields used below were checked against the public schema on 2026-10-03.

## Goals / Non-Goals

**Goals:**

- One data path: everything the browser shows is in `workspace.json`. The browser never calls GitHub.
- The local server and an export without `--pull-requests` keep working with no network and no token.
- What the page shows for a delta is what `openspec archive` would apply.
- Additive model changes only.

**Non-Goals:**

- Validating deltas (`openspec validate` does that). The page reports only what falls out of matching: not found, already exists.
- Thread markers inside the reader's rendered documents. Threads appear on the change page only.
- Diffs for spec files a pull request edits directly without a change folder.
- An opt-in for fork pull requests, and an opt-out for threads alone.
- A packaged GitHub Action (see decision 9).
- Caching GitHub responses between runs.

## Decisions

### 1. Delta parsing is line-based and mirrors OpenSpec (`cli/delta.ts`)

New module, pure functions, no dependencies:

- `parseDelta(content)` returns the requirement blocks of a delta spec per kind; `publishedRequirements(content)` returns the blocks of a published spec.
- Rules, as in OpenSpec: strip a BOM and normalize line endings; mask lines inside code fences; sections start at `## ` lines; the four titles `ADDED|MODIFIED|REMOVED|RENAMED Requirements` match case-insensitively and repeated sections are merged; a requirement header is `/^###\s*Requirement:\s*(.+)\s*$/i`; the name is the capture with a closing `#` run removed, trimmed; a block runs from its header to the line before the next requirement header or `## ` line, trailing blank lines dropped. REMOVED names come from headers or from bullets carrying a header (`` - `### Requirement: X` ``); the text after a removed header is its reason. RENAMED pairs are `FROM:`/`TO:` lines (optional bullet, optional backticks); a `FROM` without a following `TO` is ignored. In a published spec, blocks are read inside its `## Requirements` section.
- Scenarios inside a block are `#### ` headers outside fences; the name drops a leading `Scenario:`.
- Every block records its 1-based `line` and `endLine` in the delta document (for a rename: the `FROM` line to the `TO` line). Thread pinning needs them.
- OpenSpec applies RENAMED before MODIFIED, so a MODIFIED header uses the new name. A modified requirement whose name is a rename target is matched by the old name and reported once, as modified with `previousName`.

Alternatives: the `marked` lexer, as `inspectMarkdown` uses, gives no reliable source lines and differs from OpenSpec in edge cases. Importing OpenSpec's parser would depend on internals of a CLI the README says is not required.

### 2. Model additions (`cli/workspace.model.ts`)

```ts
export interface RequirementChange {
  kind: 'added' | 'modified' | 'removed' | 'renamed';
  name: string; // the new name after a rename
  previousName?: string; // renamed, or modified and renamed
  text: string; // Markdown block from the delta: new text (added, modified), reason (removed), '' (renamed)
  previous: string | null; // Markdown block from the published spec; null when there is none
  line: number;
  endLine: number;
}
export interface SpecDelta {
  path: string; // the delta spec document
  capability: string;
  published: string | null; // document path of the published spec; null for a new capability
  requirements: RequirementChange[]; // in document order
}
export interface ReviewThread {
  url: string; // first comment on GitHub
  path: string; // document the thread is on
  line: number | null;
  requirement: string | null; // name of the requirement change it is pinned to
  resolved: boolean;
  outdated: boolean;
  comments: { author: string; body: string; createdAt: string; url: string }[];
  omitted: number; // comments beyond the 30 included
}
export interface PullRequest {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  branch: string;
  commit: string;
  updatedAt: string;
  changes: string[]; // Change ids
  threads: ReviewThread[];
}
```

`Change` gains `deltas: SpecDelta[]` (empty for archived workspace changes) and `pullRequest?: number`. `Artifact` gains `pullRequest?: number`. `Workspace` gains `pullRequests?: PullRequest[]`: absent means pull requests were not read, an empty array means none changes the specs. "Not found" is `previous === null` on a non-added kind; "already exists" is `previous !== null` on an added kind.

### 3. Pull request documents live under a reserved path prefix

A document from pull request 42 gets the path `.pulls/42/<path relative to the openspec folder>`, and its change the id `.pulls/42/changes/<name>` (or `.pulls/42/changes/archive/<name>`), with `archived: false` and `pullRequest: 42`. The disk reader skips top-level dot-names, so the prefix cannot collide with a real file, and the existing lookup by path, the reader route and search work unchanged. A pull request change takes `modified` from the pull request's `updatedAt`; its documents have `modified: null`.

In the UI the prefix is never shown: the document path is displayed without it, next to a "PR #42" label. `WorkspaceStore.sourceLink` builds the link from the pull request's `commit` and the path without the prefix. A relative link inside a pull request document that resolves to a missing `.pulls/42/…` path is retried without the prefix, so links to published specs keep working.

Alternative: a separate `pullRequests[].documents` list. That would fork the reader, the search and the link resolution.

### 4. `buildWorkspace` assembles both sources

`BuildOptions` gains `pullRequests?: PullRequestInput[]`, where an input is a `PullRequest` without `changes`, with `files: ArtifactFile[]` (paths relative to the openspec folder) and raw threads (path relative to the openspec folder, `line`, `resolved`, `outdated`, comments, `omitted`). The grouping of documents into changes is extracted into a helper and run once for the disk files and once per pull request. Deltas are computed against the `specs/**/spec.md` documents of the disk files, for non-archived disk changes and for all pull request changes. A thread is kept when its path is a document of one of the pull request's changes, and is pinned when that document is a delta spec and `line` lies within a requirement change's `line..endLine`.

`cli/github.ts` and the demo fixture both produce `PullRequestInput[]`, so the parser, the UI and the tests do not know where the data came from.

### 5. Pull requests are read through the GraphQL API only (`cli/github.ts`)

`readPullRequests({ graphqlUrl, token, repository, branch, folder, fetch })` returns `{ pullRequests: PullRequestInput[]; warnings: string[] }`. It uses Node's global `fetch`, injectable for tests.

1. **List**, 25 per page, up to 200: `repository.pullRequests(states: OPEN, baseRefName: <branch>, orderBy: {field: UPDATED_AT, direction: DESC})` with `number title url isDraft isCrossRepository author{login} headRefName headRefOid updatedAt`, `files(first: 100){nodes{path changeType}}`, and `reviewThreads(first: 50){nodes{isResolved isOutdated path line diffSide subjectType comments(first: 30){totalCount nodes{author{login} body createdAt url}}}}`. Nested connections with more pages are followed per pull request. Cross-repository pull requests are dropped and counted.
2. **Change folders**: from `files` with `changeType` other than `DELETED` whose path starts with `<folder>/changes/`: `changes/<name>` or `changes/archive/<name>`, with at least one more path segment.
3. **Trees**, level by level, up to 50 aliases per request: `object(expression: "<headRefOid>:<directory>") { ... on Tree { entries { name type mode oid size } } }`, descending into sub-trees to depth 20. Entries are filtered like the disk reader: artifact extensions only, dot-names skipped except `.openspec.yaml`, mode `120000` (symbolic link) skipped with a warning, `size` over 2 MB skipped with a warning.
4. **Blobs**, up to 50 aliases per request: `object(oid: "<oid>") { ... on Blob { text isTruncated isBinary } }`. A truncated or binary blob is skipped with a warning.
5. **Threads** whose path is under a kept change folder are mapped. `line` is used only when `subjectType` is `LINE`, `diffSide` is `RIGHT` and the thread is not outdated; otherwise it is `null`. `omitted` is `totalCount` minus the included comments.

An HTTP error or a GraphQL `errors` array throws an error with GitHub's message. A 401/403, or an error of type `FORBIDDEN`, adds that the workflow needs `contents: read` and `pull-requests: read`.

Cost: the list query is about 13 rate-limit points per page; tree and blob requests are 1 point each. A typical export stays under 40 points against the 1,000 per hour of a workflow token.

Alternatives: fetching pull request heads with `git` needs persisted credentials and child processes, downloads whole snapshots, and still needs the API to know which changes a pull request touched (comparing trees would blame stale branches). REST needs one request per file, and thread resolution exists only in GraphQL.

### 6. Export flow and CLI

- `main.ts`: new boolean `--pull-requests`. Usage error without `export` and with `--demo`. The usage text gains the option.
- `export.ts`: `ExportOptions` gains `pullRequests?: boolean` and `fetch?`. Order: resolve the root, read the files, read pull requests, build, and only then create the output folder. The option requires `githubSource()` to resolve (so `GITHUB_ACTIONS`, `GITHUB_REPOSITORY`, `GITHUB_SHA`) plus `GITHUB_REF_NAME` and a token in `GITHUB_TOKEN` or `GH_TOKEN`; a missing one is an error that names it. The endpoint is `GITHUB_GRAPHQL_URL`, default `https://api.github.com/graphql`. Warnings from the read join the workspace warnings.
- The size totals are enforced while adding pull request files to the disk files, in list order; the first pull request that would exceed them and all later ones are dropped with one warning.
- Demo: `demo/pull-requests.json` holds a `PullRequestInput[]`. A helper in `reader.ts` loads it when `demo` is set, for the server and the export alike.

### 7. The word diff runs in the browser (`src/app/core/requirement-diff.ts`)

Dev dependency `diff` (jsdiff), bundled into the app. For a modified requirement:

1. Split both blocks into the statement (between the header and the first `#### ` header) and scenarios keyed by name.
2. Scenarios only in the new block are added as a whole, only in the previous block removed as a whole; identical ones are unchanged.
3. For the statement and each differing scenario, diff by line, pair adjacent removed and added lines one to one, and diff each pair by word. A pair that shares less than 40% of its words is shown as a whole removed line followed by a whole added line. Changed words that only white space separates are joined into one removal and one addition, and white space alone is never a change.

The result is plain data (segments with a kind), rendered by the template with `<del>` and `<ins>`, never through `innerHTML`. Changed lines are shown as text with emphasis markers and backticks stripped; a leading WHEN/THEN/AND keyword keeps its step styling. Unchanged parts, added and removed blocks go through `renderMarkdown`. `<del>` is struck through and `<ins>` underlined, so the marking does not depend on colour.

The page uses one column. Two columns side by side do not fit the phone layout the browser tests cover.

Alternative: diffing in the CLI would make `diff` a runtime dependency and put presentation data into `workspace.json`.

### 8. UI structure

- New route `change` (`/change?id=<change id>`), component `src/app/features/change/`. Header: title, task status, counts per kind, and for a pull request change the "PR #n" link, author, draft label and review status. Then one section per `SpecDelta`, each requirement with its pinned threads, then "Discussion" with the unpinned threads grouped by document. A pull request change without deltas shows a note instead of the sections.
- `src/app/shared/change-outline/`: the document list and progress box now inside `reader.html`, extracted and used by the reader and the change page, with a first entry "Behaviour changes" when the change has a page.
- `src/app/shared/review-thread/`: one thread. Unresolved ones are open; resolved ones are a closed `<details>`. Comment bodies go through `renderMarkdown` with a new option that renders non-`http(s)`/`mailto` links as text, because the reader's relative-link handling does not apply to comments.
- `WorkspaceStore`: `active` excludes pull request changes; new `inReview`, `pullRequestOf(change)`, `threadsOf(change)`; `sourceLink` as in decision 3.
- Dashboard: an "In review" section above "Active changes" on the overview and the changes view when `workspace.pullRequests` is defined, with the read time from `loadedAt`. The four metric tiles keep describing the exported branch. The "Changes" navigation count is active plus in review. Search results and the artifact list label pull request documents.
- `change-card`: links to `/change` when the change has a page, shows the counts per kind, and for pull request changes the "PR #n" label and review status.

### 9. CI setup is a workflow in the README

No GitHub Action is packaged. An action cannot declare triggers or permissions, so it would only replace four steps, at the cost of a second artifact to version and release. The README's "Publish from CI" section carries this workflow instead:

```yaml
name: Publish specs
on:
  push:
    branches: [main]
    paths: ['openspec/**']
  pull_request_target:
    branches: [main]
    types: [opened, synchronize, reopened, closed, edited, ready_for_review, converted_to_draft]
    paths: ['openspec/**']
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
      - run: npx --yes openspec-desk export --pull-requests --out site
        env:
          GITHUB_TOKEN: ${{ github.token }}
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site
      - id: deploy
        uses: actions/deploy-pages@v5
```

Compared with the current README workflow it adds the `pull_request_target` and `schedule` triggers, the `pull-requests: read` permission, the `--pull-requests` option and the token.

`pull_request_target` always runs the workflow of the default branch, with `GITHUB_REF` and the default checkout on the default branch (GitHub's behaviour since 8 December 2025; before that it was the base branch). So `main` must be the default branch, the `github-pages` environment accepts the deployment, and no pull request code runs. The `branches` filter skips pull requests that target another branch, which the export would not show anyway. Review comment events are evaluated against the pull request's merge ref and cannot deploy to that environment, so the schedule is what picks up new threads.

### 10. Sample data

- `demo/openspec/changes/add-project-invitations/specs/projects/access/spec.md`: a MODIFIED "Owners manage membership", so the local demo shows a word diff against the published `projects/access`.
- `demo/pull-requests.json`: one fictional pull request whose change has a proposal, tasks and a delta on `projects/access` with an added, a modified and a renamed requirement; one unresolved thread on a line of the modified requirement, one resolved thread, one thread on the proposal.

## Risks / Trade-offs

- [Unmerged proposals, review comments and logins become visible to the site's audience] → The CLI option is opt-in; the README states it next to the hosting advice.
- [A busy repository exhausts the token's GraphQL budget] → Batched requests, `paths` filters and `concurrency` in the recommended workflow. A failed read fails the export, so the last good site stays published.
- [Threads are stale until the next run] → The section states when pull requests were read; the schedule bounds the delay.
- [Someone adds a pull request checkout to a `pull_request_target` workflow] → The README says the job must keep the default checkout.
- [OpenSpec's delta format changes] → The rules sit in one module with unit tests ported from OpenSpec's cases. A delta the parser does not understand yields no requirement changes and stays readable as a document.
- [Word diffs of heavily rewritten text are noisy] → The 40% fallback shows whole lines.
- [GitHub Enterprise Server may lack some fields] → Tested against github.com only; the README says so.
- [The demo fixture can drift from the real mapping] → `github.ts` has its own tests on API-shaped responses; the fixture only feeds the parser and the UI.

## Migration Plan

Additive. Without the new option an export differs only by `changes[].deltas`. Repositories that already publish keep working with their current workflow; they get pull requests by replacing it with the README's new one after the next package release. Rollback: remove `--pull-requests` from the workflow.

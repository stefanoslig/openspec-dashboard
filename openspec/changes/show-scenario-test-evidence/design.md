# Design

## Context

See [proposal.md](proposal.md) for motivation and [the specification](specs/scenario-test-evidence/spec.md) for observable behaviour.

The package already ships a Node CLI and a built Angular application. `cli/reader.ts` reads Markdown and YAML; `cli/parser.ts` builds a workspace; `cli/export.ts` writes that workspace as JSON alongside the app. The browser reads only that JSON. The local server calls the reader again on refresh.

`cli/delta.ts` parses requirement blocks with source locations, but scenarios are currently counted or split for display rather than modelled as identifiable records. `Change.status` derives from task checkboxes. PR documents have a `.pulls/<number>/` prefix and carry their own head commit. Playwright is already a development dependency and drives `tests/dashboard.spec.ts`.

## Goals / Non-Goals

**Goals:** Share scenario identification and evidence matching between the reporter, server, and export; keep the browser independent of test runners; preserve the package's Node-only reading path; make every positive summary traceable to recorded executions.

**Non-goals:** See the proposal's exclusions. This version also avoids injecting interactive components into rendered Markdown, copying test attachments, resolving external OpenSpec stores, and reconstructing historical code states.

## Decisions

### 1. Use explicit IDs and a shared scenario parser

Add `cli/scenarios.ts`, using the requirement boundaries and fenced-code handling in `cli/delta.ts`. Extract scenarios under `#### Scenario:` headings from published `## Requirements` and active `ADDED`/`MODIFIED` requirement blocks. Keep scenarios without IDs in the display catalogue so they cannot disappear from the denominator.

Each occurrence carries capability, document path, requirement name, scenario name, optional ID, source line, and fingerprint. Stop a scenario at the next heading of depth four or less. Retain the requirement statement from its heading to its first scenario. Recognise only the ID syntax in the specification; malformed markers generate a diagnostic and remain ordinary readable text.

For reporter lookup, IDs are unique across the workspace. A single active definition supersedes a single published definition in the same capability. Duplicate published definitions, duplicate definitions within a change, IDs crossing capabilities, and definitions in multiple active changes are ambiguous. Keep their locations in diagnostics and omit their verified links. Ignore archived change documents; after a change is archived and synced, its published definition supplies the ID. This is a lookup rule for authored IDs, not a claim to merge all pending deltas into an effective product specification.

For display, resolve each occurrence against its own text and revision; do not overwrite the published catalogue with proposed text. Scenarios shown only in removed text and rename-only requirements have no new-behaviour evidence rows. A rename accompanied by MODIFIED uses the modified body. Ordinary archived documents keep their existing reader; archived changes exposed through a PR remain eligible through that PR's delta view.

The fingerprint is SHA-256 of a JSON array containing capability, ID, normalized requirement heading and statement, and normalized scenario heading and body. Normalize BOM and CRLF/CR to LF and trim trailing whitespace at block boundaries; preserve internal Markdown and whitespace. Exclude document path, delta-section headings, and sibling scenarios. Moving a scenario during archive therefore preserves the fingerprint, while changed wording invalidates it. This is conservative text matching; it does not infer semantic equivalence.

Alternative: matching by scenario names is fragile under renames and cannot distinguish accidental reuse. A separate mapping file would duplicate the catalogue that already lives in the specs.

### 2. Define one runner-independent JSON contract

Add types in `cli/evidence.model.ts` and validation/matching in `cli/evidence.ts`. Document the complete version-1 contract and a small valid example in the README. The shape is:

```text
schemaVersion: 1
run:
  startedAt: ISO timestamp
  finishedAt: ISO timestamp | null
  status: running | passed | failed | timedOut | interrupted
  sourceStart, sourceEnd: { commit: string | null, clean: boolean | null }
  specificationsStable: boolean | null
  scope: { projects, files, selectedTests, grep, grepInvert, shard }
  url?: absolute HTTP(S) URL
scenarios[]:
  id, capability, requirement, name, path, fingerprint
tests[]:
  key, title, file, line, project, repetition, scenarioIds[], expectedStatus
  attempts[]: { retry, status, durationMs, error?: string }
diagnostics[]: { message, scenarioId?: string, paths?: string[] }
```

`startedAt` is required and non-null. `sourceEnd` has null fields until completion. `shard` is null or `{ current, total }`; scope lists describe the suite selected by the runner, never assert complete product coverage. A scenario record is the unique definition captured before testing; unresolved IDs remain on test records and in diagnostics. Unannotated tests have an empty `scenarioIds` array. Test keys distinguish project, test identity, and repeat index; retries are attempts within one record. Duplicate keys or scenario records are invalid. Attempt statuses are `passed`, `failed`, `timedOut`, `skipped`, or `interrupted`.

Bound reading to 20,000,000 bytes and 10,000 test records, independently of the existing artifact limits. Validate types, enums, timestamps, identities, and non-negative counts/durations before matching. Unsupported versions and malformed input are errors. Unknown scenario links, failed tests, missing provenance, and stale fingerprints are valid report data. Strip ANSI escapes from error text, retain at most 8,000 characters per attempt with an explicit truncation note, and render all content as text. Record repository-relative test paths when possible; do not include attachments, environment variables, arbitrary annotations, or stdout/stderr streams.

No path inside a report authorizes a filesystem read. An optional run URL is a link only. The reporter uses this same validator before finalizing its output. A supplied invalid file fails a local workspace load or export; it never quietly degrades into an empty success.

Alternative: importing generic JUnit alone would require a separate convention for scenario identity, specification version, and source provenance. A small explicit contract makes those requirements testable and permits later adapters.

### 3. Keep freshness separate from reported outcomes

Add an injectable revision reader in `cli/revision.ts`. When Git is available, run `git rev-parse HEAD` and `git status --porcelain --untracked-files=normal` in the selected repository with `execFile`, no shell, bounded output, and a short timeout. A missing Git executable or absent repository gives unknown provenance. The reporter records source state and the scenario catalogue at both ends of the run. Generated output should be ignored by Git; the setup example uses the already conventional `test-results/` folder.

The server/export discovers the actual checked-out revision independently of GitHub metadata. Keep GitHub source links and add a separate workspace revision field for evidence, so a workflow's merge-ref metadata cannot substitute for a different actual checkout. PR occurrences use `PullRequest.commit` as their expected clean source revision. No provider API is needed for results on disk.

Freshness precedence:

1. No imported file: evidence not loaded. No ID or no reported linked test: missing, with a specific reason. Ambiguous identities cannot yield current evidence.
2. A known fingerprint or commit mismatch: outdated; preserve the older outcomes and explain the mismatch.
3. An unfinished run, changes observed during the run, unknown revision, or a dirty tested/displayed working copy: unverified. A running report also states that it is incomplete.
4. Otherwise: current. This requires matching fingerprints, equal non-null start/end/displayed commits, clean source at both ends and at the displayed local checkout, and `specificationsStable: true`.

An unsaved or uncommitted local implementation can still show its recorded tests; this version does not pretend it has verified that working tree. Computing a digest of every tracked and untracked source file is deferred because it increases I/O and configuration, particularly in large repositories.

Within current evidence, summarize the linked test records as follows:

| Condition                                                                            | Scenario outcome             |
| ------------------------------------------------------------------------------------ | ---------------------------- |
| Any test ends in failure or timeout, or unexpectedly passes an expected-failure test | Failing                      |
| Otherwise, any test passes after a failed attempt                                    | Flaky                        |
| Otherwise, all reported tests have only skipped attempts                             | Skipped                      |
| Otherwise, any test has no attempt, is interrupted, or is skipped alongside passes   | Incomplete                   |
| Otherwise, every test passed as expected                                             | Reported linked tests passed |

Expected failures retain the actual failed attempt and expected status; `TestCase.ok()` alone cannot supply evidence. Test details always retain every recorded attempt, even when a more severe aggregate state wins. Display freshness alongside outcomes and count outdated/unverified/missing evidence separately from current passes. A failed overall run can contain an individually passing scenario; show the failed run prominently and never turn the scenario counts into a release verdict.

Alternative: treating a matching ID or timestamp as fresh would allow old or unrelated code results to look current. Git is optional so exporting a copied workspace remains possible, with provenance explicitly unverified.

### 4. Ship the reporter as an optional package entry point

Add `cli/playwright-reporter.ts`, compiled by the existing CLI build, and export it as `openspec-desk/playwright-reporter`. Import Playwright reporter types only; the output must have no runtime import of Playwright. Declare an optional peer dependency with the tested minimum version, 1.63.0, below major version 2. Keep the existing bin entry and default dashboard installation lightweight.

Reporter options: `workspace` defaults to the invocation directory, `outputFile` defaults to `test-results/openspec.json`, and `runUrl` is optional. Relative options resolve from the invocation directory. Annotation descriptions contain a single case-sensitive scenario ID; multiple annotations link a test to multiple scenarios. Declaration-time annotations are the supported mapping contract.

At `onBegin`, collect the selected suite and scenario/source snapshots, then atomically replace any older result with a version-1 report whose status is `running` and whose test attempts are empty. This hook is synchronous: use bounded synchronous filesystem/Git reads for the initial snapshot and write. Share the pure parser and limits with the asynchronous reader; do not start an unawaited read in this hook. At the awaited `onEnd`, record all available attempts, final source/specification snapshots, run status, and diagnostics, then atomically replace the initial file. Normalize Playwright's run status `timedout` to the contract's `timedOut`.

If the process dies after initialization, the initial file cannot imply success. A failure to initialize or finalize output must produce a clear reporter error, identifying the destination and whether an earlier file remains; it must never be presented as a successful report. The UI always identifies a report by its recorded run time and never calls it the latest run. Concurrent runs must use separate output files. CI should use a fresh job directory and must not cache or restore the evidence output from an earlier run.

Capture resolved projects, selected file names and test count, grep settings, and shard metadata. Keep unannotated tests as records so the run's scope and outcome remain inspectable. Do not collect arbitrary process arguments. Flaky tests are detected from their attempts; expected failure handling uses `expectedStatus` and actual attempts. A dry run with no attempts cannot supply passes. Do not override the test runner's exit status.

The supported API has been checked against the installed reporter types and the official [custom reporter documentation](https://playwright.dev/docs/test-reporters#custom-reporters) and [test annotations](https://playwright.dev/docs/test-annotations#annotate-tests). The reporter lives in the existing package to avoid a second installation and release process.

### 5. Extend the existing read/export path

`main.ts` gains `--results <file>` for both modes, with repeated values rejected. Resolve the path once from the invocation directory, then pass it to `readWorkspace` or `exportSite`. Results are opt-in; there is no search for arbitrary files on disk. `--demo` uses a bundled synthetic report by default and may accept an explicit result file for fixture testing; supplied data follows normal matching rules.

Both entry points follow one flow: resolve/read workspace, read and validate the optional result, discover revision, build scenario occurrences, and attach matched evidence. Keep the existing source-document model and add optional workspace evidence data rather than manufacturing Markdown artifacts for JSON results. With no file, the browser can state evidence was not loaded without expanding every document into missing-result warnings.

The server repeats that flow on refresh and exposes only its existing endpoints. Export completes validation before creating/copying its output and embeds the evidence into `workspace.json`. The site needs no extra fetch at runtime. Result paths and provenance from the local machine are not published as absolute filesystem paths. GitHub PR import remains optional and independent: match an imported report against each PR head and displayed fingerprint, without downloading CI artifacts. One report describes one run; several PRs or shards require separate reports/sites in this version.

### 6. Add evidence panels using Angular components

Add a shared scenario-evidence component with summary rows and expandable test details. On the change page, place it within each added/modified requirement after the behaviour comparison, using the new scenario text. On a published specification, provide a grouped evidence panel before the Markdown reader with links to the existing scenario anchors. Keep the existing renderer's sanitization, outline, source view, and document links.

Each row names the scenario and ID, reports freshness and outcome, and can reveal test name, project, test source location, attempt statuses, and error text. Use visible labels and icons as well as colour. Show run time, source revision, scope, run status, and diagnostics once per page. An optional run URL opens normally as an external link. No attachments are fetched or copied.

Cards and the change page show concise evidence counts only when results are loaded. Label all existing change-status badges `Tasks: <status>` and the outline progress `Task progress`; keep the underlying task-status enum. A report cannot produce an overall `Accepted`, `Verified`, or `Ready to ship` label. Cover phone layouts and static-site subpaths with browser tests.

### 7. Make setup concrete and use it in this repository

The README should show this proposed installation and configuration, next to the ID syntax:

```sh
npm install --save-dev openspec-desk
```

```ts
// In the team's existing Playwright configuration:
reporter: [
  ['list'],
  ['openspec-desk/playwright-reporter', { outputFile: 'test-results/openspec.json' }],
],
```

```ts
test(
  'revoked invitations cannot be accepted',
  {
    annotation: { type: 'openspec', description: 'INV-002' },
  },
  async ({ page }) => {
    // Existing test implementation.
  },
);
```

```sh
# After the team's normal test command:
npx openspec-desk --results test-results/openspec.json

# After those same tests in CI:
npx --yes openspec-desk export --results test-results/openspec.json --out site
```

CI instructions extend an existing test job and publish its `site/` as an artifact or on the team's static host. Export/upload must still run after test failure, while the test job retains its failed status. A PR report must use the same checked-out revision as its test run. This belongs in ordinary test workflows; the README's existing `pull_request_target` workflow continues reading PR documents as data and must not gain PR-code execution.

This change's acceptance scenarios already have IDs. Annotate corresponding browser tests during implementation, leaving untested IDs visible as missing. Configure this repository's reporter through its built relative path; separately verify the public package entry from an installed tarball. The sample workspace gets synthetic evidence and an explicit synthetic revision covering passes, failures, skipped/flaky/missing states, and mismatched fingerprints. Only the bundled `--demo` data uses this revision; ordinary workspaces and explicit result overrides follow normal provenance rules. Mark it as sample data through `isDemo`; it never establishes genuine evidence for a user's repository.

## Risks / Trade-offs

- [An ID links to a test whose assertions miss the requirement] → Use the precise label “reported linked tests passed”; humans still review the mapping and assertions.
- [Uncommitted local work has useful results but unverifiable source identity] → Show the outcomes with an unverified source label; require no commit just to read the report.
- [Several active changes reuse the same ID] → Show the ambiguity and require the authors to resolve it; do not choose by file order or modification time.
- [A shard or filtered run appears comprehensive] → Show its scope and every missing scenario; avoid product-coverage percentages and release verdicts.
- [A branch-wide site is expected to gather every PR's evidence] → Document the single-run boundary and the separate per-PR report workflow before setup.
- [Reporter output grows or leaks machine details] → Bound input/output, retain concise errors, use relative locations, and omit attachments and environment data.

## Migration Plan

Existing commands and packages remain usable without a reporter. Introduce the JSON contract and reader, then the reporter and UI, followed by demo and README examples. Verify the installed package in a temporary consumer before release. Teams opt in by adding IDs, annotations, one reporter entry, and `--results` to their existing commands. Removing `--results` and the reporter restores the prior workflow; no repository or service data migration is needed.

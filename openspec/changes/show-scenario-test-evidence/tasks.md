# Tasks

## 1. Scenario identities and specification fingerprints

- [x] 1.1 Add scenario occurrence types and `cli/scenarios.ts`, sharing requirement/fence rules with `cli/delta.ts`. Test published and ADDED/MODIFIED scenarios, missing/malformed IDs, nested capabilities, code fences, CRLF/BOM, and source locations in `cli/scenarios.test.ts`; verify `npm test` passes.
- [ ] 1.2 Implement the reporter's ID catalogue and the fingerprint algorithm from design decision 1. Test active-over-published lookup, unknown and duplicate IDs, different capabilities, multiple active changes, archive exclusion, title/statement/body changes, unchanged sibling scenarios, and relocation into a published spec; verify EVID-003–005 and EVID-013–015 with `npm test`.
- [x] 1.3 Document ID syntax, uniqueness, and archive behaviour in the README, including one scenario and matching test annotation; verify the examples resolve to the same ID with the parser and existing specs without IDs remain readable.

## 2. Portable results and evidence matching

- [ ] 2.1 Add `cli/evidence.model.ts` and a bounded file reader/validator in `cli/evidence.ts`. Test valid running/final reports, missing files, malformed JSON, unsupported versions, invalid fields, duplicate identities, byte/test limits, and unresolved links; verify `npm test` passes and embedded paths trigger no extra reads.
- [ ] 2.2 Add optional revision discovery in `cli/revision.ts` with injected process execution and synchronous support for reporter initialization. Test clean, dirty, missing-Git, non-repository, timeout, and truncated-output cases; verify uncertain states never produce a clean verified revision.
- [ ] 2.3 Implement freshness and outcome summaries from design decision 3. Test matching evidence, changed fingerprints/commits, unknown/dirty provenance, changed source during a run, incomplete runs, retries, mixed results, expected failures, missing IDs/results, and project/repetition isolation; verify EVID-009–018 with `npm test`.
- [ ] 2.4 Document the full version-1 JSON contract, limits, freshness rules, and the meaning of passing evidence in the README; validate its example using the production validator and confirm the documented fields match the exported types.

## 3. Optional Playwright reporter

- [ ] 3.1 Add `cli/playwright-reporter.ts`, its package export, and the optional Playwright peer range from design decision 4. Provide bounded synchronous scenario/source snapshots for `onBegin`, reusing the reader's path, symlink, and size rules; verify the build output contains no runtime Playwright import and `npm test` covers parity with asynchronous snapshots.
- [ ] 3.2 Implement declaration-time links, selected-suite metadata, running-file replacement, attempt capture, source/specification checks, and atomic final output. Test normal completion, failure, skipped/flaky/expected-failure tests, unknown IDs, multiple annotations, interruption, source changes, output errors, and coexistence with another reporter; verify EVID-006–008 and EVID-030 without overriding runner test outcomes.
- [ ] 3.3 Add a temporary Playwright consumer fixture driven by the test suite, with deliberate passing, failing, retrying, and skipped cases. Assert the fixture's expected exit status and recorded results so its intentional failures do not fail the outer suite; verify configuration and annotations work through the real reporter lifecycle, including a running file written before tests execute.
- [ ] 3.4 Document the reporter installation/configuration and supported Playwright version in the README. Include ignored output, concurrent-run filenames, interrupted/error cases, and fresh CI output; verify the example runs in the consumer fixture with a normal test command.

## 4. Local server and static export

- [ ] 4.1 Add the optional evidence/revision data to `cli/workspace.model.ts` and attach scenario occurrences/results during workspace construction. Test active changes, published specs, removed scenarios, rename-only requirements, archived local documents, and two PRs with different heads in `cli/parser.test.ts`; verify EVID-027 and EVID-029 and the existing workspace tests.
- [ ] 4.2 Add `--results <file>` to `cli/main.ts`, the reader, and export using the shared flow in design decision 5. Extend CLI/reader/server/export tests for path resolution from the invocation directory, repeated options, no-file compatibility, refreshed evidence, and no network calls from result import; verify EVID-019–021 with `npm test`.
- [ ] 4.3 Validate results before export writes and embed them into `workspace.json`. Test invalid imports leaving an existing export untouched, valid failing reports exporting successfully, unknown Git provenance, actual checkout revision versus GitHub metadata, and evidence supplied alongside `--pull-requests`; verify EVID-016–017 and EVID-022–023 with `npm test`.
- [ ] 4.4 Add `demo/results.json`, scenario IDs, and the bundled demo's explicit synthetic revision as in design decision 7. Cover passing/failing/flaky/skipped/missing evidence and an outdated fingerprint; verify `--demo` server/export parity, explicit result overrides using normal provenance, and sample-only data in the resulting workspace.
- [ ] 4.5 Extend the README local/CI examples with `--results`, a concrete snippet extending an existing test job, and static artifact/hosting instructions. Ensure export/upload can run after test failure while the job stays failed, output is not restored from an earlier run, and PR tests run outside `pull_request_target`; verify the commands against the fixture and `--help`.

## 5. Evidence in the dashboard

- [ ] 5.1 Add a shared scenario-evidence component with accessible outcome/freshness labels and expandable test attempts/errors. Exercise current, missing, outdated, unverified, skipped, flaky, and incomplete states plus HTML/ANSI-looking error text in browser tests; verify details remain text and no attachments or external resources are fetched.
- [ ] 5.2 Add requirement-grouped evidence to the change page, a linked evidence panel to the published-spec reader, and run/scope/diagnostic details. Add browser tests for EVID-024–027, missing IDs in summary counts, scenario heading navigation, existing word diffs and discussion threads, and selected test scope; verify `npm run build` and `npm run test:ui` pass.
- [ ] 5.3 Add evidence counts to change cards and label existing badges/progress as task status. Test a change whose tasks are complete while evidence fails, the no-results state, and revision isolation between PRs; verify EVID-021 and EVID-028–029 in the browser suite.
- [ ] 5.4 Annotate the real browser tests that exercise EVID-019–021 and EVID-024–029, using only IDs whose full scenarios they cover, and enable the built reporter in `playwright.config.ts`. Describe the evidence panels and first-version boundaries in the README; verify the repository's browser run produces a valid report with remaining unmapped scenarios visible as missing.

## 6. Integration and package checks

- [ ] 6.1 Run the repository's format, unit-test, build, and browser-test commands. Verify existing reading/search/diff/PR workflows still pass, and evidence refresh, phone layout, and static export under a subpath work together.
- [ ] 6.2 Pack the build into a temporary directory and install it into temporary consumers. Verify the published reporter entry generates usable evidence, the exported site embeds it, and a dashboard-only consumer runs without Playwright or Git. Exercise paths containing spaces and confirm result contents cannot introduce extra file reads.
- [ ] 6.3 Follow the documented test → export → serve workflow on the consumer fixture once with passing tests and once with an expected failing test job. Verify both reports are readable, failures remain failures in the job, run scope/revision are visible, and publishing needs no Desk account, database, or API token.
- [ ] 6.4 Run `openspec validate show-scenario-test-evidence --strict` and check the implementation against all acceptance scenarios; verify no scenario is counted as currently passing solely because its task is checked or its ID matches.

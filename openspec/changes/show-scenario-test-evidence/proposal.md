# Proposal

## Why

OpenSpec Desk shows proposed behaviour and review discussions, but its task progress cannot tell a product owner, developer, or tester which acceptance scenarios have been exercised. Showing actual test results beside those scenarios would help the team find failures and gaps before accepting a change.

## What Changes

- **Evidence per scenario.** Show linked tests and their outcomes beside the scenarios of an active change, a change in review, and a published specification. Include passing, failing, flaky, skipped, missing, and outdated evidence. Summaries count these states without declaring a change accepted or a requirement proven correct.
- **Small, explicit links.** An optional stable ID in a scenario heading connects it to a test annotation. Scenarios without an ID remain visible as having no linked evidence. Changes to scenario text, its parent requirement, or the tested code revision invalidate earlier evidence.
- **Playwright first.** Ship an optional reporter in the existing npm package. It captures results from the team's existing tests in a versioned JSON file. Other runners can produce the same documented format; additional adapters are outside this change.
- **The same files locally and in CI.** Add `--results <file>` to the local command and static export. Node.js remains the only required runtime for reading and publishing. The core feature requires no account, service, database, API key, or network access. Revision checks use Git when available and explicitly show when a code revision cannot be verified.
- **Clear scope and provenance.** Show the run time, tested revision, and reported test scope. Evidence read for one revision cannot become a current result for another PR or the published branch. Failed or partial runs remain useful reports.
- **Separate task progress from evidence.** Label the existing completion badge as task status, and show test evidence independently. Completing every task cannot turn missing or failing evidence green.
- **A short adoption path.** Document one reporter configuration, one annotated test, and the local and CI commands. Extend the bundled demo and exercise the feature against this repository's own Playwright tests.

Out of scope: generating or running tests, inferring coverage from code or test names, AI review, manual sign-off, acceptance gates that fail CI, result history, merging shards or multiple result files, fetching CI artifacts from GitHub, and packaging a GitHub Action. A PR's CI job can export its own report; a branch-wide site does not automatically collect evidence from other jobs.

## Capabilities

### New Capabilities

- `scenario-test-evidence`: Associate acceptance scenarios with recorded test executions, check the evidence against the displayed specification and code revision, and present the results locally and in static exports.

### Modified Capabilities

None. The existing behaviour comparison and PR reader are implemented under `show-in-flight-changes`; this change adds evidence alongside them. No specifications have been published under `openspec/specs/` yet.

## Impact

- CLI: scenario parsing, evidence validation and matching, optional revision discovery, local refresh, and export.
- Package: a Playwright reporter entry point; Playwright remains optional for consumers of the dashboard.
- Dashboard: scenario evidence, run details, summaries, and explicit task-status labels.
- Documentation and verification: README setup examples, demo results, unit and browser tests, and a packaged-consumer smoke check.

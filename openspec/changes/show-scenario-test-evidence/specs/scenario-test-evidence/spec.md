# Spec Delta

## Purpose

Connect acceptance scenarios to recorded test executions so readers can inspect failures, missing checks, and evidence that no longer matches the displayed change.

## ADDED Requirements

### Requirement: Scenarios have optional explicit test identifiers

The system SHALL recognise an ID at the start of a scenario title, written `#### Scenario: [INV-001] Invitation expires`. IDs SHALL be case-sensitive, start with an ASCII letter, and contain at most 64 ASCII letters, digits, periods, underscores, or hyphens. Scenarios without a valid ID SHALL remain readable and be identified as having no linked evidence. Fenced examples SHALL NOT create scenarios.

#### Scenario: [EVID-001] An annotated scenario is read

- **WHEN** a specification contains `#### Scenario: [INV-001] Invitation expires` under a requirement
- **THEN** the scenario has ID `INV-001` and retains its title, requirement, capability, and source location

#### Scenario: [EVID-002] A scenario has no identifier

- **WHEN** a scenario has no valid ID
- **THEN** the evidence view includes it with a missing-link explanation
- **AND** it contributes to the count of scenarios without evidence

### Requirement: Test links resolve to an unambiguous specification

The reporter SHALL resolve a test's scenario IDs against the checked-out specifications. A unique definition in an active change SHALL take precedence over its published definition in the same capability. Archived change documents SHALL be excluded. An unknown ID, duplicate within a version, occurrence in different capabilities, or occurrence in multiple active changes SHALL produce an explicit diagnostic and no verified link for that ID.

#### Scenario: [EVID-003] A change updates a published scenario

- **WHEN** an active change and its published capability both contain `INV-001` with different text
- **THEN** the reporter records the active change's scenario and requirement text as the test link's specification version
- **AND** a result for that version cannot appear current beside the older published text

#### Scenario: [EVID-004] Two active changes reuse an identifier

- **WHEN** two active changes contain `INV-001`
- **THEN** the report identifies both locations as ambiguous
- **AND** tests annotated with that ID do not supply verified evidence for either definition

#### Scenario: [EVID-005] A test references an unknown identifier

- **WHEN** a reported test references an ID absent from the eligible specifications
- **THEN** the report retains the test outcome and identifies the unresolved ID
- **AND** it does not infer a link from the test's name

### Requirement: Test executions produce a portable evidence file

The package SHALL provide an optional Playwright reporter that writes versioned JSON containing specification fingerprints, test identities and attempts, run times, source provenance, run outcome, diagnostics, and test scope. Tests SHALL link through declaration-time annotations of type `openspec`, whose description is one scenario ID. The reporter SHALL coexist with other reporters and SHALL NOT run tests or alter their pass/fail policy.

#### Scenario: [EVID-006] An existing test is linked

- **WHEN** a test has `annotation: { type: 'openspec', description: 'INV-001' }` and the reporter is enabled
- **THEN** the team's normal test command records its result against that scenario
- **AND** tests without an OpenSpec annotation continue to run normally

#### Scenario: [EVID-007] A test fails

- **WHEN** a test run finishes with failures
- **THEN** the reporter still writes the available evidence, including failure details and the failed run outcome
- **AND** the test runner retains its failing exit status

#### Scenario: [EVID-008] A run is interrupted

- **WHEN** the reporter has initialised a new run's output and that run is interrupted before finalising its report
- **THEN** a previous successful report at the same destination cannot be mistaken for that run's results
- **AND** an unfinished report identifies the evidence as incomplete

#### Scenario: [EVID-030] The reporter cannot initialize its output

- **WHEN** the reporter cannot replace a previous report at its output destination
- **THEN** it emits an error identifying the destination and whether the previous file remains
- **AND** the previous report retains its original run time and is never described as the new run's result

### Requirement: Recorded outcomes preserve failures and uncertainty

The system SHALL retain outcomes per test, project, repetition, and attempt. A failure that passes on retry SHALL be flaky. Expected failures SHALL NOT become passing evidence. Skipped, interrupted, and unexecuted tests SHALL remain distinguishable from passes. Scenario summaries SHALL describe the reported linked tests and SHALL NOT imply that unreported tests or environments passed.

#### Scenario: [EVID-009] A test passes after a failed attempt

- **WHEN** a linked test fails and then passes on retry
- **THEN** its scenario shows flaky evidence with both attempts available

#### Scenario: [EVID-010] A scenario has mixed outcomes

- **WHEN** one linked test passes and another fails
- **THEN** the scenario's summary is failing and both results are inspectable

#### Scenario: [EVID-011] A skipped test accompanies a pass

- **WHEN** one linked test passes and another is skipped
- **THEN** the scenario's summary identifies incomplete evidence
- **AND** it does not count as a scenario whose reported linked tests all passed

#### Scenario: [EVID-012] An expected failure occurs

- **WHEN** a linked test is marked as expected to fail and actually fails
- **THEN** its evidence shows the failure and its expected-failure annotation
- **AND** it is not counted as a pass

### Requirement: Evidence identifies the specification it exercised

The system SHALL compare recorded fingerprints with the scenario and its parent requirement statement. A changed title, statement, or scenario body SHALL make prior evidence outdated. Moving an otherwise identical scenario from a change into its published capability SHALL preserve its specification identity. Changes limited to line endings or an unrelated scenario SHALL NOT invalidate the fingerprint.

#### Scenario: [EVID-013] The requirement changes after a passing run

- **WHEN** a requirement's invitation lifetime changes after the linked tests passed
- **THEN** the evidence for its scenarios is outdated even if their IDs are unchanged

#### Scenario: [EVID-014] A different scenario changes

- **WHEN** another scenario changes while this scenario and the parent requirement statement remain identical
- **THEN** this scenario's specification fingerprint remains the same
- **AND** code-revision checks still apply independently

#### Scenario: [EVID-015] A change is archived

- **WHEN** a scenario moves into the published specification with the same ID, capability, statement, and text
- **THEN** moving the file does not change its specification fingerprint
- **AND** evidence still has to match the displayed code revision

### Requirement: Evidence identifies the code revision it exercised

Evidence SHALL identify the tested commit and whether its working copy was clean when known. It SHALL count as current only when the run completed against a stable specification and clean, unchanged source revision matching the displayed revision. A known mismatch SHALL be outdated; missing provenance or uncommitted source SHALL be unverified. Revision discovery SHALL be optional and work without a hosting-provider API.

#### Scenario: [EVID-016] A different commit is displayed

- **WHEN** the evidence records commit A and the dashboard displays commit B
- **THEN** the dashboard marks the evidence outdated and shows the tested revision

#### Scenario: [EVID-017] Source provenance cannot be verified

- **WHEN** Git is unavailable or the tested or displayed working copy contains uncommitted files
- **THEN** the dashboard still shows recorded test outcomes and identifies code provenance as unverified
- **AND** those results do not count as current passing evidence

#### Scenario: [EVID-018] The source changes during a run

- **WHEN** the reporter observes different source revisions or specification fingerprints at the start and end of a run
- **THEN** the report records the change
- **AND** the run cannot supply current passing evidence

### Requirement: Local and CI commands consume the same evidence

The local command and `export` SHALL accept one optional `--results <file>`, resolved from the invocation directory. Both SHALL consume the same JSON without a network request or additional service. Refresh SHALL reread the file. Export SHALL embed the evidence in the static workspace. The dashboard SHALL run without the reporter or Playwright installed, and commands without `--results` SHALL continue to work.

#### Scenario: [EVID-019] Results are refreshed locally

- **WHEN** a user replaces the result file and chooses Refresh workspace
- **THEN** the dashboard rereads the evidence while retaining the selected document or change

#### Scenario: [EVID-020] CI publishes a report

- **WHEN** CI exports the checked-out workspace with `--results results.json --out site`
- **THEN** the output is readable on a plain static host, including under a URL subpath
- **AND** reading the exported report requires no result file, test runner, Git executable, or network API at runtime

#### Scenario: [EVID-021] No evidence file is supplied

- **WHEN** a user runs an existing command without `--results`
- **THEN** the dashboard loads normally and identifies test evidence as not loaded
- **AND** it does not imply that tests have never run

### Requirement: Invalid evidence cannot masquerade as a successful import

A requested result file that is missing, malformed, unsupported, larger than 20 MB, or contains more than 10,000 test records SHALL fail loading with a specific error. Export SHALL validate it before writing output. Valid files containing failed tests, unresolved links, or outdated evidence SHALL remain exportable. Embedded paths SHALL NOT cause the system to read or copy other files.

#### Scenario: [EVID-022] An import is invalid

- **WHEN** export receives a result file with an unsupported format version
- **THEN** it exits nonzero with a message identifying the version
- **AND** it leaves the existing export untouched

#### Scenario: [EVID-023] A report contains failing evidence

- **WHEN** export receives a valid report with failed and missing scenario results
- **THEN** it writes the report successfully
- **AND** it does not introduce an acceptance gate that changes the earlier test job's result

### Requirement: Readers can inspect evidence where they review behaviour

The change page SHALL group evidence by requirement for added and modified bodies, including unchanged scenarios. The published-spec reader SHALL link evidence to scenario headings. Summaries SHALL count missing IDs/results, separate freshness from outcomes, show run time and scope, and exclude removed scenarios and rename-only requirements. Details SHALL use accessible text without executing embedded HTML or fetching attachments.

#### Scenario: [EVID-024] A reader checks an invitation change

- **WHEN** a change has one current passing scenario, one failing scenario, and one without a linked result
- **THEN** the page shows all three states and lets the reader inspect the reported tests and failure details
- **AND** the summary states one passing, one failing, and one missing scenario

#### Scenario: [EVID-025] A published spec is read

- **WHEN** a reader opens a published specification with imported evidence
- **THEN** its evidence view identifies the corresponding requirement and scenario for each result
- **AND** each scenario entry links to its heading in the specification

#### Scenario: [EVID-026] A report describes a selected test scope

- **WHEN** the run includes selected projects, filters, or a shard
- **THEN** the report makes that scope visible
- **AND** its passing summary describes only the linked tests reported in that run

#### Scenario: [EVID-027] A scenario was removed

- **WHEN** the behaviour comparison shows a removed scenario
- **THEN** it remains visible in the comparison without contributing to the new behaviour's evidence summary

### Requirement: Evidence remains separate from tasks and PR identity

Task badges SHALL explicitly describe tasks and SHALL NOT imply test success or acceptance. Evidence for a change in review SHALL be checked against that PR's head commit and displayed scenario text. Importing a result file SHALL NOT fetch other CI artifacts or apply a matching ID's result across revisions as current evidence.

#### Scenario: [EVID-028] Every task is checked but a scenario failed

- **WHEN** all tasks are checked and a linked scenario has failing evidence
- **THEN** the dashboard can show tasks complete and failing evidence simultaneously
- **AND** it does not label the change accepted or verified

#### Scenario: [EVID-029] Two PRs contain the same scenario

- **WHEN** the supplied report matches PR A's head and scenario text, while PR B has another head commit
- **THEN** only PR A can receive current evidence from that report
- **AND** PR B cannot count the same test result as a current pass

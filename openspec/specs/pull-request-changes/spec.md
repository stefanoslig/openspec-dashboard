# pull-request-changes Specification

## Purpose

Makes OpenSpec changes that still live in open pull requests visible on the published site, so they can be reviewed before they merge.

## Requirements

### Requirement: Export reads open pull requests on request

`openspec-desk export --pull-requests` SHALL read the open pull requests of the repository whose base branch is the exported branch, using the repository, branch and token that the GitHub Actions environment provides. Without the option the export SHALL make no request to GitHub. The option SHALL be rejected as a usage error on the local server command and together with `--demo`.

#### Scenario: Export with the option in GitHub Actions

- **WHEN** the export runs with `--pull-requests` in a workflow on branch `main` with a token that can read pull requests
- **THEN** the open pull requests that target `main` are read

#### Scenario: A pull request targets another branch

- **WHEN** an open pull request targets a branch other than the exported one
- **THEN** nothing from it is included

#### Scenario: Export without the option

- **WHEN** the export runs without `--pull-requests`
- **THEN** no request is made to GitHub and the site has no "In review" section

#### Scenario: The option on the local server

- **WHEN** `openspec-desk --pull-requests` is run without `export`
- **THEN** the command exits with a non-zero status and a usage message

### Requirement: A pull request contributes the changes it creates or modifies

A change SHALL be included for a pull request when the pull request adds, modifies or renames at least one file inside the change's folder, `changes/<name>/` or `changes/archive/<name>/` under the openspec folder. The included documents SHALL be those of that folder at the pull request's head commit. A change read from a pull request SHALL be presented as in review, never as archived.

#### Scenario: A pull request adds a change

- **WHEN** a pull request adds `changes/add-invitations/` with a proposal, tasks and a delta spec
- **THEN** the change is included with those three documents

#### Scenario: A pull request has already archived its change

- **WHEN** at the head of a pull request the change lies under `changes/archive/2026-10-03-add-invitations/`
- **THEN** the change is included as in review, titled "Add invitations", and is not listed in the archive

#### Scenario: A pull request changes code only

- **WHEN** a pull request changes no file under the openspec folder's `changes/`
- **THEN** it contributes no change and is not listed

#### Scenario: A pull request deletes a change

- **WHEN** a pull request only deletes the files of a change folder
- **THEN** no change is included for that folder

#### Scenario: An untouched change differs on an old branch

- **WHEN** a pull request's branch holds an older version of a change that the pull request itself did not touch
- **THEN** that change is not included for the pull request

#### Scenario: Two pull requests touch the same change

- **WHEN** two open pull requests each modify `changes/add-invitations/`
- **THEN** the change is listed twice, once per pull request

### Requirement: In-review changes are compared with the exported branch

Requirement changes of a change read from a pull request SHALL be computed against the published specs of the exported branch, also when the pull request itself updates those specs.

#### Scenario: A pull request archives a change and updates the spec

- **WHEN** a pull request modifies a requirement through a delta spec and also applies it to `specs/<capability>/spec.md`
- **THEN** the requirement is shown as modified, with the exported branch's text as previous text

### Requirement: In-review changes are listed apart

When pull requests were read, the dashboard SHALL list their changes in an "In review" section on the overview and the changes view, apart from the changes of the exported branch. Each SHALL show the pull request's number, title, author and draft state and link to the pull request on GitHub. The section SHALL state when the pull requests were read.

#### Scenario: A change in review

- **WHEN** pull request 42 "Let editors invite viewers" by `mara` contributes a change
- **THEN** the "In review" section lists the change with "PR #42", the author, and a link to the pull request

#### Scenario: A draft pull request

- **WHEN** the pull request is a draft
- **THEN** its change is labelled as draft

#### Scenario: No pull request changes the specs

- **WHEN** pull requests were read and none contributes a change
- **THEN** the "In review" section says that no open pull request changes the specs

#### Scenario: Pull requests were not read

- **WHEN** the workspace was served locally or exported without `--pull-requests`
- **THEN** there is no "In review" section

#### Scenario: Freshness

- **WHEN** the "In review" section is shown
- **THEN** it states the date and time the pull requests were read

### Requirement: Pull request documents are readable and searchable

The documents of an in-review change SHALL open in the reader labelled with their pull request, with a source link to the file at the pull request's head commit. Search SHALL include them and label each result with its pull request.

#### Scenario: Opening a pull request document

- **WHEN** a reader opens the proposal of a change from pull request 42
- **THEN** the reader shows the proposal labelled "PR #42" and "View on GitHub" opens the file at the pull request's head commit

#### Scenario: Searching pull request documents

- **WHEN** a reader searches for a phrase that occurs only in a document of pull request 42
- **THEN** the result is listed and labelled "PR #42"

### Requirement: Pull requests from forks are skipped

The export SHALL NOT read pull requests whose head branch is in another repository, and SHALL report how many were skipped as a workspace warning.

#### Scenario: A fork opens a pull request

- **WHEN** one open pull request comes from a fork
- **THEN** nothing from it is included and the dashboard warns that 1 pull request from a fork was skipped

### Requirement: A failed read fails the export

When `--pull-requests` is given and the repository, the branch or the token is unknown, or a request to GitHub fails, the export SHALL exit with a non-zero status and a message that names the missing setting or GitHub's answer, and SHALL NOT write a site.

#### Scenario: The token is missing

- **WHEN** the export runs with `--pull-requests` and no token is set
- **THEN** it exits with a non-zero status, the message names `GITHUB_TOKEN`, and the output folder is not written

#### Scenario: The token lacks permission

- **WHEN** GitHub refuses the request because the token cannot read pull requests
- **THEN** the export exits with a non-zero status and the message names the `pull-requests: read` permission

#### Scenario: Outside GitHub Actions

- **WHEN** the export runs with `--pull-requests` where the GitHub Actions variables for repository and branch are absent
- **THEN** it exits with a non-zero status and the message names the missing variables

### Requirement: Limits apply and skipped items are reported

Documents read from pull requests SHALL follow the rules of documents read from disk: only Markdown and YAML files, symbolic links skipped, at most 2 MB per document, and the workspace totals of 2,000 documents and 20 MB. At most the 200 most recently updated open pull requests SHALL be read. Anything left out for these reasons SHALL be reported as a workspace warning while the rest is still published.

#### Scenario: An oversized document

- **WHEN** a change in a pull request contains a 3 MB Markdown file
- **THEN** the file is left out, a warning names it, and the other documents of the change are published

#### Scenario: The workspace totals are reached

- **WHEN** adding a pull request's documents would exceed 2,000 documents or 20 MB in total
- **THEN** that pull request and the ones after it are left out and a warning says how many

#### Scenario: More than 200 open pull requests

- **WHEN** the repository has 230 open pull requests that target the exported branch
- **THEN** the 200 most recently updated are read and a warning says that 30 were not

### Requirement: Pull request content is treated as untrusted

The export SHALL read pull request content as data only: it SHALL NOT check out or execute anything from a pull request. The dashboard SHALL display that content under the same rules as other documents: raw HTML is shown as text and external images are not fetched.

#### Scenario: A pull request document contains a script element

- **WHEN** a proposal in a pull request contains `<script>` markup
- **THEN** the markup is displayed as text and nothing is executed

#### Scenario: Exporting on a pull request event

- **WHEN** the export runs in a workflow triggered for a pull request, with the base branch checked out
- **THEN** the working tree is not changed and no file from the pull request is executed

### Requirement: The sample workspace includes a pull request

The sample workspace (`--demo`) SHALL include one fictional pull request with a change in review, on the local server and in the export, without network access.

#### Scenario: Opening the sample

- **WHEN** a reader opens the sample workspace
- **THEN** the "In review" section lists a change from a fictional pull request, and no request is made to GitHub

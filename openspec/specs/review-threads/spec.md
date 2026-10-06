# review-threads Specification

## Purpose

Lets readers follow the review discussion of a change in review next to the requirements it concerns and see whether it is settled. Replies happen on GitHub.

## Requirements

### Requirement: Review threads on change documents are included

When pull requests are read, the export SHALL include every review thread of a pull request whose file is a document of one of that pull request's in-review changes, with its comments (author login, text, time), whether it is resolved and whether it is outdated. Threads on other files and comments outside review threads SHALL NOT be included.

#### Scenario: A thread on a delta spec

- **WHEN** a pull request has a review thread on the delta spec of its change
- **THEN** the thread and its comments are included

#### Scenario: A thread on source code

- **WHEN** a pull request has a review thread on a file outside its changes' folders
- **THEN** the thread is not included and is not counted

#### Scenario: A comment in the pull request conversation

- **WHEN** someone comments on the pull request without attaching the comment to a file
- **THEN** the comment is not included

### Requirement: Threads are pinned to requirements

A thread on a delta spec whose line lies within the block of a requirement change SHALL be shown with that requirement on the behaviour changes page. Every other included thread SHALL be shown in a general discussion section of that page, labelled with its document. An outdated thread without a current line SHALL be shown there too, marked as outdated.

#### Scenario: A thread on a scenario of a modified requirement

- **WHEN** a thread is on a line of a scenario that belongs to the modified requirement "Owners manage membership"
- **THEN** the thread is shown under that requirement

#### Scenario: A thread on the proposal

- **WHEN** a thread is on `proposal.md` of the change
- **THEN** the thread is shown in the general discussion section, labelled "Proposal"

#### Scenario: An outdated thread

- **WHEN** a thread's line no longer exists at the head of the pull request
- **THEN** the thread is shown in the general discussion section, labelled with its document and marked as outdated

#### Scenario: A thread between requirements

- **WHEN** a thread is on a line of a delta spec that belongs to no requirement change
- **THEN** the thread is shown in the general discussion section

### Requirement: Review status counts unresolved threads

For each in-review change the dashboard SHALL state the number of unresolved threads on its card and on its behaviour changes page. When the change has threads and all are resolved it SHALL say so. When it has no threads it SHALL show no review status.

#### Scenario: Unresolved threads

- **WHEN** a change has three unresolved threads and two resolved ones
- **THEN** its card and its page state "3 open threads"

#### Scenario: Everything is resolved

- **WHEN** all threads of a change are resolved
- **THEN** its card and its page state "All threads resolved"

#### Scenario: No threads

- **WHEN** a change has no threads
- **THEN** no review status is shown

### Requirement: An in-review change always has a page

An in-review change SHALL have a behaviour changes page even when it has no requirement changes, so that its pull request and its threads have a place.

#### Scenario: A proposal-only change with a thread

- **WHEN** a pull request adds a change with only a proposal, and the proposal has a thread
- **THEN** opening the change shows its page with the pull request, the thread in the general discussion section, and a note that the change has no spec changes yet

### Requirement: Resolved threads stay out of the way

Unresolved threads SHALL be shown expanded. Resolved threads SHALL be shown collapsed and SHALL be expandable.

#### Scenario: A resolved thread

- **WHEN** a requirement has one resolved thread
- **THEN** the thread appears as a collapsed line that states it is resolved, and expanding it shows its comments

### Requirement: Replies happen on GitHub

Every thread SHALL link to itself on GitHub, opening in a new tab. The dashboard SHALL offer no control to write, edit or resolve a comment.

#### Scenario: Replying

- **WHEN** a reader chooses "Reply on GitHub" on a thread
- **THEN** the thread opens on GitHub in a new tab

#### Scenario: No writing controls

- **WHEN** a thread is shown
- **THEN** the page has no text field or button that changes the thread

### Requirement: Comments are displayed safely and within limits

Comment text SHALL be displayed as Markdown with raw HTML shown as text and images not fetched. Author avatars SHALL NOT be fetched. At most 30 comments per thread SHALL be included; when a thread has more, the dashboard SHALL state how many are not shown and link to the thread on GitHub.

#### Scenario: A comment contains a script element

- **WHEN** a comment contains `<script>` markup
- **THEN** the markup is displayed as text and nothing is executed

#### Scenario: A long thread

- **WHEN** a thread has 34 comments
- **THEN** the first 30 are shown, followed by "4 more comments on GitHub" linking to the thread

### Requirement: The sample workspace includes threads

The fictional pull request of the sample workspace SHALL carry at least one unresolved thread pinned to a requirement, one resolved thread, and one thread on a document other than a delta spec.

#### Scenario: Opening the sample change in review

- **WHEN** a reader opens the in-review change of the sample workspace
- **THEN** a thread is shown under a requirement, a resolved thread is shown collapsed, and the general discussion section holds a thread on the proposal

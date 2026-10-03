# Spec Delta

## Purpose

Let product owners and testers start GitHub review discussions from the requirements they are reading, with enough context to find the relevant specification.

## ADDED Requirements

### Requirement: Readers can start a discussion beside a requirement

For a real GitHub pull request, every requirement on its change's behaviour changes page SHALL offer “Comment on GitHub”, whether or not it has threads. The action SHALL open the associated pull request's review view in a new tab. Changes without pull request data and published specifications SHALL NOT offer this action.

#### Scenario: A requirement has no comments

- **WHEN** a reader opens a requirement of a real in-review change with no threads
- **THEN** “Comment on GitHub” is available beside that requirement
- **AND** selecting it opens its pull request's review view in a new tab

#### Scenario: An existing discussion has a reply link

- **WHEN** a requirement already has a thread
- **THEN** the requirement offers “Comment on GitHub” to start another discussion
- **AND** the existing thread retains its “Reply on GitHub” link

#### Scenario: A local change has no pull request data

- **WHEN** a reader opens a local change without pull request data
- **THEN** it has no “Comment on GitHub” action

### Requirement: Destinations preserve the displayed requirement's context

A comment link SHALL use the repository, pull request, and delta document associated with the displayed requirement. It SHALL target a commentable line within that requirement when a valid diff location can be established from the exported data. Otherwise it SHALL open the document's diff when available. Comparison text from the published spec SHALL NOT determine the destination.

#### Scenario: The requirement has a valid line destination

- **WHEN** the exported data identifies a commentable diff line within a requirement
- **THEN** its link targets that line in its delta document's PR diff

#### Scenario: Only a file destination is available

- **WHEN** the spec appears in the PR diff but a commentable line within the requirement cannot be established
- **THEN** its link opens that spec's diff
- **AND** the dashboard identifies the requirement to find in the file

#### Scenario: A requirement is removed or renamed

- **WHEN** a reader chooses the action on a removed or renamed requirement
- **THEN** the destination uses the delta document containing the removal or rename
- **AND** it does not target the published specification shown for comparison

#### Scenario: Two pull requests contain the same change

- **WHEN** the same change name appears in two pull requests
- **THEN** each requirement's link targets the pull request associated with the displayed change

### Requirement: Missing diff locations have an explicit fallback

When the exported data cannot establish a document's diff destination, the action SHALL open the associated PR's Files changed view. The dashboard SHALL show the document path and requirement name and explain that a direct location is unavailable. It SHALL NOT label this fallback as a direct link to a commentable line.

#### Scenario: A change includes an unchanged spec file

- **WHEN** an exported change contains a spec that is absent from its PR's changed files
- **THEN** the action opens that PR's Files changed view
- **AND** the dashboard shows the spec path, requirement name, and fallback explanation

### Requirement: Review guidance explains posting and publication

The change page SHALL explain that commenting requires a GitHub account with repository read access, describe how to post a single line comment, and state that only review threads on change documents appear here after the next CI publication. It SHALL also explain that GitHub may show newer changes than the dashboard snapshot.

#### Scenario: A reviewer starts their first discussion

- **WHEN** a reader uses the comment guidance
- **THEN** it directs them to select a spec line in Files changed, enter feedback, and post a single comment
- **AND** it explains the account requirement, which comments return to the dashboard, and the publication delay

#### Scenario: The pull request has advanced since export

- **WHEN** GitHub contains commits newer than the dashboard's snapshot
- **THEN** the guidance makes clear that a linked location may have moved
- **AND** the dashboard does not claim to have checked the live destination

### Requirement: Comment actions work on a static site

The action SHALL navigate to GitHub without posting data or making GitHub API requests from the dashboard. Authentication and submission SHALL occur on GitHub. The exported dashboard SHALL require no comment service, write credentials, or new hosting capability.

#### Scenario: A static export is hosted under a subpath

- **WHEN** a reader selects a comment action on a site served under a URL subpath
- **THEN** it opens the correct GitHub destination
- **AND** the dashboard sends no comment or authentication request

### Requirement: The demo identifies its fictional discussion

The bundled demo SHALL show the action's placement with a disabled example and a visible explanation that its pull request is fictional. The example SHALL NOT navigate to a real commenting destination.

#### Scenario: A reader tries the demo

- **WHEN** a reader views a requirement of the demo's fictional in-review change
- **THEN** a disabled “Comment on GitHub” example appears beside it
- **AND** the explanation identifies the fictional pull request

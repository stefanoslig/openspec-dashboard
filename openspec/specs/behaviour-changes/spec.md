# behaviour-changes Specification

## Purpose

Shows what a change does to the specified behaviour of a system, requirement by requirement, by reading the change's delta specs against the published specs.

## Requirements

### Requirement: Delta specs are read as requirement changes

The system SHALL read each delta spec of a change (`specs/<capability>/spec.md` inside the change folder) into requirement changes of kind added, modified, removed or renamed, following the OpenSpec delta format: `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` sections with titles matched case-insensitively, `### Requirement:` headers, and `FROM:`/`TO:` rename pairs. Content inside fenced code blocks SHALL be ignored.

#### Scenario: A delta with all four sections

- **WHEN** a delta spec has one requirement under each of ADDED, MODIFIED and REMOVED, and one FROM/TO pair under RENAMED
- **THEN** the change has four requirement changes for that capability, one of each kind

#### Scenario: A requirement inside a fenced example

- **WHEN** a `### Requirement:` header appears inside a fenced code block of a delta spec
- **THEN** it is not read as a requirement change

#### Scenario: A section header written twice

- **WHEN** a delta spec has two `## ADDED Requirements` sections
- **THEN** the requirements of both are read as added

#### Scenario: A requirement outside the delta sections

- **WHEN** a `### Requirement:` header sits under a section that is not one of the four delta sections
- **THEN** it is not read as a requirement change

### Requirement: Requirement changes are matched to the published spec

The system SHALL match each requirement change to the requirement of the same name in the published spec of the same capability (`specs/<capability>/spec.md`) and carry that requirement's published text as its previous text. Names SHALL be compared case-sensitively, ignoring surrounding whitespace. A modified requirement that the same delta also renames SHALL be matched by its old name.

#### Scenario: A modified requirement exists in the published spec

- **WHEN** a delta modifies "Owners manage membership" and the published spec of that capability has a requirement with that name
- **THEN** the requirement change carries the published requirement, including its scenarios, as previous text

#### Scenario: A requirement is renamed and modified

- **WHEN** a delta renames "Old name" to "New name" and modifies "New name"
- **THEN** there is one modified requirement change named "New name" whose previous name is "Old name" and whose previous text is the published "Old name" requirement

#### Scenario: The published requirement is missing

- **WHEN** a delta modifies, removes or renames a requirement whose name is not in the published spec
- **THEN** the requirement change is marked as not found in the published spec

#### Scenario: The capability is new

- **WHEN** a delta spec belongs to a capability with no published spec
- **THEN** the capability is marked as new and its added requirements have no previous text

#### Scenario: An added requirement already exists

- **WHEN** a delta adds a requirement whose name is already in the published spec
- **THEN** the requirement change is marked as already existing and carries the published text as previous text

### Requirement: Behaviour changes exist for changes that are not yet history

The system SHALL compute requirement changes for every non-archived change of the workspace and for every change read from a pull request, against the published specs of the workspace. Archived changes of the workspace SHALL have none, because the text they replaced is no longer available. Computing them SHALL NOT require network access.

#### Scenario: An active change on the local server

- **WHEN** the local server reads a working copy whose active change has a delta spec
- **THEN** the change has requirement changes, and no request leaves the machine

#### Scenario: An archived change

- **WHEN** a change lies under `changes/archive/` in the workspace
- **THEN** it has no requirement changes and its documents open as before

### Requirement: A change has a behaviour changes page

The dashboard SHALL offer a page for each change that has at least one requirement change. The page SHALL list the requirement changes grouped by capability, state the kind of each and the number per kind, link to each capability's published spec when one exists, and link to the documents of the change. The page SHALL have its own address that survives a reload, including in an exported site served under a subpath.

#### Scenario: Opening a change with requirement changes

- **WHEN** a reader opens a change that has requirement changes from its card
- **THEN** the behaviour changes page of that change is shown

#### Scenario: Opening a change without requirement changes

- **WHEN** a reader opens, from its card, a change of the workspace that has no requirement changes
- **THEN** the first document of the change is shown, as before

#### Scenario: Counts per kind

- **WHEN** a change adds two requirements and modifies one
- **THEN** the page states "2 added" and "1 modified"

#### Scenario: A new capability

- **WHEN** a capability of the change has no published spec
- **THEN** the page labels the capability as new and offers no link to a published spec

#### Scenario: Reloading the page

- **WHEN** a reader reloads the behaviour changes page or opens its address in a new tab
- **THEN** the same page of the same change is shown

#### Scenario: Reaching the page from a document

- **WHEN** a reader has a document of a change with requirement changes open
- **THEN** the list of the change's documents offers a link to the behaviour changes page

### Requirement: Modified requirements show what changed

For a modified requirement the page SHALL present the previous and the new text as one reading in which removed words and added words are marked. The marking SHALL NOT rely on colour alone. Scenarios SHALL be matched by name between the two texts: a scenario only in the new text is marked as added, a scenario only in the previous text as removed, and a scenario with identical text is left unmarked.

#### Scenario: One phrase changes

- **WHEN** the published text says "expires after seven days" and the new text says "expires after fourteen days"
- **THEN** "seven" is marked as removed, "fourteen" is marked as added, and the other words are unmarked

#### Scenario: A scenario is added

- **WHEN** the new text has a scenario whose name is not in the previous text
- **THEN** that scenario is marked as added as a whole

#### Scenario: A scenario is dropped

- **WHEN** the previous text has a scenario whose name is not in the new text
- **THEN** that scenario is shown marked as removed

#### Scenario: Nothing differs

- **WHEN** the new text of a modified requirement equals its previous text
- **THEN** the page states that there is no difference from the published spec

#### Scenario: The previous text is missing

- **WHEN** a modified requirement is marked as not found in the published spec
- **THEN** the page shows the new text and states that the requirement was not found in the published spec

### Requirement: Added, removed and renamed requirements are shown in full

The page SHALL show an added requirement with its full new text, a removed requirement with its published text marked as removed together with the reason written in the delta, and a renamed requirement with its old and its new name.

#### Scenario: An added requirement

- **WHEN** a change adds a requirement with two scenarios
- **THEN** the page shows the requirement and both scenarios, labelled as added

#### Scenario: A removed requirement

- **WHEN** a change removes a requirement and gives a reason and a migration note
- **THEN** the page shows the published text of the requirement marked as removed, followed by the reason and the migration note

#### Scenario: A renamed requirement

- **WHEN** a change renames a requirement without modifying it
- **THEN** the page shows the old name and the new name

### Requirement: Change cards summarize behaviour changes

A change card SHALL state the number of requirement changes per kind when the change has any.

#### Scenario: A card for a change with requirement changes

- **WHEN** the overview lists a change that adds two requirements and removes one
- **THEN** its card states "2 added" and "1 removed"

### Requirement: Requirement text is displayed safely

Requirement text on the behaviour changes page SHALL be displayed under the same rules as documents in the reader: raw HTML is shown as text and external images are not fetched.

#### Scenario: A delta contains a script element

- **WHEN** a requirement's text contains `<script>` markup
- **THEN** the markup is displayed as text and nothing is executed

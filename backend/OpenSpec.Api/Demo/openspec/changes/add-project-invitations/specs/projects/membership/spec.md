# Membership changes

## ADDED Requirements

### Requirement: Owners can invite teammates

The system SHALL allow a project owner to invite a person by email with an editor or viewer role.

#### Scenario: A new teammate is invited

- **WHEN** an owner sends an invitation to a valid email address
- **THEN** the person receives a link that expires after seven days

### Requirement: Revoked invitations cannot be accepted

The system SHALL reject invitations that the owner has revoked.

#### Scenario: An old link is opened

- **WHEN** a person opens a revoked invitation
- **THEN** the system explains that the invitation is no longer available

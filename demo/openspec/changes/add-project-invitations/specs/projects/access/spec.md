# Access changes

## MODIFIED Requirements

### Requirement: Owners manage membership

The system SHALL reserve membership management, including invitations, for project owners.

#### Scenario: An editor opens project settings

- **WHEN** an editor opens the people settings
- **THEN** membership and pending invitations are visible but cannot be changed

#### Scenario: An owner opens project settings

- **WHEN** an owner opens the people settings
- **THEN** the owner can invite teammates and revoke pending invitations

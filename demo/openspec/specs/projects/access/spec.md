# Project access

## Purpose

Give every teammate the right level of access, with clear boundaries between reading, editing, and managing a project.

## Requirements

### Requirement: Viewers have read access

The system SHALL allow viewers to read project documents without changing them.

#### Scenario: A viewer opens a document

- **WHEN** a viewer navigates to a project document
- **THEN** the full document is displayed and editing controls are unavailable

### Requirement: Owners manage membership

The system SHALL reserve membership management for project owners.

#### Scenario: An editor opens project settings

- **WHEN** an editor opens the people settings
- **THEN** membership is visible but cannot be changed

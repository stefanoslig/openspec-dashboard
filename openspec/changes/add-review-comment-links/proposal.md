# Proposal

## Why

Product owners and testers can read requirements and reply to existing review threads in OpenSpec Desk, but starting a discussion requires finding the right spec in GitHub. A link beside each requirement would make that first comment easier while keeping the dashboard statically hosted.

## What Changes

- **Start a discussion beside a requirement.** Add “Comment on GitHub” to each requirement on an in-review change's behaviour changes page, including requirements without threads. The link opens the relevant pull request in a new tab.
- **Keep the requirement in context.** Target its line in the PR diff when a valid destination is available; otherwise open the spec file's diff. If the file is absent from the diff, open the PR's Files changed view and show the document path and requirement name for reference. Removed and renamed requirements use their delta document.
- **Explain the short workflow.** Tell reviewers to select a line, type their feedback, and post a single comment. Explain that a GitHub account with repository read access is required, that only review threads on change documents return to the dashboard, and that updates appear after the next CI publication. GitHub can show newer changes than the exported snapshot.
- **Limit links to reviewable changes.** Offer the action for changes associated with a real GitHub pull request. The bundled demo shows a disabled example labelled as fictional.

Out of scope: commenting inside the dashboard, sign-in or comment storage, general PR conversation import, live refresh, comments on published specs or local changes without PR data, and other Git hosts.

## Capabilities

### New Capabilities

- `review-comment-links`: Help readers start a GitHub review discussion from a requirement, with contextual destinations and guidance.

### Modified Capabilities

None. This builds on the review threads implemented by `show-in-flight-changes`. No specs have been published under `openspec/specs/` yet.

## Impact

- Dashboard: requirement actions, link destinations, fallback context, and review guidance on the change page.
- Export: any additional diff-location metadata needed to choose reliable destinations; GitHub access remains read-only during export.
- Documentation and verification: README reviewer instructions, a demo example, and focused link and browser checks.

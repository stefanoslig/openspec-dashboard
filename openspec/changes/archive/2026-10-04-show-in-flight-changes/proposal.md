# Proposal

## Why

The CI export snapshots one branch. In the usual OpenSpec flow a change is proposed, implemented and archived inside a single pull request, so the published site rarely shows a change while it can still be influenced: product owners and testers have nowhere to review it. A delta spec also holds only the new text of a MODIFIED requirement, so neither the dashboard nor a GitHub file diff shows what behaviour actually changes.

## What Changes

- **Behaviour changes per change.** Delta specs are parsed into requirement-level changes (ADDED, MODIFIED, REMOVED, RENAMED) with OpenSpec's own delta rules, and each one is matched to the requirement it affects in the published spec. A new "Behaviour changes" page per change shows them grouped by capability; a MODIFIED requirement shows the previous and the new text with changed words marked. This works for every non-archived change, including on the local server with no GitHub access.
- **Changes from open pull requests.** `openspec-desk export --pull-requests` reads the open pull requests that target the exported branch through the GitHub API and adds the changes they create or modify as "In review", compared against the published specs of the exported branch. A change counts as in review even when the pull request has already archived it.
- **Review threads, read-only.** Review threads on the documents of an in-review change are shown on its page, pinned to the requirement their line falls under. Unresolved threads are counted as the change's review status ("3 open threads"), and each thread links to GitHub for replies. The site stores nothing and has no comment box.
- **CI instructions.** The README's copy-paste workflow gains `--pull-requests`, with the triggers and permissions it needs. No packaged GitHub Action is added.
- **Sample workspace.** The demo gains a MODIFIED delta and one fictional pull request with threads, so the live demo and the browser tests exercise the new views without network access.

Out of scope: test results per scenario (a later change), a packaged GitHub Action, commenting or editing from the site, pull requests from forks, pull request data on the local server, general pull request conversation outside review threads, and Git hosts other than GitHub.

## Capabilities

### New Capabilities

- `behaviour-changes`: requirement-level reading of a change's delta specs against the published specs, and the page that presents them.
- `pull-request-changes`: reading OpenSpec changes from open pull requests during export and presenting them as in review.
- `review-threads`: read-only display of pull request review threads on a change's documents, pinned to requirements, with review status.

### Modified Capabilities

None. `openspec/specs/` is empty; existing behaviour has no published specs yet.

## Impact

- **CLI** (`cli/`): new delta parser and GitHub reader modules; `parser.ts`, `export.ts`, `main.ts`, `reader.ts` and `workspace.model.ts` change. `workspace.json` gains fields (`changes[].deltas`, `changes[].pullRequest`, `documents[].pullRequest`, `pullRequests`); nothing existing is removed or renamed.
- **Dashboard** (`src/app/`): new change page, requirement diff, thread display; the overview, change card, reader and store change.
- **Dependencies**: `diff` (jsdiff) added as a dev dependency, bundled into the dashboard. No new runtime dependency for the CLI; GitHub is called with Node's built-in `fetch`.
- **External systems**: the GitHub GraphQL API, only when `--pull-requests` is passed. Workflows need `pull-requests: read` in addition to `contents: read`.
- **Packaging**: new `demo/pull-requests.json`; the README's "Publish from CI" section is rewritten for pull requests.
- **Privacy**: with `--pull-requests`, unmerged proposals, review comments and their authors' GitHub logins become visible to everyone who can reach the published site.

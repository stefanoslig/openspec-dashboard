# Design

## Context

See [proposal.md](proposal.md) for scope. The GitHub reader already paginates changed files and reads current right-side review-thread lines. The parser gives each PR's documents a `.pulls/<number>/` prefix. The browser reads an exported snapshot and has no GitHub credentials.

## Decisions

- **Reuse the existing read.** Add optional `PullRequest.reviewFiles`, with each imported changed document's path, file-diff URL, and `added` flag. Preserve this metadata through parsing, prefixing paths like threads and documents. Missing metadata in older snapshots falls back to Files changed. Fetching REST patches would add requests and another snapshot-consistency problem; it is unnecessary for the specified fallbacks.
- **Build file anchors during export.** Use `<PR URL>/files#diff-<SHA-256 of the repository-relative UTF-8 path>`. Hash the actual GitHub path before the workspace prefix is added. This matches GitHub's [file and line links](https://github.com/vllm-project/production-stack/pull/105/files#diff-7d931e53fe7db67b34609c58ca5e5e2788002e7f99657cc2879c7957112dd908R130). Keeping hashing in Node avoids adding browser crypto requirements or dependencies.
- **Use only known line locations.** A new file's requirement heading is on the right side of its diff. For existing files, use a current right-side thread line inside the requirement when available. Otherwise use the file anchor. An absent file destination falls back to `<PR URL>/files`. A pure browser helper selects these destinations using the displayed PR and delta path; published comparison text never participates.
- **Keep guidance close to the action.** Show a link below each requirement heading, with context for file and PR fallbacks. A collapsible “How to comment” section explains the account requirement, single-comment workflow, imported discussions, and publication delay. Demo actions are disabled with a visible fictional-PR explanation. Local and published documents have no action.

## Risks / Trade-offs

- GitHub can change its anchor format or the PR can advance after export → state that locations may move and keep the PR's Files changed page as the base destination.
- A modified file may have commentable lines that the exported data cannot establish → use the file diff without claiming an exact location.
- A large GitHub diff may require expanding a file before commenting → keep the file path and requirement available through the page and fallback context.

## Migration

The snapshot field is optional. Existing exports remain readable; republishing supplies file destinations. There are no new permissions, requests, dependencies, or hosting requirements.

# Tasks

## 1. Export review destinations

- [x] 1.1 Retain imported changed-file metadata and generate file-diff URLs; verify GitHub reader tests cover paginated paths, nested folders, renamed files, and skipped documents without extra requests.
- [x] 1.2 Prefix review-file paths during workspace parsing and preserve compatibility with older inputs; verify parser and export tests keep destinations with their PR and omit unowned files.

## 2. Offer comment actions

- [x] 2.1 Select known line, file, or PR destinations; verify focused unit tests cover new and modified files, current and outdated threads, missing metadata, and duplicate change names across PRs.
- [x] 2.2 Add requirement actions, fallback context, comment guidance, and disabled demo examples; verify browser tests cover real and fictional PRs, local and published views, a static subpath, new-tab navigation, and phone layout.
- [x] 2.3 Document the reviewer workflow and destination limits in README; verify it matches the implemented labels and publication behavior.

## 3. Integration checks

- [x] 3.1 Run `npm test`, `npm run build`, `npm run test:ui`, formatting checks on changed files, and strict OpenSpec validation; inspect the resulting diff and browser screenshots.

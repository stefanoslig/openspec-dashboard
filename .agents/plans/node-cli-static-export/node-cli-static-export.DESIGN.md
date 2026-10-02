# Node CLI and static export (replaces the .NET backend)

## Goal

Make OpenSpec Desk trivial to run locally and to publish from CI:

- **Local:** `npx openspec-desk [path]` serves the dashboard for one working copy. Only Node is required.
- **Static export:** `npx openspec-desk export [path] --out site` writes a plain folder that any static host can serve. A company puts it behind its own SSO, so readers need no GitHub account.

Parsing moves from request time (ASP.NET API) to a TypeScript parser that runs in Node. The hosted GitHub mode and all .NET code are removed. The Angular UI is kept.

## Current state (before this change)

- `backend/OpenSpec.Api`: ASP.NET Core API. `Workspaces/WorkspaceParser.cs`, `Workspaces/LocalWorkspaceReader.cs`, and `Workspaces/Models.cs` produce the workspace model; `Api/RequestBoundary.cs` holds the local-mode request checks. The rest is hosted mode (GitHub OAuth, PostgreSQL, sessions).
- `src/`: Angular 22 app. `core/workspace-store.ts` fetches `/api/session` and `/api/workspace`; `core/workspace.model.ts` is the response type; `core/render-markdown.ts` renders Markdown in the browser with `marked`.
- Sample workspace: `backend/OpenSpec.Api/Demo/openspec/`.
- Tests: xUnit (`backend/OpenSpec.Api.Tests/WorkspaceTests.cs`), Playwright (`tests/dashboard.spec.ts`, `tests/hosted.spec.ts`), both running the .NET API.

The C# files above are the reference for the port. They are deleted only as the last step.

## Decisions

| Topic | Decision |
|---|---|
| Hosted GitHub mode, .NET | Removed entirely (recoverable from git history) |
| Distribution | npm package `openspec-desk` (name is free; `openspec-dashboard` is taken) |
| Where parsing runs | Node only. The browser fetches one `workspace.json` in both modes |
| UI framework | Angular, unchanged |
| Routing | Hash routing and relative base, so the export works at any URL path |
| Local workspace selection | Command-line argument; one workspace per process; no in-browser folder picker |
| First documented CI target | GitHub Pages |
| npm release | Manual `npm publish`; `prepack` builds |

## Package layout

```
cli/                    Node-only TypeScript (ESM)
  main.ts               entry point, argument parsing (node:util parseArgs), shebang
  parser.ts             port of WorkspaceParser.cs
  reader.ts             port of LocalWorkspaceReader.cs
  server.ts             local HTTP server
  export.ts             static export
  workspace.model.ts    the Workspace type (moved from src/app/core/); Angular imports it type-only
  *.test.ts             node:test unit tests
src/                    Angular app
demo/openspec/          sample workspace (moved from backend/OpenSpec.Api/Demo/openspec)
dist/app/               ng build output (set outputPath so files land here directly, no browser/ subfolder)
dist/cli/               tsc output of cli/ (tests excluded)
```

`package.json`:

- `name: "openspec-desk"`, not private, `bin: { "openspec-desk": "dist/cli/main.js" }`, `files: ["dist", "demo"]`.
- `dependencies`: `marked`, `yaml` only. All `@angular/*`, `rxjs`, `tslib` move to `devDependencies` (the app ships prebuilt).
- `engines.node: ">=22"`. Contributors need the Node version Angular 22 requires.
- Scripts: `build` (ng build, then tsc for `cli/`), `start` (build, then run the CLI on the demo), `dev` (ng serve with `proxy.conf.json` proxying `/workspace.json` to the CLI on port 4310), `test` (unit), `test:ui` (Playwright), `prepack` (build).

The CLI locates `dist/app` and `demo/` relative to its own file (`import.meta.url`).

## CLI contract

```
openspec-desk [path] [--port <n>] [--demo]
openspec-desk export [path] [--out <dir>] [--demo]
```

- `path`: repository root or the `openspec/` folder itself. Default: current directory. Relative paths resolve against the current directory; `~` expands to the home directory.
- `--demo`: use the bundled `demo/` workspace; `path` is ignored. Workspace name is `Atlas`, `isDemo: true`.
- `--port`: default `PORT` env, then `4310`.
- `--out`: default `site`.
- Both commands read the workspace once at startup. On a reader error they print the message to stderr and exit with code 1. Unknown flags do the same.
- Serve prints the URL and the resolved `openspec` folder, then runs until interrupted.

## `workspace.json` contract

The existing `Workspace` type, unchanged in shape. Mode-specific values:

| Field | Serve | Export |
|---|---|---|
| `name` | Name of the directory containing `openspec/` (`Atlas` with `--demo`) | Same |
| `root` | Absolute path of the `openspec` folder | Path relative to the current directory, POSIX separators (never an absolute path) |
| `documents[].modified`, `changes[].modified` | File modification time, ISO 8601 | `null` (checkout timestamps are meaningless) |
| `source` | Absent | Set when `GITHUB_ACTIONS=true`, otherwise absent |
| `loadedAt` | Time of the read | Time of the export |

`source` in export: `provider: "github"`, `repository: GITHUB_REPOSITORY`, `ref: GITHUB_REF_NAME`, `commit: GITHUB_SHA`, `committedAt: null`, `url: GITHUB_SERVER_URL + "/" + GITHUB_REPOSITORY`, `folder`: the `openspec` folder relative to `GITHUB_WORKSPACE`.

## Reader rules (`reader.ts`)

Port of `LocalWorkspaceReader.cs`:

- Resolve the folder: if the selected directory is named `openspec` use it, otherwise use its `openspec` child. Canonicalize with `realpath`.
- Errors (class `WorkspaceError`, messages as in the C# code): folder missing or unreadable; no `openspec` folder; depth over 20; more than 10,000 directory entries; more than 2,000 artifacts, 2 MB per artifact, or 20 MB total. Enforce the size caps on the bytes actually read, not only on `stat`.
- Skip symbolic links with warning `Skipped symbolic link: <relative path>`.
- Skip names starting with `.` except `.openspec.yaml`.
- Artifacts are files ending in `.md`, `.yaml`, `.yml` (case-insensitive). Paths are relative to the `openspec` folder with `/` separators. Content is read as UTF-8.

## Parser rules (`parser.ts`)

Port of `WorkspaceParser.cs`. Rules that are easy to get wrong:

- **Markdown inspection** uses `marked`'s lexer with GFM, walking all tokens recursively:
  - Tasks: every list item with `task: true`, at any nesting depth; `completed` counts checked ones. Fenced code is not tokenized as lists, so examples in code blocks are excluded.
  - Requirements and scenarios: headings whose plain text starts with `Requirement:` or `Scenario:`, case-insensitive. Plain text is the concatenation of the heading's text tokens, including text inside emphasis, excluding code spans.
  - Summary: source text of the first top-level paragraph, with `*` and backticks removed, cut to 240 characters. Empty when there is none.
- **Artifact:** `title` is the label for file names `proposal`, `design`, `tasks`, `refine` (Requirements), `spec` (Specification); otherwise the humanized file name (strip a leading `YYYY-MM-DD-`, replace `-` and `_` with spaces, capitalize the first letter). `format` is `markdown` for `.md`, else `yaml`. `revision` is the lowercase hex SHA-256 of the UTF-8 content. Non-Markdown files get zero counts and an empty summary.
- **Ordering:** documents sorted by path in code-unit order (plain `<`, not `localeCompare`).
- **Configuration:** the document matching `^config\.ya?ml$`. Read top-level scalar keys; non-scalar values become `null`. Invalid YAML adds the warning from the C# code and continues. A `store` key adds the external-store warning. Workspace `schema` is the `schema` value or `spec-driven`.
- **Changes:** group documents under `changes/<name>/` (at least 3 path parts) and `changes/archive/<name>/` (at least 4). `id` is that prefix; `archived` when it starts with `changes/archive/`. `schema` comes from `<id>/.openspec.yaml`, falling back to the workspace schema; invalid YAML there adds `Invalid metadata in <name>.`. Task counts come from `<id>/tasks.md` only. `status`: `Draft` when total is 0, `Complete` when all are done, `In progress` when some are, else `Planned`. `summary` is the proposal's summary; the fallback text applies only when there is no `proposal.md`. `modified` is the newest document time, or `null`. `documents` are ordered `refine.md`, `proposal.md`, `design.md`, `tasks.md`, then the rest by path.
- **Change ordering:** `modified` descending (nulls last), then `id` in code-unit order.
- **Specs:** documents matching `specs/**/spec.md`; `capability` is the path without the `specs/` prefix and `/spec.md` suffix.

Two deliberate differences from the C# parser, found by the parity check. Both follow `marked`, so counts and summaries match what the reader renders:

- `- [x]text` without a space after the bracket is not a task (the C# parser counted it).
- A table is not a paragraph, so a document that opens with a table takes its summary from the first real paragraph.

## Local server (`server.ts`)

`node:http`, bound to `127.0.0.1`. For every request, in this order:

1. Set headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and the `Content-Security-Policy` value from `RequestBoundary.cs`.
2. Host name other than `localhost` or `127.0.0.1`: 403 `{ "error": "Local access only." }`.
3. `Origin` header present and different from `http://<Host>`: 403.
4. `Sec-Fetch-Site: cross-site`: 403.
5. Method other than GET or HEAD: 405 `{ "error": "This dashboard is read-only." }`.
6. `GET /workspace.json`: re-read and re-parse the folder, respond with JSON. `WorkspaceError` gives 400 `{ "error": message }`; anything else gives 500 with a generic message.
7. Otherwise serve the file from `dist/app` (`/` is `index.html`), rejecting paths that resolve outside it. Unknown path: 404. No SPA fallback is needed with hash routing.

The `X-OpenSpec-Client` header check is dropped; steps 2 to 4 cover cross-site reads.

## Static export (`export.ts`)

1. Read and parse the workspace with export-mode values (see the contract table).
2. Copy `dist/app` recursively into `--out`, creating it if needed.
3. Write `<out>/workspace.json`.

Existing files with the same names are overwritten. Nothing is ever deleted.

## Angular changes

- `app.config.ts`: add `withHashLocation()`. `index.html`: `<base href="./">`.
- `workspace-store.ts`: one resource, `httpResource<Workspace>(() => 'workspace.json')` (relative URL). Keep `query`, `workspace`, `active`, `archived`, `taskCount`, `completedCount`, `error`, `sourceLink`. Remove session, sign-in, repositories, selection, path and `open`, `openRepository`, snapshot and copy link, `logout`, and the custom request header.
- `app.html`: remove sign-out, auth notices, both welcome sections, and the copy status. The error panel shows the message and a **Try again** button that reloads the resource. The repository bar keeps `repository · ref · commit` and drops **Revision link** and **Copy link**. **Refresh workspace** stays in both modes (in a static site it re-fetches `workspace.json`, picking up a new deploy).
- `workspace-navigation`: replace the `<details>` picker with a static label: avatar, workspace name, and `GitHub repository` (has `source`), `Sample workspace` (`isDemo`), or `OpenSpec workspace`. Remove the branches resource, forms, and `openPicker`. Bottom line: `Published · read only` when `source` is set, else `Read only`. The wording avoids "local" because an export from a CI system other than GitHub Actions has no `source` either.
- The skip link focuses `<main>` in a click handler; with hash routing, following `#main` would be read as a route.
- `dashboard.html`: the "Most recently updated" label applies only when changes have dates; otherwise show "At the published revision".
- Footer: demo text becomes `SAMPLE DATA`.

## CI example (README)

A copy-paste GitHub Pages workflow for consuming repositories. Action versions were current on 2026-10-02.

```yaml
name: Publish specs
on:
  push: { branches: [main], paths: ['openspec/**'] }
  workflow_dispatch:
permissions: { contents: read, pages: write, id-token: write }
concurrency: { group: pages, cancel-in-progress: true }
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npx --yes openspec-desk export --out site
      - uses: actions/upload-pages-artifact@v5
        with: { path: site }
      - id: deploy
        uses: actions/deploy-pages@v5
```

The README states that Pages sites are public unless the organization uses private Pages (Enterprise Cloud), and that other hosts only need the `site/` folder uploaded.

## Removed

`backend/`, `OpenSpec.slnx`, `global.json`, `.config/dotnet-tools.json`, `Dockerfile`, `.dockerignore`, `.env.example`, `scripts/`, `tests/hosted.spec.ts`, the .NET and hosted-credential entries in `.gitignore`, and the hosted and .NET sections of `README.md`. The README is rewritten around the two commands, the CI example, reading features, development, and current boundaries.

## Testing

1. **Parity check (one-off, before any deletion).** Run the .NET API and the Node CLI against the same folders (`backend/OpenSpec.Api/Demo` and the fixture built in `tests/dashboard.spec.ts`) and diff the JSON. Ignore `loadedAt`; compare dates as instants at millisecond precision (the serialized formats differ). Any other difference is a port bug.
2. **Unit tests** (`node:test`, run on the TypeScript sources through Node's type stripping; no test framework dependency), ported from `WorkspaceTests.cs`:
   - Markdown inspection: `"- [x] Done\n- [ ] Pending\n  - [X] Nested\n\n~~~md\n- [ ] Example\n~~~\n\n### Requirement: Read\n#### Scenario: Open"` gives 2 completed, 3 total, 1 requirement, 1 scenario, empty summary; `"# Proposal\n\nRead this **proposal**."` gives summary `Read this proposal.`.
   - Demo workspace: name `Atlas`, 3 changes, 1 archived, `add-project-invitations` is 5 of 9 and `In progress`, includes its nested delta spec, first spec is `projects/access` with 2 requirements.
   - Symlink skipped and invalid `config.yaml` reported (1 document, 2 warnings); opening the `openspec` folder directly works.
   - Size limits: 2,000,001 bytes in one file, 20,000,001 total, 2,001 files each throw.
   - Server checks: foreign `Host`, foreign `Origin`, `Sec-Fetch-Site: cross-site`, and POST are rejected with the statuses above; path traversal is rejected.
   - Export: output contains `index.html` and `workspace.json`; dates are `null`; `source` is filled from the `GITHUB_*` variables and absent without them; `root` is relative.
   - CLI: a missing folder exits with code 1 and the reader's message.
3. **Playwright** (`tests/dashboard.spec.ts`), with `webServer` running `node dist/cli/main.js --demo --port 4311`:
   - Existing sample, search, nested-link, sanitization, refresh, and phone-size tests keep their assertions. Tests that used the folder picker start the CLI on the temp folder on a second port.
   - Runtime error: remove the folder after startup, press **Refresh workspace**, expect the error panel.
   - **Subpath test:** export `--demo` into `<tmp>/specs/`, serve `<tmp>` with a minimal static server that has no fallback, open `/specs/`, open an artifact, reload the page, and follow an internal document link. This proves the export works the way GitHub Pages serves it.

## Out of scope

File watching and live reload, multiple branches or per-PR previews, a reusable GitHub Action wrapper, examples for other hosts, auto-opening the browser, prerendered HTML pages, automated npm releases, and any change of UI framework.

## Order of work

1. Port the reader and parser with unit tests; pass the parity check.
2. Move the demo to `demo/`; add the server, export, and CLI entry point; restructure `package.json` and build output.
3. Change the Angular app; update Playwright, including the subpath test.
4. Delete the .NET backend and hosted files; rewrite the README.

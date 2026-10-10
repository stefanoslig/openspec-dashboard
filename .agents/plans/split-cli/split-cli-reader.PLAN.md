# Split brief: cli/reader.ts, with server.ts, export.ts and delta.ts tidied

You are refactoring four modules in `/Users/stefanoslignos/Personal_Projects/openspec-dashboard`
for readability, behaviour unchanged. `cli/reader.ts` (135 lines, 6 warnings) mixes five concerns
and `readFiles` nests two closures over four counters. `cli/server.ts` (112 lines, 6 warnings),
`cli/export.ts` (139 lines, 3) and `cli/delta.ts` (156 lines, 4) are each one concern with one
function grown too long; they are tidied in place, no new files.

Read `AGENTS.md` and `.agents/docs/code-conventions.md` first. `cli/` is Node only: no Angular
imports. Sibling imports carry the `.ts` extension (`node --test` runs the sources directly).

## Concerns reader.ts mixes

1. The error type the server turns into an HTTP status (`WorkspaceError`).
2. Size limits and what counts as an artifact (`maxFileBytes`, `maxTotalBytes`, `maxArtifacts`,
   `isArtifact`, `checkSize`).
3. Resolving the openspec folder from a path (`resolveRoot`).
4. Walking the folder: name order, entry and depth caps, skip rules, capped reads (`readFiles`).
5. Demo pull requests and workspace assembly (`samplePullRequests`, `readWorkspace`).

## Target shape

Keep every existing comment whose fact still holds, beside the code it explains.

- `cli/workspace-error.ts` — `WorkspaceError` verbatim. `cli/server.ts`, `cli/server.test.ts`
  and `cli/reader.test.ts` import it from here.
- `cli/limits.ts` — the three maxima, `isArtifact`, `checkSize`, verbatim. `cli/limits.test.ts`
  gets the three `checkSize` assertions now in "rejects oversized workspaces" of `reader.test.ts`
  (that test keeps its folder-based part). Update every import: `grep -rn "from './reader.ts'" cli`
  and move `isArtifact`, `maxFileBytes`, `maxArtifacts`, `maxTotalBytes`, `checkSize` to
  `./limits.ts` wherever they are imported (today `cli/export.ts` and a `cli/github*.ts` module).
  `reader.ts` does not re-export them.
- `cli/reader.ts` keeps `resolveRoot`, `readFiles`, `samplePullRequests`, `readWorkspace`.
  `readFiles` passes explicit state (root, files, warnings, bytes read, entries seen) to a `walk`
  that visits children in name order through a named comparator with no nested ternary (code-unit
  order: `<` and `>` on the names, never `localeCompare`), one function per entry with guard
  clauses in today's rule order, and a capped-read helper. The try/catch mapping of errors stays in
  `readFiles`.
- `cli/server.ts` — `handle` becomes: the four headers; a pure `refusal(request)` returning
  `{ status, error }` or nothing for the four admission rules in today's order (host not
  `localhost`/`127.0.0.1` → 403 `Local access only.`; an `origin` other than
  `http://<host header>` → 403 `Cross-origin access is disabled.`; `sec-fetch-site: cross-site`
  → 403 `Cross-site access is disabled.`; method other than GET/HEAD → 405
  `This dashboard is read-only.`); pathname decoding (400 `Malformed address.`); then either the
  workspace route or the static file route, each its own function. The JSON helper is bound to one
  request and response (a small class or factory) so it takes status and body only; HEAD sends the
  headers with `Content-Length` and no body for JSON and files alike. Keep the DNS-rebinding
  comment and `createDashboardServer` as is.
- `cli/export.ts` — `exportSite` splits into reading the workspace to export and writing the site,
  each under the limits; the `root` expression with the nested ternary becomes a small named
  function with guard clauses (demo → `openspec`; else the source folder; else the path of the
  root relative to the real `cwd`, or `.` when empty). The order of effects is unchanged: resolve
  root, check the build, read files, env, source, pull requests, build, then mkdir, copy, write.
  Keep the two comments about CI file times and about writing nothing before the build.
- `cli/delta.ts` — `read` becomes a name that says what it returns (for example `linesOf`), with
  the fence tracking in its own helper so no block nests three deep; `blocks` gets a helper for
  the end of a block (next header, trailing blank lines dropped). Exports and their types are
  unchanged; the module comment stays.

## Conventions

From `.agents/docs/code-conventions.md`, applied to Node code:

- The lint limits in `eslint.config.js` are the floor: in a file you touch every warning counts as
  an error. Split, never raise a limit or disable a rule.
- One concern per module. Data shaping, parsing and classification are pure functions with a test
  beside them.
- A long function reads as steps separated by a blank line, each opened by a one-line comment;
  helpers above their first caller; parameters and return values instead of closures over shared
  mutable state.
- A name says what a thing is, not how it works; no one-word name for a number; no `read`, `data`
  or `result` for something with a meaning.
- One level of ternary at most; otherwise guard clauses or a lookup table.
- Comments give a non-obvious why or an invariant, in one or two lines, as a colleague would write
  them; never narrate what changed.

## Behaviour to preserve

reader.ts:
- An empty path: `Enter the path to a repository or its openspec folder.`; not a folder:
  `That folder could not be opened. Check the path and its permissions.`; no openspec folder:
  `No openspec folder found. Select a repository containing openspec/, or openspec/ itself.`;
  `~` and `~/` expand to the home folder; the real path is returned — two messages covered by
  "rejects folders that cannot be a workspace".
- Folder depth above 20 rejected with `This workspace exceeds the supported folder depth (20).` —
  covered. More than 10,000 entries rejected with `This openspec folder contains too many entries
  (maximum 10,000).`; the counter counts every entry before any other rule — not covered.
- Children visited in code-unit name order, so documents come out in a stable order — not covered.
- Symbolic links skipped with `Skipped symbolic link: <relative path>`; hidden entries skipped
  except `.openspec.yaml`; non-files and non-artifacts ignored; a file whose real path is outside
  the root skipped with `Skipped file outside openspec: <relative path>` — covered by "skips
  symbolic links and hidden files, and reports invalid YAML" except the outside-root case.
- Size limits checked from the metadata before reading and again per chunk while reading with the
  stream capped at `maxFileBytes` — the metadata path covered by "rejects oversized workspaces".
- A filesystem error with a `code` becomes `That folder could not be read. Check the path and its
  permissions.`; a `WorkspaceError` passes through; anything else propagates — not covered.
- Demo: name `Atlas` and the pull requests of `pull-requests.json` next to the openspec folder;
  otherwise the name of the folder containing openspec — covered by "reads the demo workspace and
  its task progress".

server.ts: every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer`, `Cache-Control: no-store` and the content security policy; the four refusals; 400 for
a malformed address; `/workspace.json` serves the loaded workspace, a `WorkspaceError` as its status
and message, any other error as 500 with the generic sentence and a `console.error`; `/` serves
`index.html`; files outside the app folder or missing give 404 `Not found.`; content types by
extension with `application/octet-stream` as fallback; HEAD without body — all covered by the four
server tests except the `Referrer-Policy` header.

export.ts: every behaviour is covered by its eight tests; keep the warning text of `withinTotals`
and the missing-variables message verbatim.

delta.ts: covered by its seven tests.

## Verification, in this order

1. `npm test` — type-checks the whole tree and runs every test; must pass.
2. `npx eslint --max-warnings 0 <every file you created or changed>` — zero problems.
3. Snapshot check, byte-identical output for the same input. Scratch dir
   `S=/private/tmp/claude-501/-Users-stefanoslignos-Personal-Projects-openspec-dashboard/dca260e3-168b-445e-9c29-cd7042034772/scratchpad/split-cli`
   holds `before-demo.json` and `before-own.json`, taken before any edit. Run from the repo root:

   ```
   node --input-type=module -e "
   import { readWorkspace } from './cli/reader.ts';
   import { writeFileSync } from 'node:fs';
   const demo = await readWorkspace('demo', { demo: true }); delete demo.loadedAt;
   const own = await readWorkspace('.'); delete own.loadedAt;
   writeFileSync('$S/after-demo-reader.json', JSON.stringify(demo, null, 1));
   writeFileSync('$S/after-own-reader.json', JSON.stringify(own, null, 1));"
   diff "$S/before-demo.json" "$S/after-demo-reader.json" && diff "$S/before-own.json" "$S/after-own-reader.json" && echo identical
   ```

Do not run `npm run build`, `npm start`, `npm run dev` or `npm run test:ui`: they share `dist/`
and fixed ports with the main session, which runs them.

## Hard constraints

- No git command that writes (add, commit, stash, checkout, restore, reset, branch). Read-only git
  is fine.
- Do not run `npm install`; do not edit `package.json`, any `tsconfig*.json`, `eslint.config.js`
  or `angular.json`.
- Stay within `cli/reader.ts`, `cli/reader.test.ts`, `cli/server.ts`, `cli/server.test.ts`,
  `cli/export.ts`, `cli/delta.ts`, the new `cli/workspace-error.ts`, `cli/limits.ts`,
  `cli/limits.test.ts`, and the import lines of the files that import the moved names. Another
  implementer is editing `cli/main.ts` and a new `cli/command.ts` at the same time: never touch
  those. If `npm test` reports a type error in a file that is not yours, wait a minute and re-run
  before judging.
- Verify against the code and the test output, never against your own earlier reasoning.

## Report back

Every file created or changed with its line count (`wc -l`); the exact tail of the `npm test`
output; the lint command and its result; the snapshot diff result; every behaviour you could not
preserve exactly, with the reason. Paste the final `cli/reader.ts` and `cli/server.ts` in full.

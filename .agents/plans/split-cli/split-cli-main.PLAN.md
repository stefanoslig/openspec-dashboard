# Split brief: cli/main.ts

You are refactoring `cli/main.ts` in `/Users/stefanoslignos/Personal_Projects/openspec-dashboard`
for readability, behaviour unchanged. The owner found it unreadable: `main` is 60 lines with a
complexity of 23, parsing arguments, validating them, exporting and serving in one function.

Read `AGENTS.md` and `.agents/docs/code-conventions.md` first. `cli/` is Node only: no Angular
imports. Sibling imports carry the `.ts` extension (`node --test` runs the sources directly).

## Concerns the file mixes

1. The usage text and `UsageError`.
2. Turning `argv` into a command, with five cross-checks and the port rule.
3. Running an export and printing its result.
4. Running the server: pre-read, build check, listen, the port-in-use message.
5. Reporting a failure with the `--help` hint.

## Target shape

Keep every existing comment whose fact still holds, beside the code it explains.

- `cli/command.ts` — `usage` (verbatim, it reads `version` from `./paths.ts`), `UsageError`, a
  `Command` union (`help`; `version`; `export` with `input`, `out`, `demo`, `pullRequests`; `serve`
  with `input`, `port`, `demo`) and `parseCommand(argv: string[], env: NodeJS.ProcessEnv):
  Command`. It calls `parseArgs` with today's options and `args: argv`, lets its errors propagate
  (their `code` starts with `ERR_PARSE_ARGS`), and applies today's checks in today's order so the
  first failing message is the same: `--help`, then `--version`, then the five usage errors, then
  the input, then for `serve` the port. The port is `Number(values.port ?? env['PORT'] ?? 4310)`
  verbatim (so an empty `PORT` means port 0, as today) and must be an integer from 0 to 65535,
  else `--port needs a number between 0 and 65535.`.
  `cli/command.test.ts` beside it: help, version, export defaults (`out` is `site`, `input` is
  `.`), serve defaults (4310, then `PORT`), `--demo` makes the input the bundled demo folder, each
  of the five usage errors with its exact message, the port errors for `abc`, `70000`, `-1` and
  `1.5`, and an unknown option rejected with an `ERR_PARSE_ARGS` code. No process is spawned.
- `cli/main.ts` keeps `main` (parse, then one branch per command kind), `runExport(command)`
  (today's export branch with its `Exported <n> artifacts to <out>` line) and `serve(command)`
  (read once before listening, the missing-build error, the server with its error handler and
  listen callback), each under the limits, plus the top-level catch unchanged. Import `UsageError`
  and `usage` from `./command.ts`.
- `cli/main.test.ts` stays unchanged.

## Conventions

From `.agents/docs/code-conventions.md`, applied to Node code:

- The lint limits in `eslint.config.js` are the floor: in a file you touch every warning counts as
  an error. Split, never raise a limit or disable a rule.
- One concern per module. Data shaping, parsing and classification are pure functions with a test
  beside them.
- A long function reads as steps separated by a blank line, each opened by a one-line comment;
  helpers above their first caller.
- A name says what a thing is, not how it works; no one-word name for a number.
- One level of ternary at most; otherwise guard clauses or a lookup table.
- Comments give a non-obvious why or an invariant, in one or two lines, as a colleague would write
  them; never narrate what changed.

## Behaviour to preserve

- `--help` prints the usage and `--version` the version, exit code 0, before any validation —
  usage covered by "prints usage".
- The five usage errors, verbatim: `Give one path at most.`; `--port applies to the local server
  only.`; `--out applies to export only.`; `--pull-requests applies to export only.`;
  `--pull-requests cannot be combined with --demo.`. Each, and any `parseArgs` error, prints the
  message followed by `Run openspec-desk --help for usage.` on the next line, exit code 1 — the
  two `--pull-requests` messages covered by "accepts --pull-requests for an export of a repository
  only"; the others only through their hint in "exits with the reason when the workspace or the
  arguments are wrong".
- `--demo` reads the bundled demo folder; the path defaults to `.`; `export` takes the path after
  the word — not covered.
- Port from `--port`, then `PORT`, then 4310; integer 0 to 65535 — only `abc` covered.
- The workspace is read once before listening so a wrong path fails in the terminal — covered by
  "exits with the reason...".
- A missing `dist/app/index.html` fails before listening with `The dashboard build is missing from
  this installation (dist/app).`; `EADDRINUSE` prints `Port <port> is already in use. Choose
  another with --port.` and exits 1; other server errors print their message; the server listens
  on `127.0.0.1` and prints `OpenSpec Desk is reading <root>` and `Open http://127.0.0.1:<bound
  port>` with the port actually bound — not covered.
- A workspace or export error prints its message without the hint, exit code 1 — covered by
  "exits with the reason...".

## Verification, in this order

1. `npm test` — type-checks the whole tree and runs every test; must pass.
2. `npx eslint --max-warnings 0 cli/main.ts cli/command.ts cli/command.test.ts` — zero problems.
3. `node cli/main.ts --help | head -3` and `node cli/main.ts --version` print as before.

Do not run `npm run build`, `npm start`, `npm run dev` or `npm run test:ui`: they share `dist/`
and fixed ports with the main session, which runs them. Do not start the server on a fixed port.

## Hard constraints

- No git command that writes (add, commit, stash, checkout, restore, reset, branch). Read-only git
  is fine.
- Do not run `npm install`; do not edit `package.json`, any `tsconfig*.json`, `eslint.config.js`
  or `angular.json`.
- Stay within `cli/main.ts`, `cli/command.ts` and `cli/command.test.ts`. Another implementer is
  editing `cli/reader.ts`, `cli/server.ts`, `cli/export.ts`, `cli/delta.ts` and new
  `cli/limits.ts` and `cli/workspace-error.ts` at the same time: never touch those; the names
  `main.ts` imports from them do not change. If `npm test` reports a type error in a file that is
  not yours, wait a minute and re-run before judging.
- Verify against the code and the test output, never against your own earlier reasoning.

## Report back

Every file created or changed with its line count (`wc -l`); the exact tail of the `npm test`
output; the lint command and its result; the output of the two commands in step 3; every
behaviour you could not preserve exactly, with the reason. Paste the final `cli/main.ts` in full.

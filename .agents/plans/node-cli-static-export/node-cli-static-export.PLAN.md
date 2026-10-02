# Plan: Node CLI and static export

Implements `node-cli-static-export.DESIGN.md` (same directory). That document is the source of truth for behavior: CLI contract, `workspace.json` values per mode, reader and parser rules, server checks, Angular changes, and test cases. This plan fixes the order, the files, and the verification for each step.

Constraints:

- Node 22.23+, npm. .NET 10 SDK is needed only for step 2 (parity) and is gone after step 6.
- No git writes (commit, branch, stash) unless the user asks.
- The C# reference files stay until step 6: `backend/OpenSpec.Api/Workspaces/{WorkspaceParser,LocalWorkspaceReader,Models}.cs`, `backend/OpenSpec.Api/Api/RequestBoundary.cs`, `backend/OpenSpec.Api.Tests/WorkspaceTests.cs`.

## Step 1: CLI toolchain, reader, parser

- `package.json`: add `"type": "module"`; add dependency `yaml`; add dev dependency `@types/node`.
- `cli/tsconfig.json`: `module`/`moduleResolution` `nodenext`, `strict`, `rootDir: "."`, `outDir: "../dist/cli"`, `types: ["node"]`, `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`; include `*.ts`, exclude `*.test.ts`. Source files import each other with `.ts` extensions so the same files run under Node's type stripping (tests) and compile with `tsc` (build).
- `cli/workspace.model.ts`: move `src/app/core/workspace.model.ts` here; add `ArtifactFile { path; content; modified: number | null }` (epoch milliseconds, fractional, so ordering keeps sub-millisecond precision). Update Angular imports to `import type` from the new location.
- `cli/parser.ts`: `humanize`, `inspectMarkdown`, `buildWorkspace(files, { name, root, isDemo, source?, warnings?, now? })`.
- `cli/reader.ts`: `WorkspaceError` (with `status`), `resolveRoot(input)`, `readFiles(root)`, `checkSize`, `readWorkspace(input, { demo })`. Sort directory entries by name for deterministic warnings.
- `cli/parser.test.ts`, `cli/reader.test.ts`: the cases listed under "Unit tests" in the design that concern inspection, the demo workspace, symlinks and invalid YAML, and size limits. Until step 3 the demo lives at `backend/OpenSpec.Api/Demo`.
- Script `test`: `node --test "cli/*.test.ts"`.

Verify: `npm test` passes; `npx tsc -p cli --noEmit` is clean.

## Step 2: Parity check (one-off, nothing is kept)

1. `dotnet build backend/OpenSpec.Api`, then run it with `PORT=4399 DASHBOARD_MODE=local`.
2. For `backend/OpenSpec.Api/Demo` and for a copy of the fixture created in `tests/dashboard.spec.ts` (`beforeAll`), fetch `http://127.0.0.1:4399/api/workspace?path=<absolute path>` with header `X-OpenSpec-Client: dashboard`, and produce the TypeScript result with `readWorkspace` on the same path.
3. Diff with a throwaway script in the scratchpad: ignore `loadedAt`; treat `source: null` as absent; compare dates as instants at millisecond precision; compare `warnings` sorted.

Verify: no differences. Fix the port, not the comparison, when one appears.

## Step 3: Server, export, entry point, packaging

- Move `backend/OpenSpec.Api/Demo/openspec` to `demo/openspec`.
- `cli/paths.ts`: find the package root by walking up from the module's directory to the `package.json` named `openspec-desk`; export `appDir` (`dist/app`) and `demoDir` (`demo`). Works from both `cli/` and `dist/cli/`.
- `cli/server.ts`: `createDashboardServer({ appDir, load })` returning an `http.Server`; `load` returns the workspace for each `/workspace.json` request.
- `cli/export.ts`: `exportSite({ input, demo, out, appDir, env, cwd })`.
- `cli/main.ts`: shebang, `parseArgs`, commands and flags from the design plus `--help`; exit code 1 with the message on `WorkspaceError`, unknown flags, a missing `dist/app`, or a port in use.
- `cli/server.test.ts`, `cli/export.test.ts`, `cli/main.test.ts`: remaining unit cases from the design.
- `angular.json`: `outputPath: { "base": "dist/app", "browser": "" }`.
- `package.json`: `name: "openspec-desk"`, drop `private`, `bin`, `files: ["dist", "demo"]`, `engines.node: ">=22"`, Angular packages to `devDependencies`, scripts `build` (`ng build && tsc -p cli`), `prestart`/`start` (`node dist/cli/main.js --demo`), `dev`, `test`, `test:ui`, `format`, `prepack`. Remove all .NET and hosted scripts.
- `proxy.conf.json`: proxy `/workspace.json` to `http://127.0.0.1:4310`.

Verify: `npm test`; `npm run build`; `node dist/cli/main.js --demo --port 4399` answers `/workspace.json`; `node dist/cli/main.js export --demo --out <tmp>` writes `index.html` and `workspace.json`; `npm pack --dry-run` lists only `dist/`, `demo/`, `package.json`, and `README.md`.

## Step 4: Angular app

Apply the "Angular changes" section of the design to `src/app/app.config.ts`, `src/index.html`, `src/app/core/workspace-store.ts`, `src/app/app.html`, `src/app/shared/workspace-navigation/*`, `src/app/features/dashboard/dashboard.html`, and `src/app/features/reader/reader.html`. Remove CSS that only styled deleted elements.

Verify: `npm run build` is clean and within budgets; the demo renders at `http://127.0.0.1:4310` after `npm start`.

## Step 5: Playwright

- `playwright.config.ts`: one `webServer`, `node dist/cli/main.js --demo --port 4311`.
- `tests/dashboard.spec.ts`: keep the sample and phone tests. The local-repository test opens a CLI started on the temp folder (port 4312). Replace the invalid-path test with the runtime-error test (remove the folder, **Refresh workspace**, expect the error panel, restore the folder, **Try again**). Add the subpath test (export `--demo` into `<tmp>/specs`, serve `<tmp>` with a no-fallback static server, open `/specs/`, open an artifact, reload, follow an internal link).
- Delete `tests/hosted.spec.ts`.

Verify: `npm run build && npm run test:ui` passes.

## Step 6: Remove .NET and hosted files, rewrite the README

- Delete `backend/`, `OpenSpec.slnx`, `global.json`, `.config/`, `Dockerfile`, `.dockerignore`, `.env.example`, `scripts/`.
- `.gitignore`: drop the .NET and hosted-credential entries. `.vscode/`: drop references to removed scripts. `.editorconfig`: drop C#-only sections if any.
- `README.md`: what it is; run locally (`npx openspec-desk`); publish from CI (the workflow in the design, with current action versions confirmed); reading features; development and tests; current boundaries. Documentation prose, not conversational voice.

Verify: `grep -ri "dotnet\|postgres\|hosted" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.agents --exclude-dir=.git .` finds nothing unintended; `npm test`, `npm run build`, `npm run test:ui`, and `npx prettier --check` on the formatted paths all pass.

## Done when

All verifications above pass, the parity check showed no differences, and `git status` shows only the intended additions, modifications, and deletions.

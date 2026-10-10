# OpenSpec Desk

Read-only dashboard for OpenSpec artifacts: an Angular 22 app in `src/app/` served and exported by a
Node CLI in `cli/`. The `openspec/` folder holds this project's own specs and changes.

## Commands

- `npm start` — builds, then serves the sample workspace on port 4310.
- `npm run dev` — Angular dev server on http://127.0.0.1:4200; reads the workspace from port 4310,
  so keep `npm start` running.
- `npm test` — type-checks and runs every `*.test.ts` under `cli/` and `src/` with `node --test`.
- `npm run lint` — ESLint over `src/`, `cli/`, `tests/`.
- `npm run build` — app and CLI into `dist/`.
- `npm run test:ui` — Playwright against the built package (run `npm run build` first) on fixed
  ports from 4311, so never from two sessions at once.
- `npm run format` — Prettier.

## Structure

- `cli/` — Node only: reads a workspace, serves it, exports a static site. No Angular imports.
- `src/app/core/` — pure functions, each tested in a `*.test.ts` beside it, plus `WorkspaceStore`.
  No DOM.
- `src/app/features/` — routed pages; `src/app/shared/` — reusable components.
- Types shared by both sides live in `cli/workspace.model.ts`.

## Docs

- [Code conventions](.agents/docs/code-conventions.md) — read before writing or changing TypeScript
  or a template.
- Angular idioms: the `angular-developer` skill in `.agents/skills/`, plus the version-specific rules
  in `node_modules/@angular/core/resources/best-practices.md`.

Planning documents go to `.agents/plans/<slug>/`.

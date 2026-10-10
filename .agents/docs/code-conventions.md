# Code conventions

Readability is judged by a stranger reading the file top to bottom, not by a metric. Lint is the
floor, not the bar.

## Lint

- The readability limits live in `eslint.config.js`. They are warnings so the backlog does not
  fail CI, but in any file you touch they count as errors; the Claude Code hook reports them after
  every edit.
- A limit that trips marks code to split, never a threshold to raise or a rule to disable. A
  disable comment is for false positives only and carries a one-line reason.

## Components and directives

- One concern per class. A component owns route state, view state and handlers that delegate.
- DOM work (listeners, measurements, element queries, `afterRenderEffect`) goes in a directive.
- Data shaping, parsing and resolution go in `src/app/core/` as pure functions with a `*.test.ts`
  beside them; the component calls them from a `computed()`.
- Lay the class out in groups separated by a blank line, each opened by a one-line comment naming
  it: injected dependencies, route signals, data, derived view data, view state, handlers.
- State is signals; no bare mutable fields. Members used only by the template are
  `protected readonly`.

## Naming and branching

- A name says what a thing is, not how it works; no one-word name for a number (`line = 110`).
- Handlers are named for what they do, not for the event.
- One level of ternary at most, in TypeScript and in templates; otherwise guard clauses or a lookup
  table.

## Definition of done

1. `npm run lint` clean for the files you touched, `npm test` green, `npm run build` green,
   `npm run test:ui` green when a page changed.
2. A fresh-context review of the diff before reporting done: a sub-agent that gets the diff and the
   intent but none of this session's reasoning, every finding answered. The user runs
   `/self-review` for the same purpose.

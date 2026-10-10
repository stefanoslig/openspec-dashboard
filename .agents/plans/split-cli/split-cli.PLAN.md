# Split the CLI for readability

Approved design, 2026-10-10. Every source file under `cli/` with lint warnings is split or tidied
so a stranger reads it top to bottom, behaviour unchanged. Warnings are fixed by splitting, never by
raising a limit or disabling a rule.

Baseline (`npx eslint cli`, `wc -l`): 61 warnings. parser.ts 334 lines / 19, github.ts 363 / 13,
reader.ts 135 / 6, server.ts 112 / 6, main.ts 94 / 4, export.ts 139 / 3, delta.ts 156 / 4. The six
warnings inside the fake GitHub servers of `export.test.ts` and `github.test.ts` are out of scope;
every export those tests import keeps its name and file, so neither test file needs an edit.

## Waves

Each brief goes to a fresh-context implementer that gets only the brief. Briefs in one wave run in
parallel on disjoint files.

1. [parser](split-cli-parser.PLAN.md) and [github](split-cli-github.PLAN.md).
2. [reader, limits, server, export, delta](split-cli-reader.PLAN.md) and
   [main, command](split-cli-main.PLAN.md). Second, because the reader brief moves exports that
   `github*.ts` and `export.ts` import.

## After both waves, in the main session

1. `npx eslint --max-warnings 0` on every touched source file; `npm test`; `npm run build`;
   `npm run test:ui`.
2. The scripted checks for the preservation items no test covers (listed in each brief), and the
   demo and own-workspace snapshots diffed against the ones taken before the first edit.
3. One fresh-eyes review of the whole diff: correctness against the preservation lists, and
   readability against `.agents/docs/code-conventions.md` (at most five stumbles, each with better
   wording).
4. Report sizes before and after, what moved where, the evidence, every deviation. No git writes;
   the user commits.

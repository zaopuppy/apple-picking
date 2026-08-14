# Repository Guidelines

## Project Structure & Module Organization

This is a Vite, TypeScript, and Three.js browser game. `src/main.ts` boots the app. Keep device input and loop utilities in `src/core/`, deterministic rules and shared types in `src/game/`, Three.js presentation in `src/render/`, and HUD/audio behavior in `src/systems/`. Reusable entity and utility code belongs in `src/entities/` and `src/utils/`. Browser and rule tests live in `tests/`; maintenance and canvas-inspection tools live in `scripts/`. Design decisions and implementation reports are versioned in `docs/`. Treat `dist/`, `test-results/`, and `artifacts/` as generated output.

## Build, Test, and Development Commands

- `npm install` installs the locked dependencies.
- `npm run dev` starts Vite on `http://127.0.0.1:5188`.
- `npm run build` runs strict TypeScript checks and creates `dist/`.
- `npm test` runs the complete Playwright suite in installed Google Chrome.
- `npm run verify:visual` runs the canvas, HUD, and responsive smoke tests.
- `npm run inspect:canvas` captures canvas diagnostics and screenshots for deeper visual QA.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, semicolons, and trailing commas in multiline TypeScript. Keep TypeScript strict: do not bypass `noUnusedLocals`, `noUnusedParameters`, or exhaustive switch checks. Name classes and exported types in `PascalCase`, functions and variables in `camelCase`, and constants in `UPPER_SNAKE_CASE`. Keep `GameSimulation` deterministic and independent from Three.js; rendering and audio should consume snapshots or events instead of owning gameplay state. No formatter or linter is configured, so match nearby code and run the build before submitting.

## Testing Guidelines

Tests use Playwright. Name test files `*.spec.ts`; place deterministic rule coverage in `tests/game-rules.spec.ts` and browser/UI coverage in `tests/visual.spec.ts`. Add a regression test for every gameplay rule or visible bug. Use the provided test hooks and seeded scenarios for repeatability, but retain at least one real keyboard-input path for changed controls. Verify both desktop and narrow Chrome when HUD layout changes.

## Commit & Pull Request Guidelines

The repository has only one historical commit (`init.codegraph`), so no mature convention exists. Use concise, imperative subjects with an optional scope, for example `game: require active apple delivery`. Keep commits focused. Pull requests should explain player-visible behavior, list verification commands, link relevant issues or design documents, and include screenshots for scene or HUD changes. Call out rule-order changes and remaining playtest risks.

## Agent Notes

When `.codegraph/` exists, use `codegraph explore "<question or symbols>"` before grep or broad file reads for code discovery. Do not hand-edit generated output or commit temporary QA artifacts.

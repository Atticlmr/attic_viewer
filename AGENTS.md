# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite/TypeScript web app for viewing robot models in URDF, MJCF, and USD formats. Source lives in `src/`: `app/` contains application orchestration, `controllers/` handles user workflows, `adapters/` and `converters/` handle model formats, `loaders/` reads files, `renderer/` owns Three.js rendering, and `ui/` plus `views/` contain interface code. Shared types are in `src/types/`, utilities in `src/utils/`, and test helpers in `src/test/`. Static USD viewer assets are under `public/usd-viewer/`.

Tests are colocated with source as `*.test.ts`, for example `src/app/AppState.test.ts` and `src/converters/URDFToMJCF.test.ts`.

## Build, Test, and Development Commands

Use pnpm, as declared by `packageManager`.

```bash
pnpm dev            # Start the Vite dev server
pnpm build          # Build production assets into dist/
pnpm preview        # Preview the production build locally
pnpm typecheck      # Run TypeScript without emitting files
pnpm test           # Run Vitest once
pnpm test:watch     # Run Vitest in watch mode
pnpm test:coverage  # Generate coverage with Vitest/V8
```

Run targeted tests with `pnpm vitest run src/path/file.test.ts` or `pnpm vitest run --testNamePattern "case name"`.

## Coding Style & Naming Conventions

Write TypeScript with 4-space indentation, semicolons, single quotes, and K&R braces. Imports between local TypeScript files should use `.js` extensions, such as `import { AppState } from './AppState.js';`. Prefer project aliases like `@/renderer/SceneManager.js` where existing code uses them.

Use PascalCase for classes and class files (`SceneManager.ts`), camelCase for methods and variables, and an underscore prefix for private/internal members such as `_dirty`. Strict TypeScript is disabled, so follow existing loose typing patterns when integrating with external model libraries.

## Testing Guidelines

Tests use Vitest with `describe`, `it`, `expect`, and setup helpers such as `beforeEach`. Keep tests near the code they cover and name them `*.test.ts`. Add focused coverage for converters, adapters, loaders, and state changes when behavior changes. Run `pnpm test` and `pnpm typecheck` before opening a pull request.

## Commit & Pull Request Guidelines

Recent history uses short imperative commits, often with release prefixes when appropriate, for example `Fix MJCF parsing compatibility` or `release: v1.3.0`. Keep commits focused on one logical change.

Pull requests should include a concise summary, test results, linked issues when relevant, and screenshots or screen recordings for visible UI or rendering changes. Note any model-format fixtures or assets used to validate URDF, MJCF, or USD behavior.


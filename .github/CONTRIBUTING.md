# Contributing Guide

Welcome! This monorepo hosts TypeScript ESM packages under `@satoshibits`, built with pnpm, Turbo, Vitest, ESLint, Prettier, Husky, and Changesets.

## Quick Start
- Requirements: Node >= 20.11, pnpm.
- Install: `pnpm install`
- Dev (watch mode where supported): `pnpm dev`
- Build all: `pnpm build` (Turbo; outputs `dist/**`)
- Test all: `pnpm test` (Vitest workspace)
- Lint: `pnpm lint`  •  Format: `pnpm run format`
- Filter a package: `pnpm --filter @satoshibits/<name> <script>`

## Commits & Changesets
- Use Conventional Commits via Commitizen: `pnpm run commit:cz`
  - Scope with the package when possible, e.g., `feat(errors): ...`
- For publishable changes, create a changeset: `pnpm run commit:publish`
  - This runs Changesets, stages `.changeset/*`, then opens Commitizen.

## Tests
- Framework: Vitest. Place tests as `*.test.mts` next to sources or in `src/__tests__/`.
- Run all: `pnpm test`  •  One package: `pnpm --filter @satoshibits/<name> test`
- Follow TDD and add edge cases and regression tests (see `CLAUDE.md`).

## Code Style
- TypeScript ESM (`.mts`). Kebab-case files; scoped packages (e.g., `@satoshibits/observability`).
- Prettier with import sorting (`prettier.config.mjs`).
- ESLint per package (`eslint.config.mts`).
- Husky pre-commit runs `turbo pre-commit` against staged files.

## Pull Requests
- Use the PR template. Include: clear summary, affected packages, tests, docs updates, and a changeset if publishing.
- Validate locally before review: `pnpm lint && pnpm test && pnpm build`.
- Avoid secrets in code. Follow PII-sanitization patterns from `@satoshibits/errors`.

## Adding a Package
- Scaffold: `pnpm package:add` or `./bin/add-package.sh -n <name> -t node|react -d "desc"`.
- Source in `packages/<name>/src/` (or `react-packages/` for React). Build emits `dist/`.

## Releases (Maintainers)
- CI release pipeline: `pnpm ci:release` (build, lint, test, `changeset version`, `changeset publish`).

Thank you for contributing! Keep changes small, well-tested, and scoped per package for clear reviews and releases.

# `satoshibits-services`

[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier) [![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/) [![license](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/wtchnm/Vitamin/blob/main/LICENSE)

This is a monorepo for managing and publishing packages. Each package is in ESM format and automatically includes TypeScript, Vitest, Eslint, Prettier, and lint-staged.

## Getting started

To add a new package: run `./bin/add-package.sh`. Make sure to add execution permissions when running into permission errors `chmod +x add-package.sh`.

View your created package in `packages/{package_name}`.

## Features

- [TypeScript](https://www.typescriptlang.org).
- Unit testing with [Vitest](https://vitest.dev).
- [ESLint](https://eslint.org) and [Prettier](https://prettier.io)
- Better commit messages with [commitizen](https://github.com/commitizen/cz-cli)
- Safer commits with git hooks managed by [Husky](https://github.com/typicode/husky) running pre-commit scripts to run linting and type-checking against staged files only using [lint-staged](https://github.com/okonet/lint-staged).
- Intuitive versioning and publishing using [changesets](https://github.com/changesets/changesets)

## Working within the monorepo

- When introducing changes that do not require any packages to be published:

  1. Git add your changes.
  2. `pnpm run commit:cz`

- When introducing changes that should trigger a package to be published:

  1. Git add your changes. Group your changes to the relevant package.
  2. `pnpm run commit:publish`

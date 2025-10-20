import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import { globalIgnores } from "eslint/config";
import path from "node:path";

import type { TSESLint } from "@typescript-eslint/utils";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

const configs: TSESLint.FlatConfig.ConfigArray = [
  includeIgnoreFile(gitignorePath),
  globalIgnores(["./examples/"]),
  ...satoshiConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [".lintstagedrc.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // disable @typescript-eslint/unbound-method for test files
  // this rule produces false positives when checking mock methods from vi.fn()
  // mock functions are standalone objects with no `this` context dependency
  // vitest utilities (expect, vi.mocked) are designed to work with unbound mocks
  // disabling this rule for tests is standard practice in typescript + vitest projects
  {
    files: ["**/*.test.mts", "**/*.spec.mts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
];

export default configs;

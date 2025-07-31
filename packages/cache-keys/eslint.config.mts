import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import path from "node:path";

import type { TSESLint } from "@typescript-eslint/utils";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

const configs: TSESLint.FlatConfig.ConfigArray = [
  includeIgnoreFile(gitignorePath),
  ...satoshiConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            ".lintstagedrc.mjs",
            "src/__tests__/builder.test.mts",
            "src/__tests__/factory.test.mts",
            "src/__tests__/patterns.test.mts",
            "src/__tests__/presets.test.mts",
            "src/__tests__/sanitizer.test.mts"
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];

export default configs;

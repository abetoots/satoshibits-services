import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import path from "node:path";

import type { TSESLint } from "@typescript-eslint/utils";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

const configs: TSESLint.FlatConfig.ConfigArray = [
  includeIgnoreFile(gitignorePath),
  ...satoshiConfig,
  {
    name: "Global Ignores",
    ignores: [
      "examples/**",
      // plain ESM applications that subprocess tests run as a consumer would; the
      // type-aware rules have no types to work from in untyped JavaScript
      "src/__tests__/preset/subprocess/fixtures/*.mjs",
    ],
  },
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
];

export default configs;

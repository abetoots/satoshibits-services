import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import eslintPluginReact from "eslint-plugin-react";
import path from "node:path";

import type { TSESLint } from "@typescript-eslint/utils";
import type { Linter } from "eslint";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

// https://typescript-eslint.io/rules/no-misused-promises/
const config: Linter.Config = {
  rules: {
    "@typescript-eslint/no-misused-promises": [
      "error",
      /** Disables checking an asynchronous function passed as a JSX attribute expected to be a function that returns `void`. */
      { checksVoidReturn: { attributes: false } },
    ],
  },
};

const configs: TSESLint.FlatConfig.ConfigArray = [
  includeIgnoreFile(gitignorePath),
  ...satoshiConfig,
  eslintPluginReact.configs.flat.recommended as Linter.Config,
  eslintPluginReact.configs.flat["jsx-runtime"] as Linter.Config,
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
  config,
];

export default configs;

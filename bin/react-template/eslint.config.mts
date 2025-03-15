import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import eslintPluginReact from "eslint-plugin-react";
import path from "node:path";

import type { TSESLint } from "@typescript-eslint/utils";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

const configs: TSESLint.FlatConfig.ConfigArray = [
  includeIgnoreFile(gitignorePath),
  ...satoshiConfig,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat["jsx-runtime"],
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

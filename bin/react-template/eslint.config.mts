import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import eslintPluginReact from "eslint-plugin-react";
import tseslint from "typescript-eslint";
import path from "node:path";

import type { FlatConfig } from "@typescript-eslint/utils/ts-eslint";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

export default tseslint.config(
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
) satisfies FlatConfig.ConfigArray;

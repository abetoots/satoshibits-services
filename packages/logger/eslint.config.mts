import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import tseslint from "typescript-eslint";
import path from "node:path";

import type { FlatConfig } from "@typescript-eslint/utils/ts-eslint";

const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
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
) satisfies FlatConfig.ConfigArray;

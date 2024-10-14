import { includeIgnoreFile } from "@eslint/compat";
import satoshiConfig from "@satoshibits/eslint-config";
import path from "path";
const gitignorePath = path.resolve(import.meta.dirname, "../../.gitignore");
/** @type {import('eslint').Linter.Config} */
export default [
  includeIgnoreFile(gitignorePath),
  ...satoshiConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          //see https://github.com/typescript-eslint/typescript-eslint/issues/9739
            allowDefaultProject: [
            "*.js",
            ".mjs",
            ".lintstagedrc.mjs",
            "eslint.config.mjs",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];

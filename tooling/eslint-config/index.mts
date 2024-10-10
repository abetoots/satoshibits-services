import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginImportX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

import type { TSESLint } from "@typescript-eslint/utils";

//plugins define new eslint rules, and configs set whether or not (and how) the rules should be applied.
const conf: TSESLint.FlatConfig.ConfigArray = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintPluginImportX.flatConfigs.recommended,
  eslintPluginImportX.flatConfigs.typescript,
  //Turns off all rules that are unnecessary or might conflict with Prettier.
  //Note that this config only turns rules off,
  //so it only makes sense using it together with some other config.
  eslintConfigPrettier,
);

export default conf;

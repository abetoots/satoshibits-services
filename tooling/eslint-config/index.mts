import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginImportX from "eslint-plugin-import-x";
import tseslint from "typescript-eslint";

import type { TSESLint } from "@typescript-eslint/utils";

//plugins define new eslint rules, and configs set whether or not (and how) the rules should be applied.
const configs: TSESLint.FlatConfig.ConfigArray = [
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  eslintPluginImportX.flatConfigs.recommended,
  eslintPluginImportX.flatConfigs.typescript,
  {
    //emulate the TypeScript style of exempting names starting with _ from the no-unused-vars rule.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  //Turns off all rules that are unnecessary or might conflict with Prettier.
  //Note that this config only turns rules off,
  //so it only makes sense using it together with some other config.
  eslintConfigPrettier,
];

export default configs;

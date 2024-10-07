/** @typedef  {import("prettier").Config} PrettierConfig */
// /** @typedef {import("prettier-plugin-tailwindcss").PluginOptions} TailwindConfig */
/** @typedef  {import("@ianvs/prettier-plugin-sort-imports").PluginConfig} SortImportsConfig */

//NOTE: If you want custom configuration for a package, just use the overrides key.

/** @type { PrettierConfig | SortImportsConfig  } */
const config = {
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: [
    // "^(react/(.*)$)|^(react$)|^(react-native(.*)$)",
    "<THIRD_PARTY_MODULES>",
    "<BUILTIN_MODULES>",
    "",
    // "^@/components/(.*)$",
    // ".css$",
    "",
    "^@/(.*)$",
    "",
    "<TYPES>",
    "",
    "^~/",
    "^[../]",
    "^[./]",
  ],
  importOrderParserPlugins: ["typescript", "decorators-legacy"],
  importOrderTypeScriptVersion: "4.5.0",
};

export default config;

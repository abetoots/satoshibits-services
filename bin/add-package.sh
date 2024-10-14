#!/bin/bash

# Source relative to the script not the current process' working directory
# https://stackoverflow.com/questions/59895/how-to-get-the-source-directory-of-a-bash-script-from-within-the-script-itself
BIN_DIR=$(dirname "$0")
source $BIN_DIR/utils.sh

# Script that adds a package to packages workspace. This script should:
# 1. Take the package name as an argument.
# 2. Create a new directory with the package name in the packages directory.
# 3. Create a package.json file with the package name and version 1.0.0.
# 4. Create an index.mts file with a simple console.log statement.
# 5. Create a jsr.json file.
# 6. Create a tsconfig.json file.
# 7. Create an eslint.config.mjs file.
# 8. Create a vitest.config.mts file.

# Inputs
read -p "Enter package name: " package_name

# Check if package name is empty
if [ -z "$package_name" ]; then
    echo "Package name is required."
    exit 1
fi

read -p "Enter package description: " package_description

# Constants
NAMESPACE="@satoshibits"
BASE_DIR=$(pwd)

# Variables
package_dir="$BASE_DIR/packages/$package_name"


# Functions
function create_package_dir() {
    mkdir "$package_dir"
}

function create_and_install_package_json() {
    cat >"$package_dir/package.json" <<EOF
{
    "name": "$NAMESPACE/$package_name",
    "version": "0.0.0",
    "main": "./dist/index.mjs",
    "types": "./dist/index.d.mts",
    "type": "module",
    "private": false,
    "scripts": {
        "build": "rm -rf dist && tsc",
        "lint": "pnpm exec eslint --flag unstable_ts_config .",
        "prepublishOnly": "npm run build",
        "pre-commit": "pnpm exec lint-staged -c ./.lintstagedrc.mjs",
        "test": "vitest --run"
    },
    "files": [
        "./dist/**/*",
        "!./dist/**/*.test.*"
    ],
    "keywords": [
        "$package_name"
    ],
    "author": {
        "name": "Abe M. Caymo",
        "email": "caymo.abesuni@gmail.com",
        "url": "https://github.com/abetoots"
    },
    "license": "ISC",
    "description": "$package_description",
    "devDependencies": {
        "@eslint/compat": "^1.2.0",
        "@repo/typescript-config": "workspace:^",
        "@satoshibits/eslint-config": "workspace:^",
        "@types/node": "^22.7.4",
        "@typescript-eslint/utils": "^8.8.1",
        "eslint": "^9.12.0",
        "jiti": "^2.3.3",
        "lint-staged": "^15.2.10",
        "typescript": "^5.6.3",
    }
}
EOF

pnpm i vitest -D --filter "$NAMESPACE/$package_name" 2>&1 | dim_text # Install and dim the output
}

function create_index_mts() {
    mkdir "$package_dir/src"
    cat >"$package_dir/src/index.mts" <<EOF
console.log("Hello, $package_name!");
EOF
}

function create_jsr_json() {
    cat >"$package_dir/jsr.json" <<EOF
{
  "\$schema": "https://jsr.io/schema/config-file.v1.json",
  "name": "@satoshibits/$package_name",
  "description": "$package_description",
  "version": "0.0.0",
  "exports": "./src/index.mts",
  "license": "ISC"
}

EOF
}

function create_tsconfig_json() {
    cat >"$package_dir/tsconfig.json" <<EOF
{
  "extends": "@repo/typescript-config/base.json",
  "include": ["src"],
  "compilerOptions": {
    "lib": ["ESNext"],
    "outDir": "dist"
  },
  "references": [{ "path": "./tsconfig.node.json" }]
}
EOF

cat > "$package_dir/tsconfig.node.json" <<EOF
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strictNullChecks": true,
    "types": ["vitest", "node"]
  },
  "include": ["vitest.config.mts", "eslint.config.mts"]
}
EOF
}

function create_eslint_config_mjs() {
    cat >"$package_dir/eslint.config.mts" <<EOF
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

EOF
}

function create_test_related_files() {
    cat >"$package_dir/vitest.config.mts" <<EOF
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true
  },
});

EOF
}

function create_misc_files() {
    cat > "$package_dir/.lintstagedrc.mjs" <<EOF
export default {
    // Lint staged passes the filenames as an argument to the command
    // If you want to pass --project to tsc, use the arrow function syntax
    // Note: Using project will defeat the purpose of lint-staged
    //since it will type check files specified in tsconfig.json, not just the staged ones
    //see: https://github.com/lint-staged/lint-staged/issues/825
    "*.{js,ts,mts,mjs}": [
        "eslint --fix --flag unstable_ts_config",
        "./tsc-lintstaged.sh",
    ],
};
EOF

    cat >"$package_dir/tsc-lintstaged.sh" <<EOF
#!/bin/bash -e
#Remember to add execution permission to the file 
#if you encounter permission denied error

#Attribution: https://stackoverflow.com/questions/44676944/how-to-compile-a-specific-file-with-tsc-using-the-paths-compiler-option

TMP=.tsconfig-lint.json
cat > \$TMP << HEREDOC
{
  "extends": "./tsconfig.json",
  "include": [
HEREDOC
for file in "\$@"; do
  echo "    \"\$file\"," >> \$TMP
done
cat >> \$TMP <<HEREDOC
    "**/*.d.ts"
  ]
}
HEREDOC
FILES_WITH_ERRORS=\$(pnpm exec tsc --project \$TMP --noEmit --skipLibCheck | cut -d '(' -f 1); for file in "\$@"; do grep -v "\$file"<<<"\$FILES_WITH_ERRORS" >/dev/null; done
EOF

chmod +x "$package_dir/tsc-lintstaged.sh"

}

# Main script logic
create_package_dir
create_index_mts
create_jsr_json
create_tsconfig_json
create_eslint_config_mjs
create_test_related_files
create_misc_files
create_and_install_package_json

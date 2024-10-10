#!/bin/bash

# Source relative to the script not the current process' working directory
# https://stackoverflow.com/questions/59895/how-to-get-the-source-directory-of-a-bash-script-from-within-the-script-itself
BIN_DIR=$(dirname "$0")
source $BIN_DIR/utils.sh

# # Script that adds a package to packages workspace. This script should:
# # 1. Take the package name as an argument.
# # 2. Create a new directory with the package name in the packages directory.
# # 3. Create a package.json file with the package name and version 1.0.0.
# # 4. Create an index.mts file with a simple console.log statement.
# # 5. Create a jsr.json file.
# # 6. Create a tsconfig.json file.
# # 7. Create an eslint.config.mjs file.

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
        "lint" : "eslint .",
        "prepublishOnly": "npm run build",
        "pre-commit": "pnpm exec lint-staged -c ./.lintstagedrc.mjs",
    },
    "files": [
        "./dist/**/*"
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
        "lint-staged": "^15.2.10"
    }
}
EOF

pnpm i --filter "$NAMESPACE/$package_name" 2>&1 | dim_text # Install and dim the output
}

function create_index_mts() {
    cat >"$package_dir/index.mts" <<EOF
console.log("Hello, $package_name!");
EOF
}

function create_jsr_json() {
    cat >"$package_dir/jsr.json" <<EOF
{
  "\$schema": "https://jsr.io/schema/config-file.v1.json",
  "name": "@satoshibits/$package_name",
  "description": "$package_description",
  "version": "1.0.0",
  "exports": "./index.mts",
  "license": "ISC"
}

EOF
}

function create_tsconfig_json() {
    cat >"$package_dir/tsconfig.json" <<EOF
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "lib": ["ESNext"],
    "outDir": "dist"
  },
  "exclude": ["dist", "node_modules"]
}
EOF
}

function create_eslint_config_mjs() {
    cat >"$package_dir/eslint.config.mjs" <<EOF
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
          allowDefaultProject: ["*.js", "*.mjs", ".lintstagedrc.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
EOF
}

function create_misc_files() {
    cat > "$package_dir/.linstagedrc.mjs" <<EOF
export default {
    // Lint staged passes the filenames as an argument to the command
    // If you want to pass --project to tsc, use the arrow function syntax
    // Note: Using project will defeat the purpose of lint-staged
    //since it will type check files specified in tsconfig.json, not just the staged ones
    //see: https://github.com/lint-staged/lint-staged/issues/825
    "*.{js,ts,mts,mjs}": ["eslint --fix", "./tsc-lintstaged.sh"],
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
FILES_WITH_ERRORS=\$(tsc --project \$TMP --noEmit --skipLibCheck | cut -d '(' -f 1); for file in "\$@"; do grep -v "\$file"<<<"\$FILES_WITH_ERRORS" >/dev/null; done
EOF
}

# Main script logic
create_package_dir
create_index_mts
create_jsr_json
create_tsconfig_json
create_eslint_config_mjs
create_misc_files
create_and_install_package_json

#!/bin/bash -e
#Remember to add execution permission to the file 
#if you encounter permission denied error

#Attribution: https://stackoverflow.com/questions/44676944/how-to-compile-a-specific-file-with-tsc-using-the-paths-compiler-option

TMP=.tsconfig-lint.json
cat > $TMP << HEREDOC
{
  "extends": "./tsconfig.json",
  "include": [
HEREDOC
for file in "$@"; do
  echo "    \"$file\"," >> $TMP
done
cat >> $TMP <<HEREDOC
    "**/*.d.ts"
  ]
}
HEREDOC
FILES_WITH_ERRORS=$(pnpm exec tsc --project $TMP --noEmit --skipLibCheck | cut -d '(' -f 1); for file in "$@"; do grep -v "$file"<<<"$FILES_WITH_ERRORS" >/dev/null; done

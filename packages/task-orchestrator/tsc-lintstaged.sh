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
# pnpm exec tsc --project $TMP --noEmit --skipLibCheck
# Run tsc and capture output
TSC_OUTPUT=$(pnpm exec tsc --project $TMP --noEmit --skipLibCheck 2>&1 || true)

# Print tsc output for debugging
echo "$TSC_OUTPUT"

# Extract file paths with errors
FILES_WITH_ERRORS=$(echo "$TSC_OUTPUT" | grep -o '^[^(]*' | sed 's/:[0-9]*:[0-9]* - .*$//' | sort -u)

# Compare with input files
for file in "$@"; do
    # Get basename of file (remove directory path)
    BASENAME=$(basename "$file")
    # Check if any error file ends with the basename
    if echo "$FILES_WITH_ERRORS" | grep -q "[/]*$BASENAME$"; then
        echo "Error in file: $file"
        exit 1
    fi
done

# If we get here, no errors were found in the staged files
echo "No errors in staged files"

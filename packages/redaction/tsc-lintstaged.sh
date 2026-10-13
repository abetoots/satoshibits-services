#!/bin/bash -e
#Remember to add execution permission to the file 
#if you encounter permission denied error

#Attribution: https://stackoverflow.com/questions/44676944/how-to-compile-a-specific-file-with-tsc-using-the-paths-compiler-option

# Initialize empty array for files to skip
NODE_INCLUDED_FILES=()

# Dynamically get files from tsconfig.node.json if it exists
TSCONFIG_NODE="./tsconfig.node.json"
if [[ -f "$TSCONFIG_NODE" ]]; then
  echo "Found $TSCONFIG_NODE, extracting files to skip..."
  # Check if jq is available
  if command -v jq >/dev/null 2>&1; then
    # Use jq to extract the include array
    INCLUDES=$(jq -r '.include[]' "$TSCONFIG_NODE" 2>/dev/null || echo "")
    if [[ -n "$INCLUDES" ]]; then
      # Convert output to array
      readarray -t NODE_INCLUDED_FILES <<< "$INCLUDES"
      echo "Files to skip from tsconfig.node.json: ${NODE_INCLUDED_FILES[*]}"
    fi
  else
    # Fallback to grep/sed if jq is not available
    echo "jq not found, using fallback method to parse JSON"
    INCLUDE_LINE=$(grep -A 10 '"include"' "$TSCONFIG_NODE" | grep -v "^[[:space:]]*//")
    if [[ -n "$INCLUDE_LINE" ]]; then
      # Extract values between quotes after [
      INCLUDES=$(echo "$INCLUDE_LINE" | grep -o '"[^"]*"' | tr -d '"')
      if [[ -n "$INCLUDES" ]]; then
        readarray -t NODE_INCLUDED_FILES <<< "$INCLUDES"
        echo "Files to skip from tsconfig.node.json: ${NODE_INCLUDED_FILES[*]}"
      fi
    fi
  fi
else
  echo "No tsconfig.node.json found, not skipping any files"
fi

TMP=.tsconfig-lint.json
cat > $TMP << HEREDOC
{
  "extends": "./tsconfig.json",
  "include": [
HEREDOC
for file in "$@"; do
  # Extract the filename without path
  filename=$(basename "$file")
  
  # Check if the file is already included in tsconfig.node.json
  skip=false
  for included in "${NODE_INCLUDED_FILES[@]}"; do
    if [[ "$filename" == "$included" ]]; then
      echo "Skipping $file as it's already included in tsconfig.node.json"
      skip=true
      break
    fi
  done
  
  # Add the file to the temporary tsconfig only if it's not already included
  if [[ "$skip" == false ]]; then
    echo "    \"$file\"," >> $TMP
  fi
done
cat >> $TMP <<HEREDOC
    "**/*.d.ts"
  ]
}
HEREDOC
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

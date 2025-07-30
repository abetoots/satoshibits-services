#!/bin/bash

# rename all .ts files to .mts and update imports
find src -name "*.ts" -type f | while read file; do
  # skip test files
  if [[ $file == *.test.ts ]]; then
    newfile="${file%.test.ts}.test.mts"
  else
    newfile="${file%.ts}.mts"
  fi
  
  echo "Renaming $file to $newfile"
  mv "$file" "$newfile"
done

# update all imports from .js to .mjs in .mts files
find src -name "*.mts" -type f | while read file; do
  echo "Updating imports in $file"
  # update imports from './xxx.js' to './xxx.mjs'
  sed -i "s/from '\\.\\(.*\\)\\.js'/from '.\\1.mjs'/g" "$file"
  sed -i 's/from "\\.\\(.*\\)\\.js"/from ".\\1.mjs"/g' "$file"
done

echo "Done! All files renamed and imports updated."
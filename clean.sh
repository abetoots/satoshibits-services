#!/usr/bin/env bash

# cleanup script for satoshibits-services monorepo
# removes dist, node_modules, and .turbo directories from all packages

set -e

echo "🧹 Cleaning up packages..."

# clean each package in packages/*
for package_dir in packages/*/; do
  if [ -d "$package_dir" ]; then
    package_name=$(basename "$package_dir")
    echo "  Cleaning $package_name..."

    # remove dist directory
    if [ -d "${package_dir}dist" ]; then
      rm -rf "${package_dir}dist"
      echo "    ✓ Removed dist/"
    fi

    # remove node_modules directory
    if [ -d "${package_dir}node_modules" ]; then
      rm -rf "${package_dir}node_modules"
      echo "    ✓ Removed node_modules/"
    fi

    # remove .turbo directory
    if [ -d "${package_dir}.turbo" ]; then
      rm -rf "${package_dir}.turbo"
      echo "    ✓ Removed .turbo/"
    fi
  fi
done

echo ""
echo "✨ Cleanup complete!"
echo ""
echo "To also clean root directories, run:"
echo "  rm -rf node_modules .turbo"

# vite-plugin-swc

A Vite plugin that uses SWC to transform TypeScript files, providing better performance and support for advanced TypeScript features like decorators.

## Features

- Fast TypeScript transformation using [SWC](https://swc.rs/)
- Support for legacy decorators
- Customizable transformation options
- Works alongside or replaces ESBuild

## Installation

```bash
# Using npm
npm install @satoshibits/vite-plugin-swc --save-dev

# Using yarn
yarn add @satoshibits/vite-plugin-swc --dev

# Using pnpm
pnpm add @satoshibits/vite-plugin-swc --save-dev
```

## Usage

### Basic Usage

Add the plugin to your Vite config:

```typescript
// vite.config.ts
import { swc } from "@satoshibits/vite-plugin-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [swc()],
});
```

### Configuration Options

The plugin accepts all [SWC options](https://swc.rs/docs/configuration/swcrc) except for `filename` and `sourceFileName` which are handled internally.

```typescript
swc({
  include: /\.ts$/, // Files to include (default: /\.ts?$/)
  exclude: "node_modules", // Files to exclude (default: 'node_modules')
  swcrc: false, // Whether to use .swcrc file
  configFile: false, // Whether to use swc.config.js file
  minify: true, // Whether to minify the code
  jsc: {
    parser: {
      syntax: "typescript",
      decorators: true,
    },
    transform: {
      decoratorMetadata: true,
      decoratorVersion: "2022-03",
    },
  },
});
```

## Examples

### Example 1: Replacing ESBuild Entirely

To completely replace ESBuild with SWC for all transformations, disable the built-in ESBuild TypeScript plugin and configure the SWC plugin to handle all TypeScript/JavaScript files:

```typescript
// vite.config.ts
import { swc } from "@satoshibits/vite-plugin-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    swc({
      include: /\.(tsx?|jsx?)$/, // Handle both TS and JS files
      jsc: {
        parser: {
          syntax: "typescript",
          tsx: true, // Enable JSX/TSX support
          decorators: true,
        },
        transform: {
          decoratorMetadata: true,
          decoratorVersion: "2022-03",
        },
      },
    }),
  ],
  // Disable esbuild entirely
  esbuild: false,
});
```

### Example 2: Selective Transformations

To use SWC specifically for TypeScript files that have legacy decorators, while letting ESBuild handle other files:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { swc } from '@satoshibits/vite-plugin-swc';

export default defineConfig({
  plugins: [
    swc({
      // Only process TypeScript files that might contain decorators
      include: /\.ts$/,
      // Default options are already set for decorator support
      jsc: {
        parser: {
          syntax: "typescript",
          decorators: true,
        },
        transform: {
            legacyDecorator: true,
            decoratorMetadata: true, // This enables emitDecoratorMetadata
        }
      }
    })
  ]
  // ESBuild will still process other files by default
   esbuild: {
    exclude: [/\.ts$/]
  }
});
```

## How It Works

This plugin uses SWC to transform files that match the include/exclude patterns. SWC is significantly faster than Babel and provides better compatibility with legacy decorators compared to ESBuild.

When a file is processed:

1. The plugin checks if the file matches the include/exclude patterns
2. If it matches, SWC transforms the file using the provided options
3. The transformed code is then passed to the next plugin in the pipeline

## License

MIT

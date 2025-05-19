# Vite Worker Plugin

A Vite plugin that fixes web worker issues in development mode, particularly the common `Uncaught SyntaxError: Cannot use import statement outside a module` error.

## Problem

Vite handles web workers differently in development mode compared to production:

- In **production**, Vite bundles web workers and automatically adds the necessary configurations
- In **development**, Vite doesn't process workers the same way, leading to errors when using import statements in classic workers

## Solution

This plugin automatically transforms classic web workers to use `{ type: 'module' }` in development mode, ensuring consistent behavior between development and production builds.

## Installation

```bash
npm install vite-worker-plugin --save-dev
```

## Usage

Add the plugin to your `vite.config.ts` file:

```typescript
import { defineConfig } from "vite";
import viteWorkerPlugin from "vite-worker-plugin";

export default defineConfig({
  plugins: [viteWorkerPlugin()],
});
```

## Features

- Automatically transforms `new Worker()` calls to use `{ type: 'module' }` in development
- Handles both string literals and variable-based worker paths
- No configuration needed, works out of the box

## Example

Before:

```javascript
// This code works in production but fails in development
const worker = new Worker("./my-worker.js");
```

After:

```javascript
// The plugin transforms this during development
const worker = new Worker("./my-worker.js", { type: "module" });
```

## Notes

- The plugin only applies transformations in development mode
- For complex worker instantiation patterns, you may need to manually add `{ type: 'module' }`

## License

MIT

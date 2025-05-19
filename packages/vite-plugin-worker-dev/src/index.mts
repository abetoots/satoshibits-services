import * as esbuild from "esbuild";
import { PluginOption, ResolvedConfig } from "vite";

// Regular expressions to detect worker imports
const WORKER_IMPORT_RE = /new\s+Worker\s*\(\s*['"`](.+?)['"`]\s*\)/g;
// Improved regex to handle complex expressions like function calls, using non-greedy matching for intermediate parts
const WORKER_CONSTRUCTOR_RE =
  /new\s+Worker\s*\(\s*([^'"`\s][^,)]*?(?:\([^)]*\)[^,)]*?)*)\s*\)/g;

/**
 * ViteWorkerPlugin - Fixes web workers in development mode using esbuild
 *
 * This plugin uses esbuild to bundle worker files in development mode,
 * ensuring consistency with production behavior.
 */
export default function viteWorkerPlugin(): PluginOption {
  let config: ResolvedConfig;
  const workerCache = new Map<string, string>();
  const processedIds = new Set<string>();

  return {
    name: "vite-plugin-worker-dev",

    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },

    //https://rollupjs.org/plugin-development/#load
    async load(id) {
      // Only process in development
      if (config.command !== "serve") return null;

      const isWorkerQueryImport = id.includes("?worker");
      let cleanPath = id;

      if (isWorkerQueryImport) {
        cleanPath = id.substring(0, id.indexOf("?"));
      }

      // If this isn't a file we've identified as a worker (via resolveId using cleanPath)
      // AND it's not an explicit ?worker import, then skip.
      if (!processedIds.has(cleanPath) && !isWorkerQueryImport) {
        return null;
      }

      // Check if we've already processed this worker
      if (workerCache.has(id)) {
        return workerCache.get(id); // This should be the processedCode that exports the URL
      }

      try {
        // Use esbuild to bundle the worker
        const result = await esbuild.build({
          entryPoints: [cleanPath], // Pass the clean path to esbuild
          bundle: true,
          write: false,
          format: "iife",
          platform: "browser",
          mainFields: ["module", "main"],
          minify: false,
          outfile: "out.js",
        });

        console.log("[esbuild] Worker build result:", result);

        if (result.outputFiles && result.outputFiles.length > 0) {
          const bundledCode = result.outputFiles[0]?.text;

          // Create a blob URL-friendly version
          const processedCode = `
      // Bundled with esbuild by vite-worker-plugin
      const code = ${JSON.stringify(bundledCode)};
      const blob = new Blob([code], { type: 'application/javascript' });
      export default URL.createObjectURL(blob);
      `;

          // Path 1: ID has '?worker' in it
          if (isWorkerQueryImport) {
            // Cache the result
            workerCache.set(id, processedCode);
          }
          return processedCode;
        }
      } catch (error) {
        console.error(
          `[vite-worker-plugin] Error bundling worker ${id}:`,
          error,
        );
      }

      return null;
    },

    //https://rollupjs.org/plugin-development/#transform
    transform(code) {
      // Only process in development
      if (config.command !== "serve") return null;

      // Skip if no Worker constructor is present
      if (!code.includes("new Worker")) return null;

      let result = code;

      // Handle string-based worker paths
      const workerImports = Array.from(code.matchAll(WORKER_IMPORT_RE));
      for (const match of workerImports) {
        const [fullMatch, workerPath] = match;

        // Transform to use dynamic import + module type
        const importPath = JSON.stringify(workerPath + "?worker");
        const replacement = `import(${importPath}).then(mod => new Worker(mod.default, { type: 'module' }))`;
        result = result.replace(fullMatch, replacement);
      }

      // Handle variable-based worker paths (more complex)
      const workerConstructors = Array.from(
        code.matchAll(WORKER_CONSTRUCTOR_RE),
      );
      for (const match of workerConstructors) {
        const [fullMatch, workerExpr] = match;

        // Skip if it already includes options
        if (fullMatch.includes(",")) continue;

        // Add module type option
        const replacement = `new Worker(${workerExpr}, { type: 'module' })`;
        result = result.replace(fullMatch, replacement);
      }

      return result !== code ? { code: result, map: null } : null;
    },
  };
}

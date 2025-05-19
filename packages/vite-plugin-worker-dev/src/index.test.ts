import * as esbuild from "esbuild";
import { Plugin } from "vite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import viteWorkerPlugin from "./index.mjs";

// Stub esbuild.build
vi.mock("esbuild", () => ({
  build: vi.fn(),
}));

const mockedEsbuild = vi.mocked(esbuild.build);

const simulateSuccessfulLoad = async (id: string, plugin: Plugin) => {
  // Mock the esbuild build function to return a successful result
  mockedEsbuild.mockResolvedValueOnce({
    outputFiles: [
      {
        text: "console.log(123);",
        path: "out.js",
        contents: new Uint8Array(),
        hash: "",
      },
    ],
    warnings: [],
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    metafile: {} as any,
    errors: [],
    mangleCache: {},
  });

  // Simulate the load function - always await the promise
  //@ts-expect-error type issue
  const result = (await plugin.load?.(id)) as Promise<string>;
  return result;
};

const simulateTransform = (code: string, id: string, plugin: Plugin) => {
  //@ts-expect-error type issue
  const result = plugin.transform(code, id) as {
    code: string;
    map: null;
  } | null;
  return result;
};

describe("viteWorkerPlugin", () => {
  let plugin: Plugin = viteWorkerPlugin() as Plugin;

  beforeEach(() => {
    // Reset mocks and create fresh plugin instance
    vi.resetAllMocks();
    vi.resetModules();
    plugin = viteWorkerPlugin() as Plugin;
    // Simulate Vite serve mode
    //@ts-expect-error type issue
    plugin.configResolved({ command: "serve" });
  });

  // Plugin Creation Tests
  describe("Plugin Initialization", () => {
    it("should be properly initialized", () => {
      expect(plugin.name).toBe("vite-plugin-worker-dev");
      expect(plugin.configResolved).toBeTypeOf("function");
      expect(plugin.load).toBeTypeOf("function");
      expect(plugin.transform).toBeTypeOf("function");
    });
  });

  describe("1. configResolved hook", () => {
    it('should allow other hooks to function when command is "serve"', async () => {
      //@ts-expect-error type issue
      plugin.configResolved({ command: "serve" });
      const loadResult = await simulateSuccessfulLoad(
        "successful.js?worker",
        plugin,
      );
      expect(loadResult).not.toBeNull();
      const transformResult = simulateTransform(
        "const w = new Worker('foo.js');",
        "/src/main.js",
        plugin,
      );
      expect(transformResult).not.toBeNull();
    });
    it('should prevent other hooks from functioning when command is "build"', async () => {
      //@ts-expect-error type issue
      plugin.configResolved({ command: "build" });
      const loadResult = await simulateSuccessfulLoad(
        "successful.js?worker",
        plugin,
      );
      expect(loadResult).toBeNull();
      const transformResult = simulateTransform(
        "const w = new Worker('foo.js');",
        "/src/main.js",
        plugin,
      );
      expect(transformResult).toBeNull();
    });
  });

  describe("2. load hook", () => {
    it("should bundle worker via esbuild and return processedCode", async () => {
      const loadResult = await simulateSuccessfulLoad(
        "successful.js?worker",
        plugin,
      );

      expect(mockedEsbuild).toHaveBeenCalledTimes(1);
      // Expect a blob-wrapping module
      expect(loadResult).toContain("new Blob");
      expect(loadResult).toContain(JSON.stringify("console.log(123);"));
      expect(loadResult).toContain("URL.createObjectURL");
    });

    it("should cache processedCode and not call esbuild twice", async () => {
      const firstResult = await simulateSuccessfulLoad(
        "successful.js?worker",
        plugin,
      );
      const secondResult = await simulateSuccessfulLoad(
        "successful.js?worker",
        plugin,
      );

      expect(mockedEsbuild).toHaveBeenCalledTimes(1);
      expect(firstResult).toStrictEqual(secondResult);
    });

    it("should return null for non-worker ids", async () => {
      //@ts-expect-error type issue
      const result = (await plugin.load("/src/other.js")) as null;
      expect(result).toBeNull();
    });

    it("should handle esbuild errors gracefully", async () => {
      const id = "failed.js?worker";
      // Mock esbuild to simulate an error
      mockedEsbuild.mockRejectedValueOnce(new Error("esbuild error"));

      //@ts-expect-error type issue
      const result = (await plugin.load(id)) as string;

      expect(result).toBeNull();
      expect(mockedEsbuild).toHaveBeenCalledTimes(1);
    });
  });

  describe("3. transform hook", () => {
    it("should rewrite string-based new Worker paths to dynamic import with ?worker", () => {
      const code = `const w = new Worker('foo.js');`;
      const id = "/src/workerTest.js";
      const transformResult = simulateTransform(code, id, plugin);

      expect(transformResult).not.toBeNull();
      const transformed = transformResult!.code;
      expect(transformed).toContain(`import("foo.js?worker")`);
      expect(transformed).toMatch(
        /new Worker\(mod\.default, \{ type: 'module' \}\)/,
      );
    });

    it('should add { type: "module" } to variable-based Worker constructors', () => {
      const code = `const url = getUrl(); const w = new Worker(url);`;
      const id = "/src/workerTest.js";
      const transformResult = simulateTransform(code, id, plugin);

      expect(transformResult).not.toBeNull();
      const transformed = transformResult!.code;
      expect(transformed).toContain(`new Worker(url, { type: 'module' })`);
    });

    it('should add {type: "module"} to expression-based Worker constructors', () => {
      const code = "const w = new Worker(getPath() + '/worker.js')";
      const id = "/src/workerTest.js";
      const transformResult = simulateTransform(code, id, plugin);
      expect(transformResult).not.toBeNull();
      const transformed = transformResult!.code;
      expect(transformed).toContain(
        `new Worker(getPath() + '/worker.js', { type: 'module' })`,
      );
    });

    it("should handle multiple Worker declarations in one file", () => {
      const code = `
            const w1 = new Worker('worker1.js');
            const w2 = new Worker('worker2.js');
        `;
      const id = "/src/workerTest.js";
      const transformResult = simulateTransform(code, id, plugin);

      expect(transformResult).not.toBeNull();
      const transformed = transformResult!.code;
      expect(transformed).toContain(`import("worker1.js?worker")`);
      expect(transformed).toContain(`import("worker2.js?worker")`);
    });

    it("should return null when no new Worker call is present", () => {
      const code = `console.log('no workers here');`;
      const id = "/src/clean.js";
      const transformResult = simulateTransform(code, id, plugin);

      expect(transformResult).toBeNull();
    });
  });
});

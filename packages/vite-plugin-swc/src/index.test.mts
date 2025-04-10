// Import the mocked transform function after mocking
import { transform as SWCTransform } from "@swc/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { swc } from "./index.mjs";

// Mock dependencies
vi.mock("@swc/core", () => ({
  transform: vi.fn().mockResolvedValue({
    code: "transformed code",
    map: "source map",
  }),
}));

// vi.mock("@rollup/pluginutils", () => ({
//   createFilter: vi.fn((include, exclude) => {
//     return (id: string) => {
//       if (typeof include === "string" && id.includes(include)) return true;
//       if (include instanceof RegExp && include.test(id)) return true;
//       if (Array.isArray(include)) {
//         for (const pattern of include) {
//           if (typeof pattern === "string" && id.includes(pattern)) return true;
//           if (pattern instanceof RegExp && pattern.test(id)) return true;
//         }
//       }

//       if (typeof exclude === "string" && id.includes(exclude)) return false;
//       if (exclude instanceof RegExp && exclude.test(id)) return false;
//       if (Array.isArray(exclude)) {
//         for (const pattern of exclude) {
//           if (typeof pattern === "string" && id.includes(pattern)) return false;
//           if (pattern instanceof RegExp && pattern.test(id)) return false;
//         }
//       }

//       // Default behavior of createFilter if include is undefined
//       return include === undefined ? true : false;
//     };
//   }),
// }));

describe("vite-plugin-swc", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should create a plugin with the correct name and enforce property", () => {
    const plugin = swc();
    expect(plugin.name).toBe("vite-plugin-swc");
    expect(plugin.enforce).toBe("pre");
  });

  it("should use default options when none are provided", () => {
    const plugin = swc();
    expect(plugin).toBeDefined();
  });

  it("should transform TypeScript files by default", async () => {
    const plugin = swc();
    const code = "const x: number = 5;";
    const id = "file.ts";

    await plugin.transform?.(code, id);

    expect(SWCTransform).toHaveBeenCalledWith(
      code,
      expect.objectContaining({
        filename: id,
        sourceFileName: id,
      }),
    );
  });

  it("should not transform files that don't match the filter", async () => {
    const plugin = swc();
    const code = "const x = 5;";
    const id = "file.js";

    const result = await plugin.transform?.(code, id);

    expect(result).toBeUndefined();
    expect(SWCTransform).not.toHaveBeenCalled();
  });

  it("should honor custom include patterns", async () => {
    const plugin = swc({
      include: /\.jsx?$/,
    });

    const code = "const x = 5;";
    const id = "file.js";

    await plugin.transform?.(code, id);

    expect(SWCTransform).toHaveBeenCalledWith(
      code,
      expect.objectContaining({
        filename: id,
        sourceFileName: id,
      }),
    );
  });

  it("should honor custom exclude patterns", async () => {
    const plugin = swc({
      include: /\.(ts|js)x?$/,
      exclude: ["node_modules/**", "dist/**"],
    });

    const code = "const x = 5;";
    const id = "dist/file.js";

    const result = await plugin.transform?.(code, id);

    expect(result).toBeUndefined();
  });

  it("should pass custom SWC options to the transform function", async () => {
    const customOptions = {
      minify: false,
      jsc: {
        parser: {
          syntax: "ecmascript" as const,
          jsx: true,
        },
        target: "es2020" as const,
      },
    };

    const plugin = swc({
      include: /\.jsx?$/,
      ...customOptions,
    });

    const code = "const x = 5;";
    const id = "file.js";

    await plugin.transform?.(code, id);

    expect(SWCTransform).toHaveBeenCalledWith(
      code,
      expect.objectContaining({
        filename: id,
        sourceFileName: id,
        minify: false,
        jsc: {
          parser: {
            syntax: "ecmascript",
            jsx: true,
          },
          target: "es2020",
        },
      }),
    );
  });

  it("should handle files with query parameters correctly", async () => {
    const plugin = swc();
    const code = "const x: number = 5;";
    const id = "file.ts?query=param";

    await plugin.transform?.(code, id);

    expect(SWCTransform).toHaveBeenCalledWith(
      code,
      expect.objectContaining({
        filename: "file.ts",
        sourceFileName: "file.ts",
      }),
    );
  });
});

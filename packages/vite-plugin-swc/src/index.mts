import { createFilter, FilterPattern } from "@rollup/pluginutils";
import { Options as SWCOption, transform as SWCTransform } from "@swc/core";

import type { PluginOption } from "vite";

interface Options extends Omit<SWCOption, "filename" | "sourceFileName"> {
  include?: FilterPattern;
}

export const swc = (
  options: Options = {
    include: /\.ts?$/,
    exclude: "node_modules",
    swcrc: false,
    configFile: false,
    minify: true,
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
  },
): PluginOption => {
  const { include, ...swcOptions } = options;
  const filter = createFilter(options.include, options.exclude);
  return {
    name: "vite-plugin-swc",
    enforce: "pre",
    transform(code: string, id: string) {
      const sourceFileName = id.split("?", 1)[0];
      if (filter(id) || filter(sourceFileName)) {
        return SWCTransform(code, {
          filename: sourceFileName,
          sourceFileName,
          ...swcOptions,
        });
      }
    },
  };
};

export default swc;

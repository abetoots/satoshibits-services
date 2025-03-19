import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

import { peerDependencies } from "./package.json";

const componentPackagePath = path.resolve(__dirname, "src", "index.mts");

// https://vitejs.dev/config/
export default defineConfig({
  test: {
    globals: true,
    include: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
    environment: "happy-dom",
    setupFiles: "./src/setupTests.ts",
  },
  build: {
    lib: {
      entry: componentPackagePath,
      name: "ReactJsonSchemaBuilder",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format}.js`,
    },
    rollupOptions: {
      //https://stackoverflow.com/questions/66194269/typeerror-cannot-read-propertyreactcurrentdispatcherof-undefined
      external: [...Object.keys(peerDependencies), "react/jsx-runtime"],
      output: { preserveModules: true, exports: "named" },
    },
    sourcemap: true,
    target: "esnext",
    emptyOutDir: true,
  },
  plugins: [
    // resolves paths from tsconfig.json
    tsconfigPaths(),
    // recommended way to use tailwindcss with Vite since v4
    tailwindcss(),
    react(),
    // generates declaration files for tsx files when using Vite
    // in library mode. you should set noEmit to true in your tsconfig.json
    // to avoid duplicate declaration files
    dts(),
  ],
});

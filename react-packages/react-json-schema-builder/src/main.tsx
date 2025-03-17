import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { SchemaProvider } from "@/packages/builder/context";
import Dev from "./dev";
import { PluginsProvider } from "@/packages/constraints/context";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SchemaProvider>
      <PluginsProvider>
        <h1 className="mb-6">
          We are developing packaged React components with Vite and TypeScript.
        </h1>
        <Dev />
      </PluginsProvider>
    </SchemaProvider>
  </StrictMode>,
);

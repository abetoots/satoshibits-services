/// <reference types="vite/client" />
import { createRoot } from "react-dom/client";
import css from "../dist/style.css?raw";
import { SchemaProvider } from "@/packages/builder/context";
import { SchemaBuilder } from "@/packages/builder/schema-builder";
import { EnumEditor } from "@/packages/builder/enum-editor";
import { createTestSchema } from "@/packages/builder/utils";
import { PluginsProvider } from "@/packages/constraints/context";
import { NumberConstraintPlugin } from "@/packages/plugins/number";
import { StringConstraintPlugin } from "@/packages/plugins/string";
import { ArrayConstraintPlugin } from "@/packages/plugins/array";
import { ObjectConstraintPlugin } from "@/packages/plugins/object";
import { EnumConstraintPlugin } from "@/packages/plugins/enum";

// the shipped sheet, injected raw so no vite css plugin touches it
const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
document.title = "rjsb render harness";

// ?dark=html|body puts the dark class on that element before the render
const dark = new URLSearchParams(location.search).get("dark");
if (dark === "html") document.documentElement.classList.add("dark");
if (dark === "body") document.body.classList.add("dark");

const plugins = [
  NumberConstraintPlugin,
  StringConstraintPlugin,
  ArrayConstraintPlugin,
  ObjectConstraintPlugin,
  EnumConstraintPlugin,
];

createRoot(document.getElementById("root")!).render(
  <SchemaProvider>
    <PluginsProvider>
      <SchemaBuilder
        initialSchema={createTestSchema()}
        plugins={plugins}
        onPropertyAddSuccess={() => { document.body.dataset.addOk = String(Number(document.body.dataset.addOk ?? 0) + 1); }}
        onPropertyAddError={() => { document.body.dataset.addError = String(Number(document.body.dataset.addError ?? 0) + 1); }}
        addPropertyButtonComponent={new URLSearchParams(location.search).get("add") === "custom"
          ? ({ onClick }) => <button type="button" onClick={onClick}>Custom add</button>
          : undefined}
      />
      <EnumEditor propertyType={["string", "number", "boolean", "null"]} />
    </PluginsProvider>
  </SchemaProvider>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { CustomComponent } from "@/packages/sample";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <>
      <h1>
        We are developing packaged React components with Vite and TypeScript.
      </h1>
      <CustomComponent sample="Hi there!" />
    </>
  </StrictMode>,
);

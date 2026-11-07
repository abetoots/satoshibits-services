import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const pkgRoot = path.resolve(import.meta.dirname, "../..");
const fixtures = path.join(pkgRoot, "tests/css/fixtures");
const tailwindBin = path.join(pkgRoot, "node_modules/.bin/tailwindcss");

const apps = ["websand-like", "shadcn-v3-like", "plain"] as const;
const orders = ["library-last", "library-first"] as const;
type App = (typeof apps)[number];
type Order = (typeof orders)[number];

const appCss = {} as Record<App, string>;
let libraryCss = "";

test.beforeAll(() => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "rjsb-fixtures-"));
  for (const app of apps) {
    if (app === "plain") {
      appCss[app] = fs.readFileSync(path.join(fixtures, "plain.css"), "utf8");
      continue;
    }
    const outFile = path.join(out, `${app}.css`);
    execFileSync(
      tailwindBin,
      ["-i", path.join(fixtures, `${app}.css`), "-o", outFile],
      { stdio: "pipe" },
    );
    appCss[app] = fs.readFileSync(outFile, "utf8");
  }
  libraryCss = fs.readFileSync(path.join(pkgRoot, "dist/style.css"), "utf8");
});

const body = `
<h1 id="outside-h">outside</h1>
<button id="outside-btn">outside</button>
<div id="app-el" class="flex p-2 font-mono">app</div>
<div class="rjsb-root">
  <div id="padded" class="rjsb:border rjsb:p-2 rjsb:rounded-md">x</div>
  <div id="layout" class="rjsb:flex rjsb:flex-col rjsb:md:grid">x</div>
  <div id="override" class="rjsb:p-2 px-8">x</div>
  <a id="link" href="#">link</a>
  <button id="primary" class="rjsb:bg-primary rjsb:text-primary-foreground rjsb:h-9 rjsb:px-4 rjsb:py-2">Add</button>
</div>`;

async function load(page: Page, app: App, order: Order, dark = false) {
  const styles =
    order === "library-last"
      ? [appCss[app], libraryCss]
      : [libraryCss, appCss[app]];
  await page.setContent(
    `<!doctype html><html${dark ? ' class="dark"' : ""}><head>${styles
      .map((css) => `<style>${css}</style>`)
      .join("")}</head><body>${body}</body></html>`,
  );
}

const css = (page: Page, sel: string, prop: string) =>
  page
    .locator(sel)
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const rootVar = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

for (const app of apps) {
  for (const order of orders) {
    test(`${app}/${order}: app tokens win`, async ({ page }) => {
      await load(page, app, order);
      expect(await rootVar(page, "--primary")).toBe("rgb(1, 2, 3)");
      expect(await rootVar(page, "--ring")).toBe("rgb(4, 5, 6)");
      if (app === "websand-like") {
        expect(await rootVar(page, "--sidebar")).toBe("rgb(7, 8, 9)");
      }
    });

    test(`${app}/${order}: app dark tokens win`, async ({ page }) => {
      await load(page, app, order, true);
      expect(await rootVar(page, "--primary")).toBe("rgb(10, 11, 12)");
    });

    test(`${app}/${order}: app body font wins`, async ({ page }) => {
      await load(page, app, order);
      const font = await css(page, "body", "font-family");
      expect(font).toContain("Fixture Sans");
      expect(font).not.toContain("ui-sans-serif");
    });

    if (app !== "plain") {
      test(`${app}/${order}: app utilities keep app values`, async ({
        page,
      }) => {
        await load(page, app, order);
        expect(await css(page, "#app-el", "display")).toBe("flex");
        if (app === "websand-like") {
          expect(await css(page, "#app-el", "padding-top")).toBe("16px");
          expect(await css(page, "#app-el", "font-family")).toContain(
            "Fixture Mono",
          );
        } else {
          expect(await css(page, "#app-el", "padding-top")).toBe("8px");
        }
      });

      test(`${app}/${order}: app className override wins on a builder element`, async ({
        page,
      }) => {
        await load(page, app, order);
        expect(await css(page, "#override", "padding-left")).toBe(
          app === "websand-like" ? "64px" : "32px",
        );
      });
    } else {
      test(`plain/${order}: no global rules leak`, async ({ page }) => {
        await load(page, app, order);
        expect(await css(page, "body", "margin-top")).toBe("8px");
        expect(await css(page, "#outside-h", "margin-top")).not.toBe("0px");
        expect(await css(page, "#outside-btn", "cursor")).not.toBe("pointer");
      });
    }

    test(`${app}/${order}: builder padding uses its own scale`, async ({
      page,
    }) => {
      await load(page, app, order);
      expect(await css(page, "#padded", "padding-top")).toBe("8px");
    });

    test(`${app}/${order}: builder borders take the app's border token`, async ({
      page,
    }) => {
      await load(page, app, order);
      expect(await css(page, "#padded", "border-top-width")).toBe("1px");
      expect(await css(page, "#padded", "border-top-style")).toBe("solid");
      expect(await css(page, "#padded", "border-top-color")).toBe(
        "rgb(13, 14, 15)",
      );
    });

    test(`${app}/${order}: builder responsive variants survive`, async ({
      page,
    }) => {
      await load(page, app, order);
      expect(await css(page, "#layout", "display")).toBe("grid");
    });

    test(`${app}/${order}: builder colors use app tokens`, async ({ page }) => {
      await load(page, app, order);
      expect(await css(page, "#primary", "background-color")).toBe(
        "rgb(1, 2, 3)",
      );
      expect(await css(page, "#primary", "cursor")).toBe("pointer");
      expect(await css(page, "#link", "text-decoration-line")).toBe("none");
      expect(await css(page, "#link", "color")).not.toBe("rgb(0, 0, 238)");
    });
  }
}

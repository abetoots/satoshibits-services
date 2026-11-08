import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postcss from "postcss";

const pkgRoot = path.resolve(import.meta.dirname, "../..");
const fixtures = path.join(pkgRoot, "tests/css/fixtures");
const tailwindBin = path.join(pkgRoot, "node_modules/.bin/tailwindcss");

const apps = ["websand-like", "shadcn-v3-like", "plain", "native-layers"] as const;
const orders = ["library-last", "library-first"] as const;
type App = (typeof apps)[number];
type Order = (typeof orders)[number];

const appCss = {} as Record<App, string>;
let libraryCss = "";
let fixtureDir = "";

test.beforeAll(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "rjsb-fixtures-"));
  for (const app of apps) {
    if (app === "plain" || app === "native-layers") {
      appCss[app] = fs.readFileSync(path.join(fixtures, `${app}.css`), "utf8");
      continue;
    }
    const outFile = path.join(fixtureDir, `${app}.css`);
    execFileSync(
      tailwindBin,
      ["-i", path.join(fixtures, `${app}.css`), "-o", outFile],
      { stdio: "pipe" },
    );
    appCss[app] = fs.readFileSync(outFile, "utf8");
  }
  libraryCss = fs.readFileSync(path.join(pkgRoot, "dist/style.css"), "utf8");
});

test.afterAll(() => {
  if (!fixtureDir) return;
  for (const app of apps.filter((name) => name !== "plain" && name !== "native-layers")) {
    const file = path.join(fixtureDir, `${app}.css`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  fs.rmdirSync(fixtureDir);
});

const body = `
<h1 id="outside-h">outside</h1>
<button id="outside-btn">outside</button><h2 id="outside-h2">outside</h2><a id="outside-link" href="#">outside</a>
<div id="app-el" class="flex p-2 font-mono">app</div>
<div id="wrapper"><div class="rjsb-root" id="builder-root">
  <h2 id="heading">heading</h2><h2 id="large-heading" class="rjsb:text-lg">heading</h2><ul id="list"><li>item</li></ul><p id="paragraph">text</p><div id="muted" class="rjsb:bg-muted">muted</div>
  <div class="rjsb:group" data-disabled="true"><label id="group-label" data-slot="label" class="rjsb:group-data-[disabled=true]:pointer-events-none rjsb:group-data-[disabled=true]:opacity-50">label</label></div><button class="rjsb:peer" disabled></button><label id="peer-label" data-slot="label" class="rjsb:peer-disabled:cursor-not-allowed rjsb:peer-disabled:opacity-50">label</label>
  <div id="padded" class="rjsb:border rjsb:p-2 rjsb:rounded-md">x</div>
  <div id="layout" class="rjsb:flex rjsb:flex-col rjsb:md:grid">x</div>
  <div id="override" class="rjsb:p-2 px-8">x</div>
  <a id="link" href="#">link</a>
  <button id="primary" class="rjsb:bg-primary rjsb:text-primary-foreground rjsb:h-9 rjsb:px-4 rjsb:py-2">Add</button>
</div></div>`;

async function load(page: Page, app: App, order: Order, dark = false, darkTarget?: "body" | "wrapper") {
  const styles =
    order === "library-last"
      ? [appCss[app], libraryCss]
      : [libraryCss, appCss[app]];
  await page.setContent(
    `<!doctype html><html${dark ? ' class="dark"' : ""}><head>${styles
      .map((css) => `<style>${css}</style>`)
      .join("")}</head><body>${body}</body></html>`,
  );
  if (darkTarget) await page.locator(darkTarget === "body" ? "body" : "#wrapper").evaluate((el) => el.classList.add("dark"));
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

    for (const target of ["body", "wrapper"] as const) {
      test(`${app}/${order}: ${target} dark retains app tokens`, async ({ page }) => {
        await load(page, app, order, false, target);
        const selector = target === "body" ? "body" : "#wrapper";
        expect(await css(page, "#primary", "background-color")).toBe("rgb(10, 11, 12)");
        expect((await css(page, selector, "--ring")).trim()).toBe("rgb(4, 5, 6)");
        expect((await css(page, selector, "--border")).trim()).toBe("rgb(13, 14, 15)");
        if (app === "websand-like") expect((await css(page, selector, "--sidebar")).trim()).toBe("rgb(7, 8, 9)");
      });
    }

    test(`${app}/${order}: builder uses app dark primary`, async ({ page }) => {
      await load(page, app, order, true);
      expect(await css(page, "#primary", "background-color")).toBe("rgb(10, 11, 12)");
    });

    test(`${app}/${order}: scoped resets apply`, async ({ page }) => {
      await load(page, app, order);
      expect(await css(page, "#heading", "font-size")).toBe(await css(page, "#builder-root", "font-size"));
      expect(await css(page, "#heading", "margin-top")).toBe("0px");
      expect(await css(page, "#list", "list-style-type")).toBe("none");
      expect(await css(page, "#list", "padding-left")).toBe("0px");
      expect(await css(page, "#paragraph", "margin-bottom")).toBe("0px");
      expect(await css(page, "#large-heading", "font-size")).toBe("18px");
      expect(await css(page, "#large-heading", "margin-top")).toBe("0px");
      if (app !== "plain") {
        expect(await css(page, "#outside-h2", "font-size")).toBe("30px");
        expect(await css(page, "#outside-h2", "margin-top")).toBe("20px");
        expect(await css(page, "#outside-link", "color")).toBe("rgb(0, 0, 255)");
        expect(await css(page, "#outside-link", "text-decoration-line")).toBe("underline");
      }
    });

    test(`${app}/${order}: missing muted token falls back in light and dark`, async ({ page }) => {
      await load(page, app, order);
      expect(await css(page, "#muted", "background-color")).toBe("oklch(0.97 0 0)");
      await load(page, app, order, true);
      expect(await css(page, "#muted", "background-color")).toBe("oklch(0.269 0 0)");
      await load(page, app, order, false, "wrapper");
      expect(await css(page, "#muted", "background-color")).toBe("oklch(0.269 0 0)");
    });

    test(`${app}/${order}: app body font wins`, async ({ page }) => {
      await load(page, app, order);
      const font = await css(page, "body", "font-family");
      expect(font).toContain("Fixture Sans");
      expect(font).not.toContain("ui-sans-serif");
    });

    if (app !== "plain" && app !== "native-layers") {
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
    } else if (app === "plain") {
      test(`plain/${order}: no global rules leak`, async ({ page }) => {
        await load(page, app, order);
        expect(await css(page, "#app-el", "display")).toBe("block");
        expect(await css(page, "#app-el", "padding-top")).toBe("0px");
        expect(await css(page, "body", "margin-top")).toBe("8px");
        expect(await css(page, "#outside-h", "margin-top")).toBe("21.44px");
        expect(await css(page, "#outside-btn", "cursor")).toBe("default");
      });
    }

    if (app === "native-layers") {
      test(`${app}/${order}: app utility overrides builder utility`, async ({ page }) => {
        await load(page, app, order);
        expect(await css(page, "#override", "padding-left")).toBe("32px");
      });
    }

    test(`${app}/${order}: disabled group and peer style labels`, async ({ page }) => {
      await load(page, app, order);
      expect(await css(page, "#group-label", "pointer-events")).toBe("none");
      expect(await css(page, "#group-label", "opacity")).toBe("0.5");
      expect(await css(page, "#peer-label", "cursor")).toBe("not-allowed");
      expect(await css(page, "#peer-label", "opacity")).toBe("0.5");
    });

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
      expect(await css(page, "#link", "color")).toBe(await css(page, "#builder-root", "color"));
    });
  }
}

test("enum tab grids have one, two, or three columns", async ({ page }) => {
  await page.setContent(`<style>${libraryCss}</style>${[1, 2, 3]
    .map((count) => `<div id="cols-${count}" class="rjsb:grid rjsb:grid-cols-${count}" style="width: 600px"></div>`)
    .join("")}`);
  for (const count of [1, 2, 3]) {
    expect(await css(page, `#cols-${count}`, "grid-template-columns"))
      .toBe(Array(count).fill(`${600 / count}px`).join(" "));
  }
});


test("standalone builder uses light and dark default colors", async ({ page }) => {
  for (const [isDark, primary, border] of [
    [false, "oklch(0.205 0 0)", "oklch(0.922 0 0)"],
    [true, "oklch(0.985 0 0)", "oklch(0.269 0 0)"],
  ] as const) {
    await page.setContent(`<html${isDark ? ' class="dark"' : ""}><head><style>${libraryCss}</style></head><body>${body}</body></html>`);
    expect(await css(page, "#primary", "background-color")).toBe(primary);
    expect(await css(page, "#padded", "border-top-color")).toBe(border);
  }
});

const allowedSelector = (selector: string) =>
  /^(?:\.rjsb-root(?![\w-])|(?:[a-zA-Z][\w-]*)?\.rjsb\\:|:where\(\.rjsb|:is\(\.rjsb|:is\(:where\(\.rjsb)/.test(selector) ||
  selector === ":where(:root)" || selector === ":where(.dark)";

test("selector audit accepts scoped Tailwind variants and rejects unscoped selectors", () => {
  for (const selector of [
    String.raw`:is(:where(.rjsb\:group)[data-disabled="true"] .rjsb\:group-data-foo)`,
    String.raw`:is(:where(.rjsb\:peer):disabled ~ .rjsb\:peer-disabled-foo)`,
    String.raw`a.rjsb\:hover`,
  ]) expect(allowedSelector(selector)).toBe(true);
  for (const selector of ["h1", "body:has(.rjsb-root) h1", "*", String.raw`body .rjsb\:flex`]) {
    expect(allowedSelector(selector)).toBe(false);
  }
});

test("shipped sheet scopes selectors and custom properties", () => {
  const sheet = postcss.parse(libraryCss);
  const invalidSelectors: string[] = [];
  const invalidProperties = new Set<string>();
  sheet.walkRules((rule) => {
    let ancestor: postcss.Node["parent"] = rule.parent;
    while (ancestor) {
      if (ancestor.type === "atrule" && "name" in ancestor && (ancestor.name === "keyframes" || (ancestor.name === "layer" && "params" in ancestor && ancestor.params === "properties"))) return;
      ancestor = ancestor.parent;
    }
    for (const selector of rule.selectors) {
      if (!allowedSelector(selector)) invalidSelectors.push(selector);
    }
  });
  sheet.walkDecls((decl) => {
    if (decl.prop.startsWith("--") && !/^--(?:rjsb|tw)-/.test(decl.prop)) invalidProperties.add(decl.prop);
  });
  const keyframes = new Set<string>();
  sheet.walkAtRules("keyframes", (rule) => { keyframes.add(rule.params); });
  expect([...keyframes].sort()).toEqual(["enter", "exit"]);
  expect(Array.from(invalidProperties)).toEqual([]);
  expect(invalidSelectors).toEqual([]);
});

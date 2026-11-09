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
<input id="outside-input"><ol id="outside-ol"><li>i</li></ol>
<div id="wrapper"><div class="rjsb-root" id="builder-root">
  <button id="reset-btn">b</button><input id="reset-input"><ol id="reset-ol"><li>i</li></ol><h1 id="reset-h1">h</h1><span id="dark-badge" class="rjsb:bg-green-100 rjsb:dark:bg-green-900">d</span>
  <h2 id="heading">heading</h2><h2 id="large-heading" class="rjsb:text-lg">heading</h2><ul id="list"><li>item</li></ul><p id="paragraph">text</p><div id="muted" class="rjsb:bg-muted">muted</div>
  <div class="rjsb:group" data-disabled="true"><label id="group-label" data-slot="label" class="rjsb:group-data-[disabled=true]:pointer-events-none rjsb:group-data-[disabled=true]:opacity-50">label</label></div><button class="rjsb:peer" disabled></button><label id="peer-label" data-slot="label" class="rjsb:peer-disabled:cursor-not-allowed rjsb:peer-disabled:opacity-50">label</label>
  <div id="padded" class="rjsb:border rjsb:p-2 rjsb:rounded-md">x</div>
  <div id="layout" class="rjsb:flex rjsb:flex-col rjsb:md:grid">x</div>
  <div id="override" class="rjsb:p-2 px-8">x</div>
  <a id="link" href="#">link</a>
  <button id="primary" class="rjsb:bg-primary rjsb:text-primary-foreground rjsb:h-9 rjsb:px-4 rjsb:py-2">Add</button>
</div></div>
<div class="rjsb-root" id="portal-root"><h2 id="portal-heading">heading</h2><ul id="portal-list"><li>item</li></ul><div id="portal-primary" class="rjsb:bg-primary">primary</div><div id="portal-border" class="rjsb:border">border</div><div id="portal-muted" class="rjsb:bg-muted">muted</div></div>
<div class="rjsb-root" id="standalone-root"><button id="standalone-remove" class="rjsb:inline-flex rjsb:items-center rjsb:justify-center rjsb:hover:bg-accent rjsb:hover:text-accent-foreground rjsb:size-9 rjsb:h-8 rjsb:w-8">remove</button></div>`;

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

    test(`${app}/${order}: scoped resets beat app base rules for button, input, ol and h1`, async ({ page }) => {
      await load(page, app, order);
      expect(await css(page, "#reset-btn", "background-color")).toBe("rgba(0, 0, 0, 0)");
      expect(await css(page, "#reset-btn", "border-top-left-radius")).toBe("0px");
      expect(await css(page, "#reset-btn", "font-size")).toBe(await css(page, "#builder-root", "font-size"));
      expect(await css(page, "#reset-input", "background-color")).toBe("rgba(0, 0, 0, 0)");
      expect(await css(page, "#reset-input", "border-top-left-radius")).toBe("0px");
      expect(await css(page, "#reset-ol", "list-style-type")).toBe("none");
      expect(await css(page, "#reset-ol", "padding-left")).toBe("0px");
      expect(await css(page, "#reset-h1", "font-size")).toBe(await css(page, "#builder-root", "font-size"));
      expect(await css(page, "#reset-h1", "margin-top")).toBe("0px");
      if (app !== "plain") {
        expect(await css(page, "#outside-btn", "background-color")).toBe("rgb(200, 0, 0)");
        expect(await css(page, "#outside-input", "background-color")).toBe("rgb(0, 200, 0)");
        expect(await css(page, "#outside-ol", "list-style-type")).toBe("decimal");
        expect(await css(page, "#outside-h", "font-size")).toBe("40px");
      }
    });

    test(`${app}/${order}: portal root inherits app tokens and resets (light)`, async ({ page }) => {
      await load(page, app, order);
      expect(await css(page, "#portal-primary", "background-color")).toBe("rgb(1, 2, 3)");
      expect(await css(page, "#portal-border", "border-top-color")).toBe("rgb(13, 14, 15)");
      expect(await css(page, "#portal-muted", "background-color")).toBe("oklch(0.97 0 0)");
      expect(await css(page, "#portal-heading", "font-size")).toBe(await css(page, "#portal-root", "font-size"));
      expect(await css(page, "#portal-heading", "margin-top")).toBe("0px");
      expect(await css(page, "#portal-list", "list-style-type")).toBe("none");
      expect(await css(page, "#portal-list", "padding-left")).toBe("0px");
    });

    test(`${app}/${order}: portal root inherits app tokens and resets (body dark)`, async ({ page }) => {
      await load(page, app, order, false, "body");
      expect(await css(page, "#portal-primary", "background-color")).toBe("rgb(10, 11, 12)");
      expect(await css(page, "#portal-border", "border-top-color")).toBe("rgb(13, 14, 15)");
      expect(await css(page, "#portal-muted", "background-color")).toBe("oklch(0.269 0 0)");
    });

    test(`${app}/${order}: portal root inherits app tokens and resets (wrapper dark)`, async ({ page }) => {
      await load(page, app, order, false, "wrapper");
      expect(await css(page, "#portal-primary", "background-color")).toBe("rgb(1, 2, 3)");
      expect(await css(page, "#portal-border", "border-top-color")).toBe("rgb(13, 14, 15)");
      expect(await css(page, "#portal-muted", "background-color")).toBe("oklch(0.97 0 0)");
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
        // ua h1 margin, 0.67em of 32px; webkit rounds to 1/64px (21.4375px)
        expect(parseFloat(await css(page, "#outside-h", "margin-top"))).toBeCloseTo(21.44, 1);
        expect(await css(page, "#outside-btn", "cursor")).toBe("default");
      });
      test(`plain/${order}: standalone renderer button is reset`, async ({ page }) => {
        await load(page, app, order);
        expect(await css(page, "#standalone-remove", "background-color")).toBe("rgba(0, 0, 0, 0)");
        expect(await css(page, "#standalone-remove", "border-top-width")).toBe("0px");
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
  for (const [target, primary, border, muted] of [
    ["light", "oklch(0.205 0 0)", "oklch(0.922 0 0)", "oklch(0.97 0 0)"],
    ["html", "oklch(0.985 0 0)", "oklch(0.269 0 0)", "oklch(0.269 0 0)"],
    ["body", "oklch(0.985 0 0)", "oklch(0.269 0 0)", "oklch(0.269 0 0)"],
    ["wrapper", "oklch(0.985 0 0)", "oklch(0.269 0 0)", "oklch(0.269 0 0)"],
  ] as const) {
    await page.setContent(`<html${target === "html" ? ' class="dark"' : ""}><head><style>${libraryCss}</style></head><body>${body}</body></html>`);
    if (target === "body" || target === "wrapper") await page.locator(target === "body" ? "body" : "#wrapper").evaluate((el) => el.classList.add("dark"));
    expect(await css(page, "#primary", "background-color")).toBe(primary);
    expect(await css(page, "#padded", "border-top-color")).toBe(border);
    expect(await css(page, "#muted", "background-color")).toBe(muted);
  }
});

test("rjsb:dark: utilities apply under html.dark and body.dark", async ({ page }) => {
  for (const target of ["light", "html", "body", "wrapper"] as const) {
    await page.setContent(`<html${target === "html" ? ' class="dark"' : ""}><head><style>${libraryCss}</style></head><body>${body}</body></html>`);
    if (target === "body" || target === "wrapper") await page.locator(target === "body" ? "body" : "#wrapper").evaluate((el) => el.classList.add("dark"));
    expect(await css(page, "#dark-badge", "background-color"), target).toBe(target === "light" ? "oklch(0.962 0.044 156.743)" : "oklch(0.393 0.095 152.535)");
  }
});

const splitSelector = (selector: string) => {
  const compounds: string[] = [];
  const combinators: string[] = [];
  let start = 0;
  let depth = 0;
  let brackets = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector.charAt(i);
    if (char === "\\") { i++; continue; }
    if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (!brackets && char === "(") depth++;
    else if (!brackets && char === ")") depth--;
    else if (!brackets && !depth && /[\s>+~]/.test(char)) {
      const compound = selector.slice(start, i).trim();
      if (!compound) continue;
      compounds.push(compound);
      while (/\s/.test(selector[i + 1] ?? "")) i++;
      if (/\s/.test(char) && /[>+~]/.test(selector[i + 1] ?? "")) i++;
      combinators.push(/[>+~]/.test(selector.charAt(i)) ? selector.charAt(i) : " ");
      while (/\s/.test(selector[i + 1] ?? "")) i++;
      start = i + 1;
    }
  }
  const last = selector.slice(start).trim();
  if (last) compounds.push(last);
  return { compounds, combinators };
};

const scopedCompound = (compound: string): boolean => {
  for (let i = 0; i < compound.length; i++) {
    if (compound[i] === "\\") { i++; continue; }
    if (compound[i] === "[") {
      while (++i < compound.length && compound[i] !== "]") if (compound[i] === "\\") i++;
    } else if (compound[i] === "." && /^(?:\.rjsb-root(?![\w-])|\.rjsb\\:)/.test(compound.slice(i))) {
      return true;
    } else if (compound[i] === ":") {
      const match = /^:([\w-]+)\(/.exec(compound.slice(i));
      if (!match) continue;
      const start = i + match[0].length;
      let depth = 1;
      let brackets = 0;
      i = start;
      for (; i < compound.length && depth; i++) {
        if (compound[i] === "\\") { i++; continue; }
        if (compound[i] === "[") brackets++;
        else if (compound[i] === "]") brackets--;
        else if (!brackets && compound[i] === "(") depth++;
        else if (!brackets && compound[i] === ")") depth--;
      }
      const inner = compound.slice(start, i - 1);
      i--;
      if ((match[1] === "is" || match[1] === "where") && postcss.list.comma(inner).every(containedSelector)) return true;
    }
  }
  return false;
};

function containedSelector(selector: string): boolean {
  const { compounds, combinators } = splitSelector(selector);
  const first = compounds[0];
  const last = compounds[compounds.length - 1];
  if (!first || !last || combinators.length !== compounds.length - 1 || !scopedCompound(first)) return false;
  return scopedCompound(last) || combinators.every((value) => value === " " || value === ">");
}

const allowedSelector = (selector: string) =>
  selector === ":where(:root)" || selector === ":where(.dark)" || containedSelector(selector);

test("selector audit accepts scoped Tailwind variants and rejects unscoped selectors", () => {
  for (const selector of [
    String.raw`:is(:where(.rjsb\:group)[data-disabled="true"] .rjsb\:group-data-foo)`,
    String.raw`:is(:where(.rjsb\:peer):disabled ~ .rjsb\:peer-disabled-foo)`,
    String.raw`a.rjsb\:hover`,
    ".rjsb-root :where(h1, h2, h3, h4, h5, h6)",
    ".rjsb-root *",
    String.raw`:where(.rjsb\:x) body`,
    ".rjsb-root:has(h1) h1",
    String.raw`.rjsb\:[\&\>svg]:size-4 > svg`,
    ".rjsb-root ::selection",
  ]) expect(allowedSelector(selector), selector).toBe(true);
  for (const selector of ["h1", "body:has(.rjsb-root) h1", "*", String.raw`body .rjsb\:flex`, ".rjsb-root ~ *", ".rjsb-root + *", ".rjsb-root ~ h1", "h1 .rjsb-root ~ p", ":is(.rjsb-root ~ body)", ":is(.rjsb-root, body)"]) {
    expect(allowedSelector(selector), selector).toBe(false);
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
  expect([...keyframes].sort()).toEqual(["rjsb-enter", "rjsb-exit"]);
  const animationNames: string[] = [];
  sheet.walkDecls(/^(animation-name|animation)$/, (decl) => {
    for (const value of postcss.list.comma(decl.value)) {
      const name = value.trim().split(/\s+/)[0];
      if (!name) throw new Error("missing animation name");
      animationNames.push(name);
    }
  });
  expect(animationNames.length).toBeGreaterThan(0);
  for (const name of animationNames) expect(keyframes.has(name), name).toBe(true);
  expect(Array.from(invalidProperties)).toEqual([]);
  expect(invalidSelectors).toEqual([]);
});

// pins a5226d6's frames: slide-in loses to animate-in's reset, duration-200 to its 150ms
for (const { label, attrs, time, name, opacity, scale } of [
  { label: "dialog open", attrs: 'data-state="open" class="rjsb:data-[state=open]:animate-in rjsb:data-[state=open]:fade-in-0 rjsb:data-[state=open]:zoom-in-95 rjsb:duration-200"', time: 0, name: "rjsb-enter", opacity: 0, scale: 0.95 },
  { label: "dialog closed", attrs: 'data-state="closed" class="rjsb:data-[state=closed]:animate-out rjsb:data-[state=closed]:fade-out-0 rjsb:data-[state=closed]:zoom-out-95 rjsb:duration-200"', time: 149.999, name: "rjsb-exit", opacity: 0, scale: 0.95 },
  { label: "select bottom", attrs: 'data-state="open" data-side="bottom" class="rjsb:data-[state=open]:animate-in rjsb:data-[state=open]:fade-in-0 rjsb:data-[state=open]:zoom-in-95 rjsb:data-[side=bottom]:slide-in-from-top-2"', time: 0, name: "rjsb-enter", opacity: 0, scale: 0.95 },
  { label: "select left", attrs: 'data-state="open" data-side="left" class="rjsb:data-[state=open]:animate-in rjsb:data-[side=left]:slide-in-from-right-2"', time: 0, name: "rjsb-enter", opacity: 1, scale: 1 },
]) {
  test(`builder animations keep their frames: ${label}`, async ({ page }) => {
    await page.setContent(`<style>${libraryCss}</style><div id="t" ${attrs} style="width:100px;height:100px"></div>`);
    const frame = await page.locator("#t").evaluate((el, currentTime) => {
      const animation = el.getAnimations()[0];
      if (!animation) throw new Error("missing animation");
      animation.pause();
      animation.currentTime = currentTime;
      const cs = getComputedStyle(el);
      const m = new DOMMatrix(cs.transform);
      return { name: cs.animationName, duration: cs.animationDuration, opacity: Number(cs.opacity), a: m.a, e: m.e, f: m.f };
    }, time);
    expect.soft(frame.duration).toBe("0.15s");
    expect.soft(frame.opacity).toBeCloseTo(opacity, 3);
    expect.soft(frame.a).toBeCloseTo(scale, 3);
    expect.soft(frame.e).toBe(0);
    expect.soft(frame.f).toBe(0);
    expect(frame.name).toBe(name);
  });
}

for (const order of orders) {
  test(`app keyframes named enter/exit keep their frames: ${order}`, async ({ page }) => {
    const app = '@keyframes enter { from { opacity: 0.25 } } @keyframes exit { to { opacity: 0.75 } }';
    const styles = order === "library-last" ? [app, libraryCss] : [libraryCss, app];
    await page.setContent(`${styles.map((style) => `<style>${style}</style>`).join("")}<div id="app-anim" style="animation: enter 1s paused">a</div><div id="app-exit" style="animation: exit 1s paused">c</div><div class="rjsb-root"><div id="lib-anim" data-state="open" class="rjsb:data-[state=open]:animate-in rjsb:data-[state=open]:fade-in-0">b</div><div id="lib-exit" data-state="closed" class="rjsb:data-[state=closed]:animate-out rjsb:data-[state=closed]:fade-out-0">d</div></div>`);
    for (const [selector, atEnd, expected] of [["#app-anim", false, 0.25], ["#lib-anim", false, 0], ["#app-exit", true, 0.75], ["#lib-exit", true, 0]] as const) {
      const opacity = await page.locator(selector).evaluate((el, end) => {
        const animation = el.getAnimations()[0];
        if (!animation?.effect) throw new Error("missing animation or effect");
        animation.pause();
        animation.currentTime = end ? Number(animation.effect.getTiming().duration) - 0.001 : 0;
        return getComputedStyle(el).opacity;
      }, atEnd);
      if (atEnd) expect.soft(Number(opacity), selector).toBeCloseTo(expected, 2);
      else expect.soft(opacity, selector).toBe(String(expected));
    }
  });
}

test("source theme maps app tokens to matching light and dark fallbacks", () => {
  const source = postcss.parse(fs.readFileSync(path.join(pkgRoot, "src/index.css"), "utf8"));
  const light = new Set<string>();
  const dark = new Set<string>();
  const lightOnly = new Set(["--rjsb-radius", "--rjsb-autofit-grid", "--rjsb-autofill-grid"]);
  const colors = new Set<string>();
  source.walkAtRules("theme", (rule) => {
    if (rule.params !== "inline") return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith("--color-")) {
        const token = decl.prop.slice("--color-".length);
        colors.add(`--rjsb-${token}`);
        expect(decl.value, decl.prop).toBe(`var(--${token}, var(--rjsb-${token}))`);
      } else if (decl.prop.startsWith("--radius-")) {
        expect(decl.value, decl.prop).toContain("var(--radius, var(--rjsb-radius))");
        expect(decl.value.split("var(--radius, var(--rjsb-radius))").join(""), decl.prop).not.toContain("var(");
      }
    });
  });
  source.walkRules((rule) => {
    const tokens = rule.selector === ":where(:root)" ? light : rule.selector === ":where(.dark)" ? dark : undefined;
    if (!tokens) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith("--rjsb-")) tokens.add(decl.prop);
    });
  });
  expect(colors.size).toBeGreaterThan(0);
  expect(Array.from(colors).filter((token) => !light.has(token) && !dark.has(token))).toEqual([]);
  expect(Array.from(lightOnly).filter((token) => !light.has(token))).toEqual([]);
  expect(light.size).toBeGreaterThan(0);
  expect(dark.size).toBeGreaterThan(0);
  expect(Array.from(dark).filter((token) => lightOnly.has(token))).toEqual([]);
  expect(Array.from(light).filter((token) => !lightOnly.has(token)).sort()).toEqual(Array.from(dark).sort());
});

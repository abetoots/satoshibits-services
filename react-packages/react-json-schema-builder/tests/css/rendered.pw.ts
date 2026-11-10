import { expect, test, type Locator, type Page } from "@playwright/test";

// the vite spa fallback serves the dev page for a missing html, so check the title
const openHarness = async (page: Page, query = "") => {
  await page.goto(`/render-harness.html${query}`);
  await expect(page).toHaveTitle("rjsb render harness");
};

const addButton = (page: Page) => page.getByRole("button", { name: /^add property$/i });
const rowOf = (page: Page, key: string): Locator => page.getByLabel(`Property key for ${key}`).locator("xpath=../..");

const light = { strip: "oklch(0.97 0 0)", input: "oklch(1 0 0)" };
const dark = { strip: "oklch(0.269 0 0)", input: "oklch(0.145 0 0)" };

for (const [query, want] of [["", light], ["?dark=html", dark], ["?dark=body", dark]] as const) {
  test(`array items strip uses the muted token in light and dark ${query}`, async ({ page }) => {
    await openHarness(page, query);
    const strip = page.getByText("Items of type:").locator("..");
    await expect(strip).toHaveCSS("background-color", want.strip);
    await expect(page.getByRole("combobox", { name: "Select items of type" })).toHaveCSS("background-color", want.input);
  });
}

// the default theme gives muted/secondary/accent (and background/card/popover) equal values, so set distinct app tokens
test("array strip, combobox and listbox read their own app tokens", async ({ page }) => {
  await openHarness(page);
  await page.addStyleTag({ content: ":root { --muted: rgb(1, 2, 3); --secondary: rgb(4, 5, 6); --accent: rgb(7, 8, 9); --background: rgb(10, 11, 12); --card: rgb(13, 14, 15); --popover: rgb(16, 17, 18); }" });
  await expect(page.getByText("Items of type:").locator("..")).toHaveCSS("background-color", "rgb(1, 2, 3)");
  const combobox = page.getByRole("combobox", { name: "Select items of type" });
  await expect(combobox).toHaveCSS("background-color", "rgb(10, 11, 12)");
  await combobox.click();
  await expect(page.getByRole("listbox")).toHaveCSS("background-color", "rgb(16, 17, 18)");
});

test("four-type enum tabs use four columns from md, three below", async ({ page }) => {
  await openHarness(page);
  const tablist = page.getByRole("tablist");
  await expect(tablist).toHaveCSS("display", "grid");
  // resolved tracks are pixel values, so count those
  const tracks = () => tablist.evaluate((el) => getComputedStyle(el).gridTemplateColumns.match(/[\d.]+px/g)?.length ?? 0);
  expect(await tracks()).toBe(4);
  await page.setViewportSize({ width: 700, height: 768 });
  expect(await tracks()).toBe(3);
});

test("portaled listbox goes dark with body.dark", async ({ page }) => {
  await openHarness(page, "?dark=body");
  await page.getByRole("combobox", { name: "Select items of type" }).click();
  await expect(page.getByRole("listbox")).toHaveCSS("background-color", dark.input);
});

test("real dialog and select animate with the rjsb frames", async ({ page }) => {
  await openHarness(page);
  // pause first: a 150ms animation would finish before it can be read
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  const firstFrame = (role: "dialog" | "listbox") =>
    page.getByRole(role).evaluate((el) => {
      const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === "rjsb-enter");
      if (!anim) return null;
      anim.currentTime = 0;
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, scale: new DOMMatrix(cs.transform).a, duration: cs.animationDuration };
    });
  // radix's popper holds animation: none until positioned, so poll
  const expectFirstFrame = (role: "dialog" | "listbox", duration: string) =>
    expect.poll(() => firstFrame(role)).toEqual({ opacity: "0", scale: 0.95, duration });

  await addButton(page).click();
  await expectFirstFrame("dialog", "0.2s");
  await page.getByRole("dialog").getByRole("combobox", { name: /select type/i }).click();
  await expectFirstFrame("listbox", "0.15s");

  // close path: select first, then the dialog, still paused
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const closed = page.locator('[role=dialog][data-state="closed"]');
  const exit = () => closed.evaluate((el) => el.getAnimations().some((a) => (a as CSSAnimation).animationName === "rjsb-exit"));
  await expect.poll(exit).toBe(true);
  const lastFrameOpacity = await closed.evaluate((el) => {
    const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === "rjsb-exit");
    if (!anim?.effect) throw new Error("missing exit animation");
    anim.currentTime = Number(anim.effect.getTiming().duration) - 0.001;
    return Number(getComputedStyle(el).opacity);
  });
  expect(lastFrameOpacity).toBeCloseTo(0, 2);
  // radix keeps the dialog mounted until rjsb-exit ends
  await pause.evaluate((el: Element) => { el.remove(); });
  await expect(closed).toHaveCount(0);
});

const rowKeys = ["name", "age", "address", "tags"];
const widths = [320, 640, 768, 900, 1024, 1150, 1280];
const fitCases: [string, number, string | null][] = [
  ...widths.map((w): [string, number, string | null] => [String(w), w, null]),
  ["1280 in a 400px container", 1280, "#root { width: 400px }"],
  ["1280 with a 20px root", 1280, "html { font-size: 20px }"],
];
for (const [label, width, css] of fitCases) {
  test(`row actions stay inside their row at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHarness(page);
    if (css) await page.addStyleTag({ content: css });
    // the row is the parent of the actions group
    const labels = await page.getByRole("button", { name: "Delete", exact: true }).evaluateAll((els) =>
      els.map((el) => el.parentElement!.parentElement!.querySelector("[aria-label^='Property key for']")?.getAttribute("aria-label")),
    );
    expect(labels).toEqual(rowKeys.map((k) => `Property key for ${k}`));
    for (const key of rowKeys) {
      const outside = await rowOf(page, key).evaluate((row) => {
        const r = row.getBoundingClientRect();
        return Array.from(row.querySelectorAll<HTMLButtonElement>("button"))
          .filter((b) => { const b2 = b.getBoundingClientRect(); return b2.left < r.left || b2.right > r.right || b2.top < r.top || b2.bottom > r.bottom; })
          .map((b) => b.getAttribute("aria-label"));
      });
      expect(outside, key).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
}

const addEnumConstraint = async (page: Page) => {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: /select constraint/i }).click();
  await page.getByRole("option", { name: "Enum Values" }).click();
  await dialog.getByRole("button", { name: "Add constraint" }).click();
  return dialog;
};
const openEnumInEdit = async (page: Page, row = 0): Promise<Locator> => {
  await page.getByRole("button", { name: "Edit constraints" }).nth(row).click();
  return addEnumConstraint(page);
};
const openEnumInAdd = async (page: Page): Promise<Locator> => {
  await addButton(page).click();
  await page.getByRole("dialog").getByRole("combobox", { name: /select type/i }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  return addEnumConstraint(page);
};

for (const which of ["Add", "Edit"]) {
  for (const width of [320, 768, 1024, 1280]) {
    test(`a long enum value stays inside the ${which} dialog at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHarness(page);
      const dialog = await (which === "Add" ? openEnumInAdd(page) : openEnumInEdit(page, 0));
      await dialog.getByPlaceholder("Enter a string value").fill("a".repeat(63));
      await dialog.getByRole("button", { name: "Add enum" }).click();
      const remove = dialog.getByRole("button", { name: "Remove value" });
      await expect(remove).toBeVisible();
      expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
      const removeRight = await remove.evaluate((el) => el.getBoundingClientRect().right);
      const viewportRight = await dialog
        .locator("[data-radix-scroll-area-viewport]")
        .first()
        .evaluate((el) => el.getBoundingClientRect().right);
      expect(removeRight).toBeLessThanOrEqual(viewportRight);
    });
  }
}

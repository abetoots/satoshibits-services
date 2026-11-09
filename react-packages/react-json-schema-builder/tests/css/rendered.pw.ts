import { expect, test, type Page } from "@playwright/test";

// the vite spa fallback serves the dev page for a missing html, so check the title
const openHarness = async (page: Page, query = "") => {
  await page.goto(`/render-harness.html${query}`);
  await expect(page).toHaveTitle("rjsb render harness");
};

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

test("four-type enum tabs use four columns from md, three below", async ({ page }) => {
  await openHarness(page);
  const tracks = () => page.getByRole("tablist").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
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
  await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  const firstFrame = (role: "dialog" | "listbox") =>
    page.getByRole(role).evaluate((el) => {
      const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === "rjsb-enter");
      if (!anim) return null;
      anim.currentTime = 0;
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, scale: new DOMMatrix(cs.transform).a };
    });
  // radix's popper holds animation: none until positioned, so poll
  const expectFirstFrame = (role: "dialog" | "listbox") =>
    expect.poll(() => firstFrame(role)).toEqual({ opacity: "0", scale: 0.95 });

  await page.getByText("Add Property").click();
  await expectFirstFrame("dialog");
  await page.getByRole("dialog").getByRole("combobox", { name: /select type/i }).click();
  await expectFirstFrame("listbox");
});

import { expect, test, type Locator, type Page } from "@playwright/test";

// the vite spa fallback serves the dev page for a missing html, so check the title
const openHarness = async (page: Page, query = "") => {
  await page.goto(`/render-harness.html${query}`);
  await expect(page).toHaveTitle("rjsb render harness");
};

const addButton = (page: Page) => page.getByRole("button", { name: /^add property$/i });
const rowOf = (page: Page, key: string): Locator => page.getByLabel(`Property key for ${key}`).locator("xpath=../..");

// escape only once radix has moved focus inside the dialog, i.e. after its escape listener is attached
const escapeDialog = async (page: Page) => {
  await expect(page.locator("[role=dialog][data-state=open]:focus-within, [role=alertdialog][data-state=open]:focus-within")).toHaveCount(1);
  await page.keyboard.press("Escape");
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
  await escapeDialog(page);
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

test("dialog overlays stay mounted until their exit animation ends", async ({ page }) => {
  await openHarness(page);
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  const checkClose = async (overlaySlot: string, dialogSlot: string) => {
    await escapeDialog(page);
    const overlay = page.locator(`[data-slot="${overlaySlot}"][data-state="closed"]`);
    await expect.poll(() => overlay.evaluateAll((els) => els.some((el) =>
      el.getAnimations().some((a) => (a as CSSAnimation).animationName === "rjsb-exit"),
    ))).toBe(true);
    await pause.evaluate((el: HTMLStyleElement) => { el.disabled = true; });
    await expect(page.locator(`[data-slot="${overlaySlot}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-slot="${dialogSlot}"]`)).toHaveCount(0);
  };

  await addButton(page).click();
  await checkClose("dialog-overlay", "dialog-content");
  await pause.evaluate((el: HTMLStyleElement) => { el.disabled = false; });
  await rowOf(page, "name").getByRole("button", { name: "Delete" }).click();
  await checkClose("alert-dialog-overlay", "alert-dialog-content");
});

test("Edit Save closes with the exit animation", async ({ page }) => {
  await openHarness(page);
  await rowOf(page, "name").getByRole("button", { name: "Edit constraints" }).click();
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  const closed = page.locator('[role=dialog][data-state="closed"]');
  await expect.poll(() => closed.evaluateAll((elements) => elements.some((el) =>
    el.getAnimations().some((animation) => (animation as CSSAnimation).animationName === "rjsb-exit"),
  ))).toBe(true);
  await pause.evaluate((el: HTMLStyleElement) => { el.disabled = true; });
  await expect(closed).toHaveCount(0);
});

test("the Edit form starts from the property being edited", async ({ page }) => {
  await openHarness(page);
  const edit = (key: string) => rowOf(page, key).getByRole("button", { name: "Edit constraints" });
  await edit("name").click();
  await escapeDialog(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await edit("age").click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowOf(page, "age").getByRole("combobox", { name: "Select type" })).toHaveText("integer");

  await edit("name").click();
  await escapeDialog(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await rowOf(page, "name").getByRole("combobox", { name: "Select type" }).click();
  await page.getByRole("option", { name: "number", exact: true }).click();
  await edit("name").click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rowOf(page, "name").getByRole("combobox", { name: "Select type" })).toHaveText("number");
});

test("the Edit heading wraps a long untitled key at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openHarness(page);
  const key = "W".repeat(63);
  await page.getByLabel("Property key for age").fill(key);
  await page.waitForTimeout(900);
  const row = rowOf(page, key);
  await row.getByPlaceholder("Title").clear();
  await page.waitForTimeout(900);
  await row.getByRole("button", { name: "Edit constraints" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading")).toContainText(key);
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
});

test("the Open tooltip stays inside a 320px viewport for a long title", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openHarness(page);
  await rowOf(page, "address").getByPlaceholder("Title").fill("W".repeat(63));
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /^open w+/i }).hover();
  await expect(page.getByRole("tooltip")).toHaveCount(1);
  const box = await page.locator('[data-slot="tooltip-content"]').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  // a capped box still spills the text unless it wraps
  expect(await page.locator('[data-slot="tooltip-content"]').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
});

test("the Delete confirmation wraps a long key at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openHarness(page);
  const key = "W".repeat(63);
  await page.getByLabel("Property key for age").fill(key);
  await page.waitForTimeout(900);
  await rowOf(page, key).getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(key);
  expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
});

test("overlays, buttons and inputs take refs without warnings", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (message) => {
    if (/cannot be given refs[\s\S]*at (DialogOverlay|AlertDialogOverlay|Button|Input) /.test(message.text())) {
      warnings.push(message.text());
    }
  });
  await openHarness(page);
  await addButton(page).click();
  await escapeDialog(page);
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  const remove = rowOf(page, "name").getByRole("button", { name: "Delete" });
  await remove.hover();
  await expect(page.getByRole("tooltip", { name: "Delete" })).toHaveCount(1);
  await remove.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(warnings).toEqual([]);
});

test("icon-only row actions show a tooltip on hover", async ({ page }) => {
  await openHarness(page);
  await page.getByRole("button", { name: "Delete" }).first().hover();
  await expect(page.getByRole("tooltip", { name: "Delete" })).toHaveCount(1);
  await page.mouse.move(0, 0, { steps: 10 });
  await expect(page.getByRole("tooltip", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open Address" }).hover();
  await expect(page.getByRole("tooltip", { name: "Open Address" })).toHaveCount(1);
  await page.mouse.move(0, 0, { steps: 10 });
  await expect(page.getByRole("tooltip", { name: "Open Address" })).toHaveCount(0);
});

// a fresh page with no pointer history: mixing hover residue with focus flaked in ci
test("icon-only row actions show a tooltip on keyboard focus", async ({ page }) => {
  await openHarness(page);
  await page.getByRole("button", { name: "Delete" }).first().focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Duplicate" }).first()).toBeFocused();
  await expect(page.getByRole("tooltip", { name: "Duplicate" })).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Edit constraints" }).first()).toBeFocused();
  await expect(page.getByRole("tooltip", { name: "Edit constraints" })).toHaveCount(1);
});

test("focus return opens the tooltip only after a keyboard close", async ({ page }) => {
  await openHarness(page);
  const edit = page.getByRole("button", { name: "Edit constraints" }).first();
  for (const close of ["Save", "Close", "overlay"]) {
    await edit.click();
    if (close === "overlay") await page.mouse.click(4, 4);
    else await page.getByRole("dialog").getByRole("button", { name: close }).click();
    await expect(edit).toBeFocused();
    await page.mouse.move(0, 0, { steps: 10 });
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  const remove = page.getByRole("button", { name: "Delete" }).first();
  await remove.click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(remove).toBeFocused();
  await page.mouse.move(0, 0, { steps: 10 });
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await edit.focus();
  await page.keyboard.press("Enter");
  await escapeDialog(page);
  await expect(edit).toBeFocused();
  await expect(page.getByRole("tooltip", { name: "Edit constraints" })).toHaveCount(1);
});

for (const [query, background] of [["", "oklch(0.205 0 0)"], ["?dark=body", "oklch(0.985 0 0)"], ["?dark=html", "oklch(0.985 0 0)"]] as const) {
  test(`portaled tooltip carries the root class, theme and rjsb-enter${query ? ` ${query}` : ""}`, async ({ page }) => {
    await openHarness(page, query);
    await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
    await page.getByRole("button", { name: "Duplicate" }).first().focus();
    const tooltip = page.locator('[data-slot="tooltip-content"]');
    await expect(tooltip).toHaveClass(/\brjsb-root\b/);
    await expect(tooltip).toHaveCSS("background-color", background);
    await expect.poll(() => tooltip.evaluate((el) => {
      const anim = el.getAnimations().find((a) => (a as CSSAnimation).animationName === "rjsb-enter");
      if (!anim) return null;
      anim.currentTime = 0;
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, scale: new DOMMatrix(cs.transform).a };
    })).toEqual({ opacity: "0", scale: 0.95 });
  });
}

test("a failed Add submit focuses the first invalid field", async ({ page }) => {
  await openHarness(page);
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^add property$/i }).click();
  await expect(dialog.getByLabel("Property Key")).toBeFocused();
});

for (const field of ["Type", "Items of type"]) {
  test(`missing ${field} focuses and describes its select`, async ({ page }) => {
    await openHarness(page);
    await addButton(page).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Property Key").fill("email");
    await dialog.getByLabel("Property Title").fill("Email");
    if (field === "Items of type") {
      await dialog.getByRole("combobox", { name: "Select type" }).click();
      await page.getByRole("option", { name: "array", exact: true }).click();
    }
    await page.waitForTimeout(300);
    await dialog.getByRole("button", { name: /^add property$/i }).click();
    const trigger = dialog.getByRole("combobox", { name: field === "Type" ? "Select type" : "Select items of type" });
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-invalid", "true");
    const message = dialog.getByText("Type is required");
    const id = await message.getAttribute("id");
    expect(id).toBeTruthy();
    expect((await trigger.getAttribute("aria-describedby"))?.split(" ")).toContain(id);
    await expect(dialog.locator("label").getByText(field, { exact: true })).toHaveAttribute("for", (await trigger.getAttribute("id"))!);
  });
}

test("a second Add click during exit does not submit again", async ({ page }) => {
  await openHarness(page);
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Property Key").fill("email");
  await dialog.getByLabel("Property Title").fill("Email");
  await dialog.getByRole("combobox", { name: "Select type" }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  await page.waitForTimeout(300);
  const box = (await dialog.getByRole("button", { name: /^add property$/i }).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(50);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("body")).toHaveAttribute("data-add-ok", "1");
  await expect(page.locator("body")).not.toHaveAttribute("data-add-error");
});

test("unsupported focus-visible selector still opens a tooltip", async ({ page }) => {
  await openHarness(page);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const matches = Element.prototype.matches;
    Element.prototype.matches = function (this: Element, selector: string): boolean {
      if (selector === ":focus-visible") throw new DOMException("unsupported", "SyntaxError");
      return Boolean(matches.call(this, selector));
    };
  });
  await page.getByRole("button", { name: "Edit constraints" }).first().focus();
  await expect(page.getByRole("tooltip", { name: "Edit constraints" })).toHaveCount(1);
});

test("closing a dialog returns focus to the button that opened it", async ({ page }) => {
  await openHarness(page);
  const add = addButton(page);
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await escapeDialog(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(add).toBeFocused();

  const edit = page.getByRole("button", { name: "Edit constraints" }).first();
  await edit.focus();
  await page.keyboard.press("Enter");
  await escapeDialog(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(page.getByRole("tooltip", { name: "Edit constraints" })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeFocused();

  const remove = rowOf(page, "name").getByRole("button", { name: "Delete" });
  await remove.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog").getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.getByRole("alertdialog").evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  await escapeDialog(page);
  await expect(remove).toBeFocused();
});

test("the Add dialog returns focus after an X or overlay close", async ({ page }) => {
  await openHarness(page);
  for (const close of ["X", "overlay"]) {
    await addButton(page).click();
    if (close === "X") await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    else await page.mouse.click(4, 4);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(addButton(page)).toBeFocused();
  }
});

test("Add submit returns focus to the opener", async ({ page }) => {
  await page.clock.install();
  await openHarness(page);
  await addButton(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Property Key").fill("email");
  await dialog.getByLabel("Property Title").fill("Email");
  await dialog.getByRole("combobox", { name: /select type/i }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  await page.clock.runFor(300);
  await dialog.getByRole("button", { name: /^add property$/i }).click();
  await expect(rowOf(page, "email")).toHaveCount(1);
  await expect(addButton(page)).toBeFocused();
});

test("Add submit resets the form before reopening", async ({ page }) => {
  await openHarness(page);
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Property Key").fill("email");
  await dialog.getByLabel("Property Title").fill("Email");
  await dialog.getByLabel("Description").fill("draft");
  await dialog.getByRole("combobox", { name: "Select type" }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  await page.waitForTimeout(300);
  await dialog.getByRole("button", { name: /^add property$/i }).click();
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await addButton(page).click();
  for (const label of ["Property Key", "Property Title", "Description"]) {
    await expect(dialog.getByLabel(label)).toHaveValue("");
  }
});

test("Escape discards unsaved edits when reopening the same row", async ({ page }) => {
  await openHarness(page);
  const edit = rowOf(page, "name").getByRole("button", { name: "Edit constraints" });
  await edit.click();
  await page.getByRole("dialog").getByLabel("Default Value").fill("draft");
  await escapeDialog(page);
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);
  await edit.click();
  await expect(page.getByRole("dialog").getByLabel("Default Value")).toHaveValue("");
});

test("the Add dialog's Required switch sits beside its label", async ({ page }) => {
  await openHarness(page);
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  const switchBox = await dialog.getByRole("switch", { name: "Required" }).boundingBox();
  const labelBox = await dialog.getByText("Required", { exact: true }).boundingBox();
  expect(switchBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(Math.abs(switchBox!.y + switchBox!.height / 2 - labelBox!.y - labelBox!.height / 2)).toBeLessThan(2);
  expect(labelBox!.x).toBeGreaterThan(switchBox!.x + switchBox!.width);
});

test("the Add dialog starts empty after every close", async ({ page }) => {
  await openHarness(page);
  for (const close of ["Escape", "X", "overlay"]) {
    await addButton(page).click();
    await page.getByRole("dialog").getByLabel("Description").fill("draft");
    if (close === "Escape") await escapeDialog(page);
    else if (close === "X") await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    else await page.mouse.click(4, 4);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await addButton(page).click();
    await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue("");
    await escapeDialog(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("Add submit does not blank the fading form", async ({ page }) => {
  await page.clock.install();
  await openHarness(page);
  await addButton(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Property Key").fill("email");
  await dialog.getByLabel("Property Title").fill("Email");
  await dialog.getByLabel("Description").fill("draft");
  await dialog.getByRole("switch", { name: "Required" }).click();
  await dialog.getByRole("combobox", { name: "Select type" }).click();
  await page.getByRole("option", { name: "string", exact: true }).click();
  await page.clock.runFor(300);
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  await dialog.getByRole("button", { name: /^add property$/i }).click();
  const closed = page.locator('[role=dialog][data-state="closed"]');
  await expect(closed.getByLabel("Property Key")).toHaveValue("email");
  await expect(closed.getByLabel("Description")).toHaveValue("draft");
  await expect(closed.getByRole("combobox", { name: "Select type", includeHidden: true })).toHaveText("string");
  await expect(closed.getByRole("switch", { name: "Required", includeHidden: true })).toBeChecked();
  await expect(closed.getByRole("combobox", { name: "Select constraint", includeHidden: true })).toHaveCount(1);
  await pause.evaluate((el: HTMLStyleElement) => { el.disabled = true; });
  await expect(closed).toHaveCount(0);
  await expect(rowOf(page, "email")).toHaveCount(1);
  await expect(addButton(page)).toBeFocused();
});

test("focus returns to a custom add button", async ({ page }) => {
  await openHarness(page, "?add=custom");
  const add = page.getByRole("button", { name: "Custom add" });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await escapeDialog(page);
  await expect(add).toBeFocused();
});

test("Add opens a fresh session during its exit", async ({ page }) => {
  await page.clock.install();
  await openHarness(page, "?add=custom");
  const add = page.getByRole("button", { name: "Custom add" });
  await add.click();
  await page.getByRole("dialog").getByLabel("Property Key").fill("draft");
  await page.clock.runFor(500);
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  await escapeDialog(page);
  await expect(page.locator('[role=dialog][data-state="closed"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Custom add", includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
  await pause.evaluate((el: HTMLStyleElement) => { el.disabled = true; });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Property Key")).toHaveValue("");
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

test("Delete captures the new opener during its exit", async ({ page }) => {
  await openHarness(page);
  const first = rowOf(page, "name").getByRole("button", { name: "Delete" });
  const second = rowOf(page, "age").getByRole("button", { name: "Delete" });
  await first.click();
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator('[role=alertdialog][data-state="closed"]')).toHaveCount(1);
  await rowOf(page, "age").getByRole("button", { name: "Delete", includeHidden: true }).evaluate((button: HTMLButtonElement) => { button.focus(); button.click(); });
  await pause.evaluate((el: HTMLStyleElement) => { el.disabled = true; });
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(second).toBeFocused();
});

test("focus moved elsewhere during the exit stays there", async ({ page }) => {
  await openHarness(page);
  await addButton(page).click();
  const pause = await page.addStyleTag({ content: "*, *::before, *::after { animation-play-state: paused !important; }" });
  await escapeDialog(page);
  const age = page.getByLabel("Property key for age");
  await age.focus();
  await pause.evaluate((el: HTMLStyleElement) => { el.disabled = true; });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(age).toBeFocused();
});

test("a confirmed delete leaves focus on body without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openHarness(page);
  await page.getByRole("button", { name: "Delete" }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByLabel("Property key for name")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  expect(errors).toEqual([]);
});

test("required switches look the same and take a 24px-tall target", async ({ page }) => {
  await openHarness(page);
  // zoom keeps fractional hit probes distinct in chromium
  await page.addStyleTag({ content: 'body { zoom: 2 }' });
  const switches = page.getByRole("switch", { name: "Required" });
  await expect(switches).toHaveCount(4);
  for (const i of [0, 1, 2, 3]) {
    await switches.nth(i).scrollIntoViewIfNeeded();
    const result = await switches.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const hit = (y: number) => document.elementFromPoint(x, y)?.closest("[role=switch]") === el;
      return { size: [r.width / 2, r.height / 2], hits: [hit(r.top - 1.99 * 2), hit(r.bottom + 1.99 * 2)], misses: [hit(r.top - 2.5 * 2), hit(r.bottom + 2.5 * 2)] };
    });
    expect(result).toEqual({ size: [36, 20], hits: [true, true], misses: [false, false] });
  }
});

const rowKeys = ["name", "age", "address", "tags"];
const widths = [320, 640, 768, 900, 1024, 1150, 1280];
const fitCases: [string, number, string | null][] = [
  ...widths.map((w): [string, number, string | null] => [String(w), w, null]),
  ["1280 in a 400px container", 1280, "#root { width: 400px }"],
  ["320 with a 20px root", 320, "html { font-size: 20px }"],
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
const openEnumInAdd = async (page: Page, type = "string"): Promise<Locator> => {
  await addButton(page).click();
  await page.getByRole("dialog").getByRole("combobox", { name: /select type/i }).click();
  await page.getByRole("option", { name: type, exact: true }).click();
  return addEnumConstraint(page);
};

for (const [which, row, type] of [["Add", 0, "String"], ["Add", 0, "Number"], ["Edit", 0, "String"], ["Edit", 1, "Number"]] as const) {
  test(`${type} enum placeholder fits in the ${which} dialog at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openHarness(page);
    const dialog = await (which === "Add" ? openEnumInAdd(page, type.toLowerCase()) : openEnumInEdit(page, row));
    const input = dialog.getByLabel(`${type} Value`);
    const sizes = await input.evaluate((el: HTMLInputElement) => {
      const style = getComputedStyle(el);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = style.font;
      return {
        placeholder: context.measureText(el.placeholder).width,
        available: el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    });
    expect(sizes.placeholder).toBeLessThanOrEqual(sizes.available);
  });
}

test("a single-type enum editor hides its tab list", async ({ page }) => {
  await openHarness(page);
  const dialog = await openEnumInEdit(page);
  await expect(dialog.getByRole("tab")).toHaveCount(0);
  await expect(dialog.getByRole("tabpanel")).toHaveAccessibleName("String");
});

for (const [type, row, value] of [["String", 0, "abc"], ["Number", 1, "5"]] as const) {
  test(`Enter in the ${type} enum value input adds the value and keeps the Edit dialog open`, async ({ page }) => {
    await openHarness(page);
    const dialog = await openEnumInEdit(page, row);
    const input = dialog.getByPlaceholder(`Enter a ${type.toLowerCase()} value`);
    await expect(dialog.getByLabel(`${type} Value`)).toHaveCount(1);
    await input.fill(value);
    await input.press("Enter");
    await expect(dialog.getByRole("listitem").filter({ hasText: value })).toHaveCount(1);
    await expect(dialog).toBeVisible();
  });
}

test("Enter in the enum value input adds the value and keeps the Add dialog open", async ({ page }) => {
  await openHarness(page);
  const dialog = await openEnumInAdd(page);
  await dialog.getByLabel("Property Key").fill("email");
  await dialog.getByLabel("Property Title").fill("Email");
  await page.waitForTimeout(300);
  const input = dialog.getByPlaceholder("Enter a string value");
  await input.fill("abc");
  await input.press("Enter");
  await expect(dialog.getByRole("listitem").filter({ hasText: "abc" })).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-add-ok");
});

for (const which of ["Add", "Edit"]) {
  for (const width of [320, 768, 1024, 1280]) {
    test(`a long enum value stays inside the ${which} dialog at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHarness(page);
      const dialog = await (which === "Add" ? openEnumInAdd(page) : openEnumInEdit(page, 0));
      await dialog.getByPlaceholder("Enter a string value").fill("a".repeat(63));
      await dialog.getByRole("button", { name: "Add enum" }).click();
      await expect(dialog.getByText("a".repeat(63), { exact: true })).toHaveAttribute("title", "a".repeat(63));
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

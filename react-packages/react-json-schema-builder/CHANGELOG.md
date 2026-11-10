# @satoshibits/react-json-schema-builder

## 1.6.0

### Minor Changes

- baec1ca: Row actions stay inside their row at every width and text size: `--rjsb-autofit-grid` now defaults to `repeat(auto-fit, minmax(min(100%, calc(10.5rem + 8px)), 1fr))` (#94). Long enum values truncate inside the Add and Edit dialogs (#94). Closing a dialog returns focus to the button that opened it; switches have a 24px target; the icon-only row actions show tooltips (new dependency `@radix-ui/react-tooltip`, bundled; `SchemaBuilder` provides it, so there is nothing to wrap); enum placeholders fit at 320px; a single-type enum editor hides its tab list (#95).

  Copy changed: the "Add Property" buttons now read "Add property"; the Add dialog is titled "Add property" with the description "Set the key, type and title. You can add constraints now or after it's created."; "Edit" is now `Edit ${property.title || propertyKey}` with the description "Set a default value and constraints."; the Type select shows "Select a type"; a missing type or Items of type reads "Type is required"; and the Navigate button's tooltip and accessible name are `Open ${property.title || key}`. Apps that select on the old text, the "Navigate" name, or the old fixed enum ids (`string-value`, `number-value`, `true-value`, `false-value`, `null-value`, `object-value`, `array-value`) must update; ids are now unique per editor.

  Also fixed:

  - Edit Save no longer erases fields the dialog doesn't edit, such as an array's nested item schema.
  - E1: Select menus slide in from the correct direction.
  - E2: Dialog animations use the intended 200ms duration.
  - E3: Dialog and alert overlays fade out when closing.
  - E4: The Add dialog resets only after it closes.
  - E5: The missing-type error now sits on its field and reads "Type is required".
  - E6: Enter in an enum value adds it without submitting the dialog.
  - E7: Internal: test coverage tightened.
  - N1: Untitled properties can be saved in the Edit dialog.
  - N2: Enum editor ids are unique per editor.
  - N3: Inputs forward refs so the first invalid field takes focus.
  - N4: The Edit dialog starts from the property being edited.
  - The Add dialog's Required switch now sits beside its label.
  - Edit Save fade: The Edit dialog remains mounted long enough to fade out after saving.

  The builder's animation variables are now private (`--rjsb-enter-*`/`--rjsb-exit-*`), so they no longer touch an app's `--tw-enter-*`/`--tw-exit-*`.

### Patch Changes

- a9efbc9: Rename the sheet's keyframes to `rjsb-enter` and `rjsb-exit`, so they no longer collide with app keyframes named `enter` or `exit` (#93). Classes used only by the package's dev page no longer ship in the sheet. Note for 1.5.0: it renamed the grid variables `--my-autofit-grid` and `--my-autofill-grid` to `--rjsb-autofit-grid` and `--rjsb-autofill-grid`; apps that set the old names must switch.

## 1.5.0

### Minor Changes

- 2b4a796: Make the stylesheet safe to load in either order (#91).

  - No preflight or unscoped element resets; resets apply inside the builder and beat bare-element rules in `@layer base`.
  - Defaults use private `--rjsb-*` tokens. The sheet no longer defines app tokens such as `--primary` for app UI; apps that relied on them must define them. Builder tokens use app values when set. Use complete CSS colours such as `oklch(...)` or `rgb(...)`; bare shadcn v3 HSL channels are unsupported.
  - Builder utilities are `rjsb:`-prefixed. Unprefixed utilities are no longer emitted; non-Tailwind apps that passed classes such as `mt-4` through `*ClassName` props must provide those styles themselves. Internal class selectors also need updating.
  - Tailwind theme variables such as `--spacing` and `--font-mono` are no longer declared or used by builder utilities. `cn()` merges only prefixed classes.
  - Unlayered app element rules and resets override layered builder styles. The inline builder inherits text colour, font and line height and has no root background; colour the page explicitly if needed.
  - The array items strip uses the muted theme colour in dark mode, with a background on its select. Multi-type enum tabs now lay out in columns.
  - Dialogs and selects are portaled into `body`; use `.dark` on `html` or `body` for dark defaults there.
  - The sheet defines global `enter` and `exit` keyframes, which collide with app keyframes of the same names.

## 1.4.3

### Patch Changes

- 2cff0f7: Export `./index.css` unconditionally so CSS resolvers can import it. It was only exported under the `import` and `require` conditions, so resolvers that ask for the `style` condition (Tailwind v4's `@import "@satoshibits/react-json-schema-builder/index.css"`, for one) failed with `"./index.css" is not exported under the condition "style"`.

## 1.4.2

### Patch Changes

- 010dbdd: add more formats

## 1.4.1

### Patch Changes

- 919c501: ensure outer forms aren't submitted

## 1.4.0

### Minor Changes

- 885b51a: enable disabled mode and read-only of properties

## 1.3.0

### Minor Changes

- 0819aa6: enable adding default values

### Patch Changes

- 8272a6e: fix rows not overflowing properly

## 1.2.0

### Minor Changes

- cb429a5: add enum constraint plugin and editor

### Patch Changes

- f4474c6: fix property change logic
- 558292c: add more unit tests for each plugin and fix exports and imports

## 1.1.7

### Patch Changes

- 985bf24: add demo and update package urls

## 1.1.6

### Patch Changes

- d06af43: export utils as well

## 1.1.5

### Patch Changes

- e6409de: export plugins as named

## 1.1.4

### Patch Changes

- a6fe84c: cleanup keys with undefined values

## 1.1.3

### Patch Changes

- 5ff0375: ensure outer forms aren't submitted

## 1.1.2

### Patch Changes

- c5d6c7b: default to type button to prevent unwanted submissions

## 1.1.1

### Patch Changes

- aa5f401: onSchemaChange should be called imperatively, not through useEffect

## 1.1.0

### Minor Changes

- b0f94f8: add duplicate feature to useSchema

## 1.0.3

### Patch Changes

- 06bcd2d: add getValue
- bb99d24: prevent unintentional submission when inside form

## 1.0.2

### Patch Changes

- cd01d9e: fix rollup options and lib name

## 1.0.1

### Patch Changes

- cb1a327: add ability to edit key UI elements classNames

## 1.0.0

### Major Changes

- ef64d51: release react-json-schema-builder v1.0.0
- ef64d51: release react-json-schema-builder v1.0.0

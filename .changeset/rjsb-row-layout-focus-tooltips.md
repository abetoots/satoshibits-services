---
"@satoshibits/react-json-schema-builder": minor
---

Row actions stay inside their row at every width and text size: `--rjsb-autofit-grid` now defaults to `repeat(auto-fit, minmax(min(100%, calc(10.5rem + 8px)), 1fr))` (#94). Long enum values truncate inside the Add and Edit dialogs (#94). Closing a dialog returns focus to the button that opened it; switches have a 24px target; the icon-only row actions show tooltips (new dependency `@radix-ui/react-tooltip`, bundled; `SchemaBuilder` provides it, so there is nothing to wrap); enum placeholders fit at 320px; a single-type enum editor hides its tab list (#95).

Copy changed: the "Add Property" buttons now read "Add property"; the Add dialog is titled "Add property" with the description "Set the key, type and title. You can add constraints now or after it's created."; "Edit" is now `Edit ${property.title || propertyKey}` with the description "Set a default value and constraints."; the Type select shows "Select a type"; a missing type or Items of type reads "Type is required"; and the Navigate button's tooltip and accessible name are `Open ${property.title || key}`. Apps that select on the old text or the "Navigate" name must update.

Also fixed:

- E1: Select menus slide in from the correct direction.
- E2: Dialog animations use the intended 200ms duration.
- E3: Dialog and alert overlays fade out when closing.
- E4: The Add dialog resets only after it closes.
- E5: Missing type errors identify their fields.
- E6: Enter in an enum value adds it without submitting the dialog.
- E7: Tests cover enum errors, dark utilities and dialog states more reliably.
- N1: Untitled properties can be saved in the Edit dialog.
- N2: Enum editor ids are unique per editor.
- N3: Inputs forward refs so the first invalid field takes focus.
- N4: The Edit dialog starts from the property being edited.
- Edit Save fade: The Edit dialog remains mounted long enough to fade out after saving.

The builder's animation variables are now private (`--rjsb-enter-*`/`--rjsb-exit-*`), so they no longer touch an app's `--tw-enter-*`/`--tw-exit-*`.

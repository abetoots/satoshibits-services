---
"@satoshibits/react-json-schema-builder": patch
---

Rename the sheet's keyframes to `rjsb-enter` and `rjsb-exit`, so they no longer collide with app keyframes named `enter` or `exit` (#93). Classes used only by the package's dev page no longer ship in the sheet. Note for 1.5.0: it renamed the grid variables `--my-autofit-grid` and `--my-autofill-grid` to `--rjsb-autofit-grid` and `--rjsb-autofill-grid`; apps that set the old names must switch.

---
"@satoshibits/react-json-schema-builder": minor
---

Make the stylesheet safe to load in either order (#91).

- No preflight or unscoped element resets; resets apply inside the builder and beat bare-element rules in `@layer base`.
- Defaults use private `--rjsb-*` tokens. The sheet no longer defines app tokens such as `--primary` for app UI; apps that relied on them must define them. Builder tokens use app values when set. Use complete CSS colours such as `oklch(...)` or `rgb(...)`; bare shadcn v3 HSL channels are unsupported.
- Builder utilities are `rjsb:`-prefixed. Unprefixed utilities are no longer emitted; non-Tailwind apps that passed classes such as `mt-4` through `*ClassName` props must provide those styles themselves. Internal class selectors also need updating.
- Tailwind theme variables such as `--spacing` and `--font-mono` are no longer declared or used by builder utilities. `cn()` merges only prefixed classes.
- Unlayered app element rules and resets override layered builder styles. The inline builder inherits text colour, font and line height and has no root background; colour the page explicitly if needed.
- The array items strip uses the muted theme colour in dark mode, with a background on its select. Multi-type enum tabs now lay out in columns.
- Dialogs and selects are portaled into `body`; use `.dark` on `html` or `body` for dark defaults there.
- The sheet defines global `enter` and `exit` keyframes, which collide with app keyframes of the same names.

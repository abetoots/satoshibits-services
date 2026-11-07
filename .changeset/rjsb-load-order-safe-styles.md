---
"@satoshibits/react-json-schema-builder": minor
---

Make the stylesheet safe to load in any order (#91). The sheet no longer overrides the host app's styles.

- No preflight, and no unscoped `html`, `body` or `button` rules. Element resets apply only inside the builder (`.rjsb-root`).
- Tailwind's theme variables (`--font-sans`, `--spacing`, ...) are no longer declared. The app's `--spacing`, `--font-mono` and `--text-*` no longer reach the builder.
- Builder classes are now `rjsb:`-prefixed. This matters if you styled the builder through its internal class names.
- Default tokens now yield to the app's tokens in any load order. The "import before your theme" rule is gone.
- `cn()` merges only `rjsb:` classes. Conflicting unprefixed classes passed through `*ClassName` props are no longer de-duplicated: `cn("px-2 px-8")` keeps both.
- With no preflight, the builder inherits the host page's `font-family` and `line-height`.

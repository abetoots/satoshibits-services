---
"@satoshibits/react-json-schema-builder": patch
---

Export `./index.css` unconditionally so CSS resolvers can import it. It was only exported under the `import` and `require` conditions, so resolvers that ask for the `style` condition (Tailwind v4's `@import "@satoshibits/react-json-schema-builder/index.css"`, for one) failed with `"./index.css" is not exported under the condition "style"`.

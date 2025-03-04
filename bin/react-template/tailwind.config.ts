import formsPlugin from "@tailwindcss/forms";

import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  plugins: [formsPlugin()],
} satisfies Config;

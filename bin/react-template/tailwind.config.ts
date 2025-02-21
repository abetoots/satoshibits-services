import formsPlugin from "@tailwindcss/forms";
import { fontFamily } from "tailwindcss/defaultTheme";

import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  plugins: [formsPlugin()],
} satisfies Config;

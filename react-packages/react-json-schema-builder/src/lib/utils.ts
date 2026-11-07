import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// plain (unprefixed) class that the sheet scopes its element resets under
export const ROOT_CLASS = "rjsb-root";

const twMerge = extendTailwindMerge({ prefix: "rjsb" })

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

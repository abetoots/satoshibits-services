import { describe, expect, it } from "vitest";
import { cn, ROOT_CLASS } from "./utils";

describe("cn", () => {
  it("merges conflicting prefixed utilities", () => {
    expect(cn("rjsb:p-2", "rjsb:p-4")).toBe("rjsb:p-4");
    expect(cn("rjsb:md:grid", "rjsb:md:flex")).toBe("rjsb:md:flex");
  });

  it("keeps app utilities and the root class", () => {
    expect(cn("rjsb:px-4", "px-8")).toBe("rjsb:px-4 px-8");
    expect(cn("rjsb:text-sm", "rjsb:text-primary")).toBe("rjsb:text-sm rjsb:text-primary");
    expect(cn("rjsb:p-2", "p-4")).toBe("rjsb:p-2 p-4");
    expect(cn(ROOT_CLASS, "rjsb:w-full")).toBe("rjsb-root rjsb:w-full");
  });
});

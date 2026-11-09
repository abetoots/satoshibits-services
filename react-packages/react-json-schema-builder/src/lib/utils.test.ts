import { describe, expect, it } from "vitest";
import { cn, ROOT_CLASS } from "./utils";

describe("cn", () => {
  it("merges conflicting prefixed utilities", () => {
    expect(cn("rjsb:p-2", "rjsb:p-4")).toBe("rjsb:p-4");
    expect(cn("rjsb:md:grid", "rjsb:md:flex")).toBe("rjsb:md:flex");
  });

  it("keeps app utilities and the root class", () => {
    expect(cn("px-2", "px-8")).toBe("px-2 px-8");
    expect(cn("rjsb:px-4", "px-8")).toBe("rjsb:px-4 px-8");
    expect(cn("rjsb:text-sm", "rjsb:text-primary")).toBe("rjsb:text-sm rjsb:text-primary");
    expect(cn("rjsb:p-2", "p-4")).toBe("rjsb:p-2 p-4");
    expect(cn(ROOT_CLASS, "rjsb:w-full")).toBe("rjsb-root rjsb:w-full");
  });

  it("merges shorthands, longhands and colours", () => {
    expect(cn("rjsb:p-2", "rjsb:px-4")).toBe("rjsb:p-2 rjsb:px-4");
    expect(cn("rjsb:px-4", "rjsb:p-2")).toBe("rjsb:p-2");
    expect(cn("rjsb:bg-primary", "rjsb:bg-muted")).toBe("rjsb:bg-muted");
    expect(cn("rjsb:text-primary", "rjsb:text-muted-foreground")).toBe("rjsb:text-muted-foreground");
    expect(cn("rjsb:text-sm", "rjsb:text-muted-foreground")).toBe("rjsb:text-sm rjsb:text-muted-foreground");
  });
});

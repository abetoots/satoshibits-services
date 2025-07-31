import { describe, expect, it } from "vitest";

import { CacheKeyBuilder, fromTemplate, scopedBuilder } from "../builder.mjs";

describe("CacheKeyBuilder", () => {
  it("builds basic keys", () => {
    const builder = new CacheKeyBuilder();
    const key = builder.namespace("cache").type("data").id("123").build();

    expect(key).toBe("cache:data:123");
  });

  it("builds complex keys with parameters", () => {
    const key = CacheKeyBuilder.create()
      .namespace("api")
      .type("response")
      .id("user-123")
      .param("lang", "en")
      .param("format", "json")
      .version(2)
      .build();

    expect(key).toBe("api:response:user-123:lang_en:format_json:v2");
  });

  it("uses custom separator", () => {
    const builder = new CacheKeyBuilder({ separator: "/" });
    const key = builder
      .namespace("api")
      .type("v1")
      .add("users")
      .id(123)
      .build();

    expect(key).toBe("api/v1/users/123");
  });

  it("sanitizes components by default", () => {
    const builder = new CacheKeyBuilder();
    const key = builder.namespace("data").id("email@example.com").build();

    expect(key).not.toContain("@");
  });

  it("can disable sanitization", () => {
    const builder = new CacheKeyBuilder({ sanitize: false });
    const key = builder.namespace("data").id("email@example.com").build();

    expect(key).toBe("data:email@example.com");
  });

  it("throws on empty key", () => {
    const builder = new CacheKeyBuilder();
    expect(() => builder.build()).toThrow("Cannot build empty cache key");
  });

  it("creates patterns", () => {
    const pattern = CacheKeyBuilder.create()
      .namespace("user")
      .type("profile")
      .pattern();

    expect(pattern).toBe("user:profile:*");
  });

  it("can be cloned", () => {
    const builder1 = CacheKeyBuilder.create().namespace("api").type("v1");

    const builder2 = builder1.clone().add("users");

    expect(builder1.build()).toBe("api:v1");
    expect(builder2.build()).toBe("api:v1:users");
  });

  it("can be reset", () => {
    const builder = CacheKeyBuilder.create().namespace("api").type("v1");

    expect(builder.length).toBe(2);

    builder.reset();
    expect(builder.length).toBe(0);
  });

  it("handles ID objects with toString method", () => {
    const objectId = {
      toString() {
        return "custom-id-123";
      }
    };
    
    const key = CacheKeyBuilder.create()
      .namespace("data")
      .id(objectId)
      .build();
      
    expect(key).toBe("data:custom-id-123");
  });

  it("throws error when ID.toString() fails", () => {
    const badId = {
      toString() {
        throw new Error("Cannot convert to string");
      }
    };
    
    const builder = CacheKeyBuilder.create().namespace("data");
    
    expect(() => builder.id(badId)).toThrow(
      "Failed to convert ID to string: Cannot convert to string"
    );
  });

  it("handles various ID types", () => {
    const builder = CacheKeyBuilder.create();
    
    // string ID
    expect(builder.namespace("test").id("string-id").build()).toBe("test:string-id");
    
    // number ID
    builder.reset();
    expect(builder.namespace("test").id(123).build()).toBe("test:123");
    
    // zero ID
    builder.reset();
    expect(builder.namespace("test").id(0).build()).toBe("test:0");
    
    // negative ID
    builder.reset();
    expect(builder.namespace("test").id(-1).build()).toBe("test:-1");
  });
});

describe("fromTemplate", () => {
  it("replaces placeholders", () => {
    const key = fromTemplate("user:{id}:profile", { id: "123" });
    expect(key).toBe("user:123:profile");
  });

  it("handles multiple placeholders", () => {
    const key = fromTemplate("shop:{shopId}:product:{productId}:inventory", {
      shopId: "shop-123",
      productId: "prod-456",
    });
    expect(key).toBe("shop:shop-123:product:prod-456:inventory");
  });

  it("sanitizes values by default", () => {
    const key = fromTemplate("user:{email}:settings", {
      email: "test@example.com",
    });
    expect(key).not.toContain("@");
  });

  it("can disable sanitization", () => {
    const key = fromTemplate(
      "user:{email}:settings",
      {
        email: "test@example.com",
      },
      false,
    );
    expect(key).toBe("user:test@example.com:settings");
  });

  it("throws on missing placeholder value", () => {
    expect(() => fromTemplate("user:{id}:profile", {})).toThrow(
      "Missing value for placeholder: id",
    );
  });

  it("handles ID objects in template values", () => {
    const objectId = {
      toString() {
        return "obj-123";
      }
    };
    
    const key = fromTemplate("data:{id}:item", { id: objectId });
    expect(key).toBe("data:obj-123:item");
  });

  it("throws error when template value toString() fails", () => {
    const badValue = {
      toString() {
        throw new Error("Conversion error");
      }
    };
    
    expect(() => fromTemplate("data:{id}:item", { id: badValue })).toThrow(
      "Failed to convert value for placeholder 'id' to string: Conversion error"
    );
  });
});

describe("scopedBuilder", () => {
  it("creates builder with base components", () => {
    const apiBuilder = scopedBuilder(["api", "v2"]);
    const key = apiBuilder.add("users").id("123").build();

    expect(key).toBe("api:v2:users:123");
  });

  it("respects custom options", () => {
    const apiBuilder = scopedBuilder(["api", "v2"], { separator: "/" });
    const key = apiBuilder.add("users").id("123").build();

    expect(key).toBe("api/v2/users/123");
  });
});

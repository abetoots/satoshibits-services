import { describe, expect, it } from "vitest";

import { cutUrl, cutUrls } from "./urls.mjs";

describe("cutUrls: every URL in a text, down to scheme, host and path", () => {
  const cut = cutUrls();

  it.each([
    ["GET https://api.example.com/v1/users?token=abc failed", "GET https://api.example.com/v1/users failed"],
    ["https://user:pass@host.example/path", "https://host.example/path"],
    ["see https://example.com/a#section-2 for more", "see https://example.com/a for more"],
    ["https://user:p%40ss@h.example:8443/a/b?x=1&y=2#frag", "https://h.example:8443/a/b"],
    ["redis://:secret@cache.internal:6379/0", "redis://cache.internal:6379/0"],
    ["mongodb+srv://app:pw@cluster0.example.net/db?retryWrites=true", "mongodb+srv://cluster0.example.net/db"],
    ["http://[::1]:4318/v1/traces?k=v", "http://[::1]:4318/v1/traces"],
    ["https://example.com?only=query", "https://example.com"],
    ["https://example.com#only-fragment", "https://example.com"],
    // an "@" after the path has begun is not user-info
    ["https://example.com/users/@me?x=1", "https://example.com/users/@me"],
    // the last "@" of the authority ends the user-info, whatever is in it
    ["https://a@b@host.example/", "https://host.example/"],
  ])("%j", (given, expected) => {
    expect(cut(given)).toBe(expected);
  });

  it.each([
    ["(see https://example.com/a?x=1), then", "(see https://example.com/a), then"],
    ["at https://example.com/a?x=1.", "at https://example.com/a."],
    ['url="https://example.com/a?x=1"', 'url="https://example.com/a"'],
    ["<https://example.com/a?x=1>", "<https://example.com/a>"],
    ["read https://example.com/docs/errors.", "read https://example.com/docs/errors."],
    ["is it https://example.com/a?x=1?!", "is it https://example.com/a?!"],
  ])("leaves the punctuation after a URL in place: %j", (given, expected) => {
    expect(cut(given)).toBe(expected);
  });

  it("cuts each of several", () => {
    expect(cut("from http://a.example/x?1 to http://b.example/y?2")).toBe(
      "from http://a.example/x to http://b.example/y",
    );
  });

  it.each([
    "no URL here",
    "a ratio of 3://4", // no scheme: a scheme starts with a letter
    "://nothing-before",
    "https://example.com/plain/path",
    "see example.com/a?x=1", // only the scheme:// spelling is a URL here
  ])("leaves %j as it is", (given) => {
    expect(cut(given)).toBe(given);
  });

  it("ends a URL at whitespace: what follows is not part of it", () => {
    expect(cut("https://example.com/a?x=1 token=kept")).toBe("https://example.com/a token=kept");
    expect(cut("https://example.com/a?x=1\tb\nhttps://example.com/c#d")).toBe(
      "https://example.com/a\tb\nhttps://example.com/c",
    );
  });

  it("takes time that grows with the length of the text", () => {
    const LENGTH = 96_000;
    for (const unit of ["://", "a://", "http://a?", "a", ".", "http://a@", "x "]) {
      const text = unit.repeat(Math.ceil(LENGTH / unit.length));
      const best = Math.min(
        ...[0, 1, 2].map(() => {
          const before = performance.now();
          cut(text);
          return performance.now() - before;
        }),
      );
      expect(best, `on ${JSON.stringify(unit)} repeated`).toBeLessThan(250);
    }
  });
});

describe("cutUrl: a value that is a URL, or a path with a query", () => {
  it.each([
    ["https://user:pw@example.com/a?x=1#f", "https://example.com/a"],
    ["/v1/users?email=a%40b.com", "/v1/users"],
    ["/v1/users#top", "/v1/users"],
    ["/v1/users", "/v1/users"],
    ["?x=1", ""],
    ["", ""],
    // a value with a space in it is still one value: all of it after the query mark goes
    ["/search?q=two words", "/search"],
    ["https://example.com/a b?x=1", "https://example.com/a b"],
  ])("%j", (given, expected) => {
    expect(cutUrl(given)).toBe(expected);
  });
});

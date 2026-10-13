import { describe, expect, it } from "vitest";

import { anyKey, exactKeys, keyEndsWith, keyWords, wordsOfKey } from "./keys.mjs";

describe("wordsOfKey: a key as segments, each as its words", () => {
  it.each<[string, string[][]]>([
    ["password", [["password"]]],
    ["http.request.header.authorization", [["http"], ["request"], ["header"], ["authorization"]]],
    ["gen_ai.usage.input_tokens", [["gen", "ai"], ["usage"], ["input", "tokens"]]],
    ["x-api-key", [["x", "api", "key"]]],
    ["accessToken", [["access", "token"]]],
    ["APIKey", [["api", "key"]]],
    ["userID", [["user", "id"]]],
    ["OAuth2Token", [["o", "auth", "2", "token"]]],
    ["Password1", [["password", "1"]]],
    ["sha256sum", [["sha", "256", "sum"]]],
    ["set-cookie", [["set", "cookie"]]],
    ["a..b", [["a"], [], ["b"]]],
    ["with space", [["with", "space"]]],
    ["", [[]]],
  ])("%j", (key, expected) => {
    expect(wordsOfKey(key)).toEqual(expected);
  });
});

describe("exactKeys", () => {
  const rule = exactKeys("client.address", "network.peer.address");

  it("matches the keys named and no other", () => {
    expect(rule("client.address")).toBe(true);
    expect(rule("network.peer.address")).toBe(true);
    expect(rule("server.address")).toBe(false);
    expect(rule("client.address.extra")).toBe(false);
    expect(rule("Client.Address")).toBe(false);
  });
});

describe("keyWords: a word, or words in a row, anywhere in a key", () => {
  const rule = keyWords("password", "api key", "authorization");

  it.each([
    "password",
    "user.password",
    "db_password",
    "passwordHash",
    "password.confirm",
    "PASSWORD",
    "api_key",
    "x-api-key",
    "apiKey",
    "http.request.header.authorization",
    "http.request.header.proxy-authorization",
    "Password1",
    "newPassword2",
  ])("matches %j", (key) => {
    expect(rule(key)).toBe(true);
  });

  it.each([
    "passwords", // another word
    "passwordless_login", // one word, and not "password"
    "api.key", // the two words are in different segments
    "key_api", // not in that order
    "api_public_key", // not in a row
    "author",
    "server.address",
    "",
  ])("leaves %j", (key) => {
    expect(rule(key)).toBe(false);
  });

  it("takes a phrase written with any of the separators a key has", () => {
    expect(keyWords("private_key")("privateKey")).toBe(true);
    expect(keyWords("private-key")("rsa.private_key.pem")).toBe(true);
  });
});

describe("keyEndsWith: the words a key ends with", () => {
  const rule = keyEndsWith("token");

  it.each(["token", "access_token", "refreshToken", "http.request.header.x-amz-security-token", "auth.id_token"])(
    "matches %j",
    (key) => {
      expect(rule(key)).toBe(true);
    },
  );

  it.each([
    "gen_ai.usage.input_tokens", // a count, and another word
    "gen_ai.token.type", // the word is not what the key ends with
    "token_count",
    "tokenizer",
    "",
  ])("leaves %j", (key) => {
    expect(rule(key)).toBe(false);
  });
});

describe("anyKey", () => {
  it("matches when one of its rules does", () => {
    const rule = anyKey(exactKeys("a"), keyWords("secret"));
    expect(rule("a")).toBe(true);
    expect(rule("client_secret")).toBe(true);
    expect(rule("b")).toBe(false);
  });

  it("with no rule, matches nothing", () => {
    expect(anyKey()("password")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { PolicyParts } from "./policy.mjs";

import { REDACTED } from "./masks.mjs";
import { createFieldsRedactor, createPolicy } from "./policy.mjs";
import {
  redactFields,
  standardMasks,
  standardParts,
  standardPolicy,
  standardRules,
} from "./standard.mjs";

const SECRET = "s3cr3t-value";
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const SURFACES = ["span", "link", "resource", "scope", "a surface not known yet"];

describe("the standard policy on an attribute set", () => {
  describe.each(SURFACES)("on %j", (surface) => {
    const attributes = (given: Record<string, unknown>): Record<string, unknown> =>
      standardPolicy.attributes(surface, given);

    it("leaves what the semantic conventions use to locate and count", () => {
      const given = {
        "server.address": "api.example.com",
        "server.port": 443,
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.token.type": "input",
        "http.response.status_code": 200,
        "http.request.method": "GET",
        "http.route": "/health",
        "url.path": "/health",
        "url.scheme": "https",
        "user_agent.original": "curl/8.5.0",
        "db.system.name": "mongodb",
        "messaging.kafka.message.key": "order-17",
      };
      expect(attributes(given)).toEqual(given);
    });

    it.each(["client.address", "network.peer.address", "http.client_ip", "net.peer.ip", "net.sock.peer.addr"])(
      "drops %j, key and value",
      (key) => {
        expect(attributes({ [key]: "203.0.113.7", kept: 1 })).toEqual({ kept: 1 });
      },
    );

    it.each([
      "http.request.header.authorization",
      "http.request.header.proxy-authorization",
      "http.request.header.cookie",
      "http.response.header.set-cookie",
      "http.request.header.x-api-key",
      "http.request.header.x-amz-security-token",
      "password",
      "db_password",
      "api_key",
      "apiKey",
      "client_secret",
      "access_token",
      "refreshToken",
      "aws.credentials",
      "tls.private_key",
      "db.connection_string",
    ])("redacts the value under %j", (key) => {
      expect(attributes({ [key]: SECRET })).toEqual({ [key]: REDACTED });
    });

    it("redacts an array or an object under such a key whole", () => {
      expect(
        attributes({
          "http.request.header.authorization": [`Bearer ${SECRET}`, "second"],
          password: { current: SECRET, previous: [SECRET] },
          api_key: 12345,
        }),
      ).toEqual({
        "http.request.header.authorization": REDACTED,
        password: REDACTED,
        api_key: REDACTED,
      });
    });

    it("leaves an absent value under such a key absent", () => {
      expect(attributes({ password: undefined, api_key: null })).toEqual({
        password: undefined,
        api_key: null,
      });
    });

    it.each([
      ["http.url", "https://user:pw@api.example.com/v1/users?token=abc#top", "https://api.example.com/v1/users"],
      ["url.full", "https://api.example.com/v1/users?email=a%40b.com", "https://api.example.com/v1/users"],
      ["http.target", "/v1/users?token=abc", "/v1/users"],
      ["http.target", "/search?q=two words&k=v", "/search"],
    ])("removes the query string from %j", (key, given, expected) => {
      expect(attributes({ [key]: given })).toEqual({ [key]: expected });
    });

    it("drops url.query", () => {
      expect(attributes({ "url.query": "token=abc", "url.path": "/a" })).toEqual({ "url.path": "/a" });
    });

    it("masks an email and a credential shape in a value under any other key", () => {
      expect(
        attributes({
          "enduser.id": "jane@example.com",
          note: `refused ${JWT}`,
          "db.query.text": "find user a@b.io",
          list: ["a@b.io", 3, `Bearer ${"t".repeat(20)}`],
        }),
      ).toEqual({
        "enduser.id": "[EMAIL]",
        note: `refused ${REDACTED}`,
        "db.query.text": "find user [EMAIL]",
        list: ["[EMAIL]", 3, REDACTED],
      });
    });

    it("cuts a URL found in a value under any other key", () => {
      expect(attributes({ "error.detail": "GET https://h.example/a?sig=abc failed." })).toEqual({
        "error.detail": "GET https://h.example/a failed.",
      });
    });

    it("leaves a value that is not a text as it is", () => {
      const bytes = new Uint8Array([1, 2]);
      const given = { count: 3, ok: true, none: null, missing: undefined, bytes };
      const result = attributes(given);
      expect(result).toEqual(given);
      expect(result.bytes).toBe(bytes);
    });

    it("does not change what it is given", () => {
      const given = Object.freeze({
        password: SECRET,
        "client.address": "203.0.113.7",
        list: Object.freeze(["a@b.io"]),
      });
      standardPolicy.attributes(surface, given);
      expect(given).toEqual({ password: SECRET, "client.address": "203.0.113.7", list: ["a@b.io"] });
    });
  });

  it("treats a key named __proto__ as a key", () => {
    const given = JSON.parse('{"__proto__": {"password": "s3cr3t-value"}, "a": 1}') as Record<string, unknown>;
    const result = standardPolicy.attributes("span", given);
    expect(Object.keys(result)).toEqual(["__proto__", "a"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("the standard policy on a text", () => {
  it.each(["span.name", "scope.name", "diagnostics", "a surface not known yet"])("on %j", (surface) => {
    expect(standardPolicy.text(surface, "GET https://h.example/users/a@b.io?k=v for jane@example.com")).toBe(
      "GET https://h.example/users/[EMAIL] for [EMAIL]",
    );
    expect(standardPolicy.text(surface, `Authorization: Bearer ${"t".repeat(20)}`)).toBe(
      `Authorization: ${REDACTED}`,
    );
    expect(standardPolicy.text(surface, `key sk_live_${"a".repeat(24)} and ${JWT}`)).toBe(
      `key ${REDACTED} and ${REDACTED}`,
    );
    expect(standardPolicy.text(surface, "401 Incorrect API key provided: sk-proj-Ab12Cd34Ef56Gh78.")).toBe(
      `401 Incorrect API key provided: ${REDACTED}.`,
    );
    expect(standardPolicy.text(surface, "login failed, password: hunter2")).toBe(
      `login failed, password: ${REDACTED}`,
    );
  });

  it("leaves a clean text as it is", () => {
    for (const clean of ["GET /health", "db.find users", "worker:send-email", "Cannot read properties of undefined"]) {
      expect(standardPolicy.text("span.name", clean)).toBe(clean);
    }
  });

  it("cuts a URL's user-info before the email mask can take it for an address", () => {
    expect(standardPolicy.text("diagnostics", "connect redis://app:pw@cache.example.com:6379 failed")).toBe(
      "connect redis://cache.example.com:6379 failed",
    );
  });
});

describe("the standard policy on a span", () => {
  it("drops status text", () => {
    expect(standardPolicy.spanStatus("duplicate key jane@example.com")).toBeUndefined();
    expect(standardPolicy.spanStatus("")).toBeUndefined();
  });

  it("keeps an exception event's type and drops its message and stack", () => {
    expect(
      standardPolicy.spanEvent({
        name: "exception",
        attributes: {
          "exception.type": "MongoServerError",
          "exception.message": "E11000 duplicate key { email: jane@example.com }",
          "exception.stacktrace": "MongoServerError: E11000…\n    at insert (db.mjs:1:1)",
          "exception.escaped": false,
          "client.address": "203.0.113.7",
        },
      }),
    ).toEqual({
      name: "exception",
      attributes: { "exception.type": "MongoServerError", "exception.escaped": false },
    });
  });

  it("treats an event of another name by the attribute rules alone", () => {
    expect(
      standardPolicy.spanEvent({
        name: "retry for jane@example.com",
        attributes: { "exception.message": "to a@b.io", password: SECRET, attempt: 2 },
      }),
    ).toEqual({
      name: "retry for [EMAIL]",
      attributes: { "exception.message": "to [EMAIL]", password: REDACTED, attempt: 2 },
    });
  });

  it("does not change the event it is given", () => {
    const event = { name: "exception", attributes: { "exception.message": "m" } };
    standardPolicy.spanEvent(event);
    expect(event).toEqual({ name: "exception", attributes: { "exception.message": "m" } });
  });
});

describe("the standard policy on a log record", () => {
  it("retains an exception's message and stack: a clean text unchanged, an email in one masked", () => {
    const stack = "TypeError: fetch failed\n    at send (mail.mjs:10:3)";
    expect(
      standardPolicy.logRecord({
        body: "send failed",
        attributes: {
          "exception.type": "TypeError",
          "exception.message": "fetch failed",
          "exception.stacktrace": stack,
        },
      }),
    ).toEqual({
      body: "send failed",
      attributes: {
        "exception.type": "TypeError",
        "exception.message": "fetch failed",
        "exception.stacktrace": stack,
      },
    });
    expect(
      standardPolicy.logRecord({
        body: "send failed",
        attributes: {
          "exception.message": "no mailbox jane@example.com",
          "exception.stacktrace": "Error: no mailbox jane@example.com\n    at send (mail.mjs:10:3)",
        },
      }).attributes,
    ).toEqual({
      "exception.message": "no mailbox [EMAIL]",
      "exception.stacktrace": "Error: no mailbox [EMAIL]\n    at send (mail.mjs:10:3)",
    });
  });

  it("masks a text body, the event name and the severity text", () => {
    expect(
      standardPolicy.logRecord({
        body: "welcome sent to jane@example.com",
        attributes: {},
        eventName: "mail.sent a@b.io",
        severityText: "INFO a@b.io",
      }),
    ).toEqual({
      body: "welcome sent to [EMAIL]",
      attributes: {},
      eventName: "mail.sent [EMAIL]",
      severityText: "INFO [EMAIL]",
    });
  });

  it("adds no event name or severity text where there was none", () => {
    const result = standardPolicy.logRecord({ body: "b", attributes: {} });
    expect(Object.keys(result).sort()).toEqual(["attributes", "body"]);
  });

  it("walks a nested body with the key rules at every level", () => {
    expect(
      standardPolicy.logRecord({
        body: { user: { email: "jane@example.com", password: SECRET, tags: ["a@b.io"] }, count: 1 },
        attributes: { req: { headers: { authorization: `Bearer ${SECRET}`, host: "h" } } },
      }),
    ).toEqual({
      body: { user: { email: "[EMAIL]", password: REDACTED, tags: ["[EMAIL]"] }, count: 1 },
      attributes: { req: { headers: { authorization: REDACTED, host: "h" } } },
    });
  });

  it("leaves a body that is not a text, an array or a plain object as it is", () => {
    for (const body of [3, true, null, undefined]) {
      expect(standardPolicy.logRecord({ body, attributes: {} }).body).toBe(body);
    }
  });
});

describe("redactFields: the standard policy over a logger's fields", () => {
  it.each([
    ["one", { password: SECRET }, { password: REDACTED }],
    ["two", { user: { password: SECRET } }, { user: { password: REDACTED } }],
    ["three", { req: { body: { api_key: SECRET } } }, { req: { body: { api_key: REDACTED } } }],
    ["three, inside an array", { items: [{ auth: { access_token: SECRET } }] }, { items: [{ auth: { access_token: REDACTED } }] }],
  ])("removes a secret at depth %s", (_depth, given, expected) => {
    expect(redactFields(given)).toEqual(expected);
  });

  it("masks every string and applies the drop and URL rules at any depth", () => {
    expect(
      redactFields({
        msg: "to jane@example.com",
        http: { "client.address": "203.0.113.7", "url.full": "https://h.example/a?k=v", status: 200 },
      }),
    ).toEqual({ msg: "to [EMAIL]", http: { "url.full": "https://h.example/a", status: 200 } });
  });

  it("keeps an error's message and stack, masked", () => {
    expect(redactFields({ err: { name: "Error", message: "no mailbox a@b.io", stack: "Error: no mailbox a@b.io" } })).toEqual({
      err: { name: "Error", message: "no mailbox [EMAIL]", stack: "Error: no mailbox [EMAIL]" },
    });
  });

  it("masks a text given by itself, and returns anything else that is not an object as given", () => {
    expect(redactFields("to a@b.io")).toBe("to [EMAIL]");
    expect(redactFields(3)).toBe(3);
    expect(redactFields(null)).toBeNull();
    expect(redactFields(undefined)).toBeUndefined();
  });

  it("returns a value that is not a plain object or an array as given, by identity", () => {
    const date = new Date(0);
    const error = new Error(`with ${SECRET}`);
    const map = new Map([["password", SECRET]]);
    const result = redactFields({ date, error, map }) as Record<string, unknown>;
    expect(result.date).toBe(date);
    expect(result.error).toBe(error);
    expect(result.map).toBe(map);
  });

  it("marks an object that contains itself, and still redacts around it", () => {
    const fields: Record<string, unknown> = { password: SECRET, name: "n" };
    fields.self = fields;
    const list: unknown[] = ["a@b.io"];
    list.push(list);
    expect(redactFields({ fields, list })).toEqual({
      fields: { password: REDACTED, name: "n", self: "[CIRCULAR]" },
      list: ["[EMAIL]", "[CIRCULAR]"],
    });
  });

  it("does not take the same object twice in one line for one that contains itself", () => {
    const shared = { email: "a@b.io" };
    expect(redactFields({ first: shared, second: shared, both: [shared, shared] })).toEqual({
      first: { email: "[EMAIL]" },
      second: { email: "[EMAIL]" },
      both: [{ email: "[EMAIL]" }, { email: "[EMAIL]" }],
    });
  });

  it("stops at a depth, with a mark and nothing of what lies deeper", () => {
    let deep: Record<string, unknown> = { password: SECRET, email: "a@b.io" };
    for (let level = 0; level < 40; level++) deep = { next: deep };
    const result = JSON.stringify(redactFields(deep));
    expect(result).toContain("[TOO_DEEP]");
    expect(result).not.toContain(SECRET);
    expect(result).not.toContain("a@b.io");
  });

  it("does not change what it is given", () => {
    const given = { user: { password: SECRET, emails: ["a@b.io"] } };
    redactFields(given);
    expect(given).toEqual({ user: { password: SECRET, emails: ["a@b.io"] } });
  });
});

describe("a policy of one's own, from the parts", () => {
  const given = {
    password: SECRET,
    access_token: SECRET,
    "client.address": "203.0.113.7",
    "url.query": "k=v",
    "url.full": "https://h.example/a?k=v",
    note: "to a@b.io",
  };
  const standard = {
    password: REDACTED,
    access_token: REDACTED,
    "url.full": "https://h.example/a",
    note: "to [EMAIL]",
  };
  const withParts = (changed: Partial<PolicyParts>): Record<string, unknown> =>
    createPolicy({ ...standardParts, ...changed }).attributes("span", given);

  it("the standard parts make the standard policy", () => {
    expect(withParts({})).toEqual(standard);
    expect(standardPolicy.attributes("span", given)).toEqual(standard);
  });

  it.each<[string, Partial<PolicyParts>, Record<string, unknown>]>([
    [
      "the rule for keys ending in token",
      { redactKeys: standardParts.redactKeys.filter((rule) => rule !== standardRules.tokens) },
      { ...standard, access_token: SECRET },
    ],
    [
      "the rule for sensitive words",
      { redactKeys: standardParts.redactKeys.filter((rule) => rule !== standardRules.sensitiveWords) },
      { ...standard, password: SECRET },
    ],
    [
      "the rule for peer addresses",
      { dropKeys: standardParts.dropKeys.filter((rule) => rule !== standardRules.peerAddresses) },
      { ...standard, "client.address": "203.0.113.7" },
    ],
    [
      "the rule for url.query",
      { dropKeys: standardParts.dropKeys.filter((rule) => rule !== standardRules.urlQuery) },
      // the value is then a text like any other; this one has nothing a mask knows
      { ...standard, "url.query": "k=v" },
    ],
    [
      "the rule for URL attributes",
      { urlKeys: [] },
      // still a text with a URL in it, which the text masks cut
      { ...standard, "url.full": "https://h.example/a" },
    ],
    [
      "the email mask",
      { textMasks: standardParts.textMasks.filter((mask) => mask !== standardMasks.emails) },
      { ...standard, note: "to a@b.io" },
    ],
    [
      "the URL mask and the rule for URL attributes",
      { urlKeys: [], textMasks: standardParts.textMasks.filter((mask) => mask !== standardMasks.urls) },
      { ...standard, "url.full": "https://h.example/a?k=v" },
    ],
  ])("without %s, it behaves as the standard one minus that", (_what, changed, expected) => {
    expect(withParts(changed)).toEqual(expected);
  });

  it("an allowed key is left as given, whatever the rules say", () => {
    expect(
      withParts({ allowKeys: ["password", "client.address", "url.full", "note"] }),
    ).toEqual({
      ...standard,
      password: SECRET,
      "client.address": "203.0.113.7",
      "url.full": "https://h.example/a?k=v",
      note: "to a@b.io",
    });
  });

  it("allows a key exactly as written, and only at the level it is written", () => {
    const policy = createPolicy({ ...standardParts, allowKeys: ["enduser.id"] });
    expect(policy.attributes("span", { "enduser.id": "a@b.io", "Enduser.Id": "a@b.io" })).toEqual({
      "enduser.id": "a@b.io",
      "Enduser.Id": "[EMAIL]",
    });
  });

  it("takes another replacement", () => {
    expect(createPolicy({ ...standardParts, replacement: "***" }).attributes("span", { password: SECRET })).toEqual({
      password: "***",
    });
  });

  it("keeps span status text and exception detail when told to, masked", () => {
    const policy = createPolicy({ ...standardParts, dropSpanStatusText: false, dropSpanExceptionDetail: false });
    expect(policy.spanStatus("refused a@b.io")).toBe("refused [EMAIL]");
    expect(
      policy.spanEvent({ name: "exception", attributes: { "exception.message": "refused a@b.io" } }),
    ).toEqual({ name: "exception", attributes: { "exception.message": "refused [EMAIL]" } });
  });

  it("the fields form follows the same parts", () => {
    const redact = createFieldsRedactor({ ...standardParts, allowKeys: ["email"], replacement: "***" });
    expect(redact({ user: { email: "a@b.io", password: SECRET } })).toEqual({
      user: { email: "a@b.io", password: "***" },
    });
  });

  it("the standard parts cannot be changed in place", () => {
    expect(Object.isFrozen(standardParts)).toBe(true);
    expect(Object.isFrozen(standardParts.textMasks)).toBe(true);
    expect(Object.isFrozen(standardParts.redactKeys)).toBe(true);
    expect(Object.isFrozen(standardRules)).toBe(true);
    expect(Object.isFrozen(standardMasks)).toBe(true);
  });

  it("remembers a key's decision without mixing up two policies", () => {
    const strict = createPolicy(standardParts);
    const lax = createPolicy({ ...standardParts, redactKeys: [] });
    for (let round = 0; round < 2; round++) {
      expect(strict.attributes("span", { password: SECRET })).toEqual({ password: REDACTED });
      expect(lax.attributes("span", { password: SECRET })).toEqual({ password: SECRET });
    }
  });

  it("still decides rightly for more keys than it remembers", () => {
    const policy = createPolicy(standardParts);
    for (let index = 0; index < 5000; index++) policy.attributes("span", { [`key_${index}`]: "v" });
    expect(policy.attributes("span", { late_password: SECRET, "late.client.address": "x", "client.address": "x" })).toEqual({
      late_password: REDACTED,
      "late.client.address": "x",
    });
  });
});

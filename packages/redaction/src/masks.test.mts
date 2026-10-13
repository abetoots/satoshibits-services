import { describe, expect, it } from "vitest";

import type { Mask } from "./masks.mjs";

import {
  composeMasks,
  maskApiKeys,
  maskBearerTokens,
  maskCardNumbers,
  maskEmails,
  maskGroupedDigits,
  maskIpv4Addresses,
  maskJwts,
  maskLongDigits,
  maskPasswordPairs,
  maskPhoneNumbers,
  maskProviderKeys,
  maskSsns,
  maskUuids,
  REDACTED,
} from "./masks.mjs";

// a real-shaped token: three base64url segments, the first one a JSON header
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("maskEmails", () => {
  const mask = maskEmails();

  it.each([
    ["Contact john.doe@example.com today", "Contact [EMAIL] today"],
    ["a@x.com and b@y.io", "[EMAIL] and [EMAIL]"],
    ["<first.last+tag@sub.example.co.uk>", "<[EMAIL]>"],
    ["mailto:a_b%c@host-name.org.", "mailto:[EMAIL]."],
    // the address ends where its last label of two letters or more ends
    ["a@b.com.123", "[EMAIL].123"],
    ["a@b.com1", "[EMAIL]1"],
    ["at the end a@b.co", "at the end [EMAIL]"],
  ])("masks the address in %j", (given, expected) => {
    expect(mask(given)).toBe(expected);
  });

  it.each([
    "no address here",
    "a@b", // no dot
    "a@b.c", // a last label of one letter
    "a@b.c0m", // a last label that is not letters
    "@example.com", // nothing before the sign
    "a@.com", // nothing between the sign and the dot
    "price @ 3.50 each",
  ])("leaves %j as it is", (given) => {
    expect(mask(given)).toBe(given);
  });

  it("takes the replacement it is given", () => {
    expect(maskEmails("<email>")("to a@b.com")).toBe("to <email>");
  });

  it("hands a replacement function the two sides of the address", () => {
    const partial = maskEmails((local, domain) => `${local.charAt(0)}***@${domain}`);
    expect(partial("from john.doe@example.com, cc a@b.io")).toBe(
      "from j***@example.com, cc a***@b.io",
    );
  });

  it("masks two addresses that share a run of characters", () => {
    // the first ends at its last label; what follows starts the second
    expect(mask("a@b.com-c@d.org")).toBe("[EMAIL][EMAIL]");
    expect(mask("a@b.com,c@d.org")).toBe("[EMAIL],[EMAIL]");
  });
});

describe("maskJwts", () => {
  const mask = maskJwts();

  it("masks a token, wherever it stands", () => {
    expect(mask(`token ${JWT} was refused`)).toBe(`token ${REDACTED} was refused`);
    expect(mask(JWT)).toBe(REDACTED);
    expect(mask(`"${JWT}"`)).toBe(`"${REDACTED}"`);
  });

  it("masks each of several", () => {
    expect(mask(`${JWT} ${JWT}`)).toBe(`${REDACTED} ${REDACTED}`);
  });

  it.each([
    "eyJhbGciOiJIUzI1NiJ9", // one segment
    "eyJhbGciOiJIUzI1NiJ9.payload", // two
    "eyJ.a.b", // nothing after the prefix in the first segment
    "eyJa..b", // an empty segment
    "keyJa.b.c", // the prefix does not start a word
    "eyJa.b.---", // a last segment with no letter or digit in it
  ])("leaves %j as it is", (given) => {
    expect(mask(given)).toBe(given);
  });

  it("stops the token at the last letter or digit of its third segment", () => {
    expect(mask("eyJa.b.c-- next")).toBe(`${REDACTED}-- next`);
    expect(mask("eyJa.b.c.d")).toBe(`${REDACTED}.d`);
  });

  it("finds a token after a prefix that did not start one", () => {
    expect(mask("eyJa. eyJb.c.d")).toBe(`eyJa. ${REDACTED}`);
    expect(mask("eyJa.b eyJ-eyJc.d.e")).toBe(`eyJa.b ${REDACTED}`);
    // a prefix inside a token's first segment is part of that token
    expect(mask("eyJa-eyJb.c.d")).toBe(REDACTED);
  });
});

describe("the masks kept from the library's sanitizer", () => {
  it.each<[string, Mask, string, string]>([
    ["a card number", maskCardNumbers(), "card 4111 1111 1111 1111 ok", `card ${REDACTED} ok`],
    ["a card number with hyphens", maskCardNumbers(), "4111-1111-1111-1111", REDACTED],
    ["a US social security number", maskSsns(), "ssn 123-45-6789.", `ssn ${REDACTED}.`],
    ["a password pair", maskPasswordPairs(), "password: hunter2 next", `password: ${REDACTED} next`],
    ["a password pair, other spellings", maskPasswordPairs(), "PWD:abc passwd:  x", `PWD: ${REDACTED} passwd: ${REDACTED}`],
    ["a phone number", maskPhoneNumbers(), "call 555-123-4567 now", "call ***-***-*** now"],
    ["an IPv4 address", maskIpv4Addresses(), "from 192.168.1.10 to", "from ***.***.*** to"],
    ["a UUID", maskUuids(), "id 123e4567-e89b-12d3-a456-426614174000", "id ********-****-****-****-************"],
    ["a Stripe key", maskApiKeys(), "sk_live_abcdefghijklmnopqrstuvwx", REDACTED],
    ["a prefixed key", maskApiKeys(), "api_abcdefghijklmnop rest", `${REDACTED} rest`],
    ["an AWS access key id", maskApiKeys(), "AKIAIOSFODNN7EXAMPLE", REDACTED],
    ["a GitHub token", maskApiKeys(), `ghp_${"a".repeat(36)}`, REDACTED],
    ["a Slack token", maskApiKeys(), "xoxb-1234567890-abc", REDACTED],
    ["a SendGrid key", maskApiKeys(), "SG.abcdefgh.ijklmnop", REDACTED],
    ["an Anthropic key", maskApiKeys(), `sk-ant-${"a".repeat(20)}`, REDACTED],
  ])("masks %s", (_what, mask, given, expected) => {
    expect(mask(given)).toBe(expected);
  });

  it.each<[string, Mask, string]>([
    ["a number of twelve digits", maskCardNumbers(), "123456789012"],
    ["a date", maskSsns(), "2026-10-14"],
    ["a version", maskIpv4Addresses(), "1.2.3"],
    ["a short hex id", maskUuids(), "123e4567-e89b"],
    ["a hash", maskApiKeys(), "d41d8cd98f00b204e9800998ecf8427e"],
    ["a model id", maskApiKeys(), "gpt-4o-mini"],
  ])("leaves %s as it is", (_what, mask, given) => {
    expect(mask(given)).toBe(given);
  });

  it("takes the replacement it is given", () => {
    expect(maskCardNumbers("#")("4111111111111111")).toBe("#");
    expect(maskPasswordPairs("#")("pwd: x")).toBe("pwd: #");
  });
});

describe("the masks an AI gateway needs", () => {
  // the two functions as Websand's gateway has them, built from the parts;
  // the cases are that file's own tests
  const redactPii = composeMasks(maskEmails(), maskLongDigits(), maskGroupedDigits());
  const redactSecrets = composeMasks(maskProviderKeys("[SECRET]"), maskBearerTokens("[SECRET]"));

  describe("personal data going out", () => {
    it("masks an email address", () => {
      expect(redactPii("Contact john.doe@example.com today")).toBe("Contact [EMAIL] today");
    });

    it("masks every email when several are present", () => {
      expect(redactPii("a@x.com and b@y.io")).toBe("[EMAIL] and [EMAIL]");
    });

    it("masks a long digit sequence (card / account number)", () => {
      expect(redactPii("card 4111111111111111 charged")).toBe("card [REDACTED] charged");
    });

    it("leaves ordinary text and short numbers untouched", () => {
      // a model classifying a column still needs short values like order ids, totals and postcodes
      expect(redactPii("Order 4821 total 59.99 in London")).toBe("Order 4821 total 59.99 in London");
    });

    it.each([
      ["1234567890", "1234567890"], // 10 digits: kept
      ["123456789012", "123456789012"], // 12: kept (below card length)
      ["1234567890123", "[REDACTED]"], // 13: redacted (lower edge)
      ["1234567890123456789", "[REDACTED]"], // 19: redacted (upper edge)
      ["12345678901234567890", "[REDACTED]"], // 20: redacted (a longer run is not less sensitive)
    ])("applies the digit-length boundary: %s", (input, expected) => {
      expect(redactPii(input)).toBe(expected);
    });

    it("masks a space-separated card number", () => {
      expect(redactPii("card 4111 1111 1111 1111 ok")).toBe("card [REDACTED] ok");
    });

    it("masks a hyphen-separated card number", () => {
      expect(redactPii("card 4111-1111-1111-1111 ok")).toBe("card [REDACTED] ok");
    });

    it("masks email and card together in one string", () => {
      expect(redactPii("a@b.com paid 4111111111111111")).toBe("[EMAIL] paid [REDACTED]");
    });
  });

  describe("secrets coming back", () => {
    // a provider's 401 body quotes the offending key back
    it("masks an OpenAI key echoed back by a 401", () => {
      expect(
        redactSecrets(
          "401 Incorrect API key provided: sk-proj-Ab12Cd34Ef56Gh78. You can find your API key at ...",
        ),
      ).toBe("401 Incorrect API key provided: [SECRET]. You can find your API key at ...");
    });

    it("masks anthropic and google key shapes", () => {
      expect(redactSecrets("key sk-ant-api03-Ab12Cd34Ef56 rejected")).toBe("key [SECRET] rejected");
      expect(redactSecrets("key AIzaSyD1234567890abcdef rejected")).toBe("key [SECRET] rejected");
    });

    it("masks a bearer token", () => {
      expect(redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc")).toBe(
        "Authorization: [SECRET]",
      );
    });

    // a mask that ate the model id would take the use out of the line it protects
    it("leaves model ids and ordinary prose intact", () => {
      const msg =
        "404 The model `gpt-4o-mini` does not exist; try claude-haiku-4-5 or gemini-2.5-flash";
      expect(redactSecrets(msg)).toBe(msg);
      expect(redactSecrets("this is a risk-free task-based message")).toBe(
        "this is a risk-free task-based message",
      );
    });

    it("masks every occurrence, not just the first", () => {
      expect(redactSecrets("sk-aaaaaaaaaaaa and sk-bbbbbbbbbbbb")).toBe("[SECRET] and [SECRET]");
    });

    it("leaves a real quota-exhaustion message fully intact", () => {
      const real =
        "429 You exceeded your current quota, please check your plan and billing details. " +
        "For more information on this error, read the docs: " +
        "https://platform.openai.com/docs/guides/error-codes/api-errors.";
      expect(redactSecrets(real)).toBe(real);
    });
  });
});

describe("composeMasks", () => {
  it("applies the masks in the order given", () => {
    const first: Mask = (text) => text.replace("a", "b");
    const second: Mask = (text) => text.replace("b", "c");
    expect(composeMasks(first, second)("a")).toBe("c");
    expect(composeMasks(second, first)("a")).toBe("b");
  });

  it("with no mask, returns the text as it is", () => {
    expect(composeMasks()("a@b.com")).toBe("a@b.com");
  });
});

describe("the time a mask takes", () => {
  // every mask runs on text other people wrote (a URL, a user agent, an error
  // message): the time it takes must grow with the length, not its square
  const LENGTH = 96_000;
  const repeated = (unit: string): string => unit.repeat(Math.ceil(LENGTH / unit.length));
  const hostile = [
    "a",
    "a.",
    "a-",
    "a@",
    "a@a.",
    "a@a.a|",
    "eyJ-",
    "eyJa.",
    "eyJa.b.-",
    "1",
    "1-",
    "1234 ",
    "1.",
    "SG.",
    "SG-",
    "sk-",
    "key_",
    "xoxb-",
    "ghp_",
    "pwd:",
    "Bearer ",
    "(123)",
    " ",
  ].map(repeated);
  const masks: [string, Mask][] = [
    ["maskEmails", maskEmails()],
    ["maskJwts", maskJwts()],
    ["maskCardNumbers", maskCardNumbers()],
    ["maskSsns", maskSsns()],
    ["maskPasswordPairs", maskPasswordPairs()],
    ["maskPhoneNumbers", maskPhoneNumbers()],
    ["maskIpv4Addresses", maskIpv4Addresses()],
    ["maskUuids", maskUuids()],
    ["maskApiKeys", maskApiKeys()],
    ["maskLongDigits", maskLongDigits()],
    ["maskGroupedDigits", maskGroupedDigits()],
    ["maskProviderKeys", maskProviderKeys()],
    ["maskBearerTokens", maskBearerTokens()],
  ];

  it.each(masks)("%s stays linear on text built to slow it down", (_name, mask) => {
    for (const text of hostile) {
      // the best of three, so a pause of the machine's is not read as the mask's
      const best = Math.min(
        ...[0, 1, 2].map(() => {
          const before = performance.now();
          mask(text);
          return performance.now() - before;
        }),
      );
      // a quadratic mask takes seconds at this length; a linear one a few milliseconds
      expect(best, `on ${JSON.stringify(text.slice(0, 12))}…`).toBeLessThan(250);
    }
  });
});

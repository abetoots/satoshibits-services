# @satoshibits/redaction

Redaction for what a process writes or sends: text masks, key rules, a standard policy made of them, the
same policy for a logger's fields, and a safe description of an error.

It has no dependencies and holds no global state. It knows nothing of OpenTelemetry or of any logger:
it works on texts and plain objects, so an exporter, a logger and an AI gateway can share one policy.
It decides nothing by itself: nothing is redacted unless you apply a mask or name a policy.

```sh
pnpm add @satoshibits/redaction
```

## What it does not do

Read this first. Redaction by pattern lowers the chance that a secret leaves; it does not remove it.

- A mask recognises a **shape** (an email address, a JWT, a key with a known prefix), and a key rule a
  **name** (`password`, `authorization`). A secret in another shape under another name passes.
- A URL's **path** is kept as it is. A token written into a path is not removed.
- Only a **plain object, an array or a text** is looked into. A `Date`, a `Buffer`, a `Map`, a class
  instance and an `Error` are returned as given: describe an error with `describeError` first.
- The first defence is not to write the value at all. Use this package for what gets through.

## The standard policy

`standardPolicy` is a policy as [`@satoshibits/observability`](../observability/README.md)'s
`redaction` option takes it, written against OpenTelemetry's semantic conventions.

```typescript
import { start } from "@satoshibits/observability/preset";
import { standardPolicy } from "@satoshibits/redaction";

start({ serviceName: "api", redaction: standardPolicy });
```

A policy is a plain object of five functions, each told the surface it is looking at, because the same
key means different things in different places:

```ts
import { standardPolicy } from "@satoshibits/redaction";

console.log(standardPolicy.text("span.name", "GET https://api.example.com/users?token=abc for jane@example.com"));
// → GET https://api.example.com/users for [EMAIL]

console.log(
  standardPolicy.attributes("span", {
    "http.request.header.authorization": ["Bearer abc.def.ghi"],
    "client.address": "203.0.113.7",
    "url.full": "https://api.example.com/users?token=abc",
    "server.address": "api.example.com",
    "gen_ai.usage.input_tokens": 1200,
  }),
);
// → {"http.request.header.authorization":"[REDACTED]","url.full":"https://api.example.com/users","server.address":"api.example.com","gen_ai.usage.input_tokens":1200}
```

What it does, on every surface:

| In | The standard policy |
|---|---|
| any text | cuts every URL down to scheme, host and path (query string, fragment and user-info go); masks email addresses, `Bearer` tokens, JWTs, keys with a vendor's prefix and `password: value` pairs |
| a key with `password`, `passwd`, `pwd`, `secret`, `credential(s)`, `authorization`, `cookie`, `api key`, `private key` or `connection string` among its words, or ending in `token` | replaces the value whole, an array or an object under it included. A name that only holds such a word is taken too: `aws.secretsmanager.secret.arn` is redacted. Allow it by name if you need it |
| `client.address`, `network.peer.address` and the names they replaced (`http.client_ip`, `net.peer.ip`, `net.sock.peer.addr`) | drops key and value |
| `url.query` | drops key and value |
| `url.full`, `http.url`, `http.target` | removes the query string, fragment and user-info |
| any other key | keeps it; a text value passes the text masks |

And where a span and a log record differ:

| | On a span | On a log record |
|---|---|---|
| an `exception` event's `exception.type` | kept | kept |
| `exception.message`, `exception.stacktrace` | dropped | kept, masked like any text |
| status text | dropped | (a log record has none) |

```ts
import { standardPolicy } from "@satoshibits/redaction";

const attributes = { "exception.type": "MongoServerError", "exception.message": "duplicate key jane@example.com" };

console.log(standardPolicy.spanEvent({ name: "exception", attributes }));
// → {"name":"exception","attributes":{"exception.type":"MongoServerError"}}

console.log(standardPolicy.logRecord({ body: "insert failed", attributes }));
// → {"body":"insert failed","attributes":{"exception.type":"MongoServerError","exception.message":"duplicate key [EMAIL]"}}
```

Metric attributes are not a surface: labels are bounded names chosen in code, and a redacted label
value would merge series.

### The keys it was checked against

The table below is the standard policy run against a recorded list of attribute keys: the ones the
auto-instrumentation bundle emitted for one Express request, one outbound HTTP request and one pino
line, and the ones the MongoDB and Redis instrumentations declare (nothing connects to a database when
the list is recorded). Each key is tried on the surface it was recorded on; the span events recorded
are `exception` events. A test regenerates the table and fails when this text differs. It covers the
keys listed, not every key an instrumentation could emit.

<!-- standard-policy-table:start -->
| Key | Where it comes from | What the standard policy does there |
|---|---|---|
| `client.address` | captured on a span | dropped, key and value |
| `db.client.connection.pool.name` | declared by mongodb | kept; a text value passes the text masks |
| `db.client.connection.state` | declared by mongodb | kept; a text value passes the text masks |
| `db.collection.name` | declared by mongodb | kept; a text value passes the text masks |
| `db.namespace` | declared by mongodb | kept; a text value passes the text masks |
| `db.operation.name` | declared by mongodb; declared by redis; declared by ioredis | kept; a text value passes the text masks |
| `db.query.text` | declared by mongodb; declared by redis; declared by ioredis | kept; a text value passes the text masks |
| `db.system.name` | declared by mongodb; declared by redis; declared by ioredis | kept; a text value passes the text masks |
| `exception.message` | captured on a span event | dropped, key and value |
| `exception.stacktrace` | captured on a span event | dropped, key and value |
| `exception.type` | captured on a span event | kept; a text value passes the text masks |
| `express.name` | captured on a span | kept; a text value passes the text masks |
| `express.type` | captured on a span | kept; a text value passes the text masks |
| `http.request.method` | captured on a span | kept; a text value passes the text masks |
| `http.response.status_code` | captured on a span | kept; a text value passes the text masks |
| `http.route` | captured on a span | kept; a text value passes the text masks |
| `network.peer.address` | captured on a span | dropped, key and value |
| `network.peer.port` | captured on a span | kept; a text value passes the text masks |
| `network.protocol.version` | captured on a span | kept; a text value passes the text masks |
| `os.type` | captured on a resource | kept; a text value passes the text masks |
| `router.name` | captured on a span | kept; a text value passes the text masks |
| `router.type` | captured on a span | kept; a text value passes the text masks |
| `router.version` | captured on a span | kept; a text value passes the text masks |
| `server.address` | captured on a span; declared by mongodb; declared by redis; declared by ioredis | kept; a text value passes the text masks |
| `server.port` | captured on a span; declared by mongodb; declared by redis; declared by ioredis | kept; a text value passes the text masks |
| `service.instance.id` | captured on a resource | kept; a text value passes the text masks |
| `service.name` | captured on a resource | kept; a text value passes the text masks |
| `telemetry.sdk.language` | captured on a resource | kept; a text value passes the text masks |
| `telemetry.sdk.name` | captured on a resource | kept; a text value passes the text masks |
| `telemetry.sdk.version` | captured on a resource | kept; a text value passes the text masks |
| `url.full` | captured on a span | query string, fragment and user-info removed |
| `url.path` | captured on a span | kept; a text value passes the text masks |
| `url.query` | captured on a span | dropped, key and value |
| `url.scheme` | captured on a span | kept; a text value passes the text masks |
| `userId` | captured on a log record | kept; a text value passes the text masks |
| `user_agent.original` | captured on a span | kept; a text value passes the text masks |
<!-- standard-policy-table:end -->

## For a logger

`redactFields` is the standard policy over a value of any depth: the key rules at every level, the text
masks on every string. It is the log-record side of the policy, so an error's message and stack are
kept and masked. What you pass is not changed.

```ts
import { describeError, redactFields } from "@satoshibits/redaction";

console.log(
  redactFields({
    msg: "welcome sent to jane@example.com",
    req: { headers: { authorization: "Bearer abc.def.ghi", host: "api.example.com" } },
  }),
);
// → {"msg":"welcome sent to [EMAIL]","req":{"headers":{"authorization":"[REDACTED]","host":"api.example.com"}}}

const failure = Object.assign(new TypeError("no mailbox jane@example.com"), { code: "EENVELOPE", stack: undefined });
console.log(redactFields({ err: describeError(failure) }));
// → {"err":{"name":"TypeError","message":"no mailbox [EMAIL]","code":"EENVELOPE"}}
```

The key rules look at each key by itself, at every level. A rule written for a dotted attribute name
(`client.address`, `url.full`) matches that spelling: in `{ client: { address } }` the key is `address`,
and no standard rule names it.

With pino, redact the finished line. A line is made in several places (the fields, the serializers,
the message and what is interpolated into it, a child logger's bindings), and pino runs
`formatters.log` before the serializers, so redacting the fields there lets an error's message and
stack pass. The one place everything has arrived is `hooks.streamWrite`:

```typescript
import pino from "pino";
import { describeError, redactFields } from "@satoshibits/redaction";

const logger = pino({
  serializers: { err: describeError },
  hooks: { streamWrite: (line) => `${JSON.stringify(redactFields(JSON.parse(line)))}\n` },
});
```

That parses and writes each line a second time; measure it if your service logs heavily. It covers
what pino writes to its stream, not a copy of the record sent elsewhere (OpenTelemetry's log sending
has the exporter's policy for that).

## Describing an error

`describeError` turns an error into what a log line may carry: `name`, `message`, `code`, `stack`, and
one level of cause as `causeName` and `causeCode`. Everything else the error carries is left out: a
database error can hold the document it failed on, an HTTP client's error the request it sent.

- A name or code is kept only if it is a short identifier; a message or stack only if it is a text.
- A class that extends `Error` without naming itself is described by its class name.
- A cause contributes identifiers only. Of a cause that is a structure and not an error, only its
  `code` is kept.
- A value that is not an error is described by its type: `{ thrown: "string" }`.
- It does not throw, whatever the error does when it is read.

```ts
import { describeError, isUsableErrorCode } from "@satoshibits/redaction";

class PaymentDeclined extends Error {}
const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET", request: { body: "…" } });
const error = Object.assign(new PaymentDeclined("charge failed", { cause }), { stack: undefined, payload: { card: "…" } });

console.log(describeError(error));
// → {"name":"PaymentDeclined","message":"charge failed","causeName":"Error","causeCode":"ECONNRESET"}

console.log(describeError("a string that was thrown"));
// → {"thrown":"string"}

console.log(isUsableErrorCode("ECONNRESET"), isUsableErrorCode("has spaces"), isUsableErrorCode(11000));
// → true false true
```

`isUsableErrorCode(value)` is the test it applies to a code: a finite number, or a string of 1 to 64
characters from letters, digits and `_ . : -`. Use it wherever a code is put somewhere that must not
hold prose, such as a span attribute.

A message or a stack can still quote a value. Pass the description through `redactFields`, as above.

## A policy of your own

The standard policy is built from parts, and so is yours: spread `standardParts` and change what your
policy changes. Its rules and masks are exported by name (`standardRules`, `standardMasks`), so one
can be taken out, as `peerAddresses` is below.

```ts
import { createFieldsRedactor, createPolicy, exactKeys, keyWords, maskCardNumbers, standardParts, standardRules } from "@satoshibits/redaction";

const parts = {
  ...standardParts,
  // also mask card numbers in any text
  textMasks: [...standardParts.textMasks, maskCardNumbers()],
  // also redact these keys
  redactKeys: [...standardParts.redactKeys, keyWords("ssn"), exactKeys("customer.tax_id")],
  // keep the peer address: this service is not public
  dropKeys: standardParts.dropKeys.filter((rule) => rule !== standardRules.peerAddresses),
  // leave this key readable whatever the rules say
  allowKeys: ["enduser.id"],
};
const policy = createPolicy(parts);
const redact = createFieldsRedactor(parts);

console.log(policy.attributes("span", { "enduser.id": "jane@example.com", "client.address": "10.0.0.7", user_ssn: "123-45-6789" }));
// → {"enduser.id":"jane@example.com","client.address":"10.0.0.7","user_ssn":"[REDACTED]"}

console.log(redact({ note: "card 4111 1111 1111 1111" }));
// → {"note":"card [REDACTED]"}
```

| Part | What it is |
|---|---|
| `textMasks` | masks applied in order to every text, and to every string value no key rule decides |
| `redactKeys` | key rules; the value under a matching key is replaced whole |
| `dropKeys` | key rules; a matching key is removed with its value |
| `urlKeys` | key rules; the value is a URL, or a path with a query, and is cut |
| `allowKeys` | keys, exactly as written, left as given whatever the rules say |
| `replacement` | what a redacted value becomes |
| `dropSpanExceptionDetail` | on a span's `exception` event, drop the message and stack |
| `dropSpanStatusText` | drop a span's status text; when false it passes the text masks |

A key is decided in this order: allowed, dropped, redacted, cut as a URL, otherwise its value passes
the text masks.

### Key rules

A rule looks at a key as it is built. A dotted key is segments, and a segment is words, separated by
anything that is not a letter or a digit, by a change of case, and between a letter and a digit
(`Password1` is `password` and `1`). A word matches a word.

```ts
import { exactKeys, keyEndsWith, keyWords, wordsOfKey } from "@satoshibits/redaction";

console.log(wordsOfKey("http.request.header.x-api-key"));
// → [["http"],["request"],["header"],["x","api","key"]]

const token = keyEndsWith("token");
console.log(token("access_token"), token("refreshToken"), token("gen_ai.usage.input_tokens"), token("gen_ai.token.type"));
// → true true false false

const password = keyWords("password");
console.log(password("db_password"), password("user.passwordHash"), password("passwordless"));
// → true true false

console.log(exactKeys("client.address")("client.address"), exactKeys("client.address")("server.address"));
// → true false
```

- `exactKeys(...keys)`: the keys named, exactly as written.
- `keyWords(...phrases)`: a word, or several in a row within one segment, anywhere in the key.
- `keyEndsWith(...phrases)`: the words the key ends with; for a word that names a secret only when it
  is the thing the key holds.
- `anyKey(...rules)`: matches when one of the rules does.

### Masks

A mask is a function from a text to a text. Each takes time that grows with the length of the text and
not with its square, whatever the text is.

| Mask | Replaces |
|---|---|
| `cutUrls()` | every `scheme://…` URL, with the same cut down to scheme, host and path |
| `maskEmails(replacement?)` | email addresses, with `[EMAIL]`, a text of yours, or a function of the local part and the domain |
| `maskBearerTokens(replacement?)` | `Bearer <token>`, the scheme included, in any case; a word of eight characters or more after the word "bearer" in a sentence goes too |
| `maskJwts(replacement?)` | three base64url segments, the first starting `eyJ` |
| `maskVendorKeys(replacement?)` | keys with a vendor's prefix: Stripe, AWS access key ids, Google, GitHub, Slack, SendGrid, OpenAI project keys, Anthropic |
| `maskProviderKeys(replacement?)` | `sk-…` and `AIza…` at the shorter lengths an AI provider quotes back in an error; a model id such as `gpt-4o-mini` passes |
| `maskPasswordPairs(replacement?)` | the value in `password: value` (also `passwd`, `pwd`) |
| `maskApiKeys(replacement?)` | what `maskVendorKeys` does, and `api_`, `key_`, `token_`, `secret_`, `auth_` or `bearer_` followed by 16 letters or digits or more, which is also the shape of a name such as `api_getUserProfileSettings` |
| `maskCardNumbers(replacement?)` | sixteen digits in four groups |
| `maskLongDigits(replacement?)` | thirteen digits or more in a row |
| `maskGroupedDigits(replacement?)` | thirteen to nineteen digits written in groups |
| `maskSsns(replacement?)` | `123-45-6789` |
| `maskPhoneNumbers()` | North American phone numbers |
| `maskIpv4Addresses(replacement?)` | IPv4 addresses |
| `maskUuids(replacement?)` | UUIDs |

The first seven are the standard policy's, in that order. A replacement is used as written: `$&` in it
means those two characters. `composeMasks(...masks)` makes one of several.
`cutUrl(value)` cuts a value that is one URL, or a path with a query.

For text sent to or returned by an AI provider:

```ts
import { composeMasks, maskBearerTokens, maskEmails, maskGroupedDigits, maskLongDigits, maskProviderKeys } from "@satoshibits/redaction";

// before a prompt leaves: personal data
const outgoing = composeMasks(maskEmails(), maskLongDigits(), maskGroupedDigits());
console.log(outgoing("jane@example.com paid with 4111 1111 1111 1111, order 4821"));
// → [EMAIL] paid with [REDACTED], order 4821

// before a provider's error text is logged: it can quote your key back
const incoming = composeMasks(maskProviderKeys("[SECRET]"), maskBearerTokens("[SECRET]"));
console.log(incoming("401 Incorrect API key provided: sk-proj-Ab12Cd34Ef56Gh78. The model `gpt-4o-mini` exists."));
// → 401 Incorrect API key provided: [SECRET]. The model `gpt-4o-mini` exists.
```

## Limits worth knowing

- **URLs in a text** are recognised in the `scheme://` spelling only, and end at whitespace.
- **Nested values** are followed 32 levels deep; below that a value is replaced with `[TOO_DEEP]`. An
  object that contains itself is replaced with `[CIRCULAR]` where it repeats. An object reached by
  several paths is walked once, and appears in the result as one object in each of those places.
- **An allowed key wins over everything**, the drop of an exception's message on a span included.
- **A policy must answer at once** and the same way each time for the same input; the ones built here do.
- **Keys are matched as written.** `exactKeys` and `allowKeys` are case-sensitive; `keyWords` and
  `keyEndsWith` are not.

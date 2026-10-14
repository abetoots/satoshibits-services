---
"@satoshibits/redaction": major
---

First release. Redaction for what a process writes or sends, with no dependencies and no global state:

- text masks (email addresses, JWTs, keys with a known prefix, `Bearer` tokens, password pairs, card and long digit runs, SSNs, phone numbers, IPv4 addresses, UUIDs), each linear in the length of the text;
- `cutUrls` and `cutUrl`: a URL cut down to scheme, host and path;
- key rules: `exactKeys` matches a whole key exactly as written, `keyWords` a word or phrase among the words of a key, `keyEndsWith` the word or words a key ends with;
- `standardParts`, `standardRules` and `standardMasks`: the standard policy's parts, rules and masks by name, to build a policy of your own from;
- `createPolicy` and `standardPolicy`: a policy in the shape `@satoshibits/observability`'s `redaction` option takes, written against OpenTelemetry's semantic conventions;
- `createFieldsRedactor` and `redactFields`: the same policy over a logger's fields, at any depth;
- `describeError` and `isUsableErrorCode`: an error as name, message, code, stack and one level of cause.

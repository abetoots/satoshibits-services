/**
 * The standard policy, and the parts it is made of.
 *
 * It is written against OpenTelemetry's semantic conventions: it names the
 * keys it redacts and the keys it drops, and it leaves `server.address`,
 * `gen_ai.usage.input_tokens` and a route called `/health` alone. The table
 * of what it does to each key an instrumentation emits is in the README.
 *
 * It covers the shapes and keys listed, not every secret: a value under a
 * key no rule names, in a shape no mask knows, passes.
 */

import type { KeyRule } from "./keys.mjs";
import type { Mask } from "./masks.mjs";
import type { PolicyParts } from "./policy.mjs";

import { exactKeys, keyEndsWith, keyWords } from "./keys.mjs";
import {
  maskApiKeys,
  maskBearerTokens,
  maskEmails,
  maskJwts,
  maskPasswordPairs,
  maskProviderKeys,
  REDACTED,
} from "./masks.mjs";
import { createFieldsRedactor, createPolicy } from "./policy.mjs";
import { cutUrls } from "./urls.mjs";

/** the standard policy's text masks, by name, in the order they are applied */
export const standardMasks = Object.freeze({
  /** every URL in the text loses its query string, fragment and user-info */
  urls: cutUrls(),
  emails: maskEmails(),
  bearerTokens: maskBearerTokens(),
  jwts: maskJwts(),
  apiKeys: maskApiKeys(),
  providerKeys: maskProviderKeys(),
  passwordPairs: maskPasswordPairs(),
}) satisfies Readonly<Record<string, Mask>>;

/** the standard policy's key rules, by name */
export const standardRules = Object.freeze({
  /**
   * Redacted: a key with one of these words in it. `authorization` and
   * `cookie` are the HTTP headers (`http.request.header.authorization`,
   * `http.response.header.set-cookie`).
   */
  sensitiveWords: keyWords(
    "password",
    "passwd",
    "pwd",
    "secret",
    "credential",
    "credentials",
    "authorization",
    "cookie",
    "api key",
    "apikey",
    "private key",
    "connection string",
  ),
  /** redacted: a key that ends in `token` (`access_token`, not `input_tokens`) */
  tokens: keyEndsWith("token"),
  /**
   * Dropped: the address of the other end of a connection, under its stable
   * names and the ones they replaced. On a server span that is the client;
   * on a client span it is an address `server.address` already names.
   */
  peerAddresses: exactKeys(
    "client.address",
    "network.peer.address",
    "http.client_ip",
    "net.peer.ip",
    "net.sock.peer.addr",
  ),
  /** dropped: a URL's query string as an attribute of its own */
  urlQuery: exactKeys("url.query"),
  /** cut: the HTTP attributes that hold a URL, or a path with a query, old names and stable */
  urls: exactKeys("url.full", "http.url", "http.target"),
}) satisfies Readonly<Record<string, KeyRule>>;

/** the parts of the standard policy; spread them and change what your policy changes */
export const standardParts: PolicyParts = Object.freeze({
  textMasks: Object.freeze(Object.values(standardMasks)),
  redactKeys: Object.freeze([standardRules.sensitiveWords, standardRules.tokens]),
  dropKeys: Object.freeze([standardRules.peerAddresses, standardRules.urlQuery]),
  urlKeys: Object.freeze([standardRules.urls]),
  allowKeys: Object.freeze([]),
  replacement: REDACTED,
  dropSpanExceptionDetail: true,
  dropSpanStatusText: true,
});

/**
 * The standard policy. In any text: URLs cut, emails and credential shapes
 * masked. In attributes and fields: values under sensitive keys replaced,
 * peer addresses and URL query strings dropped, URL attributes cut. On a
 * span, an `exception` event keeps its type and loses its message and
 * stack, and status text is dropped; on a log record both stay, masked.
 */
export const standardPolicy = createPolicy(standardParts);

/** the standard policy for a logger: the same rules over a line's fields, at any depth */
export const redactFields = createFieldsRedactor(standardParts);

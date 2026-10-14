/**
 * A preload that breaks the import rule: it imports a module that creates a
 * pino logger, and only then calls start(). ESM evaluates both imports
 * before this module's body, so pino is loaded before any instrumentation
 * or loader hook exists.
 */

import { start } from "@satoshibits/observability/preset";

import "./early-logger.mjs";

start({ redaction: false });

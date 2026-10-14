/**
 * A preload of the application's own: start() with one setting of the pino
 * instrumentation overridden. The preset's other default for it (sending
 * lines over OTLP follows the logs signal) must stay.
 */

import { start } from "@satoshibits/observability/preset";

start({
  redaction: false,
  instrumentations: {
    "@opentelemetry/instrumentation-pino": {
      logKeys: { traceId: "tid", spanId: "sid", traceFlags: "tf" },
    },
  },
});

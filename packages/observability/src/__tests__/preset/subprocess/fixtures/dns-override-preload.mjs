/**
 * A preload of the application's own: start() with a partial setting for the
 * dns instrumentation that does not mention `enabled`. The preset turns that
 * instrumentation off; the partial setting must keep it off.
 *
 * `OBS_FIXTURE_DNS_ENABLED=1` adds `enabled: true` to the same setting, the
 * control that shows a lookup would otherwise be seen.
 */

import { start } from "@satoshibits/observability/preset";

start({
  redaction: false,
  instrumentations: {
    "@opentelemetry/instrumentation-dns": {
      ignoreHostnames: ["never-matches.invalid"],
      ...(process.env.OBS_FIXTURE_DNS_ENABLED === "1" && { enabled: true }),
    },
  },
});

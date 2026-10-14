/**
 * A preload of the application's own that exports everything as given: the
 * control for the standard policy's cases, showing the instrumentation does
 * emit each value the policy removes.
 */

import { start } from "@satoshibits/observability/preset";

start({ redaction: false });

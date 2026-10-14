/**
 * A preload of the application's own: start() under the standard policy
 * with one key allowed, `app.contact`. The standard policy itself allows
 * nothing, so `register` cannot show an allow-list; this is the policy an
 * application builds for one.
 */

import { start } from "@satoshibits/observability/preset";
import { createPolicy, standardParts } from "@satoshibits/redaction";

start({ redaction: createPolicy({ ...standardParts, allowKeys: ["app.contact"] }) });

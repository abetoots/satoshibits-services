/**
 * A module that creates a pino logger as it is imported. The early-logger
 * preload imports it BEFORE calling start(), which is what the preset's
 * import rule ("import nothing here but the preset and Node built-ins")
 * warns against.
 */

import pino from "pino";

export const earlyLogger = pino();

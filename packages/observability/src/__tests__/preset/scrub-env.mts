/**
 * The in-process preset tests read `process.env` through the real `start()`.
 * Remove every telemetry variable the runner inherited so a developer's shell
 * or a CI setting cannot change their outcome.
 */
for (const name of Object.keys(process.env)) {
  if (name.startsWith("OTEL_") || name.startsWith("OBS_")) {
    delete process.env[name];
  }
}

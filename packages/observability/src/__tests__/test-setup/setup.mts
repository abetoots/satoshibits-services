/**
 * Global test setup
 *
 * Environment setup (browser globals, Node.js APIs) is handled by Vitest's
 * environment configuration (jsdom/node), not here.
 *
 * This file only contains setup that must be truly global across all tests.
 */

// ensure tests never attempt network exporters in Node SDK
if (typeof process !== 'undefined' && !process.env.OBS_TEST_NO_EXPORT) {
  process.env.OBS_TEST_NO_EXPORT = '1';
}

// Note: Mock cleanup is handled automatically by vitest.config.mts:
// - restoreMocks: true  (auto-restore vi.spyOn after each test)
// - unstubGlobals: true (auto-unstub vi.stubGlobal after each test)

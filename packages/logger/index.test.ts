import { expect, it, vi } from "vitest";
import { parentPort } from "worker_threads";

import { loggerFactory } from "./index";

vi.mock("worker_threads", () => ({
  isMainThread: false,
  parentPort: { postMessage: vi.fn() },
}));

it("should create a logger", () => {
  const { logger } = loggerFactory({});
  expect(logger).toBeDefined();
});

it("should error if using methods that do not conform to standard", () => {
  //arrange
  const { logger } = loggerFactory({});

  //act

  //assert
  //@ts-expect-error testing for error
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
  expect(() => logger.what("info", "message")).toThrowError();
});

it("should have all logger methods defined", () => {
  const { logger } = loggerFactory({});
  expect(logger.trace).toBeDefined();
  expect(logger.debug).toBeDefined();
  expect(logger.info).toBeDefined();
  expect(logger.warn).toBeDefined();
  expect(logger.error).toBeDefined();
  expect(logger.fatal).toBeDefined();
});

it("should log messages correctly in the main thread", () => {
  const { logger } = loggerFactory({});
  const spy = vi.spyOn(logger, "info");

  logger.info("test message", { key: "value" });

  expect(spy).toHaveBeenCalledWith("test message", { key: "value" });
});

it("should post messages correctly in worker threads", () => {
  const { logger } = loggerFactory({});
  logger.info("test message", { key: "value" });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  expect(parentPort?.postMessage).toHaveBeenCalledWith({
    type: "message",
    level: "info",
    message: "test message",
    meta: { key: "value" },
  });
});

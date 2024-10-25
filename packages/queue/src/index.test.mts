import Bree from "bree";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QueueHandler } from "./index.mjs";

vi.mock("node:path");
vi.mock("node:worker_threads");

describe("QueueHandler", () => {
  let queueHandler: QueueHandler<"test" | "invalid">;
  const validateFunction = (jobType: string) =>
    jobType === "test" ? true : false;
  const validationMock = vi.fn(validateFunction);

  beforeEach(() => {
    queueHandler = new QueueHandler({
      validateJob: validationMock,
      rootPath: import.meta.dirname,
      onUnhandledError: vi.fn(),
    });
    const bree = queueHandler.getBree();
    vi.spyOn(bree, "add").mockImplementation((options) => {
      return new Promise((resolve) => {
        bree.config.jobs.push(options as Bree.Job);
        resolve();
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    vi.spyOn(bree, "start").mockImplementation(async () => {});
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    vi.spyOn(bree, "run").mockImplementation(async () => {});
  });

  it("should initialize QueueHandler correctly", () => {
    expect(queueHandler).toBeInstanceOf(QueueHandler);
    expect(queueHandler.getBree()).toBeInstanceOf(Bree);
  });

  it("should add a job correctly when job is valid", async () => {
    const job = { id: "1", type: "test" as const, groupId: "group1" };
    const options = { timeout: 0 };

    const result = await queueHandler.addJob(job, options);

    expect(validationMock).toHaveBeenCalledWith("test");
    expect(result?.type).toBe("added");
    expect(result?.job).toStrictEqual(job);
  });

  it("should not add a job when job is invalid", async () => {
    const job = { id: "1", type: "invalid" as const, groupId: "group1" };
    const options = { timeout: 0 };

    const result = await queueHandler.addJob(job, options);

    expect(validationMock).toHaveBeenCalledWith("invalid");
    expect(result).toBeUndefined();
  });

  it("should not error when adding a job that already exists", async () => {
    const job = { id: "1", type: "test" as const, groupId: "group1" };
    const options = { timeout: 0 };

    const result1 = await queueHandler.addJob(job, options);
    const result2 = await queueHandler.addJob(job, options);

    expect(result1?.type).toBe("added");
    expect(result2?.type).toBe("existing");
  });

  it("should be able to start a valid job that has been added", async () => {
    const job = { id: "1", type: "test" as const, groupId: "group1" };
    const options = { timeout: 0 };

    await queueHandler.addJob(job, options);
    const result = await queueHandler.startJob(job);

    expect(result).not.toBeUndefined();
  });

  it("should error when starting a job that does not exist", async () => {
    const job = { id: "1", type: "test" as const, groupId: "group1" };

    await expect(queueHandler.startJob(job)).rejects.toThrow(
      `Job test_1_group1 not found. Please add the job first.`,
    );
  });
});

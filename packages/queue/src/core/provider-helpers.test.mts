import { describe, it, expect, vi } from "vitest";
import { ProviderHelper } from "./provider-helpers.mjs";
import type { IQueueProvider, IProviderFactory } from "../providers/provider.interface.mjs";
import { Result } from "@satoshibits/functional";

describe("ProviderHelper", () => {
  describe("resolveBoundProvider", () => {
    it("should return MemoryProvider when provider is undefined", () => {
      const result = ProviderHelper.resolveBoundProvider(undefined, "test-queue");

      expect(result).toBeDefined();
      expect(result.capabilities).toBeDefined();
      // MemoryProvider supports delayed jobs and priority
      expect(result.capabilities.supportsDelayedJobs).toBe(true);
      expect(result.capabilities.supportsPriority).toBe(true);
    });

    it("should call forQueue on factory providers", () => {
      const mockBoundProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: true,
          supportsPriority: true,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        fetch: vi.fn(),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      const mockFactory: IProviderFactory = {
        forQueue: vi.fn().mockReturnValue(mockBoundProvider),
      };

      const result = ProviderHelper.resolveBoundProvider(mockFactory, "test-queue");

      expect(mockFactory.forQueue).toHaveBeenCalledWith("test-queue");
      expect(result).toBe(mockBoundProvider);
    });

    it("should return provider directly if not a factory", () => {
      const mockProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        fetch: vi.fn(),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      const result = ProviderHelper.resolveBoundProvider(mockProvider, "test-queue");

      expect(result).toBe(mockProvider);
    });
  });

  describe("isFactory", () => {
    it("should return true for factory providers", () => {
      const mockFactory: IProviderFactory = {
        forQueue: vi.fn(),
      };

      expect(ProviderHelper.isFactory(mockFactory)).toBe(true);
    });

    it("should return false for non-factory providers", () => {
      const mockProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        fetch: vi.fn(),
        ack: vi.fn(),
        nack: vi.fn(),
      };

      const result = ProviderHelper.resolveBoundProvider(mockProvider, "test-queue");

      expect(result).toBe(mockProvider);
    });

    it("should work with different queue names", () => {
      const mockFactory: IProviderFactory = {
        forQueue: vi.fn().mockImplementation((queueName: string) => ({
          capabilities: {
            supportsDelayedJobs: false,
            supportsPriority: false,
            supportsLongPolling: false,
            supportsBatching: false,
            supportsRetries: true,
            supportsDLQ: true,
            maxJobSize: 0,
            maxBatchSize: 0,
            maxDelaySeconds: 0,
          },
          queueName,
          add: vi.fn(),
          getJob: vi.fn(),
          getStats: vi.fn(),
          getHealth: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          delete: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
        })),
      };

      const result1 = ProviderHelper.resolveBoundProvider(mockFactory, "queue-1");
      const result2 = ProviderHelper.resolveBoundProvider(mockFactory, "queue-2");

      expect(mockFactory.forQueue).toHaveBeenCalledWith("queue-1");
      expect(mockFactory.forQueue).toHaveBeenCalledWith("queue-2");
      expect(result1).not.toBe(result2);
    });
  });

  describe("conditionalDisconnect", () => {
    it("should call disconnect if provider has disconnect method", async () => {
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);
      const mockProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: disconnectSpy,
      };

      await ProviderHelper.conditionalDisconnect(mockProvider);

      expect(disconnectSpy).toHaveBeenCalledOnce();
    });

    it("should not throw if provider does not have disconnect method", async () => {
      const mockProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };

      await expect(
        ProviderHelper.conditionalDisconnect(mockProvider),
      ).resolves.not.toThrow();
    });

    it("should not call non-function disconnect property", async () => {
      const mockProvider: Omit<IQueueProvider, "disconnect"> & { disconnect: string } = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: "not a function",
      };

      await expect(
        ProviderHelper.conditionalDisconnect(mockProvider as unknown as IQueueProvider),
      ).resolves.not.toThrow();
    });

    it("should propagate disconnect errors", async () => {
      const disconnectError = new Error("Disconnect failed");
      const mockProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn().mockRejectedValue(disconnectError),
      };

      await expect(
        ProviderHelper.conditionalDisconnect(mockProvider),
      ).rejects.toThrow("Disconnect failed");
    });
  });

  describe("isFactory", () => {
    it("should return true for factory providers", () => {
      const mockFactory: IProviderFactory = {
        forQueue: vi.fn(),
      };

      expect(ProviderHelper.isFactory(mockFactory)).toBe(true);
    });

    it("should return false for non-factory providers", () => {
      const mockProvider: IQueueProvider = {
        capabilities: {
          supportsDelayedJobs: false,
          supportsPriority: false,
          supportsLongPolling: false,
          supportsBatching: false,
          supportsRetries: true,
          supportsDLQ: true,
          maxJobSize: 0,
          maxBatchSize: 0,
          maxDelaySeconds: 0,
        },
        add: vi.fn(),
        getJob: vi.fn(),
        getStats: vi.fn(),
        getHealth: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        delete: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
      };

      expect(ProviderHelper.isFactory(mockProvider)).toBe(false);
    });

    it("should narrow type to IProviderFactory when true", () => {
      const mockFactory: IProviderFactory = {
        forQueue: vi.fn(),
      };

      const provider: IQueueProvider | IProviderFactory = mockFactory;

      if (ProviderHelper.isFactory(provider)) {
        // TypeScript should now know provider is IProviderFactory
        const _typeCheck: IProviderFactory = provider;
        expect(provider.forQueue).toBeDefined();
      }
    });
  });

  describe("integration scenarios", () => {
    it("should handle typical queue creation flow", () => {
      const mockFactory: IProviderFactory = {
        forQueue: vi.fn().mockImplementation((queueName: string) => ({
          capabilities: {
            supportsDelayedJobs: true,
            supportsPriority: true,
            supportsLongPolling: false,
            supportsBatching: false,
          },
          queueName,
          add: vi.fn().mockResolvedValue(Result.ok({ id: "job-1" })),
          getJob: vi.fn(),
          getStats: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          delete: vi.fn(),
        })),
      };

      // simulate Queue constructor usage
      const boundProvider = ProviderHelper.resolveBoundProvider(mockFactory, "my-queue");

      expect(boundProvider).toBeDefined();
      expect(mockFactory.forQueue).toHaveBeenCalledWith("my-queue");
    });

    it("should handle zero-config (undefined provider)", () => {
      // simulate Queue constructor with no provider specified
      const boundProvider = ProviderHelper.resolveBoundProvider(undefined, "default-queue");

      expect(boundProvider).toBeDefined();
      expect(boundProvider.capabilities).toBeDefined();
    });

    it("should handle cleanup flow", async () => {
      const disconnectSpy = vi.fn().mockResolvedValue(undefined);
      const mockFactory: IProviderFactory = {
        forQueue: vi.fn().mockReturnValue({
          capabilities: {
            supportsDelayedJobs: false,
            supportsPriority: false,
            supportsLongPolling: false,
            supportsBatching: false,
          },
          add: vi.fn(),
          getJob: vi.fn(),
          getStats: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          delete: vi.fn(),
          disconnect: disconnectSpy,
        }),
      };

      const boundProvider = ProviderHelper.resolveBoundProvider(mockFactory, "cleanup-queue");
      await ProviderHelper.conditionalDisconnect(boundProvider);

      expect(disconnectSpy).toHaveBeenCalledOnce();
    });
  });
});

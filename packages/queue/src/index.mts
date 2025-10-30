/**
 * @satoshibits/queue - Backend-agnostic queue abstraction
 *
 * A thin translation layer that maps a unified API to native provider capabilities.
 */

// Core API
export { Queue } from "./api/queue.mjs";
export { Worker } from "./api/worker.mjs";

// Core Types
export type {
  Job,
  ActiveJob,
  JobStatus,
  JobOptions,
  JobHandler,
  QueueOptions,
  DefaultJobOptions,
  QueueStats,
  QueueError,
  WorkerOptions,
  ProviderCapabilities,
  HealthStatus,
} from "./core/types.mjs";

// Event System
export { TypedEventEmitter } from "./core/events.mjs";
export type {
  QueueEventMap,
  QueueEventName,
  QueueEventListener,
  ActiveEventPayload,
  CompletedEventPayload,
  FailedEventPayload,
  JobRetryingEventPayload,
  ProcessorShuttingDownEventPayload,
  ProcessorShutdownTimeoutEventPayload,
  QueueErrorEventPayload,
  QueueDrainedEventPayload,
  QueuePausedEventPayload,
  QueueResumedEventPayload,
} from "./core/events.mjs";

// Provider Interface
export type {
  IQueueProvider,
  IProviderFactory,
} from "./providers/provider.interface.mjs";

// BullMQ-specific extensions (provider-specific features)
export type {
  IBullMQExtensions,
  JobSchedulerOptions,
  JobScheduler,
} from "./providers/bullmq/bullmq-extensions.interface.mjs";

// Built-in Providers
export { MemoryProvider } from "./providers/memory/memory.provider.mjs";

// Utilities (for advanced use cases)
export { QueueErrorFactory } from "./core/utils.mjs";
export { ConstructorValidator } from "./core/validators.mjs";
export { ProviderHelper } from "./core/provider-helpers.mjs";

// Job ID Generator (default)
export { uuidId } from "./core/job-id-generators.mjs";

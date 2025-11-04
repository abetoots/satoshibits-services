import Axe from "axe";
import { isMainThread, parentPort } from "node:worker_threads";

export type LoggerLevels =
  | "info"
  | "trace"
  | "debug"
  | "warn"
  | "error"
  | "fatal";
export type LoggerMessage = string | Error;
export type LoggerMeta = Record<string, unknown>;

export type BaseLogger = Record<
  LoggerLevels,
  (message: LoggerMessage, meta?: LoggerMeta) => void
>;
export interface WorkerLoggerPostMessageType {
  level: LoggerLevels;
  message: LoggerMessage;
  meta?: LoggerMeta;
  type: "message";
}

export type LoggerFactoryOptions = Axe.Options<Axe.Logger>;

/**
 * This logger can be used
 * in both the main thread and worker threads.
 */
export const loggerFactory = (options: LoggerFactoryOptions) => {
  const axeLogger = new Axe(options);

  const logger: BaseLogger & {
    logMessage: (
      level: LoggerLevels,
      message: LoggerMessage,
      meta?: LoggerMeta,
    ) => void;
  } = {
    logMessage(level, message, meta) {
      //If inside a worker thread
      if (!isMainThread) {
        const postMessage: WorkerLoggerPostMessageType = {
          type: "message",
          level,
          message,
          meta,
        };
        //NOTE: Careful passing objects that can't be serialized here.
        //As of time of writing, I encountered errors when passing a Set iterator (Set.entries())
        parentPort?.postMessage(postMessage);

        return;
      }
      void axeLogger[level](message, meta);
    },
    trace: function (message, meta?) {
      this.logMessage("trace", message, meta);
    },
    debug: function (message, meta?) {
      this.logMessage("debug", message, meta);
    },
    info: function (message, meta?) {
      this.logMessage("info", message, meta);
    },
    warn: function (message, meta?) {
      this.logMessage("warn", message, meta);
    },
    error: function (message, meta?) {
      this.logMessage("error", message, meta);
    },
    fatal: function (message, meta?) {
      this.logMessage("fatal", message, meta);
    },
  };

  return { logger, axeLogger };
};

export default loggerFactory;

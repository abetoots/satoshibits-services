import Bree from "bree";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { debuglog } from "node:util";
import { Worker } from "node:worker_threads";

const debug = debuglog("satoshibits:queue");

export interface BaseJob<TType extends string = string> {
  id: string;
  /** The job type. */
  type: TType;
  groupId: string;
  processEnvironment?: string;
}

export interface QueueHandlerOptions {
  validateJob: (jobType: string) => boolean;
  rootPath: string;
  jobsPath?: string;
  onUnhandledError?: (e: unknown) => void;
}

/**
 * Represents a queue handler for managing jobs.
 */
export class QueueHandler<TJobTypes extends string = string> {
  private bree: Bree;
  private extension: string;
  private jobsPath: string;

  /** Determines if a job can be added/processed */
  private validateJob: (jobType: string) => boolean;

  constructor(options: QueueHandlerOptions) {
    this.extension = process.env.NODE_ENV === "production" ? "js" : "ts";

    this.validateJob = options.validateJob;
    this.jobsPath = options.jobsPath ?? path.join(options.rootPath, "jobs");

    //IMPORTANT: When in development, ESM loaders specified at the top level
    //such as "tsx" or "ts-node" are not respected by worker threads. This
    //is a limitation of the worker_threads module in Node 20 as of time of writing.
    //See: https://github.com/privatenumber/tsx/issues/354 for a workaround
    //See: https://github.com/nodejs/node/issues/47747 for another workaround

    //We need to monkey patch the Bree constructor to use a proxy file that registers
    //the tsx loader before requiring the actual job file. This is a workaround until
    //Node fixes the issue.
    //See https://github.com/breejs/ts-worker/blob/main/src/index.js to learn how to extend Bree.

    if (process.env.NODE_ENV === "development") {
      const devLoaderPath = fileURLToPath(
        import.meta.resolve("./dev-loader.mjs"),
      );
      const oldCreateWorker = Bree.prototype.createWorker;
      Bree.prototype.createWorker = function (filename, options) {
        if (filename.endsWith(".ts") || filename.endsWith(".mts")) {
          const filePath = filename;
          debug("filePath", filePath);
          const workerData: object =
            typeof options?.workerData === "object"
              ? (options.workerData as object)
              : {};
          return new Worker(devLoaderPath, {
            ...options,
            workerData: {
              ...workerData,
              filePath,
            },
          });
        }
        return oldCreateWorker(filename, options);
      };
    }

    // Bree.extend(breePlugin);
    this.bree = new Bree({
      logger: false,
      errorHandler: (e) => {
        if (options.onUnhandledError) {
          options.onUnhandledError(e);
        } else {
          console.error("Unhandled error in queue handler", e);
        }
      },
      //IMPORTANT: set to false when not passing an initial jobs array.
      //This is because Bree will run a root check function that
      //will try to resolve the jobs array from the root index: "index.js".
      //It will throw an error if the default export is not an array.
      doRootCheck: false,
      defaultExtension: this.extension,
      root: options.rootPath,
      removeCompleted: true,
      acceptedExtensions: [".js", ".ts", ".mjs"],
    });

    debug("Bree config: ", this.bree.config);
  }

  getBree() {
    return this.bree;
  }

  /**
   * Finds a job based on the provided options.
   *
   * @param options - The options used to search for the job.
   * @returns An object containing the found job, its name, and the associated worker.
   */
  findJob(options: BaseJob<TJobTypes>) {
    let name: string = options.type;
    if (options.id.trim()) {
      name = `${name}_${options.id}`;
    }
    if (options.groupId.trim()) {
      name = `${name}_${options.groupId}`;
    }
    const worker = this.bree.workers.get(name);
    const breeJob = this.bree.config.jobs.find((j) => j.name === name);
    const alreadyStarted =
      this.bree.timeouts.has(name) ||
      this.bree.intervals.has(name) ||
      this.bree.workers.has(name);
    return { breeJob, name, worker, alreadyStarted };
  }

  /**
   * Adds a job to the queue. Job type must match the name
   * of the file in the jobs directory. e.g. "process-user" type must have a file
   * named "process-user.ts" in the jobs directory
   *
   * @param job - The job to be added.
   * @param options - The options for the job.
   */
  async addJob(
    job: BaseJob<TJobTypes>,
    options: Omit<Bree.JobOptions, "name">,
  ) {
    if (!this.validateJob(job.type)) {
      debug(`addJob: failed due to ${job.type} is not valid.`);
      return;
    }

    const { breeJob, name } = this.findJob(job);
    //job already exists
    if (breeJob) return { type: "existing", job };
    await this.bree.add({
      name,
      ...options,
      path: path.join(
        typeof options.path === "string" ? options.path : this.jobsPath,
        `${job.type}.${this.extension}`,
      ),
    });

    return { type: "added", job };
  }

  /**
   * Schedules or immediately runs a job
   *
   * @param job
   */
  async startJob(job: BaseJob<TJobTypes>) {
    if (!this.validateJob(job.type)) {
      debug(`startJob: failed due to ${job.type} is not valid.`);
      return;
    }
    const { breeJob, name, alreadyStarted } = this.findJob(job);

    if (!breeJob) {
      throw new Error(`Job ${name} not found. Please add the job first.`);
    }

    if (!alreadyStarted) {
      debug(`Job ${name} not found. Starting...`);
      await this.bree.start(name); // abides by timeout,date,interval provided
    }

    //provide your own logic here
    //if you want to deliberately run a job type
    //even if it's not time to run it yet
    //or if the scheduled time has passed
    //uncomment the following lines
    //await this.bree.run(name);
  }
}

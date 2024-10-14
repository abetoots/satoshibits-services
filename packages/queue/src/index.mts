import Bree from "bree";
import path from "node:path";
import { debuglog } from "node:util";
import { Worker } from "node:worker_threads";

const debug = debuglog("satoshibits:queue");

export interface BaseJob {
  id: string;
  /** The queued item type */
  type: string;
  groupId: string;
  processEnvironment?: string;
}

export interface QueueHandlerOptions {
  validateJob: (jobType: string) => boolean;
  rootPath: string;
  jobsPath?: string;
  onUnhandledError?: (e: any) => void;
}

/**
 * Represents a queue handler for managing jobs.
 */
export class QueueHandler {
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

    //We need to monkey patch the Bree constructor to use the tsx cli
    //when creating a new worker.
    //See https://github.com/breejs/ts-worker/blob/main/src/index.js to learn how to extend Bree.
    //NOTE: You can only do relative imports in the worker script. If you want
    //the paths in tsconfig to work, you need to register tsconfig-paths as well.
    //See: https://github.com/breejs/ts-worker/blob/main/src/worker.js
    if (process.env.NODE_ENV === "development") {
      const oldCreateWorker = Bree.prototype.createWorker;
      Bree.prototype.createWorker = function (filename, options) {
        if (filename.endsWith(".ts")) {
          const filePath = filename;
          debug("filePath", filePath);
          return new Worker(
            `import("tsx/esm/api").then(({ register }) => {
              register();
              import("${filePath}");
            })`,
            {
              ...options,
              eval: true,
            },
          );
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
  findJob(options: BaseJob) {
    let name = options.type;
    if (options.id.trim()) {
      name = `${name}_${options.id}`;
    }
    if (options.groupId.trim()) {
      name = `${name}_${options.groupId}`;
    }
    const worker = this.bree.workers.get(name);
    const breeJob = this.bree.config.jobs.find((j) => j.name === name);
    return { breeJob, name, worker };
  }

  /**
   * Adds a job to the queue. Job type must match the name
   * of the file in the jobs directory. e.g. "process-user" type must have a file
   * named "process-user.ts" in the jobs directory
   *
   * @param job - The job to be added.
   * @param options - The options for the job.
   */
  async addJob(job: BaseJob, options: Omit<Bree.JobOptions, "name">) {
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
      path: path.join(this.jobsPath, `${job.type}.${this.extension}`),
    });

    return { type: "added", job };
  }

  /**
   * Schedules or immediately runs a job
   *
   * @param job
   */
  async startJob(job: BaseJob) {
    if (!this.validateJob(job.type)) {
      debug(`startJob: failed due to ${job.type} is not valid.`);
      return;
    }
    const { breeJob, worker, name } = this.findJob(job);

    if (!breeJob) {
      throw new Error(`Job ${name} not found. Please add the job first.`);
    }

    if (!worker) {
      debug(`Job ${name} not found. Starting...`);
      await this.bree.start(name); // abides by timeout,date,interval provided
      return { type: "scheduled" };
    } else {
      debug(`Job ${name} found. Running...`);
      await this.bree.run(name);
      return { type: "run" };
    }

    //provide your own logic here
    //if you want to deliberately run a job type
    //even if it's not time to run it yet
    //or if the scheduled time has passed
    //uncomment the following lines
    //await this.bree.run(name);
  }
}
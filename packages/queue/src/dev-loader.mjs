import { register } from "tsx/esm/api";
import { workerData } from "node:worker_threads";

register();

//eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
if (workerData?.filePath) {
  //eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  await import(workerData.filePath);
}

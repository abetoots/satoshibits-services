import { input, select } from "@inquirer/prompts";
import { execa } from "execa";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageName = await input({ message: "Enter package name" });
const description = await input({ message: "Enter package description" });
const packageType = await select({
  message: "Select package type",
  choices: [
    { name: "Node Package Module", value: "node" },
    { name: "React Component", value: "react" },
  ],
});

try {
  const { stdout } = await execa({
    stdout: process.stdout,
    stderr: process.stderr,
  })`bash ${__dirname}/add-package.sh -n ${packageName} -d ${description} -t ${packageType}`;
  console.log(stdout);
} catch (error) {
  console.error(error.message);
}

/**
 * The package as `pnpm publish` uploads it, for the tests that need it:
 * package-contents.test.mts reads what the tarball holds, and
 * readme-examples.test.mts installs it into a consumer.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const NAME = "@satoshibits/observability";
const run = promisify(execFile);

/** rebuild dist/, as preload.test.mts does, unless the release workflow has just built it */
export async function buildDist(): Promise<void> {
  if (process.env.OBS_TEST_DIST_FRESH !== "1") {
    await run("pnpm", ["run", "build"], { cwd: PACKAGE_ROOT });
  }
}

export interface Packed {
  /** every file in the tarball, as `pnpm pack --json` lists it */
  files: string[];
  tarball: string;
  /** remove the tarball */
  dispose: () => void;
}

/** `pnpm pack` the package as it is on disk (build it first) into a temporary directory */
export async function packPackage(): Promise<Packed> {
  const destination = mkdtempSync(join(tmpdir(), "obs-pack-"));
  const dispose = () => rmSync(destination, { recursive: true, force: true });
  try {
    const { stdout } = await run("pnpm", ["pack", "--pack-destination", destination, "--json"], {
      cwd: PACKAGE_ROOT,
      maxBuffer: 16 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as { files?: unknown; filename?: unknown };
    if (!Array.isArray(parsed.files) || typeof parsed.filename !== "string") {
      throw new Error(`pnpm pack --json printed no files array or file name: ${stdout.slice(0, 200)}`);
    }
    return {
      files: (parsed.files as { path: string }[]).map((file) => file.path),
      tarball: parsed.filename,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export interface Installed {
  /** where the unpacked package is */
  dir: string;
  /** the store directory whose node_modules holds the package and what it may import */
  store: string;
  dispose: () => void;
}

/**
 * Install a packed tarball into `consumer` the way pnpm lays it out: the
 * package unpacked in a store directory, beside links to the dependencies its
 * packed manifest declares (the workspace's installed copies: the test runs
 * offline) and to the peers the consumer provides, and linked into the
 * consumer's node_modules. Node resolves the package from its real path, so
 * it sees only those: an import of anything else fails.
 */
export async function installPacked(tarball: string, consumer: string): Promise<Installed> {
  const store = mkdtempSync(join(tmpdir(), "obs-store-"));
  const modules = join(store, "node_modules");
  const dir = join(modules, NAME);
  const dispose = () => rmSync(store, { recursive: true, force: true });
  try {
    mkdirSync(dir, { recursive: true });
    await run("tar", ["-xzf", tarball, "-C", dir, "--strip-components=1"]);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const link = (name: string, target: string) => {
      mkdirSync(join(modules, name, ".."), { recursive: true });
      symlinkSync(target, join(modules, name), "dir");
    };
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      link(name, realpathSync(join(PACKAGE_ROOT, "node_modules", name)));
    }
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      const provided = join(consumer, "node_modules", name);
      if (!existsSync(provided)) throw new Error(`the consumer does not provide the peer ${name}`);
      link(name, realpathSync(provided));
    }
    mkdirSync(join(consumer, "node_modules", NAME, ".."), { recursive: true });
    symlinkSync(dir, join(consumer, "node_modules", NAME), "dir");
    return { dir, store, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

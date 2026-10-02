import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Where the Inform tools live. The extension does not ship compilers; it
 * finds them. In order:
 *
 *   1. the informEcosystem.compilersPath setting
 *   2. the INFORM_COMPILERS environment variable
 *   3. a Build\Compilers folder of a Windows-Inform7 checkout near the
 *      workspace, which is what the inform-builder project produces
 *   4. an installed Inform IDE (Windows Program Files, or Inform.app on macOS)
 *   5. inform7 on the PATH
 *
 * The Internal folder, which inform7 needs for every run, is taken from the
 * setting or found beside the compilers.
 */
export interface Toolchain {
  compilersDir: string;
  internalDir: string;
  externalDir?: string;
  origin: string;
}

const EXE = process.platform === "win32" ? ".exe" : "";

export function toolPath(toolchain: Toolchain, name: string): string {
  return path.join(toolchain.compilersDir, name + EXE);
}

function hasInform7(dir: string): boolean {
  return fs.existsSync(path.join(dir, "inform7" + EXE));
}

function candidateCompilerDirs(): { dir: string; origin: string }[] {
  const out: { dir: string; origin: string }[] = [];
  const config = vscode.workspace.getConfiguration("informEcosystem");

  const setting = config.get<string>("compilersPath", "").trim();
  if (setting) {
    out.push({ dir: setting, origin: "informEcosystem.compilersPath setting" });
  }
  if (process.env.INFORM_COMPILERS) {
    out.push({
      dir: process.env.INFORM_COMPILERS,
      origin: "INFORM_COMPILERS environment variable",
    });
  }

  // Near the workspace: the inform-builder layout puts the IDE checkout as a
  // sibling of the sources, so look in the folder and a few parents.
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    let dir = folder.uri.fsPath;
    for (let depth = 0; depth < 4; depth++) {
      for (const rel of [
        "Windows-Inform7/Build/Compilers",
        "Build/Compilers",
        "Compilers",
      ]) {
        out.push({
          dir: path.join(dir, rel),
          origin: `found near workspace (${path.join(dir, rel)})`,
        });
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  if (process.platform === "win32") {
    for (const pf of [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
      process.env["LOCALAPPDATA"] &&
        path.join(process.env["LOCALAPPDATA"], "Programs"),
    ]) {
      if (pf) {
        out.push({
          dir: path.join(pf, "Inform", "Compilers"),
          origin: "installed Inform IDE",
        });
      }
    }
  } else if (process.platform === "darwin") {
    for (const app of [
      "/Applications/Inform.app",
      path.join(os.homedir(), "Applications", "Inform.app"),
    ]) {
      out.push({
        dir: path.join(app, "Contents", "MacOS"),
        origin: "installed Inform.app",
      });
    }
  }

  for (const p of (process.env.PATH ?? "").split(path.delimiter)) {
    if (p) {
      out.push({ dir: p, origin: "PATH" });
    }
  }
  return out;
}

function findInternal(compilersDir: string): string | undefined {
  const config = vscode.workspace.getConfiguration("informEcosystem");
  const setting = config.get<string>("internalPath", "").trim();
  if (setting) {
    return setting;
  }
  const candidates = [
    path.join(compilersDir, "..", "Internal"), // Windows IDE and inform-builder layout
    path.join(compilersDir, "..", "Resources", "Internal"), // Inform.app
    path.join(compilersDir, "Internal"),
    "/usr/share/inform7/Internal",
    "/usr/local/share/inform7/Internal",
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, "Extensions")));
}

function findExternal(): string | undefined {
  const config = vscode.workspace.getConfiguration("informEcosystem");
  const setting = config.get<string>("externalPath", "").trim();
  if (setting) {
    return setting;
  }
  // The IDEs keep the user's extensions in Documents/Inform (Windows, macOS).
  const docs = path.join(os.homedir(), "Documents", "Inform");
  return fs.existsSync(docs) ? docs : undefined;
}

export function locateToolchain(): Toolchain | undefined {
  for (const { dir, origin } of candidateCompilerDirs()) {
    if (hasInform7(dir)) {
      const internalDir = findInternal(dir);
      if (!internalDir) {
        continue;
      }
      return {
        compilersDir: path.resolve(dir),
        internalDir: path.resolve(internalDir),
        externalDir: findExternal(),
        origin,
      };
    }
  }
  return undefined;
}

/** Find a single tool (inform6 for stand-alone .inf files) even without inform7. */
export function locateTool(name: string): string | undefined {
  const toolchain = locateToolchain();
  if (toolchain && fs.existsSync(toolPath(toolchain, name))) {
    return toolPath(toolchain, name);
  }
  for (const { dir } of candidateCompilerDirs()) {
    const p = path.join(dir, name + EXE);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export const NOT_FOUND_HELP =
  "Inform compilers not found. Set informEcosystem.compilersPath to a folder " +
  "containing inform7, inform6 and inblorb (for example Windows-Inform7\\Build\\Compilers " +
  "produced by inform-builder, or the Compilers folder of an installed Inform IDE).";

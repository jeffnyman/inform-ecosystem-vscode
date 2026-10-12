import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { installedToolchains } from "./download";

/**
 * Where the Inform tools live. The extension does not ship compilers; it
 * finds them. In order:
 *
 *   1. the informEcosystem.compilersPath setting
 *   2. the INFORM_COMPILERS environment variable
 *   3. a Build\Compilers folder of a Windows-Inform7 checkout near the
 *      workspace, which is what the inform-builder project produces
 *   4. a toolchain downloaded with "Inform: Download Compilers", newest first
 *   5. an installed Inform IDE: on Windows wherever the installer's registry
 *      entry says, then Program Files; on macOS, Inform.app
 *   6. inform7 on the PATH
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

  for (const t of installedToolchains()) {
    out.push({
      dir: t.compilersDir,
      origin: `downloaded toolchain ${t.version}`,
    });
  }

  if (process.platform === "win32") {
    for (const dir of registeredInformInstalls()) {
      out.push({
        dir: path.join(dir, "Compilers"),
        origin: `installed Inform IDE (${dir})`,
      });
    }
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

let registered: string[] | undefined;

/**
 * Install folders of Inform for Windows, read from the uninstall entry its
 * installer writes, so an install outside Program Files is found. The 64-bit
 * build's entry is in the 32-bit registry view, so both views are searched.
 * Read once per session.
 */
function registeredInformInstalls(): string[] {
  if (registered) {
    return registered;
  }
  const reg = (args: string[]) => {
    try {
      return execFileSync("reg.exe", ["query", ...args], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      });
    } catch {
      return ""; // reg exits non-zero when nothing matches
    }
  };
  const dirs = new Set<string>();
  for (const hive of ["HKLM", "HKCU"]) {
    for (const view of ["/reg:32", "/reg:64"]) {
      const uninstall = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`;
      const search = reg([
        uninstall,
        "/s",
        "/f",
        "Inform for Windows",
        "/d",
        view,
      ]);
      for (const key of registryKeys(search)) {
        const icon = registryValue(
          reg([key, "/v", "DisplayIcon", view]),
          "DisplayIcon",
        );
        if (icon) {
          dirs.add(
            path.dirname(icon.replace(/,\s*-?\d+$/, "").replace(/"/g, "")),
          );
        }
      }
    }
  }
  registered = [...dirs];
  return registered;
}

/** The key names in the output of `reg query`. */
export function registryKeys(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("HKEY_"))
    .map((line) => line.trim());
}

/** A value's data in the output of `reg query /v`. */
export function registryValue(
  output: string,
  name: string,
): string | undefined {
  const m = new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*?)\\s*$`, "m").exec(
    output,
  );
  return m ? m[1] : undefined;
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
    path.join(compilersDir, ".."), // downloaded toolchain: the package root is Internal
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
  "Inform compilers not found. Download them with Inform: Download Compilers, " +
  "or set informEcosystem.compilersPath to a folder " +
  "containing inform7, inform6 and inblorb (for example Windows-Inform7\\Build\\Compilers " +
  "produced by inform-builder, or the Compilers folder of an installed Inform IDE).";

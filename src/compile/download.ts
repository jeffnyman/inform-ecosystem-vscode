import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import * as vscode from "vscode";

import { outputChannel, run } from "./runner";

/**
 * Downloads a complete Inform toolchain into the extension's global storage,
 * so that compiling works without an Inform IDE or a local build.
 *
 * The packages are the Informant toolchains: the native inform7, inform6 and
 * inblorb in a Compilers folder, beside everything inform7 expects in its
 * Internal folder (Extensions, Inter, Languages, Templates, ...). The package
 * root is therefore itself the Internal folder.
 *
 * Each install lives in toolchains/<version>/. It is extracted to a
 * ".partial" folder and renamed only when complete, and its toolchain.json is
 * what makes it visible to compiler discovery, so an interrupted download
 * never leaves a half-usable toolchain behind.
 */

interface ManifestEntry {
  version: string;
  platform: string;
  url: string;
  sha256: string;
}

const RELEASES =
  "https://github.com/interactivefiction/informant-toolchains/releases/download";

// From Informant's official manifest. Platforms are `${platform}-${arch}`.
const MANIFEST: ManifestEntry[] = [
  {
    version: "10.1.2c",
    platform: "win32-x64",
    url: `${RELEASES}/inform-10.1.2c-windows-x64/informant-toolchain-windows-x64-10.1.2.tar.gz`,
    sha256: "8d84a154721c70b841475aef82de104cc650769876ed7fe722f3bf754d7239b2",
  },
  {
    version: "10.1.2c",
    platform: "linux-x64",
    url: `${RELEASES}/inform-10.1.2c-linux-x64/informant-toolchain-linux-x64-10.1.2.tar.gz`,
    sha256: "3900ed5dd54ccfb80b7506ca04316d8bff2e128b6853a6772afc77914ede48cd",
  },
  {
    version: "10.1.2c",
    platform: "darwin-x64",
    url: `${RELEASES}/inform-10.1.2c-macosuniv-x64/informant-toolchain-macos-universal-10.1.2.tar.gz`,
    sha256: "df222fe547277b73900d5196c68232934779fdfb0719b34ab1f4553a8f9b9749",
  },
  {
    version: "10.1.2c",
    platform: "darwin-arm64",
    url: `${RELEASES}/inform-10.1.2c-macosuniv-x64/informant-toolchain-macos-universal-10.1.2.tar.gz`,
    sha256: "df222fe547277b73900d5196c68232934779fdfb0719b34ab1f4553a8f9b9749",
  },
];

export interface InstalledToolchain {
  version: string;
  compilersDir: string;
  installedAt: string;
}

const MARKER = "toolchain.json";
const EXE = process.platform === "win32" ? ".exe" : "";

let toolchainsRoot: string | undefined;

export function setToolchainsRoot(dir: string) {
  toolchainsRoot = dir;
}

/** Completed downloads, most recently installed first. */
export function installedToolchains(): InstalledToolchain[] {
  if (!toolchainsRoot || !fs.existsSync(toolchainsRoot)) {
    return [];
  }
  const found: InstalledToolchain[] = [];
  for (const name of fs.readdirSync(toolchainsRoot)) {
    const dir = path.join(toolchainsRoot, name);
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, MARKER), "utf8"));
      found.push({
        version: String(data.version),
        compilersDir: path.join(dir, String(data.compilers)),
        installedAt: String(data.installedAt),
      });
    } catch {
      // No marker: a partial download, or something that is not ours.
    }
  }
  return found.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
}

/**
 * Download, verify and unpack the toolchain for this platform. Resolves true
 * when a toolchain is installed (now or already), false if the user declined
 * or it failed.
 */
export async function downloadCompilers(): Promise<boolean> {
  const root = toolchainsRoot;
  if (!root) {
    return false;
  }
  const platform = `${process.platform}-${process.arch}`;
  const entry = MANIFEST.find((e) => e.platform === platform);
  if (!entry) {
    vscode.window.showErrorMessage(
      `No downloadable Inform compilers for ${platform}. Set informEcosystem.compilersPath to a local build instead.`,
    );
    return false;
  }

  const dest = path.join(root, entry.version);
  if (fs.existsSync(path.join(dest, MARKER))) {
    vscode.window.showInformationMessage(
      `Inform ${entry.version} compilers are already downloaded.`,
    );
    return true;
  }

  const download = "Download";
  const answer = await vscode.window.showInformationMessage(
    `Download the Inform ${entry.version} compilers?`,
    {
      modal: true,
      detail: `About 51 MB from ${new URL(entry.url).host}, unpacked to about 90 MB in the extension's storage. Other Inform installations are not touched.`,
    },
    download,
  );
  if (answer !== download) {
    return false;
  }

  const out = outputChannel();
  out.show(true);
  out.appendLine(`== Download Inform ${entry.version} compilers`);
  out.appendLine(`From: ${entry.url}`);

  fs.mkdirSync(root, { recursive: true });
  const archive = path.join(root, `${entry.version}.download.tar.gz`);
  const partial = path.join(root, `${entry.version}.partial`);

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Inform: downloading ${entry.version} compilers`,
        cancellable: true,
      },
      async (progress, token) => {
        const sha256 = await fetchTo(entry.url, archive, progress, token);
        if (sha256 !== entry.sha256) {
          throw new Error(
            `Checksum mismatch: expected ${entry.sha256}, got ${sha256}.`,
          );
        }
        out.appendLine(`SHA-256 verified: ${sha256}`);

        progress.report({ message: "unpacking" });
        fs.rmSync(partial, { recursive: true, force: true });
        fs.mkdirSync(partial);
        const result = await run(tar(), ["-xf", archive, "-C", partial], root);
        if (result.code !== 0) {
          throw new Error(`tar exited with code ${result.code}.`);
        }

        const compilers = findCompilersDir(partial);
        if (!compilers) {
          throw new Error(`No inform7${EXE} found in the downloaded package.`);
        }
        if (process.platform !== "win32") {
          for (const name of fs.readdirSync(compilers)) {
            fs.chmodSync(path.join(compilers, name), 0o755);
          }
        }
        fs.writeFileSync(
          path.join(partial, MARKER),
          JSON.stringify(
            {
              version: entry.version,
              platform,
              compilers: path.relative(partial, compilers),
              url: entry.url,
              sha256,
              installedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        );
        fs.rmSync(dest, { recursive: true, force: true });
        fs.renameSync(partial, dest);
      },
    );
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    const message = err instanceof Error ? err.message : String(err);
    out.appendLine(`== Download failed: ${message}`);
    vscode.window.showErrorMessage(`Inform: download failed. ${message}`);
    return false;
  } finally {
    fs.rmSync(archive, { force: true });
  }

  out.appendLine(`== Installed in ${dest}`);
  return true;
}

/** Stream a URL to a file, reporting progress; resolves with its SHA-256. */
async function fetchTo(
  url: string,
  file: string,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken,
): Promise<string> {
  const abort = new AbortController();
  const cancel = token.onCancellationRequested(() => abort.abort());
  try {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    const hash = crypto.createHash("sha256");
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        received += chunk.length;
        const mb = (received / 1048576).toFixed(1);
        progress.report({
          message: total
            ? `${mb} of ${(total / 1048576).toFixed(1)} MB`
            : `${mb} MB`,
          increment: total ? (chunk.length / total) * 100 : undefined,
        });
        done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      meter,
      fs.createWriteStream(file),
    );
    return hash.digest("hex");
  } catch (err) {
    if (token.isCancellationRequested) {
      throw new Error("Cancelled.");
    }
    throw err;
  } finally {
    cancel.dispose();
  }
}

/**
 * Windows 10 and later ship bsdtar, which reads .tar.gz. Name it explicitly:
 * a GNU tar from Git for Windows earlier on the PATH would read "C:\..." as a
 * remote host.
 */
function tar(): string {
  if (process.platform === "win32") {
    return path.join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "tar.exe",
    );
  }
  return "tar";
}

/** The folder holding inform7, at most a few levels down (PACKAGE/Compilers). */
function findCompilersDir(dir: string, depth = 0): string | undefined {
  if (fs.existsSync(path.join(dir, "inform7" + EXE))) {
    return dir;
  }
  if (depth >= 3) {
    return undefined;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const found = findCompilersDir(path.join(dir, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

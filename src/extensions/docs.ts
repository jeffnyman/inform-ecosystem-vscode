import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

import { PagePanel, Site } from "../common/pages";
import { findProjectDir, listProjects } from "../compile/project";
import { NOT_FOUND_HELP, locateToolchain, toolPath } from "../compile/tools";
import {
  documentationInverts,
  findImagery,
  imageryRewrite,
  openDocumentationLink,
} from "../docs/viewer";

/**
 * Shows the documentation of installed extensions, as the Index links to it
 * (inform://Extensions/Extensions/Author/Title.html).
 *
 * Inform writes those pages in an "extensions census". Our compiles skip it
 * (-no-census-update): folded into a compile, a first census on Linux read
 * every built-in extension into the story and failed. Run on its own it is
 * safe and quick, so it is run here whenever the pages are wanted, writing
 * into the extension's storage (-transient) rather than the user's Inform
 * folder, with the project's own extensions included (-nest).
 */
export const EXTENSION_DOCS_VIEW_TYPE = "informEcosystem.extensionDocs";

const execFileAsync = promisify(execFile);

let storageRoot: string | undefined;

/** Where census output is kept; set on activation. */
export function setCensusStorage(dir: string) {
  storageRoot = dir;
}

/** Story.inform's own extensions are in Story.materials/Extensions. */
export function materialsFolder(projectDir: string): string {
  return projectDir.replace(/\.inform$/i, ".materials");
}

/** The project being worked on: the active editor's, else the workspace's only one. */
export function currentProject(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  const fromEditor = active?.scheme === "file" && findProjectDir(active.fsPath);
  if (fromEditor) {
    return fromEditor;
  }
  const found = new Set<string>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const own = findProjectDir(folder.uri.fsPath);
    if (own) {
      found.add(own);
    }
    listProjects(folder.uri.fsPath).forEach((p) => found.add(p));
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** Run the census for a project (or none) and return the folder of its pages. */
export async function runCensus(project: string | undefined): Promise<string> {
  const toolchain = locateToolchain();
  if (!toolchain || !storageRoot) {
    throw new Error(NOT_FOUND_HELP);
  }
  const key = project
    ? crypto
        .createHash("sha1")
        .update(project.toLowerCase())
        .digest("hex")
        .slice(0, 12)
    : "user";
  const transient = path.join(storageRoot, "extension-docs", key);
  const docs = path.join(transient, "Documentation");
  // Start afresh, so removed extensions' pages go too.
  fs.rmSync(docs, { recursive: true, force: true });
  fs.mkdirSync(transient, { recursive: true });
  const args = ["-internal", toolchain.internalDir];
  if (toolchain.externalDir) {
    args.push("-external", toolchain.externalDir);
  }
  args.push("-transient", transient);
  if (project && fs.existsSync(materialsFolder(project))) {
    args.push("-nest", materialsFolder(project));
  }
  args.push("-census");
  await execFileAsync(toolPath(toolchain, "inform7"), args, {
    cwd: transient,
    windowsHide: true,
  });
  if (!fs.existsSync(path.join(docs, "Extensions.html"))) {
    throw new Error("Inform wrote no extension documentation.");
  }
  return docs;
}

function site(root: string): Site {
  const imagery = findImagery();
  const self: Site = {
    viewType: EXTENSION_DOCS_VIEW_TYPE,
    title: "Extension Documentation",
    root,
    resourceRoots: imagery ? [root, imagery] : [root],
    home: "Extensions.html",
    contents: [
      { label: "Installed Extensions", page: "Extensions.html" },
      { label: "Definitions from Extensions in Use", page: "ExtIndex.html" },
    ],
    rewrite: imageryRewrite(imagery),
    invertWhenDark: documentationInverts,
    onLink: (href) => {
      if (openDocumentationLink(href)) {
        return;
      }
      // Links between these pages.
      const m = /^inform:\/\/Extensions\/(.+)$/.exec(href);
      if (m) {
        PagePanel.open(self, censusPage(m[1]));
      }
    },
  };
  return self;
}

/**
 * The census page an inform://Extensions/... link names. Inform 10.1 writes
 * them as .../Extensions/Author/Title.html, from the Documentation folder;
 * earlier builds as .../Documentation/Author/Title.html. Both name the page
 * Extensions/Author/Title.html.
 */
export function censusPage(link: string): string {
  let page = link;
  try {
    page = decodeURI(link);
  } catch {
    // Leave it as given.
  }
  return page.replace(/^Documentation\//, "Extensions/");
}

/**
 * Open extension documentation for a project, at a page relative to the
 * documentation folder (Extensions/Author/Title.html), or at the list of
 * installed extensions.
 */
export async function openExtensionDocumentation(
  project: string | undefined,
  page = "Extensions.html",
) {
  let root: string;
  try {
    root = await runCensus(project);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not produce the extension documentation: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  const [file] = page.split("#");
  if (!fs.existsSync(path.join(root, file))) {
    vscode.window.showWarningMessage(
      `Inform has no documentation page ${file}; showing the installed extensions instead.`,
    );
    page = "Extensions.html";
  }
  const open = PagePanel.get(EXTENSION_DOCS_VIEW_TYPE);
  PagePanel.open(site(root), page, open?.panel.viewColumn);
}

export function registerExtensionDocs(context: vscode.ExtensionContext) {
  setCensusStorage(context.globalStorageUri.fsPath);
  context.subscriptions.push(
    vscode.commands.registerCommand("informEcosystem.openExtensionDocs", () =>
      openExtensionDocumentation(currentProject()),
    ),
  );
}

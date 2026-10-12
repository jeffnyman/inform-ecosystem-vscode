import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { PagePanel, Site } from "../common/pages";
import { pickProject } from "../compile/commands";
import { installedToolchains } from "../compile/download";
import { locateToolchain } from "../compile/tools";
import { findDocumentation, openDocumentationPage } from "../docs/viewer";

/**
 * Shows a project's Index, the reports inform7 writes into its Index folder
 * on every compile: Welcome, Contents, Actions, Kinds, Phrasebook, Rules,
 * Scenes and World, with a Details page per action.
 *
 * Beyond what the documentation needs, the Index uses the IDE's schemes:
 * inform:/doc_images/... and the like for images that live with Inform, not
 * the project; inform:/docN.html for links into the documentation;
 * source:story.ni#lineN to show a line of the source. Its scripts navigate
 * with window.location and read ?segmentN queries, both seen to by the page
 * panel.
 */
export const INDEX_VIEW_TYPE = "informEcosystem.index";

const REPORTS = [
  "Welcome",
  "Contents",
  "Actions",
  "Kinds",
  "Phrasebook",
  "Rules",
  "Scenes",
  "World",
];

const IMAGE_FAMILIES = [
  "doc_images",
  "map_icons",
  "scene_icons",
  "bg_images",
  "outcome_images",
];

/**
 * The folder holding Inform's image folders (doc_images and the rest): the
 * Imagery folder of a downloaded toolchain, the Windows IDE's Documentation
 * folder, or the website documentation's assets/images.
 */
export function findImagery(): string | undefined {
  const candidates: string[] = [];
  const toolchain = locateToolchain();
  if (toolchain) {
    candidates.push(path.join(toolchain.internalDir, "Imagery"));
  }
  const docs = findDocumentation();
  if (docs) {
    candidates.push(docs.root, path.join(docs.root, "assets", "images"));
  }
  for (const t of installedToolchains()) {
    candidates.push(path.join(t.compilersDir, "..", "Imagery"));
  }
  return candidates.find((dir) => fs.existsSync(path.join(dir, "doc_images")));
}

export function indexSite(projectDir: string): Site {
  const root = path.join(projectDir, "Index");
  const name = path.basename(projectDir).replace(/\.inform$/i, "");
  const imagery = findImagery();
  const families = new RegExp(
    `(["'=(])inform:/(${IMAGE_FAMILIES.join("|")})/`,
    "g",
  );
  return {
    viewType: INDEX_VIEW_TYPE,
    title: `${name} Index`,
    root,
    resourceRoots: imagery ? [root, imagery] : [root],
    home: "Welcome.html",
    pageTitle: (page) =>
      `${name} Index: ${page.startsWith("Details/") ? "Action Details" : path.basename(page, ".html")}`,
    contents: REPORTS.filter((r) =>
      fs.existsSync(path.join(root, `${r}.html`)),
    ).map((r) => ({ label: r, page: `${r}.html` })),
    // Image references are often unquoted (src=inform:/doc_images/...).
    rewrite: (html, uri) =>
      imagery
        ? html.replace(
            families,
            (_, before: string, family: string) =>
              `${before}${uri(path.join(imagery, family))}/`,
          )
        : html,
    onLink: (href) => followLink(projectDir, href),
  };
}

/** The IDE's own links: into the source, and into the documentation. */
async function followLink(projectDir: string, href: string) {
  const source = /^source:([^#]+)#line(\d+)$/.exec(href);
  if (source) {
    await showSourceLine(
      projectDir,
      decodeURIComponent(source[1]),
      Number(source[2]),
    );
    return;
  }
  const doc = /^inform:\/((R?doc\d+\.html)(#.*)?)$/.exec(href);
  if (doc) {
    if (!openDocumentationPage(doc[1], vscode.ViewColumn.Beside)) {
      vscode.window.showWarningMessage(
        `The documentation page ${doc[2]} was not found. Open Documentation shows where it is looked for.`,
      );
    }
    return;
  }
  if (/^inform:\/\/Extensions\//.test(href)) {
    vscode.window.setStatusBarMessage(
      "Inform: links to extension documentation are not supported yet.",
      5000,
    );
  }
}

/** Show a line of a file in the project's Source folder, selected. */
export async function showSourceLine(
  projectDir: string,
  file: string,
  line: number,
) {
  const sourceDir = path.join(projectDir, "Source");
  const target = path.resolve(sourceDir, file);
  if (
    path.relative(sourceDir, target).startsWith("..") ||
    !fs.existsSync(target)
  ) {
    return;
  }
  const uri = vscode.Uri.file(target);
  const visible = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.fsPath.toLowerCase() === target.toLowerCase(),
  );
  const editor = await vscode.window.showTextDocument(uri, {
    viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
  });
  const range = editor.document.lineAt(
    Math.min(Math.max(line - 1, 0), editor.document.lineCount - 1),
  ).range;
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

// Reload the open Index when a compile rewrites it.
let watched: { root: string; watcher: vscode.Disposable } | undefined;

function watchIndex(root: string) {
  if (watched?.root === root) {
    return;
  }
  watched?.watcher.dispose();
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(root), "**/*.html"),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const panel = PagePanel.get(INDEX_VIEW_TYPE);
      if (panel?.site.root === root) {
        panel.reload();
      }
    }, 500);
  };
  watcher.onDidChange(reload);
  watcher.onDidCreate(reload);
  watched = { root, watcher };
}

export async function openIndex() {
  const project = await pickProject();
  if (!project) {
    return;
  }
  const welcome = path.join(project.dir, "Index", "Welcome.html");
  if (!fs.existsSync(welcome)) {
    const compile = "Compile";
    const answer = await vscode.window.showInformationMessage(
      `${project.name} has no Index yet. Inform writes it when the project is compiled.`,
      compile,
    );
    if (answer !== compile) {
      return;
    }
    await vscode.commands.executeCommand("informEcosystem.compile");
    if (!fs.existsSync(welcome)) {
      return;
    }
  }
  const site = indexSite(project.dir);
  PagePanel.open(site);
  watchIndex(site.root);
}

export function registerIndex(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("informEcosystem.openIndex", openIndex),
    { dispose: () => watched?.watcher.dispose() },
  );
}

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { installedToolchains } from "../compile/download";
import { locateToolchain } from "../compile/tools";

/**
 * Shows Inform's own documentation, Writing with Inform and The Recipe Book,
 * in a panel beside the source, as the Inform IDE does.
 *
 * The pages are indoc-generated HTML, found in one of two layouts:
 *
 *   - the Inform website's, as in the downloaded toolchains: pages in book/
 *     (WI_1_1.html, RB_1_1.html), images under assets/ referred to by
 *     site-absolute paths (/assets/images/...);
 *   - the Windows IDE's: pages side by side (doc1.html, Rdoc1.html) with a
 *     contents page, index.html, and images referred to through the IDE's
 *     own inform: scheme (inform:/doc_images/...).
 *
 * Either way the image paths, some of them inside the pages' own scripts,
 * are relative to the documentation folder. A webview cannot follow links
 * between local pages, so each page is read here, those paths pointed at the
 * webview's resource URIs, and a small script added that sends link clicks
 * back to the extension. The example "paste" buttons call
 * window.Project.pasteCode, the IDE's hook; the script provides that hook and
 * the code is pasted into the Inform source editor.
 */
export const DOCS_VIEW_TYPE = "informEcosystem.docs";

const ONLINE = "https://ganelson.github.io/inform-website/book/WI_1_1.html";

interface Layout {
  /** The page that identifies the layout, and opens first. */
  home: string;
  contents: { label: string; page: string }[];
}

const LAYOUTS: Layout[] = [
  {
    home: "book/WI_1_1.html",
    contents: [
      { label: "Writing with Inform", page: "book/WI_1_1.html" },
      { label: "The Inform Recipe Book", page: "book/RB_1_1.html" },
      { label: "General Index", page: "book/general_index.html" },
      {
        label: "Examples (alphabetical)",
        page: "book/examples_alphabetical.html",
      },
      { label: "Examples (numerical)", page: "book/examples_numerical.html" },
      { label: "Examples (thematic)", page: "book/examples_thematic.html" },
    ],
  },
  {
    home: "index.html",
    contents: [
      { label: "Contents", page: "index.html" },
      { label: "Writing with Inform", page: "doc1.html" },
      { label: "The Inform Recipe Book", page: "Rdoc1.html" },
      { label: "General Index", page: "general_index.html" },
      { label: "Examples (alphabetical)", page: "examples_alphabetical.html" },
      { label: "Examples (numerical)", page: "allegs.html" },
      { label: "Examples (thematic)", page: "Rallegs.html" },
    ],
  },
];

export interface Documentation {
  root: string;
  layout: Layout;
}

function config() {
  return vscode.workspace.getConfiguration("informEcosystem");
}

/** The layout of a documentation folder, if it is one. */
function layoutOf(dir: string): Layout | undefined {
  return LAYOUTS.find(
    (layout) =>
      fs.existsSync(path.join(dir, layout.home)) &&
      fs.existsSync(path.join(dir, layout.contents[1].page)),
  );
}

/**
 * The documentation folder: the setting, else the one in or beside the
 * Internal folder of the compilers in use (a downloaded toolchain has it
 * inside, the Windows IDE beside), else that of any downloaded toolchain.
 */
export function findDocumentation(): Documentation | undefined {
  const candidates: string[] = [];
  const setting = config().get<string>("documentationPath", "").trim();
  if (setting) {
    candidates.push(setting);
  }
  const toolchain = locateToolchain();
  if (toolchain) {
    candidates.push(
      path.join(toolchain.internalDir, "Documentation"),
      path.join(toolchain.internalDir, "..", "Documentation"),
    );
  }
  for (const t of installedToolchains()) {
    candidates.push(path.join(t.compilersDir, "..", "Documentation"));
  }
  for (const root of candidates) {
    const layout = layoutOf(root);
    if (layout) {
      return { root, layout };
    }
  }
  return undefined;
}

/** Paste code escapes characters as [=0xNNNN=]; turn them back. */
export function decodePasteCode(code: string): string {
  return code.replace(/\[=0x([0-9A-Fa-f]{4})=\]/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * Runs inside each page, ahead of the page's own scripts.
 *
 * Clicks are handled in the bubbling phase, so the pages' own onclick
 * handlers (showing and hiding examples) run first, and propagation stops at
 * the document so VS Code's handler on the window never sees them: it would
 * try to open book links as files and cancel javascript: links.
 */
function pageScript(hash: string): string {
  return `(function () {
  var vscode = acquireVsCodeApi();
  var hash = ${JSON.stringify(hash).replace(/</g, "\\u003c")};
  window.Project = {
    selectView: function () {},
    pasteCode: function (code) { vscode.postMessage({ type: "paste", code: String(code) }); },
    // Example links in the Windows IDE's pages; not supported yet.
    createNewProject: function () {}
  };
  function scrollTo(id) {
    var target = document.getElementById(id) || document.getElementsByName(id)[0];
    if (target) { target.scrollIntoView(); }
  }
  if (hash) {
    // The page's own onload opens the example named in location.hash.
    try { history.replaceState(null, "", "#" + hash); } catch (e) {}
    window.addEventListener("load", function () { scrollTo(hash); });
  }
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest && event.target.closest("a[href]");
    if (!link) { return; }
    event.stopPropagation();
    var href = link.getAttribute("href");
    if (/^javascript:/i.test(href) || event.defaultPrevented) { return; }
    event.preventDefault();
    if (href.charAt(0) === "#") {
      // With a <base>, the browser would resolve this against the book folder.
      scrollTo(decodeURIComponent(href.slice(1)));
    } else if (/^https?:/i.test(href)) {
      vscode.postMessage({ type: "external", url: href });
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      vscode.postMessage({ type: "navigate", href: href });
    }
  });
  window.addEventListener("mouseup", function (event) {
    if (event.button === 3) { vscode.postMessage({ type: "back" }); }
    if (event.button === 4) { vscode.postMessage({ type: "forward" }); }
  });
})();`;
}

/**
 * Make a documentation page displayable in the webview: a content security
 * policy, a base for its relative links, our script, and its image paths
 * (in attributes and in its scripts alike), /assets/... in the website's
 * layout and inform:/... in the Windows IDE's, pointed into the
 * documentation folder.
 */
export function preparePage(
  html: string,
  page: { baseUri: string; rootUri: string; cspSource: string; hash: string },
): string {
  // The pages' scripts are inline, and so are their onclick handlers and
  // javascript: links; they are local files from the toolchain.
  const csp = [
    "default-src 'none'",
    `img-src ${page.cspSource} data:`,
    `style-src ${page.cspSource} 'unsafe-inline'`,
    `font-src ${page.cspSource}`,
    "script-src 'unsafe-inline'",
  ].join("; ");
  // VS Code styles every webview from the colour theme: text in the editor's
  // foreground colour, links in its link colour, blockquotes tinted. The
  // pages are white paper that sets no body text colour, so in a dark theme
  // their text came out light gray on white. Put back a browser's defaults;
  // the pages' own stylesheet, which follows, still has the last word.
  const defaults =
    "body { color: #000000; }" +
    " a, a:hover { color: #0000ee; }" +
    " blockquote { background: transparent; border-color: transparent; }";
  const head =
    `\n<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `\n<base href="${page.baseUri}/">` +
    `\n<style>${defaults}</style>` +
    `\n<script>${pageScript(page.hash)}</script>`;
  return html
    .replace(/(["'])\/assets\//g, `$1${page.rootUri}/assets/`)
    .replace(/(["'])inform:\//g, `$1${page.rootUri}/`)
    .replace(/<head[^>]*>/i, (tag) => tag + head);
}

class DocsViewer {
  private static current: DocsViewer | undefined;

  /** Pages visited, as paths relative to the documentation folder, with any #fragment. */
  private history: string[] = [];
  private position = -1;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly docs: Documentation,
  ) {
    panel.webview.onDidReceiveMessage((message) => this.receive(message));
    panel.onDidChangeViewState(() => this.updateContext());
    panel.onDidDispose(() => {
      if (DocsViewer.current === this) {
        DocsViewer.current = undefined;
        this.updateContext();
      }
    });
  }

  static show(docs: Documentation) {
    if (DocsViewer.current && DocsViewer.current.docs.root !== docs.root) {
      // Its onDidDispose may not have run by the time we go on.
      const old = DocsViewer.current;
      DocsViewer.current = undefined;
      old.panel.dispose();
    }
    if (!DocsViewer.current) {
      const panel = vscode.window.createWebviewPanel(
        DOCS_VIEW_TYPE,
        "Inform Documentation",
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
        {
          enableScripts: true,
          enableFindWidget: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.file(docs.root)],
        },
      );
      DocsViewer.current = new DocsViewer(panel, docs);
    } else {
      DocsViewer.current.panel.reveal();
    }
    DocsViewer.current.go(docs.layout.home);
  }

  static back() {
    DocsViewer.current?.step(-1);
  }

  static forward() {
    DocsViewer.current?.step(1);
  }

  static async contents() {
    const viewer = DocsViewer.current;
    if (!viewer) {
      return;
    }
    const choice = await vscode.window.showQuickPick(
      viewer.docs.layout.contents,
      { placeHolder: "Go to" },
    );
    if (choice) {
      viewer.go(choice.page);
    }
  }

  private go(page: string) {
    this.history.splice(this.position + 1, Infinity, page);
    this.position = this.history.length - 1;
    this.render();
  }

  private step(delta: number) {
    const next = this.position + delta;
    if (next >= 0 && next < this.history.length) {
      this.position = next;
      this.render();
    }
  }

  private render() {
    const [page, hash = ""] = this.history[this.position].split("#");
    const file = path.join(this.docs.root, page);
    let html: string;
    try {
      html = fs.readFileSync(file, "utf8");
    } catch {
      vscode.window.showErrorMessage(`Documentation page not found: ${file}`);
      return;
    }
    const webview = this.panel.webview;
    const uri = (rel: string) =>
      webview.asWebviewUri(vscode.Uri.file(path.join(this.docs.root, rel)));
    this.panel.webview.html = preparePage(html, {
      baseUri: uri(path.dirname(page)).toString(),
      rootUri: uri(".").toString(),
      cspSource: webview.cspSource,
      hash,
    });
    const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1].trim();
    this.panel.title = title || "Inform Documentation";
    this.updateContext();
  }

  private async receive(message: {
    type?: string;
    href?: string;
    url?: string;
    code?: string;
  }) {
    switch (message?.type) {
      case "navigate":
        this.follow(String(message.href));
        break;
      case "external":
        if (/^https?:/i.test(String(message.url))) {
          vscode.env.openExternal(vscode.Uri.parse(String(message.url)));
        }
        break;
      case "paste":
        await pasteIntoSource(decodePasteCode(String(message.code)));
        break;
      case "back":
        this.step(-1);
        break;
      case "forward":
        this.step(1);
        break;
    }
  }

  /** A link relative to the current page; only pages inside the documentation. */
  private follow(href: string) {
    const [target, hash] = href.split("#");
    const current = this.history[this.position].split("#")[0];
    let page: string;
    try {
      page = path.posix.normalize(
        path.posix.join(path.posix.dirname(current), decodeURI(target)),
      );
    } catch {
      return;
    }
    if (page.startsWith("..") || !/\.html?$/i.test(page)) {
      return;
    }
    this.go(hash ? `${page}#${hash}` : page);
  }

  private updateContext() {
    const active = DocsViewer.current === this && this.panel.active;
    vscode.commands.executeCommand(
      "setContext",
      "informEcosystem.docsCanGoBack",
      active && this.position > 0,
    );
    vscode.commands.executeCommand(
      "setContext",
      "informEcosystem.docsCanGoForward",
      active && this.position < this.history.length - 1,
    );
  }
}

// The Inform source editor last used, to paste examples into while the
// documentation panel has the focus.
let lastSourceEditor: vscode.TextEditor | undefined;

function isInformSource(editor: vscode.TextEditor | undefined) {
  return (
    !!editor &&
    ["inform7", "inform7extension"].includes(editor.document.languageId)
  );
}

/** Paste at the cursor of the Inform source, replacing any selection, and show it. */
export async function pasteIntoSource(code: string) {
  const target =
    (lastSourceEditor && !lastSourceEditor.document.isClosed
      ? lastSourceEditor
      : undefined) ?? vscode.window.visibleTextEditors.find(isInformSource);
  if (!target) {
    vscode.window.showWarningMessage(
      "Open an Inform 7 source file to paste the example into.",
    );
    return;
  }
  const editor = await vscode.window.showTextDocument(
    target.document,
    target.viewColumn,
  );
  await editor.edit((edit) => edit.replace(editor.selection, code));
}

async function openDocumentation() {
  let docs = findDocumentation();
  if (!docs) {
    const download = "Download Compilers";
    const online = "Open Online";
    const answer = await vscode.window.showWarningMessage(
      "No Inform documentation was found beside the compilers. The downloaded compilers include it.",
      download,
      online,
    );
    if (answer === download) {
      await vscode.commands.executeCommand("informEcosystem.downloadCompilers");
      docs = findDocumentation();
    } else if (answer === online) {
      vscode.env.openExternal(vscode.Uri.parse(ONLINE));
    }
  }
  if (docs) {
    DocsViewer.show(docs);
  }
}

export function registerDocs(context: vscode.ExtensionContext) {
  if (isInformSource(vscode.window.activeTextEditor)) {
    lastSourceEditor = vscode.window.activeTextEditor;
  }
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (isInformSource(editor)) {
        lastSourceEditor = editor;
      }
    }),
    vscode.commands.registerCommand(
      "informEcosystem.openDocs",
      openDocumentation,
    ),
    vscode.commands.registerCommand("informEcosystem.docsBack", () =>
      DocsViewer.back(),
    ),
    vscode.commands.registerCommand("informEcosystem.docsForward", () =>
      DocsViewer.forward(),
    ),
    vscode.commands.registerCommand("informEcosystem.docsContents", () =>
      DocsViewer.contents(),
    ),
  );
}

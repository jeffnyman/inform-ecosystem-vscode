import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { PagePanel, Site } from "../common/pages";
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
 * are relative to the documentation folder, and are pointed there.
 */
export const DOCS_VIEW_TYPE = "informEcosystem.docs";

const ONLINE = "https://ganelson.github.io/inform-website/book/WI_1_1.html";

export interface Layout {
  /** The page that identifies the layout, and opens first. */
  home: string;
  contents: { label: string; page: string }[];
  /** The page for the IDE's name of a section, docN.html or RdocN.html. */
  section(root: string, name: string): string | undefined;
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
    // docN is the Nth section of Writing with Inform in reading order, and
    // RdocN of the Recipe Book: WI_1_1, WI_1_2, ..., WI_2_1, ...
    section(root, name) {
      const m = /^(R?)doc(\d+)\.html$/.exec(name);
      if (!m) {
        return undefined;
      }
      const page = sections(root, m[1] ? "RB" : "WI")[Number(m[2]) - 1];
      return page && `book/${page}`;
    },
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
    section: (_root, name) => name,
  },
];

const sectionLists = new Map<string, string[]>();

/** The WI_c_s.html or RB_c_s.html pages of a book folder, in reading order. */
function sections(root: string, book: "WI" | "RB"): string[] {
  const key = `${root}|${book}`;
  let list = sectionLists.get(key);
  if (!list) {
    const pattern = new RegExp(`^${book}_(\\d+)_(\\d+)\\.html$`);
    list = fs
      .readdirSync(path.join(root, "book"))
      .map((f) => ({ f, m: pattern.exec(f) }))
      .filter((x) => x.m)
      .sort(
        (a, b) =>
          Number(a.m![1]) - Number(b.m![1]) ||
          Number(a.m![2]) - Number(b.m![2]),
      )
      .map((x) => x.f);
    sectionLists.set(key, list);
  }
  return list;
}

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

/** Whether light-only documentation pages are inverted in a dark theme. */
export function documentationInverts(): boolean {
  return (
    config().get<string>("documentation.colorTheme", "followTheme") ===
    "followTheme"
  );
}

function site(docs: Documentation): Site {
  return {
    viewType: DOCS_VIEW_TYPE,
    title: "Inform Documentation",
    root: docs.root,
    resourceRoots: [docs.root],
    home: docs.layout.home,
    contents: docs.layout.contents,
    invertWhenDark: documentationInverts,
    rewrite: (html, uri) => {
      const root = uri(docs.root);
      return html
        .replace(/(["'])\/assets\//g, `$1${root}/assets/`)
        .replace(/(["'])inform:\//g, `$1${root}/`);
    },
  };
}

/** Open the documentation, offering a download or the online copy if there is none. */
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
    PagePanel.open(site(docs));
  }
}

/**
 * Open the documentation at a section named the IDE's way, docN.html or
 * RdocN.html (with any #fragment), as the Index links to it. The panel goes
 * in the given column, or stays where it is if already open.
 */
export function openDocumentationPage(
  name: string,
  column?: vscode.ViewColumn,
): boolean {
  const docs = findDocumentation();
  const [file, hash] = name.split("#");
  const page =
    docs &&
    (file === "index.html"
      ? docs.layout.home
      : docs.layout.section(docs.root, file));
  if (!docs || !page || !fs.existsSync(path.join(docs.root, page))) {
    return false;
  }
  const open = PagePanel.get(DOCS_VIEW_TYPE);
  PagePanel.open(
    site(docs),
    hash ? `${page}#${hash}` : page,
    open?.panel.viewColumn ?? column,
  );
  return true;
}

/**
 * Follow a link into the documentation as the Index and extension
 * documentation give them: inform:/docN.html, inform:/RdocN.html, or
 * inform:/index.html for its contents. False if the link is not one of those.
 */
export function openDocumentationLink(href: string): boolean {
  const m = /^inform:\/((R?doc\d+\.html|index\.html)(#.*)?)$/.exec(href);
  if (!m) {
    return false;
  }
  if (!openDocumentationPage(m[1], vscode.ViewColumn.Beside)) {
    vscode.window.showWarningMessage(
      `The documentation page ${m[2]} was not found. Open Documentation shows where it is looked for.`,
    );
  }
  return true;
}

const IMAGE_FAMILIES = [
  "doc_images",
  "map_icons",
  "scene_icons",
  "bg_images",
  "outcome_images",
];

/**
 * The folder holding Inform's image folders (doc_images and the rest), which
 * the Index and extension documentation refer to as inform:/doc_images/...:
 * the Imagery folder of a downloaded toolchain, the Windows IDE's
 * Documentation folder, or the website documentation's assets/images.
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

/** A Site rewrite pointing inform:/doc_images/... and the like into the imagery folder. */
export function imageryRewrite(imagery: string | undefined): Site["rewrite"] {
  // References are often unquoted (src=inform:/doc_images/...).
  const families = new RegExp(
    `(["'=(])inform:/(${IMAGE_FAMILIES.join("|")})/`,
    "g",
  );
  return (html, uri) =>
    imagery
      ? html.replace(
          families,
          (_, before: string, family: string) =>
            `${before}${uri(path.join(imagery, family))}/`,
        )
      : html;
}

export function registerDocs(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "informEcosystem.openDocs",
      openDocumentation,
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("informEcosystem.documentation.colorTheme")
      ) {
        PagePanel.get(DOCS_VIEW_TYPE)?.reload();
        PagePanel.get("informEcosystem.extensionDocs")?.reload();
      }
    }),
  );
}

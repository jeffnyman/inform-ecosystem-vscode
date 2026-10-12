import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, after, before } from "mocha";

import { decodePasteCode, pasteIntoSource, preparePage } from "../common/pages";
import { registryKeys, registryValue } from "../compile/tools";
import { DOCS_VIEW_TYPE, openDocumentationPage } from "../docs/viewer";
import { INDEX_VIEW_TYPE, showSourceLine } from "../index/viewer";

/** Write pages under a folder, each titled as given ("" for an empty title). */
function writePages(root: string, titles: Record<string, string>) {
  for (const [page, title] of Object.entries(titles)) {
    fs.mkdirSync(path.dirname(path.join(root, page)), { recursive: true });
    fs.writeFileSync(
      path.join(root, page),
      `<html><head><title>${title}</title></head><body></body></html>`,
    );
  }
}

async function useDocumentation(dir: string | undefined) {
  await vscode.workspace
    .getConfiguration("informEcosystem")
    .update("documentationPath", dir, vscode.ConfigurationTarget.Global);
}

/** The panel tab of a view type once it shows the given title; the tab model lags behind. */
async function panelTab(viewType: string, label: string) {
  const find = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (t) =>
          t.input instanceof vscode.TabInputWebview &&
          t.input.viewType.endsWith(viewType) &&
          t.label === label,
      );
  let tab = find();
  for (let i = 0; !tab && i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    tab = find();
  }
  return tab;
}

describe("Pages", function () {
  it("decodes the escapes in paste code", () => {
    assert.strictEqual(
      decodePasteCode(
        "[=0x0022=]Cave[=0x0022=] by Me[=0x000A=][=0x0009=]say [=0x0027=]hi[=0x0027=]",
      ),
      `"Cave" by Me\n\tsay 'hi'`,
    );
  });

  it("prepares a page for the webview", () => {
    const html = preparePage(
      `<html><head><title>T</title></head><body>` +
        `<a onclick="window.location='Welcome.html'; return false;">W</a>` +
        `<script>if (location.search.length > 0) {}</script></body></html>`,
      {
        baseUri: "https://res/docs/book",
        cspSource: "https://res",
        search: "?segment2",
        hash: "e3</script>",
      },
    );
    assert.match(
      html,
      /^<html><head>\n<meta http-equiv="Content-Security-Policy"/,
    );
    assert.match(html, /<base href="https:\/\/res\/docs\/book\/">/);
    // Black on white whatever the colour theme, ahead of the page's own styles.
    assert.match(
      html,
      /<style>body { color: #000000; background-color: #ffffff; }/,
    );
    assert.ok(html.indexOf("<style>") < html.indexOf("<title>"));
    assert.match(
      html,
      /onclick="__informGo\('Welcome\.html'\); return false;"/,
    );
    assert.match(html, /if \(__informSearch\.length > 0\)/);
    assert.match(html, /window\.__informSearch = "\?segment2"/);
    assert.ok(!html.includes("e3</script>"), "the fragment must be escaped");
  });

  it("inverts a light-only page in a dark theme only when asked", () => {
    const page = `<html><head><title>T</title></head><body class="paper"></body></html>`;
    const options = { baseUri: "B", cspSource: "S", search: "", hash: "" };
    const inverted = preparePage(page, { ...options, invertWhenDark: true });
    assert.match(
      inverted,
      /@media \(prefers-color-scheme: dark\) \{ html \{ background-color: #121212; \} body \{ filter: invert\(1\) hue-rotate\(180deg\);/,
    );
    assert.match(
      inverted,
      /img, video \{ filter: invert\(1\) hue-rotate\(180deg\); \}/,
    );
    assert.ok(!preparePage(page, options).includes("filter:"));
  });

  it("leaves a page with its own dark design dark in a dark theme", () => {
    const html = preparePage(
      `<html><head><style>@media (prefers-color-scheme: dark) { :root { --x: #000; } }</style></head></html>`,
      {
        baseUri: "B",
        cspSource: "S",
        search: "",
        hash: "",
        invertWhenDark: true,
      },
    );
    assert.ok(!html.includes("filter:"), "its own design, not an inversion");
    assert.match(
      html,
      /@media \(prefers-color-scheme: light\) \{ body \{ color: #000000; background-color: #ffffff; \}/,
    );
    assert.match(
      html,
      /@media \(prefers-color-scheme: dark\) \{ body \{ color: #ffffff; background-color: #121212; \} \}/,
    );
  });

  it("pastes code at the cursor of the Inform source", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "inform7",
      content: "Before.\n",
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await pasteIntoSource('"Cave" by Me\n');
    assert.strictEqual(document.getText(), 'Before.\n"Cave" by Me\n');
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});

describe("Documentation", function () {
  this.timeout(10000);
  let website: string;
  let ide: string;

  before(async function () {
    website = fs.mkdtempSync(path.join(os.tmpdir(), "inform-docs-web-"));
    writePages(website, {
      "book/WI_1_1.html": "1.1. Preface",
      "book/WI_1_2.html": "1.2. The Natural Language",
      "book/WI_2_1.html": "2.1. Creating the world",
      "book/RB_1_1.html": "1.1. Recipes",
    });
    ide = fs.mkdtempSync(path.join(os.tmpdir(), "inform-docs-ide-"));
    writePages(ide, { "index.html": "Contents", "doc1.html": "1.1. Preface" });
    await vscode.extensions
      .getExtension("jeffnyman.inform-ecosystem-vscode")
      ?.activate();
  });

  after(async () => {
    await useDocumentation(undefined);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(website, { recursive: true, force: true });
    fs.rmSync(ide, { recursive: true, force: true });
  });

  it("opens the website layout at Writing with Inform", async () => {
    await useDocumentation(website);
    await vscode.commands.executeCommand("informEcosystem.openDocs");
    assert.ok(await panelTab(DOCS_VIEW_TYPE, "1.1. Preface"));
  });

  it("finds the IDE's docN sections in the website layout", async () => {
    await useDocumentation(website);
    // doc3 is the third section in reading order: chapter 2, section 1.
    assert.ok(openDocumentationPage("doc3.html"));
    assert.ok(await panelTab(DOCS_VIEW_TYPE, "2.1. Creating the world"));
    assert.ok(!openDocumentationPage("doc99.html"));
  });

  it("opens the Windows IDE layout at its contents page", async () => {
    await useDocumentation(ide);
    await vscode.commands.executeCommand("informEcosystem.openDocs");
    assert.ok(await panelTab(DOCS_VIEW_TYPE, "Contents"));
  });
});

describe("Index", function () {
  this.timeout(10000);
  let parent: string;
  let project: string;

  before(async function () {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "inform-index-"));
    project = path.join(parent, "Fixture.inform");
    fs.mkdirSync(path.join(project, "Source"), { recursive: true });
    fs.writeFileSync(
      path.join(project, "Source", "story.ni"),
      '"Fixture"\n\nThe Hall is a room.\nThe lamp is in the Hall.\n',
    );
    writePages(path.join(project, "Index"), {
      "Welcome.html": "",
      "Kinds.html": "",
    });
    await vscode.extensions
      .getExtension("jeffnyman.inform-ecosystem-vscode")
      ?.activate();
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it("opens the Index of the project being edited", async () => {
    await vscode.window.showTextDocument(
      vscode.Uri.file(path.join(project, "Source", "story.ni")),
    );
    await vscode.commands.executeCommand("informEcosystem.openIndex");
    assert.ok(await panelTab(INDEX_VIEW_TYPE, "Fixture Index: Welcome"));
  });

  it("shows a source line, selected", async () => {
    await showSourceLine(project, "story.ni", 3);
    const editor = vscode.window.activeTextEditor;
    assert.strictEqual(editor?.selection.start.line, 2);
    assert.strictEqual(
      editor?.document.getText(editor.selection),
      "The Hall is a room.",
    );
  });
});

describe("Registry", function () {
  it("reads keys and values from reg query output", () => {
    const search =
      "\r\nHKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inform 7 x64\r\n" +
      "    DisplayName    REG_SZ    Inform for Windows\r\n\r\nEnd of search: 1 match(es) found.\r\n";
    assert.deepStrictEqual(registryKeys(search), [
      "HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inform 7 x64",
    ]);
    const value =
      "\r\nHKEY_LOCAL_MACHINE\\...\\Inform 7 x64\r\n    DisplayIcon    REG_SZ    F:\\Apps\\Inform\\Inform.exe,0\r\n\r\n";
    assert.strictEqual(
      registryValue(value, "DisplayIcon"),
      "F:\\Apps\\Inform\\Inform.exe,0",
    );
    assert.strictEqual(registryValue(value, "UninstallString"), undefined);
  });
});

import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, after, before } from "mocha";

import { registryKeys, registryValue } from "../compile/tools";
import {
  DOCS_VIEW_TYPE,
  decodePasteCode,
  pasteIntoSource,
  preparePage,
} from "../docs/viewer";

/** Write a documentation folder of the given pages, titled by their names. */
function docsFolder(root: string, titles: Record<string, string>) {
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

/** The documentation tab once it shows the given title; the tab model lags behind. */
async function docsTab(label: string) {
  const find = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (t) =>
          t.input instanceof vscode.TabInputWebview &&
          t.input.viewType.endsWith(DOCS_VIEW_TYPE) &&
          t.label === label,
      );
  let tab = find();
  for (let i = 0; !tab && i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    tab = find();
  }
  return tab;
}

describe("Documentation", function () {
  this.timeout(10000);
  let website: string;
  let ide: string;

  before(async function () {
    website = fs.mkdtempSync(path.join(os.tmpdir(), "inform-docs-web-"));
    docsFolder(website, {
      "book/WI_1_1.html": "1.1. Preface",
      "book/RB_1_1.html": "1.1. Recipes",
    });
    ide = fs.mkdtempSync(path.join(os.tmpdir(), "inform-docs-ide-"));
    docsFolder(ide, { "index.html": "Contents", "doc1.html": "1.1. Preface" });
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
      `<html><head><title>T</title></head><body><img src="/assets/images/a.png">` +
        `<img src="inform:/doc_images/c.png">` +
        `<script>x.src = '/assets/images/b.png';</script></body></html>`,
      {
        baseUri: "https://res/docs/book",
        rootUri: "https://res/docs",
        cspSource: "https://res",
        hash: "e3</script>",
      },
    );
    assert.match(
      html,
      /^<html><head>\n<meta http-equiv="Content-Security-Policy"/,
    );
    assert.match(html, /<base href="https:\/\/res\/docs\/book\/">/);
    // Black text whatever the colour theme, ahead of the page's own styles.
    assert.match(html, /<style>body \{ color: #000000; \}/);
    assert.ok(html.indexOf("<style>") < html.indexOf("<title>"));
    assert.match(html, /src="https:\/\/res\/docs\/assets\/images\/a\.png"/);
    assert.match(html, /'https:\/\/res\/docs\/assets\/images\/b\.png'/);
    assert.match(html, /src="https:\/\/res\/docs\/doc_images\/c\.png"/);
    assert.ok(!html.includes("e3</script>"), "the fragment must be escaped");
  });

  it("opens the website layout at Writing with Inform", async () => {
    await useDocumentation(website);
    await vscode.commands.executeCommand("informEcosystem.openDocs");
    assert.ok(await docsTab("1.1. Preface"), "Expected the preface");
  });

  it("opens the Windows IDE layout at its contents page", async () => {
    await useDocumentation(ide);
    await vscode.commands.executeCommand("informEcosystem.openDocs");
    assert.ok(await docsTab("Contents"), "Expected the contents page");
  });

  it("pastes example code at the cursor of the Inform source", async () => {
    const document = await vscode.workspace.openTextDocument({
      language: "inform7",
      content: "Before.\n",
    });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    await pasteIntoSource('"Cave" by Me\n');
    assert.strictEqual(document.getText(), 'Before.\n"Cave" by Me\n');
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

import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, after, before, afterEach } from "mocha";
import * as sinon from "sinon";

import { newStorySource, projectFolderName } from "../compile/project";

describe("New Project", function () {
  let parent: string;

  before(async function () {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "inform-newproject-"));
    await vscode.extensions
      .getExtension("jeffnyman.inform-ecosystem-vscode")
      ?.activate();
  });

  afterEach(() => sinon.restore());

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it("makes a folder name from a title", () => {
    assert.strictEqual(projectFolderName("a/b\\c: d?"), "abc d");
    assert.strictEqual(projectFolderName("  Trailing. . "), "Trailing");
    assert.strictEqual(projectFolderName('"?*"'), "");
  });

  it("writes the bibliographic sentence", () => {
    assert.strictEqual(
      newStorySource('The "Key"', "Jane Doe"),
      `"The 'Key'" by Jane Doe\n\nThe Starting Room is a room.\n`,
    );
    assert.strictEqual(
      newStorySource("Untitled", "  "),
      `"Untitled"\n\nThe Starting Room is a room.\n`,
    );
  });

  function answer(title: string, author: string) {
    const input = sinon.stub(vscode.window, "showInputBox");
    input.onFirstCall().resolves(title);
    input.onSecondCall().resolves(author);
    sinon
      .stub(vscode.window, "showOpenDialog")
      .resolves([vscode.Uri.file(parent)]);
    sinon.stub(vscode.window, "showInformationMessage").resolves(undefined);
    return input;
  }

  it("creates the project and opens its story", async () => {
    answer("The Lost Key: Part 1?", "Jane Doe");
    await vscode.commands.executeCommand("informEcosystem.newProject");

    const dir = path.join(parent, "The Lost Key Part 1.inform");
    const story = path.join(dir, "Source", "story.ni");
    assert.strictEqual(
      fs.readFileSync(story, "utf8"),
      `"The Lost Key: Part 1?" by Jane Doe\n\nThe Starting Room is a room.\n`,
    );
    assert.match(
      fs.readFileSync(path.join(dir, "uuid.txt"), "utf8"),
      /^[0-9a-f-]{36}\n$/,
    );
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase(),
      story.toLowerCase(),
    );
  });

  it("remembers the author and refuses an existing project", async () => {
    const input = answer("The Lost Key: Part 1?", "Jane Doe");
    const error = sinon.stub(vscode.window, "showErrorMessage");
    await vscode.commands.executeCommand("informEcosystem.newProject");

    assert.strictEqual(input.secondCall.args[0]?.value, "Jane Doe");
    assert.ok(
      error.calledOnce &&
        /already exists/.test(String(error.firstCall.args[0])),
      "Expected an 'already exists' error",
    );
  });

  it("does nothing when the title is cancelled", async () => {
    answer(undefined as unknown as string, "Jane Doe");
    const existing = fs.readdirSync(parent);
    await vscode.commands.executeCommand("informEcosystem.newProject");
    assert.deepStrictEqual(fs.readdirSync(parent), existing);
  });
});

import * as vscode from "vscode";
import * as assert from "assert";
import { describe, it, after, before } from "mocha";
import * as sinon from "sinon";

describe("Extension Tests", function () {
  let showInfoMessageStub: sinon.SinonStub;

  before(async function () {
    showInfoMessageStub = sinon.stub(vscode.window, "showInformationMessage");

    await vscode.extensions
      .getExtension("jeffnyman.inform-ecosystem-vscode")
      ?.activate();
  });

  after(() => {
    vscode.window.showInformationMessage("Extension Tests Completed");
    showInfoMessageStub.restore();
  });

  it("should execute the 'informEcosystem.verify' command and show a message", async () => {
    await vscode.commands.executeCommand("informEcosystem.verify");

    assert.ok(
      showInfoMessageStub.calledWith("Inform Ecosystem Active."),
      "Expected showInformationMessage to be called with 'Inform Ecosystem Active.'",
    );
  });
});

import * as vscode from "vscode";
import * as assert from "assert";
import { describe, it, after } from "mocha";

describe("Tautology Tests", () => {
  after(() => {
    vscode.window.showInformationMessage("Tautology Tests Completed");
  });

  it("handles strict equality checks", () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});

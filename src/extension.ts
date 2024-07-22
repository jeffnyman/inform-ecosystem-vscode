import * as vscode from "vscode";

import { I7Folding } from "./i7-folding";

export function activate(context: vscode.ExtensionContext) {
  console.log("Inform Ecosystem Extension enabled.");

  let disposable = vscode.commands.registerCommand("infeco.verify", () => {
    vscode.window.showInformationMessage("Inform Ecosystem Active.");
  });

  context.subscriptions.push(disposable);

  const i7Folding = new I7Folding();
  context.subscriptions.push(i7Folding);
}

export function deactivate() {}

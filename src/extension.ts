import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("Inform Ecosystem Extension enabled.");

  let disposable = vscode.commands.registerCommand("infeco.testing", () => {
    vscode.window.showInformationMessage("Inform Ecosystem Active.");
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}

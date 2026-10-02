import * as vscode from "vscode";

import { registerOutline } from "./common/symbols";
import { registerCompileCommands } from "./compile/commands";
import { StoryPlayerProvider } from "./player/editor";
import { Inform7FoldingProvider } from "./inform7/folding";
import { outlineInform7 } from "./inform7/outline";
import { outlineInform6 } from "./inform6/outline";

export function activate(context: vscode.ExtensionContext) {
  console.log("Inform Ecosystem extension enabled.");

  context.subscriptions.push(
    vscode.commands.registerCommand("informEcosystem.verify", () => {
      vscode.window.showInformationMessage("Inform Ecosystem Active.");
    }),
  );

  registerCompileCommands(context);
  context.subscriptions.push(StoryPlayerProvider.register(context));

  context.subscriptions.push(new Inform7FoldingProvider());
  context.subscriptions.push(
    registerOutline(["inform7", "inform7extension"], outlineInform7),
  );
  context.subscriptions.push(
    registerOutline(["inform6", "inform6template"], outlineInform6),
  );
}

export function deactivate() {}

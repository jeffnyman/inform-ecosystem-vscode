import * as vscode from "vscode";

import { registerPageCommands } from "./common/pages";
import { registerOutline } from "./common/symbols";
import { registerCompileCommands } from "./compile/commands";
import { registerDocs } from "./docs/viewer";
import { registerExtensionDocs } from "./extensions/docs";
import { registerExtensions } from "./extensions/manager";
import { registerIndex } from "./index/viewer";
import { registerTesting } from "./testing/controller";
import { StoryPlayerProvider, playerTurns } from "./player/editor";
import { Inform7FoldingProvider } from "./inform7/folding";
import { outlineInform7 } from "./inform7/outline";
import { outlineInform6 } from "./inform6/outline";

/** What the extension offers other code, such as its own tests. */
export interface InformEcosystemApi {
  /** Every turn played in a player tab. */
  playerTurns: typeof playerTurns;
}

export function activate(context: vscode.ExtensionContext): InformEcosystemApi {
  console.log("Inform Ecosystem extension enabled.");

  context.subscriptions.push(
    vscode.commands.registerCommand("informEcosystem.verify", () => {
      vscode.window.showInformationMessage("Inform Ecosystem Active.");
    }),
  );

  registerCompileCommands(context);
  context.subscriptions.push(...registerPageCommands());
  registerDocs(context);
  registerIndex(context);
  registerExtensions(context);
  registerExtensionDocs(context);
  registerTesting(context);
  context.subscriptions.push(StoryPlayerProvider.register(context));

  context.subscriptions.push(new Inform7FoldingProvider());
  context.subscriptions.push(
    registerOutline(["inform7", "inform7extension"], outlineInform7),
  );
  context.subscriptions.push(
    registerOutline(["inform6", "inform6template"], outlineInform6),
  );

  return { playerTurns };
}

export function deactivate() {}

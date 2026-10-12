import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { createProject, projectFolderName } from "./project";

const LAST_AUTHOR = "informEcosystem.lastAuthor";

/** A documentation example to start a project from: its title and source. */
export interface Example {
  title: string;
  source: string;
}

function isExample(value: unknown): value is Example {
  const v = value as Example | undefined;
  return typeof v?.title === "string" && typeof v?.source === "string";
}

/**
 * Create a new Inform 7 project: ask for a title, an author and a parent
 * folder, write Title.inform there, and open its story.ni. The author is
 * remembered for next time.
 *
 * Given an example (from the documentation's "create a new project" links),
 * the title is offered from it and its source becomes the story, which has
 * its own opening line, so no author is asked for.
 */
export async function newProject(
  context: vscode.ExtensionContext,
  given?: unknown,
) {
  const example = isExample(given) ? given : undefined;
  const steps = example ? 2 : 3;
  const title = await vscode.window.showInputBox({
    title: `New Inform 7 Project (1/${steps})`,
    prompt: example ? "Project name for the example" : "Story title",
    placeHolder: "The Example Story",
    value: example?.title.replace(/^Example\s*-\s*/i, "").trim(),
    ignoreFocusOut: true,
    validateInput: (value) =>
      !value.trim()
        ? "Enter a story title."
        : !projectFolderName(value)
          ? "The title needs at least one character usable in a folder name."
          : undefined,
  });
  if (title === undefined) {
    return;
  }

  const author = example
    ? ""
    : await vscode.window.showInputBox({
        title: "New Inform 7 Project (2/3)",
        prompt: "Author (leave empty to omit)",
        value: context.globalState.get<string>(LAST_AUTHOR, ""),
        ignoreFocusOut: true,
      });
  if (author === undefined) {
    return;
  }

  const folders = await vscode.window.showOpenDialog({
    title: `New Inform 7 Project (${steps}/${steps}): where should ${projectFolderName(title)}.inform go?`,
    defaultUri:
      vscode.workspace.workspaceFolders?.[0]?.uri ??
      vscode.Uri.file(os.homedir()),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Create Project Here",
  });
  if (!folders || folders.length === 0) {
    return;
  }
  const parent = folders[0];

  let story: string;
  try {
    story = createProject(parent.fsPath, title, author, example?.source);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not create the project: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  if (!example) {
    await context.globalState.update(LAST_AUTHOR, author.trim());
  }

  const storyUri = vscode.Uri.file(story);
  await vscode.window.showTextDocument(storyUri);

  // Compiling works from the open story.ni alone, but the project is easier
  // to work with as part of the workspace.
  if (!vscode.workspace.getWorkspaceFolder(storyUri)) {
    const open = "Open Folder";
    const answer = await vscode.window.showInformationMessage(
      `Created ${path.basename(path.dirname(path.dirname(story)))} in ${parent.fsPath}.`,
      open,
    );
    if (answer === open) {
      await vscode.commands.executeCommand("vscode.openFolder", parent);
    }
  }
}

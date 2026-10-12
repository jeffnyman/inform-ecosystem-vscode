import * as path from "node:path";
import * as vscode from "vscode";

import { findProjectDir } from "../compile/project";
import { findTests } from "./tests";

/**
 * Turns commands recorded in the player into a test: a "Test <name> with"
 * sentence added to the end of the project's story.ni, which the Testing view
 * then runs like any other.
 */

/**
 * A Test sentence for these commands. Its text cannot hold everything a
 * player can type: a double quote ends it, "/" separates commands, and square
 * brackets are text substitutions. Those are replaced, and reported.
 */
export function testSentence(
  name: string,
  commands: string[],
): { sentence: string; changed: string[] } {
  const changed: string[] = [];
  const clean = commands.map((command) => {
    const c = command
      .replace(/"/g, "'")
      .replace(/\//g, " ")
      .replace(/\[/g, "(")
      .replace(/]/g, ")")
      .replace(/\s+/g, " ")
      .trim();
    if (c !== command.trim()) {
      changed.push(`"${command}" became "${c}"`);
    }
    return c;
  });
  return {
    sentence: `Test ${name} with "${clean.filter(Boolean).join(" / ")}".`,
    changed,
  };
}

/** Ask for a name and add the recorded commands to story.ni as a test. */
export async function saveRecordedTest(story: vscode.Uri, commands: string[]) {
  if (!commands.length) {
    vscode.window.showInformationMessage(
      "Nothing was recorded: no commands were typed.",
    );
    return;
  }
  const projectDir = findProjectDir(story.fsPath);
  if (!projectDir) {
    vscode.window.showWarningMessage(
      "This story is not part of an Inform project, so there is no source to add the test to.",
    );
    return;
  }
  const source = vscode.Uri.file(path.join(projectDir, "Source", "story.ni"));
  const document = await vscode.workspace.openTextDocument(source);
  const taken = new Set(
    findTests(document.getText()).map((t) => t.name.toLowerCase()),
  );
  let suggestion = "recording";
  for (let n = 2; taken.has(suggestion); n++) {
    suggestion = `recording ${n}`;
  }

  const name = await vscode.window.showInputBox({
    title: "Save Recorded Test",
    prompt: `A name for the test of ${commands.length} command${commands.length === 1 ? "" : "s"}; it runs as "test <name>"`,
    value: suggestion,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const v = value.trim();
      if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(v)) {
        return "Use letters, digits and spaces, starting with a letter.";
      }
      if (taken.has(v.toLowerCase())) {
        return `There is already a test called "${v}".`;
      }
      return undefined;
    },
  });
  if (!name) {
    return;
  }

  const { sentence, changed } = testSentence(name.trim(), commands);
  const text = document.getText();
  const end = document.positionAt(text.length);
  const gap = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const edit = new vscode.WorkspaceEdit();
  edit.insert(source, end, `${gap}${sentence}\n`);
  await vscode.workspace.applyEdit(edit);
  await document.save();

  const line = document.lineCount - 2;
  const show = "Show";
  const answer = await vscode.window.showInformationMessage(
    `Added "test ${name.trim()}" to story.ni; it is in the Testing view.` +
      (changed.length
        ? ` Some commands were changed to fit a Test sentence: ${changed.join("; ")}.`
        : ""),
    show,
  );
  if (answer === show) {
    const editor = await vscode.window.showTextDocument(document);
    const range = document.lineAt(Math.max(line, 0)).range;
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range);
  }
}

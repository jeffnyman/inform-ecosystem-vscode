import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import {
  Problem,
  inform6Succeeded,
  inform7Succeeded,
  parseInform6Output,
  parseInform7Output,
} from "./problems";
import {
  Project,
  ensureProjectFiles,
  findProjectDir,
  formatDetails,
  listProjects,
  loadProject,
} from "./project";
import { outputChannel, run } from "./runner";
import { openInPlayer } from "../player/editor";
import { NOT_FOUND_HELP, locateTool, locateToolchain, toolPath } from "./tools";

const diagnostics = vscode.languages.createDiagnosticCollection("inform");

type Format = "glulx" | "z8";

function config() {
  return vscode.workspace.getConfiguration("informEcosystem");
}

// --- Problems -> Diagnostics ----------------------------------------------

function publish(
  problems: Problem[],
  resolveFile: (file?: string) => string | undefined,
) {
  diagnostics.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const p of problems) {
    const file = resolveFile(p.file);
    if (!file) {
      continue;
    }
    const line = Math.max(0, (p.line ?? 1) - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    const d = new vscode.Diagnostic(
      range,
      p.message,
      p.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error,
    );
    d.source = "inform";
    const list = byFile.get(file) ?? [];
    list.push(d);
    byFile.set(file, list);
  }
  for (const [file, list] of byFile) {
    diagnostics.set(vscode.Uri.file(file), list);
  }
}

// --- Finding the project -----------------------------------------------------

async function pickProject(): Promise<Project | undefined> {
  const defaultFormat = config().get<Format>("inform7.defaultFormat", "glulx");
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const fromEditor = active && findProjectDir(active);
  if (fromEditor) {
    return loadProject(fromEditor, defaultFormat);
  }
  const candidates: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const dir = findProjectDir(folder.uri.fsPath);
    if (dir) {
      candidates.push(dir);
    }
    candidates.push(...listProjects(folder.uri.fsPath));
  }
  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    vscode.window.showErrorMessage(
      "No Inform 7 project found. Open a file inside a .inform folder, or a workspace containing one.",
    );
    return undefined;
  }
  if (unique.length === 1) {
    return loadProject(unique[0], defaultFormat);
  }
  const choice = await vscode.window.showQuickPick(
    unique.map((dir) => ({ label: path.basename(dir), description: dir })),
    { placeHolder: "Which Inform 7 project?" },
  );
  return choice ? loadProject(choice.description!, defaultFormat) : undefined;
}

// --- Inform 7 ----------------------------------------------------------------

async function compileProject(release: boolean) {
  const toolchain = locateToolchain();
  if (!toolchain) {
    const open = "Open Settings";
    if ((await vscode.window.showErrorMessage(NOT_FOUND_HELP, open)) === open) {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "informEcosystem.compilersPath",
      );
    }
    return;
  }
  const project = await pickProject();
  if (!project) {
    return;
  }
  await vscode.workspace.saveAll();
  ensureProjectFiles(project);

  const out = outputChannel();
  out.show(true);
  out.appendLine(
    `== ${release ? "Release" : "Compile"} ${project.name} (${project.settings.format}) using ${toolchain.origin}`,
  );
  const fmt = formatDetails(project.settings.format, release);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Inform: ${release ? "releasing" : "compiling"} ${project.name}`,
      cancellable: true,
    },
    async (progress, token) => {
      // 1. inform7
      progress.report({ message: "inform7" });
      const i7args = ["-internal", toolchain.internalDir];
      if (toolchain.externalDir) {
        i7args.push("-external", toolchain.externalDir);
      }
      i7args.push("-project", project.dir, `-format=${fmt.inform7Format}`);
      if (release) {
        i7args.push("-release");
      }
      if (project.settings.nobbleRng) {
        i7args.push("-rng");
      }
      const i7 = await run(
        toolPath(toolchain, "inform7"),
        i7args,
        project.dir,
        token,
      );
      const html = readIfExists(path.join(project.buildDir, "Problems.html"));
      const i7problems = parseInform7Output(i7.output, html);
      publish(i7problems, (file) =>
        resolveInform7File(project, toolchain.externalDir, file),
      );
      if (!inform7Succeeded(i7.output)) {
        vscode.window.showErrorMessage(
          `Inform 7: translation failed (${i7problems.length} problem${i7problems.length === 1 ? "" : "s"}). See the Problems panel.`,
        );
        return;
      }

      // 2. inform6
      progress.report({ message: "inform6" });
      const story = `output.${fmt.storyExtension}`;
      const i6 = await run(
        toolPath(toolchain, "inform6"),
        [fmt.inform6Switches, "+include_path=../Source,./", "auto.inf", story],
        project.buildDir,
        token,
      );
      const i6problems = parseInform6Output(i6.output);
      publish(i6problems, (file) =>
        file ? path.resolve(project.buildDir, file) : undefined,
      );
      if (!inform6Succeeded(i6.output, i6.code)) {
        vscode.window.showErrorMessage(
          "Inform 6 failed; see the Inform output channel.",
        );
        return;
      }
      let result = path.join(project.buildDir, story);

      // 3. inblorb, for a release with a Blorb
      const blurb = path.join(project.dir, "Release.blurb");
      if (release && project.settings.createBlorb && fs.existsSync(blurb)) {
        progress.report({ message: "inblorb" });
        const blorb = `output.${fmt.blorbExtension}`;
        const ib = await run(
          toolPath(toolchain, "inblorb"),
          ["Release.blurb", path.join("Build", blorb)],
          project.dir,
          token,
        );
        if (ib.code === 0) {
          result = path.join(project.buildDir, blorb);
        }
      }

      out.appendLine(`== Done: ${result}`);
      afterCompile(result);
    },
  );
}

function resolveInform7File(
  project: Project,
  externalDir: string | undefined,
  file?: string,
): string | undefined {
  if (!file) {
    return project.source;
  }
  if (file === "story.ni") {
    return project.source;
  }
  // Problems.html links name extension files by leafname; look in the
  // project's own materials and the external Extensions folder.
  const roots = [
    path.join(project.dir + ".materials", "Extensions"),
    path.join(
      path.dirname(project.dir),
      `${project.name}.materials`,
      "Extensions",
    ),
    externalDir && path.join(externalDir, "Extensions"),
  ].filter((r): r is string => !!r);
  for (const root of roots) {
    const hit = findFile(root, file, 2);
    if (hit) {
      return hit;
    }
  }
  return project.source;
}

function findFile(
  root: string,
  leaf: string,
  depth: number,
): string | undefined {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const full = path.join(root, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === leaf.toLowerCase()) {
        return full;
      }
      if (entry.isDirectory() && depth > 0) {
        const hit = findFile(full, leaf, depth - 1);
        if (hit) {
          return hit;
        }
      }
    }
  } catch {
    // unreadable or missing folder: not an error here
  }
  return undefined;
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function afterCompile(storyFile: string) {
  const mode = config().get<string>("openStoryAfterCompile", "no");
  if (mode === "external") {
    vscode.env.openExternal(vscode.Uri.file(storyFile));
  } else if (mode === "editor") {
    void openInPlayer(vscode.Uri.file(storyFile));
  }
}

// --- Inform 6 stand-alone ----------------------------------------------------

async function compileInform6File(release: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.(inf|i6)$/i.test(editor.document.fileName)) {
    vscode.window.showErrorMessage(
      "Open an Inform 6 source file (.inf or .i6) first.",
    );
    return;
  }
  const inform6 = locateTool("inform6");
  if (!inform6) {
    vscode.window.showErrorMessage(NOT_FOUND_HELP);
    return;
  }
  await editor.document.save();
  const source = editor.document.fileName;
  const cwd = path.dirname(source);
  const target = config().get<string>("inform6.target", "glulx");
  const vm = target === "glulx" ? "G" : target === "z5" ? "v5" : "v8";
  const ext = target === "glulx" ? "ulx" : target;
  const switches = "-E1w" + (release ? "~S~D" : "SD") + vm;
  const args = [switches];
  const include = config().get<string>("inform6.includePath", "").trim();
  if (include) {
    args.push(`+include_path=${include}`);
  }
  args.push(...config().get<string[]>("inform6.extraArguments", []));
  const output = path.basename(source).replace(/\.[^.]+$/, "") + "." + ext;
  args.push(path.basename(source), output);

  const out = outputChannel();
  out.show(true);
  out.appendLine(`== Inform 6 ${release ? "release" : "compile"}: ${source}`);
  const result = await run(inform6, args, cwd);
  const problems = parseInform6Output(result.output);
  publish(problems, (file) => (file ? path.resolve(cwd, file) : source));
  if (inform6Succeeded(result.output, result.code)) {
    const story = path.join(cwd, output);
    out.appendLine(`== Done: ${story}`);
    afterCompile(story);
  } else {
    vscode.window.showErrorMessage(
      `Inform 6: ${problems.length} problem${problems.length === 1 ? "" : "s"}. See the Problems panel.`,
    );
  }
}

// --- Misc --------------------------------------------------------------------

function showToolchain() {
  const out = outputChannel();
  out.show(true);
  const t = locateToolchain();
  if (!t) {
    out.appendLine(NOT_FOUND_HELP);
    return;
  }
  out.appendLine(`Compilers: ${t.compilersDir}  (${t.origin})`);
  out.appendLine(`Internal:  ${t.internalDir}`);
  out.appendLine(`External:  ${t.externalDir ?? "(none)"}`);
  for (const name of [
    "inform7",
    "inform6",
    "inblorb",
    "intest",
    "frotz",
    "glulxe",
  ]) {
    const p = toolPath(t, name);
    out.appendLine(
      `  ${name.padEnd(8)} ${fs.existsSync(p) ? "ok" : "missing"}  ${p}`,
    );
  }
}

async function playStory() {
  const project = await pickProject();
  if (!project) {
    return;
  }
  const candidates = [
    "output.gblorb",
    "output.zblorb",
    "output.ulx",
    "output.z8",
  ]
    .map((f) => path.join(project.buildDir, f))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (candidates.length === 0) {
    vscode.window.showErrorMessage(
      `No compiled story in ${project.buildDir}. Compile first.`,
    );
    return;
  }
  await openInPlayer(vscode.Uri.file(candidates[0]));
}

async function playStoryExternally() {
  const project = await pickProject();
  if (!project) {
    return;
  }
  const story = newestStory(project.buildDir);
  if (!story) {
    vscode.window.showErrorMessage(
      `No compiled story in ${project.buildDir}. Compile first.`,
    );
    return;
  }
  vscode.env.openExternal(vscode.Uri.file(story));
}

function newestStory(buildDir: string): string | undefined {
  return ["output.gblorb", "output.zblorb", "output.ulx", "output.z8"]
    .map((f) => path.join(buildDir, f))
    .filter((f) => fs.existsSync(f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

export function registerCompileCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    diagnostics,
    vscode.commands.registerCommand("informEcosystem.compile", () =>
      compileProject(false),
    ),
    vscode.commands.registerCommand("informEcosystem.release", () =>
      compileProject(true),
    ),
    vscode.commands.registerCommand("informEcosystem.compileInform6", () =>
      compileInform6File(false),
    ),
    vscode.commands.registerCommand("informEcosystem.releaseInform6", () =>
      compileInform6File(true),
    ),
    vscode.commands.registerCommand("informEcosystem.play", playStory),
    vscode.commands.registerCommand(
      "informEcosystem.playExternal",
      playStoryExternally,
    ),
    vscode.commands.registerCommand(
      "informEcosystem.showToolchain",
      showToolchain,
    ),
  );
}

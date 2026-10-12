import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { buildStory, offerToLocateCompilers } from "../compile/commands";
import { findProjectDir, listProjects, loadProject } from "../compile/project";
import { locateToolchain } from "../compile/tools";
import { runStory } from "./engine";

/**
 * Runs a project's Inform tests from VS Code's Testing view.
 *
 * Each "Test me with ..." sentence in a project's story.ni is a test. To run
 * them, the project is compiled as a test build (debug, with predictable
 * random outcomes) into Build/tests.ulx or tests.z8, leaving the playable
 * story alone; the story is then run with no window and sent "test me", so
 * Inform plays the script itself, exactly as in the IDE. What it prints is
 * compared with the expected output kept in Story.materials/Tests/me.txt.
 *
 * A test's first run records its expected output. Later, any difference
 * fails the test, with a side-by-side comparison; "Accept Test Output"
 * makes the latest output the expected output when the change is intended.
 */
export const CONTROLLER_ID = "informEcosystem.tests";

const TEST_SENTENCE = /^[ \t]*Test[ \t]+(.+?)[ \t]+with[ \t]+"/gim;

/** The story engines, in the extension's engines folder; set on activation. */
let enginesDir = "";

/** The latest output of each test, for Accept Test Output. */
const lastOutput = new Map<string, string>();

function config() {
  return vscode.workspace.getConfiguration("informEcosystem");
}

/** The tests a source text defines: their names, and the line of each. */
export function findTests(source: string): { name: string; line: number }[] {
  const tests: { name: string; line: number }[] = [];
  for (const m of source.matchAll(TEST_SENTENCE)) {
    const line = source.slice(0, m.index).split("\n").length - 1;
    tests.push({ name: m[1].trim(), line });
  }
  return tests;
}

function expectedFile(projectDir: string, test: string): string {
  const safe = test.replace(/[^\w -]/g, "_");
  return path.join(
    projectDir.replace(/\.inform$/i, ".materials"),
    "Tests",
    `${safe}.txt`,
  );
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Projects in the workspace: a folder that is one, or holds some. */
function workspaceProjects(): string[] {
  const found = new Set<string>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const own = findProjectDir(folder.uri.fsPath);
    if (own) {
      found.add(own);
    }
    listProjects(folder.uri.fsPath).forEach((p) => found.add(p));
  }
  return [...found];
}

/** Bring a project's item and its tests up to date with its story.ni. */
function refreshProject(controller: vscode.TestController, projectDir: string) {
  const source = path.join(projectDir, "Source", "story.ni");
  const id = projectDir;
  let text: string;
  try {
    text = fs.readFileSync(source, "utf8");
  } catch {
    controller.items.delete(id);
    return;
  }
  const uri = vscode.Uri.file(source);
  let item = controller.items.get(id);
  if (!item) {
    item = controller.createTestItem(
      id,
      path.basename(projectDir).replace(/\.inform$/i, ""),
      uri,
    );
    controller.items.add(item);
  }
  const children = findTests(text).map(({ name, line }) => {
    const child = controller.createTestItem(`${id}::${name}`, name, uri);
    child.range = new vscode.Range(line, 0, line, 0);
    child.description = `test ${name}`;
    return child;
  });
  item.children.replace(children);
}

export interface TestResult {
  /** "recorded": a first run, whose output is now the expected output. */
  outcome: "passed" | "failed" | "recorded";
  actual: string;
  expected?: string;
  /** The expected-output file. */
  file: string;
}

/**
 * Run one test against a test build of its project: send "test <name>" and
 * compare what the story prints with the expected output, recording it as
 * the expected output if there is none yet.
 */
export async function checkTest(
  enginesDir: string,
  projectDir: string,
  story: string,
  name: string,
): Promise<TestResult> {
  const turns = await runStory(enginesDir, story, [`test ${name}`]);
  // turns[0] is the story's opening, up to the first prompt.
  const actual = normalize(turns[1] ?? "");
  const file = expectedFile(projectDir, name);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, actual);
    return { outcome: "recorded", actual, file };
  }
  const expected = normalize(fs.readFileSync(file, "utf8"));
  return {
    outcome: expected === actual ? "passed" : "failed",
    actual,
    expected,
    file,
  };
}

async function runTests(
  controller: vscode.TestController,
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
  const run = controller.createTestRun(request);
  // The tests asked for, grouped by project.
  const byProject = new Map<string, vscode.TestItem[]>();
  const add = (item: vscode.TestItem) => {
    if (request.exclude?.includes(item)) {
      return;
    }
    if (item.children.size) {
      item.children.forEach(add);
      return;
    }
    const projectDir = item.id.split("::")[0];
    if (item.id.includes("::")) {
      byProject.set(projectDir, [...(byProject.get(projectDir) ?? []), item]);
    }
  };
  if (request.include) {
    request.include.forEach(add);
  } else {
    controller.items.forEach(add);
  }
  for (const tests of byProject.values()) {
    tests.forEach((t) => run.enqueued(t));
  }

  try {
    const toolchain = locateToolchain();
    if (!toolchain) {
      for (const tests of byProject.values()) {
        tests.forEach((t) =>
          run.errored(
            t,
            new vscode.TestMessage("No Inform compilers were found."),
          ),
        );
      }
      void offerToLocateCompilers();
      return;
    }
    await vscode.workspace.saveAll();

    for (const [projectDir, tests] of byProject) {
      if (token.isCancellationRequested) {
        break;
      }
      const project = loadProject(
        projectDir,
        config().get<"glulx" | "z8">("inform7.defaultFormat", "glulx"),
      );
      run.appendOutput(`Compiling ${project.name} for testing...\r\n`);
      const story = await buildStory(project, toolchain, {
        release: false,
        rng: true,
        output: "tests",
        token,
      });
      if (!story) {
        tests.forEach((t) =>
          run.errored(
            t,
            new vscode.TestMessage(
              "The project did not compile; see the Problems panel.",
            ),
          ),
        );
        continue;
      }

      for (const test of tests) {
        if (token.isCancellationRequested) {
          run.skipped(test);
          continue;
        }
        run.started(test);
        const started = Date.now();
        const name = test.label;
        try {
          const result = await checkTest(enginesDir, projectDir, story, name);
          lastOutput.set(test.id, result.actual);
          run.appendOutput(
            `\r\n== ${project.name}: test ${name}\r\n${result.actual.replace(/\n/g, "\r\n")}\r\n`,
            undefined,
            test,
          );
          if (result.outcome === "recorded") {
            run.appendOutput(
              `(First run: recorded this as the expected output, in ${result.file}.)\r\n`,
              undefined,
              test,
            );
            run.passed(test, Date.now() - started);
          } else if (result.outcome === "passed") {
            run.passed(test, Date.now() - started);
          } else {
            const message = vscode.TestMessage.diff(
              `The output of "test ${name}" differs from the expected output. If the change is intended, use Accept Test Output.`,
              result.expected ?? "",
              result.actual,
            );
            message.location =
              test.uri &&
              test.range &&
              new vscode.Location(test.uri, test.range);
            run.failed(test, message, Date.now() - started);
          }
        } catch (err) {
          run.errored(
            test,
            new vscode.TestMessage(
              err instanceof Error ? err.message : String(err),
            ),
            Date.now() - started,
          );
        }
      }
    }
  } finally {
    run.end();
  }
}

/** Make a test's latest output its expected output; for a project, all of its tests'. */
function acceptOutput(item?: vscode.TestItem) {
  if (!item) {
    vscode.window.showInformationMessage(
      "Use Accept Test Output on a test in the Testing view.",
    );
    return;
  }
  const tests: vscode.TestItem[] = [];
  if (item.children.size) {
    item.children.forEach((c) => tests.push(c));
  } else {
    tests.push(item);
  }
  let accepted = 0;
  for (const test of tests) {
    const output = lastOutput.get(test.id);
    if (output === undefined) {
      continue;
    }
    const file = expectedFile(test.id.split("::")[0], test.label);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, output);
    accepted++;
  }
  vscode.window.showInformationMessage(
    accepted
      ? `Accepted the latest output of ${accepted === 1 ? `"test ${tests[0].label}"` : `${accepted} tests`} as expected.`
      : "Run the test first; there is no output to accept yet.",
  );
}

export function registerTesting(context: vscode.ExtensionContext) {
  enginesDir = path.join(context.extensionUri.fsPath, "engines");
  const controller = vscode.tests.createTestController(CONTROLLER_ID, "Inform");
  const refreshAll = () => {
    const projects = workspaceProjects();
    controller.items.forEach((item) => {
      if (!projects.includes(item.id)) {
        controller.items.delete(item.id);
      }
    });
    projects.forEach((p) => refreshProject(controller, p));
  };
  controller.resolveHandler = async () => refreshAll();
  controller.refreshHandler = async () => refreshAll();
  controller.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    (request, token) => runTests(controller, request, token),
    true,
  );

  // Keep the tests in step with the source as it is edited and saved.
  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/*.inform/Source/story.ni",
  );
  const onSource = (uri: vscode.Uri) => {
    const projectDir = findProjectDir(uri.fsPath);
    if (projectDir) {
      refreshProject(controller, projectDir);
    }
  };
  watcher.onDidChange(onSource);
  watcher.onDidCreate(onSource);
  watcher.onDidDelete(onSource);

  context.subscriptions.push(
    controller,
    watcher,
    vscode.workspace.onDidChangeWorkspaceFolders(refreshAll),
    vscode.commands.registerCommand(
      "informEcosystem.acceptTestOutput",
      acceptOutput,
    ),
  );
}

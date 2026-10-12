import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, after, afterEach, before } from "mocha";
import * as sinon from "sinon";

import { buildStory } from "../compile/commands";
import { loadProject } from "../compile/project";
import { locateToolchain } from "../compile/tools";
import type { InformEcosystemApi } from "../extension";
import { PLAYER_VIEW_TYPE } from "../player/editor";
import { checkTest, findTests } from "../testing/controller";
import { saveRecordedTest, testSentence } from "../testing/recording";

describe("Testing", function () {
  this.timeout(120000);
  let parent: string;
  let engines: string;

  before(async function () {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "inform-testing-"));
    const extension = vscode.extensions.getExtension(
      "jeffnyman.inform-ecosystem-vscode",
    )!;
    await extension.activate();
    engines = path.join(extension.extensionPath, "engines");
  });

  after(() => {
    fs.rmSync(parent, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  });

  it("finds the test scripts in a source text", () => {
    assert.deepStrictEqual(
      findTests(
        '"S"\n\nThe Hall is a room.\n\nTest me with "look / jump".\n' +
          '\tTest lamp with "take lamp" holding the lamp.\nTest is a thing.\n',
      ),
      [
        { name: "me", line: 4 },
        { name: "lamp", line: 5 },
      ],
    );
  });

  it("writes recorded commands as a Test sentence", () => {
    assert.deepStrictEqual(testSentence("lamp", ["take lamp", " look "]), {
      sentence: 'Test lamp with "take lamp / look".',
      changed: [],
    });
    const awkward = testSentence("odd", ['say "hi"', "a/b", "[x]"]);
    assert.strictEqual(
      awkward.sentence,
      `Test odd with "say 'hi' / a b / (x)".`,
    );
    assert.strictEqual(awkward.changed.length, 3);
  });

  it("hears the player's turns from Parchment's transcript recorder", async function () {
    const toolchain = locateToolchain();
    if (!toolchain) {
      this.skip();
    }
    const dir = path.join(parent, "Played.inform");
    fs.mkdirSync(path.join(dir, "Source"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "Source", "story.ni"),
      '"Played"\n\nThe Gallery is a room. "Paintings line the walls."\n',
    );
    const story = await buildStory(loadProject(dir, "glulx"), toolchain!, {
      release: false,
      rng: false,
      output: "output",
    });
    assert.ok(story, "The fixture compiles");

    const api = vscode.extensions.getExtension<InformEcosystemApi>(
      "jeffnyman.inform-ecosystem-vscode",
    )!.exports;
    const opening = new Promise<{ input: string; output: string }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("No turn was heard from the player.")),
          30000,
        );
        const listener = api.playerTurns((turn) => {
          if (turn.story.fsPath.toLowerCase() === story!.toLowerCase()) {
            clearTimeout(timer);
            listener.dispose();
            resolve(turn);
          }
        });
      },
    );
    await vscode.commands.executeCommand(
      "vscode.openWith",
      vscode.Uri.file(story!),
      PLAYER_VIEW_TYPE,
    );
    const turn = await opening;
    assert.strictEqual(turn.input, "");
    assert.match(turn.output, /Gallery\nPaintings line the walls\./);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  afterEach(() => sinon.restore());

  it("saves a recording as a test in the project's source", async () => {
    const dir = path.join(parent, "Recorded.inform");
    fs.mkdirSync(path.join(dir, "Source"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Build"), { recursive: true });
    const source = path.join(dir, "Source", "story.ni");
    fs.writeFileSync(
      source,
      '"Recorded"\n\nThe Hall is a room.\n\nTest recording with "look".\n',
    );
    const input = sinon.stub(vscode.window, "showInputBox");
    input.callsFake(async (options) => options?.value);
    sinon.stub(vscode.window, "showInformationMessage").resolves(undefined);

    await saveRecordedTest(
      vscode.Uri.file(path.join(dir, "Build", "output.ulx")),
      ["take lamp", "inventory"],
    );

    // The name offered avoids the one already taken.
    assert.strictEqual(input.firstCall.args[0]?.value, "recording 2");
    const text = fs.readFileSync(source, "utf8");
    assert.ok(
      text.endsWith('\nTest recording 2 with "take lamp / inventory".\n'),
      text,
    );
    assert.deepStrictEqual(
      findTests(text).map((t) => t.name),
      ["recording", "recording 2"],
    );
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  for (const format of ["glulx", "z8"] as const) {
    it(`records, passes and fails a test against a ${format} test build`, async function () {
      const toolchain = locateToolchain();
      if (!toolchain) {
        this.skip();
      }
      const dir = path.join(parent, `Fixture ${format}.inform`);
      fs.mkdirSync(path.join(dir, "Source"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "Source", "story.ni"),
        '"Fixture"\n\nThe Hall is a room. "A plain hall."\n\nTest me with "look / jump".\n',
      );
      const project = loadProject(dir, format);
      const story = await buildStory(project, toolchain!, {
        release: false,
        rng: true,
        output: "tests",
      });
      assert.ok(story, "The fixture compiles");
      assert.strictEqual(
        path.basename(story!),
        `tests.${format === "glulx" ? "ulx" : "z8"}`,
      );

      const first = await checkTest(engines, dir, story!, "me");
      assert.strictEqual(first.outcome, "recorded");
      assert.match(first.actual, />\[1\] look\nHall\nA plain hall\./);
      assert.match(first.actual, />\[2\] jump\n/);
      assert.strictEqual(
        first.file,
        path.join(parent, `Fixture ${format}.materials`, "Tests", "me.txt"),
      );

      const second = await checkTest(engines, dir, story!, "me");
      assert.strictEqual(second.outcome, "passed");

      fs.writeFileSync(first.file, "something else");
      const third = await checkTest(engines, dir, story!, "me");
      assert.strictEqual(third.outcome, "failed");
      assert.strictEqual(third.expected, "something else");
      assert.strictEqual(third.actual, first.actual);
    });
  }
});

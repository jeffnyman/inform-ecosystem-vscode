import * as vscode from "vscode";
import * as assert from "assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, after, before } from "mocha";

import { buildStory } from "../compile/commands";
import { loadProject } from "../compile/project";
import { locateToolchain } from "../compile/tools";
import { checkTest, findTests } from "../testing/controller";

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

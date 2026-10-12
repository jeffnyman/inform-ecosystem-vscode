import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Runs a story file with no window: the Glulxe or Bocfel interpreter, as
 * WebAssembly from emglken (see scripts/copy-engines.mjs), driven by a GlkOte
 * of our own that types the given commands and keeps the text of each turn.
 *
 * The GlkOte contract, as far as an interpreter uses it: init(options) hands
 * over options.accept, to which events go (the first being "init"); the
 * interpreter calls update(data) with the windows, their new content, and
 * the input it now wants. Text is taken from buffer windows only, the way
 * Parchment's transcript recorder takes it, so a status line does not count.
 */

/** What the interpreter is told about its screen; tests do not depend on it. */
const METRICS = {
  width: 800,
  height: 600,
  charwidth: 8,
  charheight: 16,
  outspacingx: 0,
  outspacingy: 0,
  inspacingx: 0,
  inspacingy: 0,
  gridcharwidth: 8,
  gridcharheight: 16,
  gridmarginx: 0,
  gridmarginy: 0,
  buffercharwidth: 8,
  buffercharheight: 16,
  buffermarginx: 0,
  buffermarginy: 0,
  graphicsmarginx: 0,
  graphicsmarginy: 0,
};

interface Update {
  type: string;
  gen?: number;
  message?: string;
  windows?: { id: number; type: string }[];
  content?: {
    id: number;
    text?: { append?: boolean; content?: unknown[] }[];
  }[];
  input?: { id: number; type: string }[];
  disable?: boolean;
}

type Accept = (event: Record<string, unknown>) => void;

class TestGlkOte {
  readonly classname = "GlkOte";
  readonly version = "inform-ecosystem-test";
  private accept: Accept = () => {};
  private Dialog: unknown;
  private windows = new Map<number, string>();
  private text = "";
  readonly turns: string[] = [];
  private finish!: (error?: Error) => void;
  readonly finished = new Promise<void>((resolve, reject) => {
    this.finish = (error) => (error ? reject(error) : resolve());
  });

  constructor(private readonly commands: string[]) {}

  async init(options: { accept: Accept; Dialog?: unknown }) {
    this.accept = options.accept;
    this.Dialog = options.Dialog;
    this.accept({
      type: "init",
      gen: 0,
      metrics: METRICS,
      support: ["timer", "hyperlinks"],
    });
  }

  update(data: Update) {
    if (data.type === "error") {
      this.finish(new Error(data.message ?? "The interpreter failed."));
      return;
    }
    if (data.type !== "update") {
      return;
    }
    for (const w of data.windows ?? []) {
      this.windows.set(w.id, w.type);
    }
    for (const c of data.content ?? []) {
      if (this.windows.get(c.id) !== "buffer") {
        continue;
      }
      for (const para of c.text ?? []) {
        if (!para.append) {
          this.text += "\n";
        }
        // Runs come as [style, text] pairs, or objects with a text.
        const runs = para.content ?? [];
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i];
          if (typeof run === "string") {
            this.text += String(runs[++i] ?? "");
          } else if (run && typeof run === "object" && "text" in run) {
            this.text += String((run as { text: unknown }).text);
          }
        }
      }
    }
    const wants = (data.input ?? []).find(
      (i) => i.type === "line" || i.type === "char",
    );
    if (!wants) {
      if (!(data.input ?? []).length) {
        // Nothing more is wanted: the story has ended.
        this.turns.push(this.text);
        this.text = "";
        this.finish();
      }
      return;
    }
    this.turns.push(this.text);
    this.text = "";
    const command = this.commands.shift();
    if (command === undefined) {
      this.finish();
      return;
    }
    setImmediate(() =>
      this.accept(
        wants.type === "line"
          ? { type: "line", gen: data.gen, window: wants.id, value: command }
          : {
              type: "char",
              gen: data.gen,
              window: wants.id,
              value: command[0] ?? " ",
            },
      ),
    );
  }

  getlibrary(name: string) {
    return name === "Dialog" ? this.Dialog : null;
  }
  getinterface() {
    return {};
  }
  inited() {
    return true;
  }
  log() {}
  warning() {}
  error(error: unknown) {
    this.finish(error instanceof Error ? error : new Error(String(error)));
  }
  extevent() {}
  save_allstate() {
    return {};
  }
}

// The interpreter speaks in POSIX paths: /C:/... on Windows.
function toPosix(native: string): string {
  if (process.platform !== "win32") {
    return native;
  }
  const p = native.replaceAll(path.sep, path.posix.sep);
  return /^\w:/.test(p) ? `/${p}` : p;
}

function toNative(posix: string): string {
  if (process.platform !== "win32") {
    return posix;
  }
  const p = posix.replaceAll(path.posix.sep, path.sep);
  return p.startsWith("\\") ? p.slice(1) : p;
}

/**
 * File access for the interpreter: the story file, and any files the story
 * writes (transcripts, data files), kept in a scratch folder. A story that
 * asks the player to pick a file is told there is none.
 */
class TestDialog {
  readonly async = true;
  constructor(private readonly scratch: string) {}
  async init() {}
  async delete(file: string) {
    fs.rmSync(toNative(file), { force: true });
  }
  async exists(file: string) {
    return fs.existsSync(toNative(file));
  }
  get_dirs() {
    const dir = toPosix(this.scratch);
    return {
      storyfile: dir,
      system_cwd: dir,
      temp: toPosix(os.tmpdir()),
      working: dir,
    };
  }
  async prompt() {
    return null;
  }
  async read(file: string) {
    try {
      return fs.readFileSync(toNative(file));
    } catch {
      return null;
    }
  }
  set_storyfile_dir(dir: string) {
    return { storyfile: dir, working: toPosix(this.scratch) };
  }
  async write(files: Record<string, Uint8Array>) {
    for (const [file, data] of Object.entries(files)) {
      fs.writeFileSync(toNative(file), data);
    }
  }
}

type Engine = (options?: object) => Promise<{ start(options: object): void }>;

/**
 * Run a story, typing each command in turn when it asks for input, and
 * resolve with the text of each turn: the first is everything before the
 * first prompt, then one per command, each including the echo of the
 * command and the next prompt.
 */
export async function runStory(
  enginesDir: string,
  storyFile: string,
  commands: string[],
  timeoutMs = 30000,
): Promise<string[]> {
  const engineFile = /\.(ulx|gblorb|glb)$/i.test(storyFile)
    ? "glulxe.js"
    : "bocfel-noz6.js";
  // A dynamic import, kept as one in the bundle: the engines are ES modules
  // that find their .wasm beside themselves.
  const engine = (
    (await import(pathToFileURL(path.join(enginesDir, engineFile)).href)) as {
      default: Engine;
    }
  ).default;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "inform-test-"));
  try {
    const glkote = new TestGlkOte([...commands]);
    const dialog = new TestDialog(scratch);
    const vm = await engine();
    vm.start({
      arguments: [toPosix(storyFile)],
      Dialog: dialog,
      GlkOte: glkote,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      glkote.finished,
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `The story did not finish within ${timeoutMs / 1000} seconds.`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return glkote.turns;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

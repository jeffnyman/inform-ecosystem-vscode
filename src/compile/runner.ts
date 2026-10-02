import { spawn } from "node:child_process";
import * as vscode from "vscode";

export interface RunResult {
  code: number;
  output: string;
}

let channel: vscode.OutputChannel | undefined;

export function outputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Inform");
  }
  return channel;
}

/** Quote an argument for display only; the process receives it unquoted. */
function show(arg: string): string {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

/**
 * Run a tool, echoing its command line and streaming its combined output to
 * the Inform output channel, and resolve with the exit code and the full text
 * for parsing.
 */
export function run(
  exe: string,
  args: string[],
  cwd: string,
  token?: vscode.CancellationToken,
): Promise<RunResult> {
  const out = outputChannel();
  out.appendLine(`$ ${show(exe)} ${args.map(show).join(" ")}`);
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const child = spawn(exe, args, { cwd, windowsHide: true });
    const onData = (data: Buffer) => {
      const text = data.toString("utf8");
      chunks.push(text);
      out.append(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => {
      out.appendLine("");
      resolve({ code: code ?? -1, output: chunks.join("") });
    });
    token?.onCancellationRequested(() => child.kill());
  });
}

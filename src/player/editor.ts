import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Plays Z-machine and Glulx story files in an editor tab.
 *
 * The interpreter is Parchment's "for Inform 7" bundle (Bocfel for the
 * Z-machine, Glulxe for Glulx, both compiled to WebAssembly), the same files
 * Inform's own "Release along with an interpreter" ships. Parchment is driven
 * exactly as that release template drives it: a window.parchment_options
 * object, and resources delivered as JSONP scripts. The engine carriers
 * already come in that form; the story file is wrapped into one here, in the
 * extension's global storage, each time it is opened or changes on disk.
 */
export const PLAYER_VIEW_TYPE = "informEcosystem.player";

class StoryDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose() {}
}

export class StoryPlayerProvider
  implements vscode.CustomReadonlyEditorProvider<StoryDocument>
{
  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PLAYER_VIEW_TYPE,
      new StoryPlayerProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): StoryDocument {
    return new StoryDocument(uri);
  }

  async resolveCustomEditor(
    document: StoryDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const parchmentDir = vscode.Uri.joinPath(
      this.context.extensionUri,
      "webview",
      "parchment",
    );
    const storageDir = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "stories",
    );
    await vscode.workspace.fs.createDirectory(storageDir);

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "webview"),
        storageDir,
      ],
    };

    const load = async () => {
      try {
        const carrier = await this.writeCarrier(document.uri, storageDir);
        panel.webview.html = this.html(
          panel.webview,
          document.uri,
          parchmentDir,
          carrier,
        );
      } catch (err) {
        panel.webview.html = errorHtml(
          `Could not load ${document.uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    await load();

    const disposables: vscode.Disposable[] = [];

    // Reload when the story file is recompiled.
    if (config().get<boolean>("player.reloadOnChange", true)) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(path.dirname(document.uri.fsPath)),
          path.basename(document.uri.fsPath),
        ),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(load, 300);
      };
      watcher.onDidChange(schedule, null, disposables);
      watcher.onDidCreate(schedule, null, disposables);
      disposables.push(watcher);
    }

    // Follow the colour theme.
    vscode.window.onDidChangeActiveColorTheme(load, null, disposables);

    panel.webview.onDidReceiveMessage(
      (message: { type?: string }) => {
        if (message?.type === "reload") {
          void load();
        }
      },
      null,
      disposables,
    );

    panel.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }

  /** Wrap the story bytes as a JSONP resource, as Parchment's Inform 7 launcher expects. */
  private async writeCarrier(
    story: vscode.Uri,
    storageDir: vscode.Uri,
  ): Promise<vscode.Uri> {
    const bytes = await vscode.workspace.fs.readFile(story);
    const hash = crypto
      .createHash("sha1")
      .update(story.fsPath)
      .digest("hex")
      .slice(0, 12);
    const carrier = vscode.Uri.joinPath(
      storageDir,
      `${hash}-${path.basename(story.fsPath)}.js`,
    );
    const text = `ParchmentResource({base64: 1, data: '${Buffer.from(bytes).toString("base64")}'})\n`;
    await vscode.workspace.fs.writeFile(carrier, Buffer.from(text, "utf8"));
    return carrier;
  }

  private html(
    webview: vscode.Webview,
    story: vscode.Uri,
    parchmentDir: vscode.Uri,
    carrier: vscode.Uri,
  ): string {
    const nonce = crypto.randomBytes(16).toString("hex");
    const res = (dir: vscode.Uri, file: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(dir, file)).toString();
    const webviewDir = vscode.Uri.joinPath(
      this.context.extensionUri,
      "webview",
    );
    const libPath = webview.asWebviewUri(parchmentDir).toString() + "/";
    const filename = path.basename(story.fsPath);
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind ===
        vscode.ColorThemeKind.HighContrast;
    const autosave = config().get<boolean>("player.autosave", true) ? 1 : 0;

    const options = {
      // The webview is an iframe; Parchment must not try to break out of it.
      play_in_iframe: 1,
      autoplay: 1,
      do_vm_autosave: autosave,
      jsonp: "ParchmentResource",
      lib_path: libPath,
      theme: dark ? "dark" : "",
      // Keep saves separate per story file.
      dialog_localStorage_id: storyId(story),
      story: {
        filename,
        title: storyTitle(story),
        url: webview.asWebviewUri(carrier).toString(),
      },
    };

    // Scripts: our nonce'd inline options, Parchment's own files, and the
    // JSONP carriers it injects as script tags from the webview origin. The
    // WebAssembly engines need wasm-unsafe-eval (older runtimes: unsafe-eval).
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data: blob:`,
      `media-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource} 'unsafe-eval' 'wasm-unsafe-eval'`,
      `connect-src ${webview.cspSource} data: blob:`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en"${dark ? ' data-theme="dark"' : ""}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(filename)}</title>
<link rel="stylesheet" href="${res(parchmentDir, "parchment.css")}">
<link rel="stylesheet" href="${res(webviewDir, "player.css")}">
<script nonce="${nonce}" src="${res(parchmentDir, "jquery.min.js")}"></script>
<script nonce="${nonce}" src="${res(parchmentDir, "ie.js")}" nomodule></script>
<script nonce="${nonce}">window.parchment_options = ${JSON.stringify(options)};</script>
<script nonce="${nonce}" src="${res(parchmentDir, "parchment.js")}"></script>
<script nonce="${nonce}" src="${res(webviewDir, "player.js")}"></script>
</head>
<body>
<div id="gameport">
  <div id="windowport"></div>
  <div id="loadingpane">
    <img src="${res(parchmentDir, "waiting.gif")}" alt="LOADING"><br>
    <em>&nbsp;&nbsp;&nbsp;Loading...</em>
  </div>
  <div id="errorpane" style="display:none;"><div id="errorcontent">...</div></div>
</div>
</body>
</html>`;
  }
}

function config() {
  return vscode.workspace.getConfiguration("informEcosystem");
}

/** "X.inform/Build/output.ulx" is the story of project X; otherwise use the file name. */
function storyTitle(story: vscode.Uri): string {
  const m = /([^/\\]+)\.inform[/\\]Build[/\\][^/\\]+$/i.exec(story.fsPath);
  return m ? m[1] : path.basename(story.fsPath).replace(/\.[^.]+$/, "");
}

function storyId(story: vscode.Uri): string {
  return storyTitle(story)
    .toLowerCase()
    .replace(/[^\w\s_-]/g, "")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function errorHtml(message: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:1em"><p>${escapeHtml(message)}</p></body></html>`;
}

/** Open a story file in the player, beside the current editor. */
export function openInPlayer(story: vscode.Uri) {
  return vscode.commands.executeCommand(
    "vscode.openWith",
    story,
    PLAYER_VIEW_TYPE,
    vscode.ViewColumn.Beside,
  );
}

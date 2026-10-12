import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { locateToolchain } from "../compile/tools";
import {
  CatalogEntry,
  Plan,
  Present,
  compareVersions,
  download,
  identity,
  loadCatalog,
  parseHeader,
  resolvePlan,
  satisfies,
  sha256,
} from "./catalog";
import {
  currentProject,
  materialsFolder,
  openExtensionDocumentation,
} from "./docs";

/**
 * Installs Inform 7 extensions from the catalog, with what they Include.
 *
 * Inform finds installed extensions in two places, and either can be used:
 * the user's Inform folder (Documents/Inform/Extensions, shared by every
 * project and by the Inform IDE), or a project's own materials folder
 * (Story.materials/Extensions), which only that project sees and which
 * Inform prefers. The informEcosystem.extensions.installLocation setting
 * picks the usual one; each install offers both.
 *
 * Only files that match a catalog download byte for byte can be removed
 * here, so an author's own extensions, or edited copies, are never deleted.
 */
type Where = "user" | "project";

interface Installed extends Present {
  file: string;
  where: Where | "builtin";
}

function config() {
  return vscode.workspace.getConfiguration("informEcosystem");
}

/** The user's Inform folder, as passed to inform7 -external. */
function userExtensionsDir(): string {
  const setting = config().get<string>("externalPath", "").trim();
  return path.join(
    setting || path.join(os.homedir(), "Documents", "Inform"),
    "Extensions",
  );
}

/** Story.inform's extensions live in Story.materials/Extensions beside it. */
function projectExtensionsDir(projectDir: string): string {
  return path.join(materialsFolder(projectDir), "Extensions");
}

/** The .i7x files under an extensions folder (Author/Title.i7x), by their headers. */
function scan(dir: string | undefined, where: Installed["where"]): Installed[] {
  const out: Installed[] = [];
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const file = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) {
        walk(file, depth + 1);
      } else if (e.isFile() && /\.i7x$/i.test(e.name)) {
        try {
          const head = fs.readFileSync(file, "utf8").slice(0, 4000);
          const header = parseHeader(head);
          if (header) {
            out.push({ ...header, file, where });
          }
        } catch {
          // Unreadable: leave it out.
        }
      }
    }
  };
  if (dir) {
    walk(dir, 0);
  }
  return out;
}

/** Everything Inform would find: the project's, the user's, and the built-in extensions. */
function installedExtensions(project: string | undefined): Installed[] {
  const toolchain = locateToolchain();
  return [
    ...scan(project && projectExtensionsDir(project), "project"),
    ...scan(userExtensionsDir(), "user"),
    ...scan(
      toolchain && path.join(toolchain.internalDir, "Extensions"),
      "builtin",
    ),
  ];
}

function byIdentity(installed: Installed[]): Map<string, Installed> {
  const map = new Map<string, Installed>();
  for (const i of installed) {
    const key = identity(i.title, i.author);
    if (!map.has(key)) {
      map.set(key, i); // the first found is the one Inform uses
    }
  }
  return map;
}

const WHERE_LABEL: Record<Installed["where"], string> = {
  project: "this project",
  user: "all projects",
  builtin: "built into Inform",
};

async function withCatalog(
  context: vscode.ExtensionContext,
): Promise<CatalogEntry[] | undefined> {
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Inform: loading the extension catalog",
      },
      () =>
        loadCatalog(path.join(context.globalStorageUri.fsPath, "extensions")),
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not load the extension catalog: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

function planDetail(plan: Plan): string {
  const lines: string[] = [];
  const name = (e: Present) =>
    `${e.title} by ${e.author}${e.version ? ` ${e.version}` : ""}`;
  if (plan.install.length > 1) {
    lines.push(`Also installs: ${plan.install.slice(1).map(name).join("; ")}.`);
  }
  if (plan.present.length) {
    lines.push(
      `Uses, already installed: ${plan.present.map(name).join("; ")}.`,
    );
  }
  if (plan.missing.length) {
    lines.push(
      `Not in the catalog, so needed separately: ${plan.missing.join("; ")}.`,
    );
  }
  for (const entry of plan.install) {
    for (const warning of entry.warnings) {
      lines.push(`${entry.title}: ${warning}`);
    }
  }
  return lines.join("\n\n");
}

async function installExtension(context: vscode.ExtensionContext) {
  const catalog = await withCatalog(context);
  if (!catalog) {
    return;
  }
  const project = currentProject();
  const installed = installedExtensions(project);
  const have = byIdentity(installed);

  const items = catalog
    .map((entry) => {
      const found = have.get(identity(entry.title, entry.author));
      return {
        label: entry.title,
        description: `by ${entry.author}${entry.version ? ` · version ${entry.version}` : ""}`,
        detail: [
          found
            ? `Installed${found.version ? ` (version ${found.version})` : ""} for ${WHERE_LABEL[found.where]}`
            : undefined,
          entry.qualifiers,
        ]
          .filter(Boolean)
          .join(" · "),
        entry,
      };
    })
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label) ||
        (b.entry.version ?? "").localeCompare(a.entry.version ?? ""),
    );
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: `Install an extension (${catalog.length} in the catalog)`,
    matchOnDescription: true,
  });
  if (!choice) {
    return;
  }
  const root = choice.entry;
  const already = have.get(identity(root.title, root.author));
  if (already && already.where !== "builtin") {
    const open = "Open It";
    const upgrade = `Upgrade to Version ${root.version}`;
    const offerUpgrade =
      compareVersions(root.version, already.version) > 0 &&
      isCatalogCopy(already, catalog);
    const answer = await vscode.window.showInformationMessage(
      `${root.title} by ${root.author} is already installed for ${WHERE_LABEL[already.where]}` +
        `${already.version ? `, version ${already.version}` : ""}.`,
      ...(offerUpgrade ? [upgrade, open] : [open]),
    );
    if (answer === open) {
      await vscode.window.showTextDocument(vscode.Uri.file(already.file));
    } else if (answer === upgrade) {
      await upgradeExtension(already, root, catalog, project);
    }
    return;
  }

  const plan = resolvePlan(root, catalog, have);
  if (plan.conflicts.length) {
    vscode.window.showErrorMessage(
      `Cannot install ${root.title}: ${plan.conflicts.join(" ")}`,
      { modal: true },
    );
    return;
  }

  const forAll = "Install for All Projects";
  const forProject = "Install for This Project";
  const preferProject =
    config().get<string>("extensions.installLocation", "user") === "project";
  const buttons = !project
    ? [forAll]
    : preferProject
      ? [forProject, forAll]
      : [forAll, forProject];
  const answer = await vscode.window.showInformationMessage(
    `Install ${root.title} by ${root.author}${root.version ? ` version ${root.version}` : ""}?`,
    {
      modal: true,
      detail: [
        planDetail(plan),
        `All projects: ${userExtensionsDir()}`,
        project ? `This project: ${projectExtensionsDir(project)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    ...buttons,
  );
  if (!answer) {
    return;
  }
  const target =
    answer === forProject && project
      ? projectExtensionsDir(project)
      : userExtensionsDir();

  try {
    const files = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Inform: installing ${root.title}`,
      },
      async (progress) => {
        // Fetch and verify everything before writing anything.
        const fetched: { entry: CatalogEntry; data: Buffer }[] = [];
        for (const entry of plan.install) {
          progress.report({ message: entry.title });
          fetched.push({
            entry,
            data: await download(entry.url, {
              bytes: entry.bytes,
              sha256: entry.sha256,
            }),
          });
        }
        return fetched.map(({ entry, data }) => {
          const dir = path.join(target, entry.author);
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, entry.filename);
          fs.writeFileSync(file, data);
          return file;
        });
      },
    );
    const show = "Open";
    const reply = await vscode.window.showInformationMessage(
      `Installed ${files.length === 1 ? root.title : `${root.title} and ${files.length - 1} more`} in ${target}.` +
        (plan.missing.length
          ? ` Still needed: ${plan.missing.join("; ")}.`
          : ""),
      show,
    );
    if (reply === show) {
      await vscode.window.showTextDocument(vscode.Uri.file(files[0]));
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not install ${root.title}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Whether an installed file is a catalog download, unchanged. */
function isCatalogCopy(item: Installed, catalog: CatalogEntry[]): boolean {
  try {
    const hash = sha256(fs.readFileSync(item.file));
    return catalog.some((e) => e.sha256 === hash);
  } catch {
    return false;
  }
}

/** The catalog's newest version of an installed extension, if newer than it. */
function newestVersion(
  item: Installed,
  catalog: CatalogEntry[],
): CatalogEntry | undefined {
  const key = identity(item.title, item.author);
  return catalog
    .filter(
      (e) =>
        identity(e.title, e.author) === key &&
        compareVersions(e.version, item.version) > 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version))[0];
}

/**
 * Replace an installed catalog copy with a newer version, in the same place,
 * with whatever the newer version needs. Other installed extensions that
 * require a version the upgrade moves away from are named before going on.
 */
async function upgradeExtension(
  item: Installed,
  newer: CatalogEntry,
  catalog: CatalogEntry[],
  project: string | undefined,
) {
  const key = identity(item.title, item.author);
  const installed = installedExtensions(project);
  const have = byIdentity(installed.filter((i) => i.file !== item.file));
  have.delete(key);
  const plan = resolvePlan(newer, catalog, have);
  if (plan.conflicts.length) {
    vscode.window.showErrorMessage(
      `Cannot upgrade ${item.title}: ${plan.conflicts.join(" ")}`,
      { modal: true },
    );
    return;
  }

  // Installed catalog copies that Include this extension with version bounds.
  const broken: string[] = [];
  for (const other of installed) {
    if (other.file === item.file || other.where === "builtin") {
      continue;
    }
    let hash: string;
    try {
      hash = sha256(fs.readFileSync(other.file));
    } catch {
      continue;
    }
    const entry = catalog.find((e) => e.sha256 === hash);
    for (const dep of entry?.dependencies ?? []) {
      if (
        dep.kind === "include" &&
        identity(dep.title, dep.author) === key &&
        !satisfies(newer.version, dep)
      ) {
        broken.push(
          `${other.title} needs version ${dep.requestedVersion ?? dep.minVersion}`,
        );
      }
    }
  }

  const target = path.dirname(path.dirname(item.file));
  const go = "Upgrade";
  const answer = await vscode.window.showWarningMessage(
    `Upgrade ${item.title} by ${item.author} from version ${item.version ?? "(none)"} to ${newer.version}?`,
    {
      modal: true,
      detail: [
        broken.length
          ? `This may break extensions that need the old version: ${broken.join("; ")}.`
          : "",
        planDetail(plan),
        `For ${WHERE_LABEL[item.where]}: ${target}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
    go,
  );
  if (answer !== go) {
    return;
  }
  try {
    const files = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Inform: upgrading ${item.title}`,
      },
      async (progress) => {
        const fetched: { entry: CatalogEntry; data: Buffer }[] = [];
        for (const entry of plan.install) {
          progress.report({ message: entry.title });
          fetched.push({
            entry,
            data: await download(entry.url, {
              bytes: entry.bytes,
              sha256: entry.sha256,
            }),
          });
        }
        return fetched.map(({ entry, data }) => {
          const dir = path.join(target, entry.author);
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, entry.filename);
          fs.writeFileSync(file, data);
          return file;
        });
      },
    );
    // The old file goes once the new one is in place, unless it was the
    // same file, overwritten.
    if (!files.some((f) => f.toLowerCase() === item.file.toLowerCase())) {
      fs.rmSync(item.file, { force: true });
    }
    vscode.window.showInformationMessage(
      `Upgraded ${item.title} to version ${newer.version}` +
        (files.length > 1 ? `, with ${files.length - 1} more` : "") +
        "." +
        (plan.missing.length
          ? ` Still needed: ${plan.missing.join("; ")}.`
          : ""),
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not upgrade ${item.title}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function manageExtensions(context: vscode.ExtensionContext) {
  const project = currentProject();
  const installed = installedExtensions(project).filter(
    (i) => i.where !== "builtin",
  );
  if (!installed.length) {
    const install = "Install Extension...";
    const answer = await vscode.window.showInformationMessage(
      "No extensions are installed, for this project or for all projects.",
      install,
    );
    if (answer === install) {
      await installExtension(context);
    }
    return;
  }
  const choice = await vscode.window.showQuickPick(
    installed
      .map((i) => ({
        label: i.title,
        description: `by ${i.author}${i.version ? ` · version ${i.version}` : ""} · ${WHERE_LABEL[i.where]}`,
        detail: i.file,
        installed: i,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    { placeHolder: "Installed extensions", matchOnDescription: true },
  );
  if (!choice) {
    return;
  }
  const item = choice.installed;

  // Removable, or upgradable, only if it is a catalog download, unchanged.
  const catalog = await withCatalog(context);
  const removable = !!catalog && isCatalogCopy(item, catalog);
  const newer = removable ? newestVersion(item, catalog!) : undefined;
  const upgrade = newer && `Upgrade to Version ${newer.version}`;

  const actions = ["Open Documentation", "Open", "Reveal in File Explorer"];
  if (upgrade) {
    actions.unshift(upgrade);
  }
  if (removable) {
    actions.push("Remove");
  }
  const action = await vscode.window.showQuickPick(actions, {
    placeHolder: removable
      ? `${item.title} by ${item.author}`
      : `${item.title} by ${item.author} (not a catalog copy, so it cannot be removed here)`,
  });
  if (upgrade && action === upgrade) {
    await upgradeExtension(item, newer!, catalog!, project);
  } else if (action === "Open Documentation") {
    await openExtensionDocumentation(
      project,
      `Extensions/${item.author}/${item.title}.html`,
    );
  } else if (action === "Open") {
    await vscode.window.showTextDocument(vscode.Uri.file(item.file));
  } else if (action === "Reveal in File Explorer") {
    await vscode.commands.executeCommand(
      "revealFileInOS",
      vscode.Uri.file(item.file),
    );
  } else if (action === "Remove") {
    const remove = "Remove";
    const sure = await vscode.window.showWarningMessage(
      `Remove ${item.title} by ${item.author} from ${WHERE_LABEL[item.where]}?`,
      {
        modal: true,
        detail: `${item.file}\n\nProjects that include it will need it installed again. Extensions it includes are left installed.`,
      },
      remove,
    );
    if (sure === remove) {
      fs.rmSync(item.file);
      const dir = path.dirname(item.file);
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
      vscode.window.showInformationMessage(`Removed ${item.title}.`);
    }
  }
}

export function registerExtensions(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("informEcosystem.installExtension", () =>
      installExtension(context),
    ),
    vscode.commands.registerCommand("informEcosystem.manageExtensions", () =>
      manageExtensions(context),
    ),
  );
}

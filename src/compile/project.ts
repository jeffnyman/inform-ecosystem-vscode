import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

/**
 * An Inform 7 project is a folder named Something.inform holding
 * Source/story.ni, a uuid.txt, and optionally Settings.plist written by the
 * IDE. Build output goes in its Build/ subfolder, and Release.blurb (written
 * by inform7 during a release build) drives inblorb.
 */
export interface ProjectSettings {
  /** "glulx" or "z8"; the IDE stores this as IFSettingZCodeVersion 256 or 8. */
  format: "glulx" | "z8";
  /** Whether a release should be bound into a Blorb (IFSettingCreateBlorb). */
  createBlorb: boolean;
  /** Make the random-number generator predictable (IFSettingNobbleRng). */
  nobbleRng: boolean;
}

export interface Project {
  dir: string;
  name: string;
  source: string;
  buildDir: string;
  settings: ProjectSettings;
}

/** Walk up from a file or folder to the enclosing .inform folder, if any. */
export function findProjectDir(startPath: string): string | undefined {
  let p = path.resolve(startPath);
  for (let i = 0; i < 12 && p; i++) {
    if (/\.inform$/i.test(p) && fs.existsSync(path.join(p, "Source"))) {
      return p;
    }
    const parent = path.dirname(p);
    if (parent === p) {
      break;
    }
    p = parent;
  }
  return undefined;
}

/** List .inform folders directly inside a folder (one level), for a picker. */
export function listProjects(folder: string): string[] {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /\.inform$/i.test(d.name))
      .map((d) => path.join(folder, d.name))
      .filter((p) => fs.existsSync(path.join(p, "Source")));
  } catch {
    return [];
  }
}

export function loadProject(
  dir: string,
  defaultFormat: "glulx" | "z8",
): Project {
  const settings = readSettings(
    path.join(dir, "Settings.plist"),
    defaultFormat,
  );
  return {
    dir,
    name: path.basename(dir).replace(/\.inform$/i, ""),
    source: path.join(dir, "Source", "story.ni"),
    buildDir: path.join(dir, "Build"),
    settings,
  };
}

/** The IDE creates uuid.txt when it makes a project; inform7 refuses to run without it. */
export function ensureProjectFiles(project: Project) {
  const uuid = path.join(project.dir, "uuid.txt");
  if (!fs.existsSync(uuid)) {
    fs.writeFileSync(uuid, crypto.randomUUID() + "\n");
  }
  fs.mkdirSync(project.buildDir, { recursive: true });
}

/**
 * A folder name for a story title: the title less the characters Windows,
 * macOS or Linux refuse in file names, and without the trailing dots and
 * spaces Windows drops. Empty if nothing usable is left.
 */
export function projectFolderName(title: string): string {
  return title
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

/**
 * The opening of a new story: the bibliographic sentence and one room, so it
 * compiles at once. Inform text has no escape for a double quote, so any in
 * the title or author become single quotes.
 */
export function newStorySource(title: string, author: string): string {
  const clean = (s: string) => s.replace(/"/g, "'").trim();
  const byline = clean(author) ? ` by ${clean(author)}` : "";
  return `"${clean(title)}"${byline}\n\nThe Starting Room is a room.\n`;
}

/**
 * Create Title.inform inside a folder, holding Source/story.ni and uuid.txt,
 * and return the path of story.ni. Refuses to touch an existing folder.
 */
export function createProject(
  parent: string,
  title: string,
  author: string,
): string {
  const name = projectFolderName(title);
  if (!name) {
    throw new Error("The title has no characters usable in a folder name.");
  }
  const dir = path.join(parent, name + ".inform");
  if (fs.existsSync(dir)) {
    throw new Error(`${dir} already exists.`);
  }
  fs.mkdirSync(path.join(dir, "Source"), { recursive: true });
  const story = path.join(dir, "Source", "story.ni");
  fs.writeFileSync(story, newStorySource(title, author));
  fs.writeFileSync(path.join(dir, "uuid.txt"), crypto.randomUUID() + "\n");
  return story;
}

/**
 * Settings.plist is a small XML property list. Only three keys matter here, so
 * a regular-expression read is enough and avoids a dependency.
 */
export function readSettings(
  plistPath: string,
  defaultFormat: "glulx" | "z8",
): ProjectSettings {
  const settings: ProjectSettings = {
    format: defaultFormat,
    createBlorb: true,
    nobbleRng: false,
  };
  let xml: string;
  try {
    xml = fs.readFileSync(plistPath, "utf8");
  } catch {
    return settings;
  }
  const integer = (key: string) => {
    const m = new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`).exec(
      xml,
    );
    return m ? Number(m[1]) : undefined;
  };
  const bool = (key: string) => {
    const m = new RegExp(`<key>${key}</key>\\s*<(true|false)\\s*/>`).exec(xml);
    return m ? m[1] === "true" : undefined;
  };
  const version = integer("IFSettingZCodeVersion");
  if (version !== undefined) {
    settings.format = version === 256 ? "glulx" : "z8";
  }
  const blorb = bool("IFSettingCreateBlorb");
  if (blorb !== undefined) {
    settings.createBlorb = blorb;
  }
  const rng = bool("IFSettingNobbleRng");
  if (rng !== undefined) {
    settings.nobbleRng = rng;
  }
  return settings;
}

/** The story-file extension and inform6 switches for a format. */
export function formatDetails(format: "glulx" | "z8", release: boolean) {
  const inform7Format =
    (format === "glulx" ? "Inform6/32" : "Inform6/16") + (release ? "" : "d");
  const inform6Switches =
    "-E1w" + (release ? "~S~D" : "SD") + (format === "glulx" ? "G" : "v8");
  return {
    inform7Format,
    inform6Switches,
    storyExtension: format === "glulx" ? "ulx" : "z8",
    blorbExtension: format === "glulx" ? "gblorb" : "zblorb",
  };
}

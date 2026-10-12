import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * The catalog of Inform 7 extensions that can be installed: Informant's
 * catalog of the community extension library for Inform 10.1, one entry per
 * .i7x file, each with its download URL, exact size and SHA-256, and the
 * extensions it Includes. It comes as a zip holding extensions.xml, pinned
 * here by URL and SHA-256 like the compiler downloads.
 *
 * Nothing here touches VS Code, so it can be tested on its own.
 */
const CATALOG = {
  id: "inform-10.1.2c-extensions-i7x",
  url: "https://github.com/interactivefiction/inform7extensions/releases/download/inform-10.1.2c-extensions-i7x/extension-catalog.zip",
  sha256: "878b01eaf2631f05cf3699786aabc541e6e3eb040ebeaa7f725de112dda264a3",
};

export interface Dependency {
  title: string;
  author: string;
  /** "include" must be present; "integration" is an optional heading reference. */
  kind: string;
  requestedVersion?: string;
  minVersion?: string;
  maxVersionExclusive?: string;
}

export interface CatalogEntry {
  id: string;
  title: string;
  author: string;
  version?: string;
  /** Header restrictions, such as "for Glulx only". */
  qualifiers?: string;
  url: string;
  filename: string;
  bytes: number;
  sha256: string;
  dependencies: Dependency[];
  warnings: string[];
}

/**
 * Titles and authors compare without regard to case or spacing, and a
 * title's leading "the" is an article, as in "Version 6 of the Standard Rules
 * by Graham Nelson begins here", which others Include as "Standard Rules".
 */
export function identity(title: string, author: string): string {
  const norm = (s: string) =>
    s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return `${norm(title).replace(/^the /, "")}\0${norm(author)}`;
}

/**
 * An Inform version as three numbers: "7" is 7.0.0 and "7.1" 7.1.0. The old
 * "6/160501" form, a release number and a date, counts the date as the third.
 */
export function versionParts(
  version: string | undefined,
): number[] | undefined {
  if (!version || !/^\d+(\.\d+){0,2}(\/\d+)?$/.test(version)) {
    return undefined;
  }
  const [main, build] = version.split("/");
  const parts = main.split(".").map(Number);
  while (parts.length < 3) {
    parts.push(0);
  }
  if (build) {
    parts[2] = Number(build);
  }
  return parts;
}

export function compareVersions(a?: string, b?: string): number {
  const x = versionParts(a) ?? [-1, 0, 0];
  const y = versionParts(b) ?? [-1, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) {
      return x[i] - y[i];
    }
  }
  return 0;
}

/** Whether an extension of this version meets a dependency's version bounds. */
export function satisfies(
  version: string | undefined,
  dep: Dependency,
): boolean {
  if (!dep.minVersion && !dep.maxVersionExclusive) {
    return true;
  }
  if (!versionParts(version)) {
    return false;
  }
  return (
    (!dep.minVersion || compareVersions(version, dep.minVersion) >= 0) &&
    (!dep.maxVersionExclusive ||
      compareVersions(version, dep.maxVersionExclusive) < 0)
  );
}

function decodeEntities(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, e: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      if (e[0] !== "#") {
        return named[e.toLowerCase()];
      }
      return String.fromCodePoint(
        e[1].toLowerCase() === "x"
          ? parseInt(e.slice(2), 16)
          : Number(e.slice(1)),
      );
    },
  );
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    out[m[1]] = decodeEntities(m[2]);
  }
  return out;
}

/**
 * Read extensions.xml. It is machine-written in a fixed form, so its elements
 * are picked out directly rather than with a general XML parser.
 */
export function parseCatalog(xml: string): CatalogEntry[] {
  const root = /<catalog\b[^>]*>/.exec(xml);
  const rootAttrs = root ? attributes(root[0]) : {};
  if (
    rootAttrs.xmlns !== "urn:inform7:extension-catalog:1" ||
    rootAttrs["schema-version"] !== "1"
  ) {
    throw new Error("Unsupported extension catalog format.");
  }
  const entries: CatalogEntry[] = [];
  for (const m of xml.matchAll(
    /<extension\b([^>]*)>([\s\S]*?)<\/extension>/g,
  )) {
    const a = attributes(m[1]);
    const download = /<download\b[^>]*>/.exec(m[2]);
    const d = download ? attributes(download[0]) : {};
    if (
      !a.id ||
      !a.title ||
      !a.author ||
      !/^https:\/\//.test(d.url ?? "") ||
      !/^[a-f0-9]{64}$/.test(d.sha256 ?? "") ||
      !/^\d+$/.test(d.bytes ?? "") ||
      !d.filename ||
      /[\\/:]|^\.+$/.test(d.filename) ||
      !/\.i7x$/i.test(d.filename)
    ) {
      throw new Error(`Invalid catalog entry: ${a.title ?? a.id ?? "?"}`);
    }
    const dependencies: Dependency[] = [];
    for (const dep of m[2].matchAll(/<dependency\b[^>]*>/g)) {
      const r = attributes(dep[0]);
      dependencies.push({
        title: r.title,
        author: r.author,
        kind: r.kind,
        requestedVersion: r["requested-version"],
        minVersion: r["min-version"],
        maxVersionExclusive: r["max-version-exclusive"],
      });
    }
    const warnings = [
      ...m[2].matchAll(/<warning\b[^>]*>([\s\S]*?)<\/warning>/g),
    ].map((w) => decodeEntities(w[1].trim()));
    entries.push({
      id: a.id,
      title: a.title,
      author: a.author,
      version: a.version,
      qualifiers: a.qualifiers,
      url: d.url,
      filename: d.filename,
      bytes: Number(d.bytes),
      sha256: d.sha256,
      dependencies,
      warnings,
    });
  }
  return entries;
}

/** Minimal ZIP reader: central directory, then each stored or deflated entry. */
export function readZip(buf: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Not a zip file.");
  }
  const out: { name: string; data: Buffer }[] = [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error("Bad zip central directory.");
    }
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== 0x04034b50) {
      throw new Error("Bad zip local header.");
    }
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + compressed);
    if (method === 0) {
      out.push({ name, data: raw });
    } else if (method === 8) {
      out.push({ name, data: inflateRawSync(raw) });
    } else {
      throw new Error(`Unsupported zip compression in ${name}.`);
    }
  }
  return out;
}

export function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** Download over HTTPS, checking the exact size and SHA-256 when given. */
export async function download(
  url: string,
  expect: { bytes?: number; sha256: string },
): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (
    (expect.bytes !== undefined && data.length !== expect.bytes) ||
    sha256(data) !== expect.sha256
  ) {
    throw new Error(`Checksum mismatch for ${url}`);
  }
  return data;
}

/** The catalog, downloaded once into the given folder and read from there after. */
export async function loadCatalog(storageDir: string): Promise<CatalogEntry[]> {
  const cached = path.join(storageDir, `${CATALOG.id}.xml`);
  if (!fs.existsSync(cached)) {
    const zip = await download(CATALOG.url, { sha256: CATALOG.sha256 });
    const xml = readZip(zip).find((e) => /(^|\/)extensions\.xml$/.test(e.name));
    if (!xml) {
      throw new Error("The extension catalog has no extensions.xml.");
    }
    fs.mkdirSync(storageDir, { recursive: true });
    fs.writeFileSync(cached, xml.data);
  }
  return parseCatalog(fs.readFileSync(cached, "utf8"));
}

/** An extension's own declaration of itself: "Version 2 of Title by Author begins here." */
export function parseHeader(
  text: string,
): { title: string; author: string; version?: string } | undefined {
  const m =
    /^\s*(?:Version\s+(\S+)\s+of\s+)?(.+?)\s+by\s+(.+?)\s+begins?\s+here\s*\./im.exec(
      text.replace(/^﻿/, ""),
    );
  if (!m) {
    return undefined;
  }
  // Drop restrictions such as "(for Glulx only)".
  const strip = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return { title: strip(m[2]), author: strip(m[3]), version: m[1] };
}

export interface Present {
  title: string;
  author: string;
  version?: string;
}

export interface Plan {
  /** The extension asked for and everything it needs that is not yet present, in install order. */
  install: CatalogEntry[];
  /** Needed extensions already present, by identity. */
  present: Present[];
  /** Needed extensions that cannot be supplied from the catalog. */
  missing: string[];
  /** Requirements that disagree on a version. */
  conflicts: string[];
}

function describe(dep: Dependency): string {
  return `${dep.title} by ${dep.author}${dep.requestedVersion ? ` (version ${dep.requestedVersion})` : ""}`;
}

/**
 * What installing an extension takes: it and, transitively, everything it
 * Includes that is not already present. A needed extension already present
 * is used if its version will do; otherwise the newest catalog version that
 * meets the requirement is chosen. Disagreements are reported, not resolved.
 */
export function resolvePlan(
  root: CatalogEntry,
  catalog: CatalogEntry[],
  present: Map<string, Present>,
): Plan {
  const chosen = new Map<string, CatalogEntry>([
    [identity(root.title, root.author), root],
  ]);
  const plan: Plan = {
    install: [root],
    present: [],
    missing: [],
    conflicts: [],
  };
  const usedPresent = new Set<string>();
  const queue = [root];
  while (queue.length) {
    const entry = queue.shift()!;
    for (const dep of entry.dependencies.filter((d) => d.kind === "include")) {
      const key = identity(dep.title, dep.author);
      const picked = chosen.get(key);
      if (picked) {
        if (!satisfies(picked.version, dep)) {
          plan.conflicts.push(
            `${entry.title} needs ${describe(dep)}, but version ${picked.version ?? "(none)"} is being installed.`,
          );
        }
        continue;
      }
      const have = present.get(key);
      if (have) {
        if (!satisfies(have.version, dep)) {
          plan.conflicts.push(
            `${entry.title} needs ${describe(dep)}, but version ${have.version ?? "(unversioned)"} is already installed.`,
          );
        } else if (!usedPresent.has(key)) {
          usedPresent.add(key);
          plan.present.push(have);
        }
        continue;
      }
      const candidate = catalog
        .filter(
          (c) =>
            identity(c.title, c.author) === key && satisfies(c.version, dep),
        )
        .sort((a, b) => compareVersions(b.version, a.version))[0];
      if (!candidate) {
        if (!plan.missing.includes(describe(dep))) {
          plan.missing.push(describe(dep));
        }
        continue;
      }
      chosen.set(key, candidate);
      plan.install.push(candidate);
      queue.push(candidate);
    }
  }
  return plan;
}

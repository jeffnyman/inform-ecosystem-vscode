#!/usr/bin/env node
/**
 * Fetches the "Parchment for Inform 7" bundle and unpacks it into
 * webview/parchment/. This is the same interpreter package that Inform's own
 * "Release along with an interpreter" ships, so a story played in VS Code
 * behaves as it will on the web.
 *
 * Pinned to a release; bump PARCHMENT_TAG deliberately. The files are not
 * committed (see .gitignore): run `npm run fetch-parchment`, which the build
 * script does for you. No dependencies beyond Node itself.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const PARCHMENT_TAG = "2026.8.23";
const PARCHMENT_DATE = "2026-08-23";
const URL_ = `https://github.com/curiousdannii/parchment/releases/download/${PARCHMENT_TAG}/parchment-for-inform7-${PARCHMENT_DATE}.zip`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "webview", "parchment");
const stamp = join(dest, "VERSION.txt");

if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === PARCHMENT_TAG) {
  console.log(`Parchment ${PARCHMENT_TAG} already present in webview/parchment/`);
  process.exit(0);
}

console.log(`Downloading Parchment for Inform 7 ${PARCHMENT_TAG} ...`);
const tmp = await mkdtemp(join(tmpdir(), "parchment-"));
const zipPath = join(tmp, "parchment.zip");
const response = await fetch(URL_);
if (!response.ok || !response.body) {
  console.error(`Download failed: HTTP ${response.status} for ${URL_}`);
  process.exit(1);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

mkdirSync(dest, { recursive: true });
let count = 0;
for (const entry of readZip(readFileSync(zipPath))) {
  // Entries look like "Parchment/parchment.js"; flatten the top folder.
  const name = entry.name.replace(/^Parchment\//, "");
  if (!name || name.endsWith("/")) {
    continue;
  }
  writeFileSync(join(dest, name), entry.data);
  count++;
  console.log(`  ${name}  (${entry.data.length} bytes)`);
}
writeFileSync(stamp, PARCHMENT_TAG + "\n");
await rm(tmp, { recursive: true, force: true });
console.log(`Unpacked ${count} files to webview/parchment/`);

/** Minimal ZIP reader: central directory -> local headers -> stored or deflated data. */
function* readZip(buf) {
  // End of central directory record, searched from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("not a zip file");
  }
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error("bad central directory");
    }
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("bad local header");
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressed);
    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      data = inflateRawSync(raw);
    } else {
      throw new Error(`unsupported compression method ${method} for ${name}`);
    }
    yield { name, data };
  }
}

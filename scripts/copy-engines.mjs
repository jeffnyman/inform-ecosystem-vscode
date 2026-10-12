#!/usr/bin/env node
/**
 * Copies the story engines the test runner uses, Glulxe and Bocfel (built
 * without version 6 support, as in Parchment), from the emglken package into
 * engines/, which ships with the extension. Only these files are taken: they
 * and emglken's own code are MIT licensed, unlike some other interpreters in
 * the package. The package is pinned in package.json; the files are not
 * committed (see .gitignore).
 *
 * Why not use the engines Parchment already ships in webview/parchment? The
 * code that drives them is compiled into parchment.js with the browser
 * interface, and emglken's driver code cannot load them: Emscripten needs the
 * driver and the WebAssembly from the same build, and Parchment's are newer
 * than the latest emglken release. If emglken and Parchment line up again,
 * the test runner could load Parchment's WebAssembly instead (only the small
 * glulxe.js and bocfel-noz6.js drivers would be needed), saving about 0.6 MB.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "emglken");
const dest = join(root, "engines");
const files = [
  "build/glulxe.js",
  "build/glulxe.wasm",
  "build/bocfel-noz6.js",
  "build/bocfel-noz6.wasm",
  "LICENSE",
];

const version = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).version;
mkdirSync(dest, { recursive: true });
for (const file of files) {
  copyFileSync(join(source, file), join(dest, file.replace(/^build\//, "")));
}
writeFileSync(join(dest, "VERSION.txt"), `emglken ${version}\n`);
// The engines are ES modules; say so, or Node guesses (with a warning).
writeFileSync(join(dest, "package.json"), '{ "type": "module" }\n');
console.log(`Copied emglken ${version} engines to engines/`);

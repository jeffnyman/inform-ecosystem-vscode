import { OutlineNode, closeAt, node } from "../common/outline";

/**
 * Outline of an Inform 6 source file.
 *
 * Inform 6 is free-form, but by near-universal convention every top-level
 * declaration starts at the left margin and its body is indented, so the
 * outline is line-based:
 *
 *   [ Name ...;  ... ];          routine, closed by a line starting with ]
 *   Object/Class/Kind decls      closed by the next left-margin declaration
 *   Constant, Global, Array,     one line each
 *   Attribute, Property,
 *   Verb/Extend, Include
 */

const ROUTINE = /^\[\s*([A-Za-z_]\w*)/;
const ROUTINE_END = /^\]\s*;?/;

// Words that start directives, so they are never mistaken for class names.
const DIRECTIVE_WORDS = new Set(
  (
    "abbreviate array attribute constant default dictionary end endif extend " +
    "fake_action global ifdef iffalse ifndef ifnot iftrue import include link " +
    "lowstring message origsource property release replace serial statusline " +
    "stub switches system_file trace undef verb version zcharacter"
  ).split(" "),
);

const OBJECT =
  /^(Object|Class|Nearby|[A-Za-z_]\w*)\s*((?:->\s*)*)([A-Za-z_]\w*)?\s*(?:"([^"]*)")?/i;
const SIMPLE: [RegExp, OutlineNode["kind"]][] = [
  [/^#?Constant\s+([A-Za-z_]\w*)/i, "constant"],
  [/^#?Global\s+([A-Za-z_]\w*)/i, "global"],
  [/^#?Array\s+([A-Za-z_]\w*)/i, "array"],
  [/^#?Attribute\s+([A-Za-z_]\w*)/i, "attribute"],
  [/^#?Property\s+(?:additive\s+)?(?!alias\b)([A-Za-z_]\w*)/i, "property"],
  [/^#?(Verb|Extend)\b\s*(.*?);?\s*$/i, "verb"],
  [/^#?Include\s+"([^"]*)"/i, "include"],
];

function isDeclarationStart(text: string): boolean {
  if (/^\s/.test(text) || text.trim() === "" || text.startsWith("!")) {
    return false;
  }
  return /^[\[A-Za-z_#]/.test(text);
}

export function outlineInform6(lines: string[]): OutlineNode[] {
  const roots: OutlineNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    if (!isDeclarationStart(text)) {
      continue;
    }

    const routine = ROUTINE.exec(text);
    if (routine) {
      const n = node("routine", routine[1], i);
      let j = i;
      // A one-line routine closes on its own line; otherwise look for the ] line.
      if (!/\]\s*;/.test(text.slice(routine[0].length))) {
        while (j + 1 < lines.length && !ROUTINE_END.test(lines[j + 1])) {
          j++;
        }
        if (j + 1 < lines.length) {
          j++;
        }
      }
      closeAt(n, lines, j);
      roots.push(n);
      i = j;
      continue;
    }

    let matched = false;
    for (const [re, kind] of SIMPLE) {
      const m = re.exec(text);
      if (m) {
        const name = kind === "verb" ? `${m[1]} ${m[2]}`.trim() : m[1];
        roots.push(node(kind, name, i));
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    const obj = OBJECT.exec(text);
    if (obj && !DIRECTIVE_WORDS.has(obj[1].toLowerCase())) {
      const kindWord = obj[1].toLowerCase();
      const isClassDecl = kindWord === "class";
      const internal = obj[3];
      const shortName = obj[4];
      // Class Foo ... declares a class; anything else declares an object, and
      // the first word names its class (Object, or a user class).
      const name = isClassDecl
        ? (internal ?? "(unnamed class)")
        : (internal ?? shortName ?? "(anonymous)");
      // Object (and the Inform 5 spelling Nearby) are plain objects: show the
      // short name. For a class instance, show the class and the short name.
      const plainObject = kindWord === "object" || kindWord === "nearby";
      let detail = "";
      if (!isClassDecl) {
        detail = plainObject ? (shortName ?? "") : obj[1];
        if (shortName && !plainObject) {
          detail += ` "${shortName}"`;
        }
      }
      const n = node(isClassDecl ? "class" : "object", name, i, detail);
      // The declaration runs until the next left-margin declaration.
      let j = i;
      while (j + 1 < lines.length && !isDeclarationStart(lines[j + 1])) {
        j++;
      }
      closeAt(n, lines, j);
      roots.push(n);
      i = j;
    }
  }

  return roots;
}

import { OutlineNode, closeAt, node } from "../common/outline";

/**
 * Outline of an Inform 7 source text or extension.
 *
 * Headings (Volume, Book, Part, Chapter, Section) nest by level and enclose
 * everything up to the next heading of the same or a higher level. Within
 * the current heading, three kinds of top-level definition are listed:
 *
 *   - phrases:  "To ...:"  including "To say ...:" and "To decide ...:"
 *   - rules:    rule preambles ending in a colon, such as "Instead of taking
 *               the lamp:" or "Every turn when ...:"
 *   - tables:   "Table of ..." or "Table N - ..."
 *
 * Inform requires a heading to stand alone with blank lines around it, and a
 * rule or phrase preamble to start at the left margin, which is what makes
 * this line-based approach reliable enough.
 */

const HEADING_LEVELS = ["volume", "book", "part", "chapter", "section"];

const HEADING = /^\s*(volume|book|part|chapter|section)\b:?\s+(.*?)\s*$/i;
const TABLE = /^\s*(table\s+(?:of\s+.+?|\d+\s*-\s*.+?|\d+))\s*$/i;
// A phrase preamble ends in a colon; a phrase defined in Inform 6 keeps its
// body on the same line: "To flash the screen: (- FlashScreen(); -)."
const PHRASE = /^(to\b.+?)\s*:\s*(?:\(-.*-\)\.?\s*)?$/i;
const RULE =
  /^((?:before|instead of|after|check|carry out|report|every turn|when|at the time when|at \d+:\d+|definition|rule for|this is the|first|last|setting action variables|does the player mean|persuasion rule|unsuccessful attempt by|to decide)\b.+?)\s*:\s*$/i;

function headingLevel(word: string): number {
  return HEADING_LEVELS.indexOf(word.toLowerCase());
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

export function outlineInform7(lines: string[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  // Stack of open headings, outermost first. Each entry knows its level.
  const open: { level: number; node: OutlineNode }[] = [];

  const container = () =>
    open.length > 0 ? open[open.length - 1].node.children : roots;

  const closeHeadingsDownTo = (level: number, endLine: number) => {
    while (open.length > 0 && open[open.length - 1].level >= level) {
      closeAt(open.pop()!.node, lines, endLine);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];

    const heading = HEADING.exec(text);
    if (
      heading &&
      isBlank(lines[i - 1]) &&
      (i === 0 || isBlank(lines[i + 1]))
    ) {
      const level = headingLevel(heading[1]);
      closeHeadingsDownTo(level, i - 1);
      const n = node("heading", text.trim(), i, heading[1]);
      container().push(n);
      open.push({ level, node: n });
      continue;
    }

    const table = TABLE.exec(text);
    if (table) {
      const n = node("table", table[1].trim(), i);
      // A table runs until the next blank line.
      let j = i;
      while (j + 1 < lines.length && !isBlank(lines[j + 1])) {
        j++;
      }
      closeAt(n, lines, j);
      container().push(n);
      continue;
    }

    const phrase = PHRASE.exec(text);
    const rule = phrase ? null : RULE.exec(text);
    const preamble = phrase ?? rule;
    if (preamble && !/^\s/.test(text)) {
      const n = node(phrase ? "phrase" : "rule", preamble[1].trim(), i);
      // The body is the indented block that follows, up to the next blank line
      // followed by an unindented line.
      let j = i;
      while (j + 1 < lines.length) {
        const next = lines[j + 1];
        if (isBlank(next)) {
          if (j + 2 < lines.length && /^\s/.test(lines[j + 2])) {
            j++;
            continue;
          }
          break;
        }
        if (!/^\s/.test(next)) {
          break;
        }
        j++;
      }
      closeAt(n, lines, j);
      container().push(n);
    }
  }

  closeHeadingsDownTo(0, lines.length - 1);
  return roots;
}

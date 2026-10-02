/**
 * A language-neutral outline tree. The pure outline functions produce these
 * from an array of lines; the VS Code providers convert them to
 * DocumentSymbols. Keeping the parsing free of the vscode module means it can
 * be unit-tested with plain Node.
 */
export type OutlineKind =
  | "heading"
  | "table"
  | "phrase"
  | "rule"
  | "routine"
  | "object"
  | "class"
  | "constant"
  | "global"
  | "array"
  | "attribute"
  | "property"
  | "verb"
  | "include";

export interface OutlineNode {
  kind: OutlineKind;
  /** The name shown in the outline. */
  name: string;
  /** Extra text shown dimmed after the name, if any. */
  detail: string;
  /** Zero-based first line of the node, inclusive. */
  line: number;
  /** Zero-based last line of the node, inclusive. */
  endLine: number;
  /** Zero-based line holding the name itself (for the selection range). */
  nameLine: number;
  children: OutlineNode[];
}

export function node(
  kind: OutlineKind,
  name: string,
  line: number,
  detail = "",
): OutlineNode {
  return {
    kind,
    name,
    detail,
    line,
    endLine: line,
    nameLine: line,
    children: [],
  };
}

/** Trim trailing blank lines off a node's range so folded regions end tidily. */
export function closeAt(n: OutlineNode, lines: string[], endLine: number) {
  let end = Math.max(n.line, Math.min(endLine, lines.length - 1));
  while (end > n.line && lines[end].trim() === "") {
    end--;
  }
  n.endLine = end;
}

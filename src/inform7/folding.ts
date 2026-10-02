import * as vscode from "vscode";

/**
 * Folding for Inform 7 source and extensions.
 *
 * Two things fold: headings (Volume, Book, Part, Chapter, Section, each of
 * which encloses everything up to the next heading of the same or a higher
 * level) and indented blocks, which is how Inform 7 writes rule and phrase
 * bodies. A FoldKind is a heading name, or a number giving an indentation
 * depth, and the two orders compose as:
 *
 *   volume < book < part < chapter < section < indent 1 < indent 2 < ...
 */
type FoldKind = string | number;

type OpenRange = {
  kind: FoldKind;
  start: number;
};

const HEADINGS = ["volume", "book", "part", "chapter", "section"];

const HEADING_LINE = new RegExp(
  "^\\s*(" + HEADINGS.join("|") + ")\\b:?\\s+.*$",
  "i",
);

export class Inform7FoldingProvider
  implements vscode.FoldingRangeProvider, vscode.Disposable
{
  private readonly registration: vscode.Disposable;

  constructor() {
    this.registration = vscode.languages.registerFoldingRangeProvider(
      ["inform7", "inform7extension"],
      this,
    );
  }

  dispose() {
    this.registration.dispose();
  }

  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];
    const open: OpenRange[] = [];
    let previousKind: FoldKind | null = null;
    const tabSize = this.tabSize();

    for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
      // A range should not swallow the blank line before the thing that ends it.
      const previousBlank =
        lineNo > 0 && document.lineAt(lineNo - 1).isEmptyOrWhitespace;
      const endLine = previousBlank ? lineNo - 2 : lineNo - 1;

      const kind = this.foldKind(document, lineNo, tabSize);

      if (typeof kind === "string") {
        // A heading closes every open range at its level or deeper, then opens its own.
        this.closeRanges(kind, endLine, open, ranges);
        open.push({ kind, start: lineNo });
      }

      if (typeof kind === "number" && kind !== -1 && previousKind !== kind) {
        // Indentation changed. Close ranges deeper than this level; if we went
        // deeper, the enclosing line (the one that ends with a colon) starts a range.
        this.closeRanges(kind + 1, endLine, open, ranges);

        if (
          typeof previousKind === "number" &&
          kind > previousKind &&
          !document.lineAt(lineNo - 1).isEmptyOrWhitespace
        ) {
          open.push({ kind, start: lineNo - 1 });
        }
      }

      if (kind !== -1) {
        previousKind = kind;
      }
    }

    // End of document: close everything, down to the top of the hierarchy.
    this.closeRanges("volume", document.lineCount - 1, open, ranges);
    return ranges;
  }

  private tabSize(): number {
    const editor = vscode.window.activeTextEditor;
    const size = editor?.options.tabSize;
    return typeof size === "number" ? size : 4;
  }

  /** The heading name for a heading line, the indent depth otherwise, or -1 for a blank line. */
  private foldKind(
    document: vscode.TextDocument,
    lineNo: number,
    tabSize: number,
  ): FoldKind {
    const previous = lineNo > 0 ? document.lineAt(lineNo - 1) : null;
    const current = document.lineAt(lineNo);
    const next =
      lineNo + 1 < document.lineCount ? document.lineAt(lineNo + 1) : null;
    const indent = indentLevel(current.text, tabSize);

    // Inform requires a heading to stand alone: blank line before (except at the
    // very top) and after (except at the very end). Anything else is body text.
    if (previous && !previous.isEmptyOrWhitespace) {
      return indent;
    }
    if (next && !next.isEmptyOrWhitespace) {
      return indent;
    }

    const match = HEADING_LINE.exec(current.text);
    return match ? match[1].toLowerCase() : indent;
  }

  /** Close every open range whose kind is at `level` or deeper. */
  private closeRanges(
    level: FoldKind,
    endLine: number,
    open: OpenRange[],
    ranges: vscode.FoldingRange[],
  ) {
    while (open.length > 0) {
      const range = open[open.length - 1];
      if (compareKinds(level, range.kind) > 0) {
        break;
      }
      if (range.start < endLine) {
        ranges.push(
          new vscode.FoldingRange(
            range.start,
            endLine,
            typeof range.kind === "string"
              ? vscode.FoldingRangeKind.Region
              : undefined,
          ),
        );
      }
      open.pop();
    }
  }
}

/** Indentation of a line in columns, honouring mixed tabs and spaces; -1 if the line is blank. */
function indentLevel(line: string, tabSize: number): number {
  let indent = 0;
  let i = 0;
  for (; i < line.length; i++) {
    const code = line.charCodeAt(i);
    if (code === 32) {
      indent++;
    } else if (code === 9) {
      indent = indent - (indent % tabSize) + tabSize;
    } else {
      break;
    }
  }
  return i === line.length ? -1 : indent;
}

/** Negative when `a` is higher in the hierarchy than `b`, zero when equal, positive when deeper. */
function compareKinds(a: FoldKind, b: FoldKind): number {
  if (typeof a === "string" && typeof b === "string") {
    return HEADINGS.indexOf(a) - HEADINGS.indexOf(b);
  }
  if (typeof a === "string") {
    return -1;
  }
  if (typeof b === "string") {
    return 1;
  }
  return a - b;
}

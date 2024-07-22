import * as vscode from "vscode";

// Strings indicate headings while number indicates rule indentation.
type FoldKind = string | number;

type CurrentRange = {
  kind: FoldKind;
  start: number;
};

const i7_headings = ["volume", "book", "part", "chapter", "section"];

const headingMatcher = new RegExp(
  "^\\s*(" + i7_headings.join("|") + ")\\s+.*$",
  "i",
);

export class I7Folding
  implements vscode.FoldingRangeProvider, vscode.Disposable
{
  registeredDisposable: vscode.Disposable;

  constructor() {
    this.registeredDisposable = vscode.languages.registerFoldingRangeProvider(
      ["inform7", "inform7extension"],
      this,
    );
  }

  dispose() {
    this.registeredDisposable.dispose();
  }

  provideFoldingRanges(
    document: vscode.TextDocument,
    context: vscode.FoldingContext,
    token: vscode.CancellationToken,
  ): vscode.FoldingRange[] {
    const ranges: vscode.FoldingRange[] = [];

    // This has to keep track of the ranges that are current, which
    // apply to headings and rule indentation.
    const currentRanges: CurrentRange[] = [];

    // Nothing starts out as folded.
    let previousFoldKind: FoldKind | null = null;

    // This is needed to maintain consistent indentation when there
    // are multiple identations within a given range.
    const tabSize = this.getTabSize();

    for (let lineNo = 0; lineNo < document.lineCount; lineNo++) {
      // If the last line of the range is blank, that line should not
      // be included in the range.
      const isPreviousLineEmpty =
        lineNo > 0 && document.lineAt(lineNo - 1).isEmptyOrWhitespace;

      const endLine = isPreviousLineEmpty ? lineNo - 2 : lineNo - 1;

      const foldKind = this.getFoldKind(document, lineNo, tabSize);

      if (typeof foldKind === "string") {
        // A fold kind of string means a heading. This logic ends all
        // of the started ranges, including headings or indentations,
        // at the current level or below the current level. Then the
        // next range is tarted.

        this.endCurrentRanges(foldKind, endLine, currentRanges, ranges);

        currentRanges.push({
          kind: foldKind,
          start: lineNo,
        });
      }

      if (
        typeof foldKind === "number" &&
        foldKind !== -1 &&
        previousFoldKind !== foldKind
      ) {
        // It's necessary to handle the case where there is an identation
        // of a different level (although not a blank line) and end all of
        // the currently started ranges that are deeper than the current
        // indentation. If the indentation has increased, then it becomes
        // necessary to start the next range at the previous line, but only
        // if that line is not blank.

        this.endCurrentRanges(foldKind + 1, endLine, currentRanges, ranges);

        if (
          typeof previousFoldKind === "number" &&
          foldKind > previousFoldKind &&
          !document.lineAt(lineNo - 1).isEmptyOrWhitespace
        ) {
          currentRanges.push({
            kind: foldKind,
            start: lineNo - 1,
          });
        }
      }

      // If the line dealt with was not a blank line, then update the
      // previous fold kind.

      if (foldKind !== -1) {
        previousFoldKind = foldKind;
      }
    }

    // By this point, the logic has reached the end of the text, so it is
    // necessary to end all remaining ranges. This will include the last
    // line of the source text, even if it is blank. Note that this starts
    // at "volume", which is the highest level in Inform 7's hierarchy.

    this.endCurrentRanges(
      "volume",
      document.lineCount - 1,
      currentRanges,
      ranges,
    );

    return ranges;
  }

  getTabSize(): number {
    const editor = vscode.window.activeTextEditor;
    return (editor?.options.tabSize as number) ?? 4;
  }

  getFoldKind(
    document: vscode.TextDocument,
    lineNo: number,
    tabSize: number,
  ): FoldKind {
    const previousLine = lineNo > 0 ? document.lineAt(lineNo - 1) : null;
    const currentLine = document.lineAt(lineNo);
    const nextLine =
      lineNo + 1 < document.lineCount ? document.lineAt(lineNo + 1) : null;

    const indentation = computeIndentLevel(currentLine.text, tabSize);

    // The next two if conditions are in place because a heading must
    // be preceded by a blank line, except on the first line of the
    // source text, which is the title heading. A heading must also
    // be followed by a blank line, except if the heading occurs on
    // the last line of the source text.

    if (previousLine && !previousLine.isEmptyOrWhitespace) {
      return indentation;
    }

    if (nextLine && !nextLine.isEmptyOrWhitespace) {
      return indentation;
    }

    // The heading must be matched against one of the valid Inform 7
    // identifiers that indicate a heading.

    const results = headingMatcher.exec(currentLine.text);

    // The method returns the range level of the current line or returns
    // a value of -1 if the current line is blank.

    if (results) {
      return results[1].toLowerCase();
    }

    return indentation;
  }

  endCurrentRanges(
    level: FoldKind,
    endLine: number,
    currentRange: CurrentRange[],
    ranges: vscode.FoldingRange[],
  ) {
    // The goal of this method is end all of the ranges that are now
    // current, which means ranges of the same level of lower.

    if (currentRange.length === 0) {
      return;
    }

    let range = currentRange[currentRange.length - 1];

    // This loop essentially works up through the current range, which
    // contains all of the indentations that are relevant. The loop
    // continues until the desired level is found.

    while (
      range !== null &&
      range !== undefined &&
      compareFoldKinds(level, range.kind) <= 0
    ) {
      if (range.start < endLine) {
        ranges.push(
          new vscode.FoldingRange(
            range.start,
            endLine,
            isRegion(range.kind) ? vscode.FoldingRangeKind.Region : undefined,
          ),
        );
      }

      currentRange.pop();
      range = currentRange[currentRange.length - 1];
    }
  }
}

/*
This function computes thje indentation level and accounts for mixed tabs
and spaces. The function will return a value of -1 if the given line is
empty (meaning, consists only of whitespace). Any other value returned
will indicate the indentation level.
*/
function computeIndentLevel(line: string, tabSize: number): number {
  let indent = 0;
  let i = 0;
  const len = line.length;

  while (i < len) {
    const chCode = line.charCodeAt(i);

    if (chCode === 32) {
      indent++;
    } else if (chCode === 9) {
      indent = indent - (indent % tabSize) + tabSize;
    } else {
      break;
    }
    i++;
  }

  if (i === len) {
    return -1;
  }

  return indent;
}

/*
A FoldKind in the context of this extension refer to either strings,
which correspond to headings, or a numberic value, which indicates an
indentation due to a rule. The pattern here is:

volume < book < part < chapter < section < indent 1 < indent 2 < ...
*/
function compareFoldKinds(a: FoldKind, b: FoldKind): number {
  if (typeof a === "string") {
    if (typeof b === "string") {
      return i7_headings.indexOf(a) - i7_headings.indexOf(b);
    } else {
      // Condition: a (heading) < b (indent)
      return -1;
    }
  } else {
    if (typeof b === "string") {
      // Condition: a (indent) > b (heading)
      return 1;
    } else {
      return a - b;
    }
  }
}

/*
This function determines if a provided range should be marked as a
FoldingRangeKind.Region in VS Code.
*/
function isRegion(level: FoldKind) {
  return typeof level === "string";
}

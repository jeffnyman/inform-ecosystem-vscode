/**
 * Parsers for compiler output. Pure functions, so they can be tested with
 * captured output and no VS Code instance.
 */

export type Severity = "error" | "warning";

export interface Problem {
  message: string;
  severity: Severity;
  /** File as the compiler named it: for Inform 7 a leafname such as story.ni; for Inform 6 the path it was given. */
  file?: string;
  /** One-based line number, if the compiler gave one. */
  line?: number;
}

/**
 * Inform 7 writes each problem to the console as a block starting with
 * "  >--> " and continuing on lines indented by four spaces. A location, when
 * there is one, appears inline as "(source text, line 8)" or as
 * "('Extension Name' by Author, line 12)". Problems.html, written alongside,
 * carries exact "source:story.ni#line8" links; when supplied they are paired
 * with the console problems in order and take precedence.
 */
export function parseInform7Output(
  output: string,
  problemsHtml?: string,
): Problem[] {
  const problems: Problem[] = [];
  let current: string[] | null = null;

  const flush = () => {
    if (current) {
      problems.push(fromInform7Block(current.join(" ")));
      current = null;
    }
  };

  for (const raw of output.split(/\r?\n/)) {
    const start = /^\s*>-->\s?(.*)$/.exec(raw);
    if (start) {
      flush();
      current = [start[1].trim()];
    } else if (current && /^\s{2,}\S/.test(raw)) {
      current.push(raw.trim());
    } else {
      flush();
    }
  }
  flush();

  if (problemsHtml) {
    const links = [
      ...problemsHtml.matchAll(/href="source:([^"#]+)#line(\d+)"/g),
    ].map((m) => ({ file: m[1], line: Number(m[2]) }));
    // One link per problem, in order. If the counts disagree, keep what the
    // console text itself told us.
    if (links.length === problems.length) {
      problems.forEach((p, i) => {
        p.file = links[i].file;
        p.line = links[i].line;
      });
    }
  }
  return problems;
}

function fromInform7Block(text: string): Problem {
  const message = text.replace(/\s+/g, " ").trim();
  const problem: Problem = { message, severity: "error" };
  const source = /\(source text, line (\d+)\)/.exec(message);
  if (source) {
    problem.file = "story.ni";
    problem.line = Number(source[1]);
    return problem;
  }
  const extension = /\('([^']+)' by ([^,]+), line (\d+)\)/.exec(message);
  if (extension) {
    problem.file = `${extension[1]}.i7x`;
    problem.line = Number(extension[3]);
  }
  return problem;
}

/** Did the Inform 7 run succeed? The compiler says so explicitly. */
export function inform7Succeeded(output: string): boolean {
  return /\+\+ Ended: Translation succeeded/.test(output);
}

/**
 * Inform 6, in its default and -E1 message styles, reports
 *   file(line): Error:  message
 *   file(line): Fatal error:  message
 *   file(line): Warning:  message
 * each optionally followed by a "> context" line.
 */
export function parseInform6Output(output: string): Problem[] {
  const problems: Problem[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const m = /^(.*?)\((\d+)\):\s+(Error|Fatal error|Warning):\s*(.*)$/.exec(
      raw,
    );
    if (m) {
      problems.push({
        file: m[1],
        line: Number(m[2]),
        severity: m[3] === "Warning" ? "warning" : "error",
        message: m[4].trim(),
      });
      continue;
    }
    // A fatal error with no location, e.g. a missing source file.
    const fatal = /^(?:<[^>]*>\(\d+\): )?Fatal error:\s*(.*)$/.exec(raw);
    if (fatal) {
      problems.push({ severity: "error", message: fatal[1].trim() });
    }
  }
  return problems;
}

/** Inform 6's closing line reports the counts. */
export function inform6Succeeded(output: string, exitCode: number): boolean {
  if (exitCode !== 0) {
    return false;
  }
  return (
    !/Compiled with \d+ errors?/.test(output) && !/Fatal error/.test(output)
  );
}

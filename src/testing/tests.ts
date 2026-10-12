/** A "Test me with ..." sentence, at the start of a line. */
const TEST_SENTENCE = /^[ \t]*Test[ \t]+(.+?)[ \t]+with[ \t]+"/gim;

/** The tests a source text defines: their names, and the line of each. */
export function findTests(source: string): { name: string; line: number }[] {
  const tests: { name: string; line: number }[] = [];
  for (const m of source.matchAll(TEST_SENTENCE)) {
    const line = source.slice(0, m.index).split("\n").length - 1;
    tests.push({ name: m[1].trim(), line });
  }
  return tests;
}

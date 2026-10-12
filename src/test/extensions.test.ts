import * as assert from "assert";
import { describe, it } from "mocha";

import {
  CatalogEntry,
  compareVersions,
  identity,
  parseCatalog,
  parseHeader,
  resolvePlan,
  satisfies,
} from "../extensions/catalog";
import { censusPage } from "../extensions/docs";

const SHA = "a".repeat(64);

function entry(
  title: string,
  author: string,
  version: string | undefined,
  includes: {
    title: string;
    author: string;
    min?: string;
    max?: string;
  }[] = [],
): CatalogEntry {
  return {
    id: `${title}-${version}`,
    title,
    author,
    version,
    url: `https://example.org/${title}.i7x`,
    filename: `${title}.i7x`,
    bytes: 1,
    sha256: SHA,
    dependencies: includes.map((d) => ({
      title: d.title,
      author: d.author,
      kind: "include",
      minVersion: d.min,
      maxVersionExclusive: d.max,
      requestedVersion: d.min,
    })),
    warnings: [],
  };
}

describe("Extension catalog", function () {
  it("reads entries, downloads and dependencies from the catalog XML", () => {
    const xml = `<?xml version='1.0' encoding='utf-8'?>
<catalog xmlns="urn:inform7:extension-catalog:1" schema-version="1">
  <extension id="ext-1" title="Commonly Unimplemented" author="Aaron Reed" path="Aaron Reed/Commonly Unimplemented-v2.i7x" version="2">
    <download url="https://raw.example/Commonly%20Unimplemented-v2.i7x" filename="Commonly Unimplemented-v2.i7x" bytes="9572" sha256="${SHA}" />
    <dependencies>
      <dependency title="Smarter Parser" author="Aaron Reed" kind="include" line="9" requested-version="16" min-version="16.0.0" max-version-exclusive="17.0.0" status="internal" targets="ext-2" />
    </dependencies>
    <warning line="3">Odd &amp; old.</warning>
  </extension>
  <extension id="ext-2" title="Dynamic Rooms" author="Aaron Reed" path="Aaron Reed/Dynamic Rooms-v3.i7x" version="3">
    <download url="https://raw.example/Dynamic%20Rooms-v3.i7x" filename="Dynamic Rooms-v3.i7x" bytes="18853" sha256="${SHA}" />
    <dependencies />
  </extension>
</catalog>`;
    const [first, second] = parseCatalog(xml);
    assert.strictEqual(first.title, "Commonly Unimplemented");
    assert.strictEqual(first.bytes, 9572);
    assert.deepStrictEqual(first.dependencies[0], {
      title: "Smarter Parser",
      author: "Aaron Reed",
      kind: "include",
      requestedVersion: "16",
      minVersion: "16.0.0",
      maxVersionExclusive: "17.0.0",
    });
    assert.deepStrictEqual(first.warnings, ["Odd & old."]);
    assert.deepStrictEqual(second.dependencies, []);
    assert.throws(() => parseCatalog("<catalog/>"), /Unsupported/);
  });

  it("compares Inform versions", () => {
    assert.ok(compareVersions("7.1", "7") > 0);
    assert.strictEqual(compareVersions("2", "2.0.0"), 0);
    assert.ok(compareVersions("6/160501", "6/150101") > 0);
    const dep = {
      title: "T",
      author: "A",
      kind: "include",
      minVersion: "16.0.0",
      maxVersionExclusive: "17.0.0",
    };
    assert.ok(satisfies("16.2", dep));
    assert.ok(!satisfies("17", dep));
    assert.ok(!satisfies(undefined, dep));
    assert.ok(
      satisfies(undefined, { title: "T", author: "A", kind: "include" }),
    );
  });

  it("matches names as Inform does", () => {
    assert.strictEqual(
      identity("the Standard Rules", "Graham Nelson"),
      identity("Standard  Rules", "graham nelson"),
    );
  });

  it("reads an extension's header line", () => {
    assert.deepStrictEqual(
      parseHeader(
        "﻿\nVersion 4 of Glulx Image Centering (for Glulx only) by Emily Short begins here.\n",
      ),
      { title: "Glulx Image Centering", author: "Emily Short", version: "4" },
    );
    assert.deepStrictEqual(
      parseHeader("Locksmith by Emily Short begins here."),
      {
        title: "Locksmith",
        author: "Emily Short",
        version: undefined,
      },
    );
    assert.strictEqual(parseHeader("Not an extension."), undefined);
  });

  it("finds the census page an Index link names, in either form", () => {
    assert.strictEqual(
      censusPage("Extensions/Graham%20Nelson/English%20Language.html"),
      "Extensions/Graham Nelson/English Language.html",
    );
    assert.strictEqual(
      censusPage("Documentation/Graham%20Nelson/English%20Language.html"),
      "Extensions/Graham Nelson/English Language.html",
    );
  });

  it("plans what an install needs", () => {
    const smarter16 = entry("Smarter Parser", "Aaron Reed", "16");
    const smarter17 = entry("Smarter Parser", "Aaron Reed", "17");
    const commonly = entry("Commonly Unimplemented", "Aaron Reed", "2", [
      {
        title: "Smarter Parser",
        author: "Aaron Reed",
        min: "16.0.0",
        max: "17.0.0",
      },
      { title: "Basic Screen Effects", author: "Emily Short" },
      { title: "Nowhere", author: "Nobody" },
    ]);
    const catalog = [smarter17, smarter16, commonly];
    const present = new Map([
      [
        identity("Basic Screen Effects", "Emily Short"),
        { title: "Basic Screen Effects", author: "Emily Short", version: "8" },
      ],
    ]);
    const plan = resolvePlan(commonly, catalog, present);
    // The version requested (16), not the newest (17).
    assert.deepStrictEqual(plan.install, [commonly, smarter16]);
    assert.deepStrictEqual(
      plan.present.map((p) => p.title),
      ["Basic Screen Effects"],
    );
    assert.deepStrictEqual(plan.missing, ["Nowhere by Nobody"]);
    assert.deepStrictEqual(plan.conflicts, []);

    // An installed version that does not meet the requirement is a conflict.
    present.set(identity("Smarter Parser", "Aaron Reed"), {
      title: "Smarter Parser",
      author: "Aaron Reed",
      version: "15",
    });
    assert.match(
      resolvePlan(commonly, catalog, present).conflicts[0],
      /needs Smarter Parser by Aaron Reed \(version 16\.0\.0\), but version 15 is already installed/,
    );
  });
});

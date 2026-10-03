# Inform Ecosystem

_Language and tool support for the Inform ecosystem in Visual Studio Code._

![Inform Ecosystem](inform.png)

Inform is a family of tools for writing interactive fiction, and this extension
aims to support all of it from one place:

| Language | File extensions | What you get |
|---|---|---|
| Inform 7 source | `.ni`, `.i7` | Syntax highlighting; folding by heading and by rule indentation; an outline of headings, rules, phrases and tables; snippets |
| Inform 7 extensions | `.i7x` | As above, plus rubric, credits and documentation sections |
| Inform 6 | `.inf`, `.i6`, `.h`, `.i6h` | Syntax highlighting including library functions, actions, attributes and opcodes; an outline of objects, classes, routines, constants and verbs; snippets |
| Inform 6 templates | `.i6t` | Highlighting for the literate template files used by Inform 7 |
| Preform | `.preform` | Highlighting for Inform's grammar-definition syntax |
| Intest | `.intest` | Highlighting for Delia test recipes |
| Inweb | `.w`, `.inweb` | Highlighting for literate-programming webs |

Inform 6 code included in Inform 7 source between `(-` and `-)` is colored as
Inform 6, with `(+ ... +)` references back to Inform 7 marked. A `[preform]`
comment before `(-` colors the block as Preform instead. Texts used with
Vorple's `execute JavaScript command`, or preceded by `[js]`, are colored as
JavaScript.

The `.i6` and `.i6h` extensions are not official. Inform 6 traditionally used
`.inf` and `.h`, which collide with other languages, so the `i6` variants are
offered as an unambiguous alternative.

## How it works

Highlighting uses [TextMate grammars](https://macromates.com/manual/en/language_grammars)
in JSON, with [Oniguruma regular expressions](https://macromates.com/manual/en/regular_expressions).
VS Code tokenises each file with the grammar as you type. Folding for Inform 7
is a small folding-range provider, since headings and indentation are
structural in Inform 7 and a grammar alone cannot express that.

The outline (the Outline view, breadcrumbs, and "Go to Symbol in Editor") comes
from a line-based scan that relies on Inform's own conventions: headings stand
alone between blank lines, Inform 7 rule and phrase preambles start at the left
margin and end with a colon, and Inform 6 declarations start at the left margin
with their bodies indented.

Snippets: type a prefix such as `room`, `instead`, `action`, `table` or `to`
in an Inform 7 file, or `object`, `routine`, `verb`, `objectloop` or `story` in
an Inform 6 file, and accept the suggestion.

## Compiling from VS Code

With an Inform 7 file open, the run button in the editor title bar compiles the
enclosing `.inform` project the way the Inform IDE does: `inform7`, then
`inform6`, and for a release also `inblorb`. Errors appear in the Problems
panel, linked to the source line, and the full compiler output is in the
"Inform" output channel. The commands are also in the palette under
"Inform:" and in the Explorer context menu of a project folder.

| Command | What it does |
|---|---|
| Inform: Compile Project (debug build) | `inform7` then `inform6` with debugging on; output in the project's `Build` folder |
| Inform: Release Project | Release build; bound into a Blorb if the project's settings ask for one and `Release.blurb` exists |
| Inform: Play Compiled Story | Opens the newest story file in `Build` in the player tab |
| Inform: Play Compiled Story in External Interpreter | Opens it with your system's associated application instead |
| Inform: Compile Inform 6 File | Compiles a stand-alone `.inf` with `inform6`, to Glulx by default |
| Inform: Show Compiler Locations | Prints which compilers and Internal folder will be used |

The project's own settings are honoured where they exist: the story format
(Glulx or Z-machine), whether to create a Blorb, and the predictable-random
option come from `Settings.plist` written by the IDE. Projects without one
compile to Glulx unless `informEcosystem.inform7.defaultFormat` says otherwise.
A bare project folder with only `Source/story.ni` works; the `uuid.txt` that
`inform7` requires is created for you.

### Where the compilers come from

The extension does not bundle compilers. It looks, in order, at the
`informEcosystem.compilersPath` setting, the `INFORM_COMPILERS` environment
variable, a `Windows-Inform7\Build\Compilers` folder near the workspace (the
layout produced by the companion inform-builder project), an installed Inform IDE
(`Program Files\Inform\Compilers` on Windows, `Inform.app` on macOS), and the
PATH. The `Internal` folder is taken from `informEcosystem.internalPath` or
found beside the compilers.

## Playing stories in VS Code

Story files open in a player tab: `.ulx` and `.gblorb` (Glulx), and `.z3`,
`.z4`, `.z5`, `.z8` and `.zblorb` (Z-machine). After a successful compile the
story opens beside your source by default (`informEcosystem.openStoryAfterCompile`),
and when the file changes on disk, for example after the next compile, the
player restarts it. A Restart button sits in the corner of the tab. Saves and
autosaves are kept in the editor's storage, per story.

The interpreter is [Parchment](https://github.com/curiousdannii/parchment), in
the same "for Inform 7" bundle that Inform's own *Release along with an
interpreter* ships, so what you see in VS Code is what players will see on the
web: Glulxe for Glulx and Bocfel for the Z-machine, both compiled to
WebAssembly. Version 6 Z-machine files are the one format it does not play.
The bundle is fetched at build time (`npm run fetch-parchment`) and is not
part of this repository; see `THIRD_PARTY_NOTICES.md` for its licences.

## Status

Highlighting, folding, outline, snippets, compiling and playing are in place.
See the [CHANGELOG](CHANGELOG.md).

## Acknowledgements

Parts of the grammars were informed by Natrium729's Inform 6 and Inform 7
extensions; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licence

MIT; see [LICENSE](LICENSE).

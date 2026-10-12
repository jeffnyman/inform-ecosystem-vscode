# Changelog

All notable changes to the Inform Ecosystem extension are recorded here,
following the [Keep a Changelog](http://keepachangelog.com/) conventions.

## [Unreleased]

Nothing yet.

## [0.2.0] - 2026-10-12

Everything needed to work on an Inform 7 story without the Inform IDE:
compilers, new projects, the documentation, the Index, extensions and tests.
Much of it follows the Informant extension, whose compiler packages and
extension catalog it uses.

### Added

- **Download Compilers.** "Inform: Download Compilers" fetches a complete
  Inform 10.1.2 toolchain for Windows, Linux or macOS (the Informant toolchain
  packages), checks its SHA-256 and unpacks it into the extension's storage,
  touching no other Inform installation. When no compilers are found, the
  error offers the download. Downloaded compilers are used after any
  configured or nearby inform-builder ones and before an installed IDE.
- **New Project.** "Inform: New Project..." asks for a title, an author
  (remembered for next time) and a folder, and creates `Title.inform` with a
  `Source/story.ni` that compiles straight away. Characters a file system
  would refuse are left out of the folder name but kept in the title.
- **Documentation.** "Inform: Open Documentation" shows Writing with Inform
  and The Inform Recipe Book beside the source, from the copy that comes with
  the compilers: the downloaded compilers' or the Windows IDE's (or
  `informEcosystem.documentationPath`). Links stay in the panel, with Back,
  Forward and Go to... in its title bar; an example's paste button inserts
  its code into the source, and in the IDE's documentation an example's "new
  project" button starts New Project from it.
- **Index.** "Inform: Open Index" shows the project's Index beside the
  source, reloading after each compile. Paste buttons paste into the source,
  source links open the source at the line, and documentation links open the
  documentation at that section.
- **Extensions.** "Inform: Install Extension..." installs from the Inform
  10.1 community library catalog (Informant's), with the extensions each one
  includes, every file checked against the catalog's size and SHA-256. They go
  either to all projects (`Documents/Inform/Extensions`) or to the current one
  (`Story.materials/Extensions`), the
  `informEcosystem.extensions.installLocation` setting picking the default.
  "Inform: Manage Installed Extensions..." reads their documentation, opens,
  reveals, upgrades to a newer catalog version, or removes them; only
  unchanged catalog copies are ever replaced or removed.
- **Extension documentation.** "Inform: Open Extension Documentation", the
  Index's extension links, and Manage Installed Extensions show the
  documentation of built-in, shared and project extensions, written by
  Inform when wanted into the extension's storage, never your Inform folder.
- **Testing.** Each `Test me with "..."` sentence in `story.ni` is a test in
  VS Code's Testing view. A test build (debug, predictable random outcomes)
  is run with no window by the Glulxe and Bocfel interpreters, so Glulx and
  Z-machine stories can both be tested, and its output compared with expected
  output kept in `Story.materials/Tests/`: recorded on a test's first run,
  shown as a diff when it differs, updated with "Accept Test Output".
- **Recording tests.** In the player, **Record** restarts the story and
  **Stop** adds the commands typed to `story.ni` as a
  `Test <name> with "..."` sentence.

### Changed

- The documentation and the Index follow the colour theme: the Index with
  the dark design Inform gives it, the documentation inverted in a dark theme,
  keeping its hues and pictures (`informEcosystem.documentation.colorTheme`:
  `light` keeps it black on white).
- On Windows, an Inform IDE installed outside Program Files is found through
  the uninstall entry its installer writes.
- The extension starts in any workspace that contains an Inform project, so
  its tests appear in the Testing view without first opening the source.

### Fixed

- On Linux, the first compile for a user with no `~/Inform` folder failed
  with two problems in the built-in Skeleton Keys extension. Compiles now pass
  `-no-census-update`, which also stops inform7 writing extension
  documentation into the home folder.
- The player's corner buttons now appear; Restart had never shown, as its
  script ran before the page had a body to add it to.

## [0.1.0] - 2026-10-03

First release on the Visual Studio Marketplace. A fresh start, consolidating the earlier Quendor and Inform Ecosystem prototypes.

- Syntax highlighting for Inform 7 source and extensions, Inform 6 source and
  `.i6t` templates, Preform, Intest recipes and Inweb webs.
- Inform 6 inclusions inside Inform 7 are colored as Inform 6, with `(+ +)`
  references back to Inform 7 marked; `[preform](- -)` blocks as Preform;
  Vorple JavaScript texts as JavaScript.
- Folding for Inform 7 by heading level and by rule indentation.
- Outline / Go to Symbol for Inform 7 (headings, rules, phrases, tables) and
  Inform 6 (objects, classes, routines, constants, globals, arrays, attributes,
  properties, verb grammar, includes).
- Snippets for Inform 7 and Inform 6.
- Compile and release Inform 7 projects (inform7, inform6, inblorb) and
  stand-alone Inform 6 files from the editor, with problems reported in the
  Problems panel. Compilers are located automatically or via settings; the
  project's Settings.plist is honored. "Inform: Choose Compilers Folder..."
  picks the folder with a dialog, since the Settings editor has no browse button.
- Play Z-machine and Glulx story files in an editor tab, using the Parchment
  for Inform 7 bundle (Bocfel and Glulxe as WebAssembly). Stories open beside
  the source after compiling and restart when recompiled.

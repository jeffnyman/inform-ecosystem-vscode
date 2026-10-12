# Changelog

All notable changes to the Inform Ecosystem extension are recorded here,
following the [Keep a Changelog](http://keepachangelog.com/) conventions.

## [Unreleased]

- "Inform: New Project..." asks for a title, an author (remembered for next
  time) and a folder, creates `Title.inform` with `Source/story.ni` and
  `uuid.txt`, and opens the story. Characters a file system would refuse are
  left out of the folder name but kept in the story's title.
- "Inform: Download Compilers" fetches a complete Inform 10.1.2 toolchain
  (the Informant toolchain packages for Windows, Linux and macOS), verifies
  its SHA-256 and unpacks it into the extension's storage. Downloaded
  compilers are found after any configured or nearby inform-builder ones and
  before an installed IDE or the PATH. When no compilers are found, the error
  now offers the download.
- Inform 7 compiles pass `-no-census-update`. On Linux, the first compile
  for a user with no `~/Inform` folder otherwise failed with two problems in
  the built-in Skeleton Keys extension, and inform7 no longer writes
  extension documentation into the home folder.

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

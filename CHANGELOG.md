# Changelog

All notable changes to the Inform Ecosystem extension are recorded here,
following the [Keep a Changelog](http://keepachangelog.com/) conventions.

## [Unreleased]

Fresh start, consolidating the earlier Quendor and Inform Ecosystem prototypes.

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

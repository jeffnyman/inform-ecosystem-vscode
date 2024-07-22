# Inform Ecosystem for VS Code

This extension is designed to provide support for languages in the Inform ecosystem.

## Features

The extension adds syntax highlighting to Inform 7 source text (in `.ni` or `.i7` files) as well as Inform 7 extensions (in `.i7x` files).

The extension also adds syntax highlighting to Inform 6 source code (in `.inf` or `.i6` files) as well as header files (`.h` or `.i6h`). Note that `.i6` and `.i6h` are not official extensions but the Inform systems prior to version 7 used extensions that were broadly used for other languages or used for operating system files. So the "i6" variants are a way to allow for not having to change standard file extensions.

## Implementation

This project is a Visual Studio code extension. For language extensions, the standard [TextMate grammar](https://macromates.com/manual/en/language_grammars) style is adopted. These grammars rely on what are referred to as [Oniguruma regular expressions](https://macromates.com/manual/en/regular_expressions). These are written in JSON format. I used a moderately helpful resource on [writing a TextMate grammar](https://www.apeth.com/nonblog/stories/textmatebundle.html).

How all of this works is that Visual Studio Code uses the provided TextMate grammars as the tokenization mechanic. Those TextMate grammars work in the context of a single source file and break up the contents of that file based on lexical rules expressed in the regular expressions. The tokenization runs along with the renderer process which means that tokens are updated as source code is typed.

## Aspirations

The initial goal is to provide syntax highlighting. Semantic highlighting is something I will be looking at in the future.

Currently Inform 7 is supported. The goal is to also support Inform 6 as well as other tools within the Inform ecosystem, such as Inweb and Intest.

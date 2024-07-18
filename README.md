# Inform Ecosystem for VS Code

This extension is designed to provide support for languages in the Inform ecosystem.

## Implementation

This project is a Visual Studio code extension. For language extensions, the standard [TextMate grammar](https://macromates.com/manual/en/language_grammars) style is adopted. These grammars rely on what are referred to as [Oniguruma regular expressions](https://macromates.com/manual/en/regular_expressions). These are written in JSON format. I used a moderately helpful resource on [writing a TextMate grammar](https://www.apeth.com/nonblog/stories/textmatebundle.html).

How all of this works is that Visual Studio Code uses the provided TextMate grammars as the tokenization mechanic. Those TextMate grammars work in the context of a single source file and break up the contents of that file based on lexical rules expressed in the regular expressions. The tokenization runs along with the renderer process which means that tokens are updated as source code is typed.

## Aspirations

The initial goal is to provide syntax highlighting. Semantic highlighting is something I will be looking at in the future.

# Third-party notices

Inform Ecosystem is released under the MIT License (see `LICENSE`). It builds on the
work of others, acknowledged here.

## Grammar rules derived from Natrium729's VS Code extensions

Parts of the TextMate grammars in `syntaxes/` were ported from, or informed
by, the following extensions by Nathanaël Marion (Natrium729), both released
under the MIT License:

- Inform 6 extension for VS Code: https://gitlab.com/Natrium729/vscode-inform6
- Inform 7 extension for VS Code: https://gitlab.com/Natrium729/vscode-inform7

In particular: the Inform 6 library function, constant, variable, action,
attribute and opcode lists; the `.i6t` template grammar and its `{inclusion}`
injection; the Preform grammar; and the Vorple JavaScript sub-grammars. Scope
naming, rule structure, object and directive handling, action statements and
the Inform 7 `Include` rule are this project's own.

```
MIT License

Copyright (c) 2019-present Nathanaël Marion

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Parchment interpreter bundle (not committed; fetched at build time)

`webview/parchment/` holds the "Parchment for Inform 7" release by Dannii
Willis, downloaded unmodified by `scripts/fetch-parchment.mjs` from
https://github.com/curiousdannii/parchment/releases and included in the
packaged extension. It contains:

| Component | Author | Licence |
|---|---|---|
| Parchment (`parchment.js`, `parchment.css`, `ie.js`) | Dannii Willis | MIT |
| AsyncGlk and GlkOte (within `parchment.js`) | Dannii Willis; Andrew Plotkin | MIT |
| Emglken (WebAssembly build glue) | Dannii Willis | MIT |
| Bocfel Z-machine interpreter (`bocfel-noz6.js`) | Chris Spiegel | MIT |
| Glulxe Glulx interpreter (`glulxe.js`) | Andrew Plotkin | MIT |
| jQuery (`jquery.min.js`) | OpenJS Foundation | MIT |

The player shell around it (`webview/player.js`, `webview/player.css`,
`src/player/`) is this project's own code.

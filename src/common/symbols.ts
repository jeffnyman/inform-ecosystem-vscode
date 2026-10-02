import * as vscode from "vscode";
import { OutlineKind, OutlineNode } from "./outline";

const KINDS: Record<OutlineKind, vscode.SymbolKind> = {
  heading: vscode.SymbolKind.Namespace,
  table: vscode.SymbolKind.Struct,
  phrase: vscode.SymbolKind.Function,
  rule: vscode.SymbolKind.Event,
  routine: vscode.SymbolKind.Function,
  object: vscode.SymbolKind.Object,
  class: vscode.SymbolKind.Class,
  constant: vscode.SymbolKind.Constant,
  global: vscode.SymbolKind.Variable,
  array: vscode.SymbolKind.Array,
  attribute: vscode.SymbolKind.Boolean,
  property: vscode.SymbolKind.Property,
  verb: vscode.SymbolKind.Interface,
  include: vscode.SymbolKind.Module,
};

export function toDocumentSymbols(
  document: vscode.TextDocument,
  nodes: OutlineNode[],
): vscode.DocumentSymbol[] {
  return nodes.map((n) => {
    const fullRange = new vscode.Range(
      n.line,
      0,
      n.endLine,
      document.lineAt(n.endLine).text.length,
    );
    const nameRange = document.lineAt(n.nameLine).range;
    const symbol = new vscode.DocumentSymbol(
      n.name,
      n.detail,
      KINDS[n.kind],
      fullRange,
      nameRange,
    );
    symbol.children = toDocumentSymbols(document, n.children);
    return symbol;
  });
}

/** Register a DocumentSymbolProvider backed by a pure outline function. */
export function registerOutline(
  languages: string[],
  outline: (lines: string[]) => OutlineNode[],
): vscode.Disposable {
  return vscode.languages.registerDocumentSymbolProvider(languages, {
    provideDocumentSymbols(document) {
      const lines = document.getText().split(/\r?\n/);
      return toDocumentSymbols(document, outline(lines));
    },
  });
}

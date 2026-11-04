# XQLibur

Language tools for Cortex XQL in VS Code: highlighting, completion, hovers,
argument hints and conservative diagnostics, also inside `xql: |` blocks in YAML.
Everything runs locally. XQLibur never executes queries or sends your text anywhere.

XQLibur is an independent project and is not affiliated with or endorsed by
Palo Alto Networks. Cortex and XQL are used only to identify the supported language.

> **Preview.** XQLibur checks what public documentation supports and stays quiet
> where evidence is incomplete. A clean Problems panel does not prove that a query
> will run in Cortex.

## Features

- **Highlighting** for stages, functions, operators, strings, comments and
  dataset sources, with semantic roles for fields, declarations and aliases.
- **Completion** for stages, functions and query-local fields, filtered by
  context (for example, aggregates only where a stage accepts them).
- **Hovers** with short summaries and links to the official documentation for
  all 142 catalogued functions.
- **Argument hints** that follow nested calls, optional and repeated arguments.
- **Diagnostics** for structural problems, argument counts on 130 reviewed
  functions and fields removed by earlier stages. Unknown names are warnings,
  never errors.
- **YAML support:** completion, hovers, argument hints and diagnostics inside
  plain `xql: |` literal blocks (including `|-` and `|+`), plus lexical XQL
  highlighting inside them. The rest of the YAML file keeps its normal language
  support.
- Works in untitled documents, Restricted Mode and virtual workspaces.

## Getting started

1. Install **XQLibur** from the Extensions view.
2. Open a `.xql` file, or pick **Cortex XQL** from the language-mode menu in the
   status bar for any document.
3. In YAML files, put queries in a plain literal block:

   ```yaml
   xql: |
     dataset = example_dataset
     | filter action = "allow"
     | comp count() as total by host
   ```

If another XQL extension is installed, disable it for the workspace if their
features conflict. XQLibur never changes file associations or other extensions.

## Limits

- Complete XQL syntax, implicit operator precedence and argument types are not
  verified. Argument counts are checked only for the 130 reviewed functions;
  partially reviewed functions are never rejected.
- Field availability depends on your tenant's schemas, which XQLibur does not
  read. Field help comes only from what the query itself defines.
- In YAML, folded (`>`), quoted, explicitly indented and templated values are not
  analyzed. XQLibur does not color YAML documents semantically.
- No formatting, schema-backed completion or query execution.

## Theme fallback

Some themes only color scopes from specific languages. XQLibur supplies default
XQL-only stage and function colors for Eclipse Dark, which otherwise leaves those
tokens in the ordinary foreground. The defaults do not change other languages or
themes. You can override them in VS Code's user settings; this example shows the
default colors and XQL-specific scopes to adjust:

```jsonc
"editor.tokenColorCustomizations": {
  "[Eclipse Dark]": {
    "textMateRules": [
      { "scope": "keyword.control.xql", "settings": { "foreground": "#E88537" } },
      { "scope": "keyword.control.clause.xql", "settings": { "foreground": "#E88537" } },
      { "scope": "keyword.operator.word.xql", "settings": { "foreground": "#E88537" } },
      { "scope": "keyword.operator.xql", "settings": { "foreground": "#E88537" } },
      { "scope": "support.function.xql", "settings": { "foreground": "#A7EC21" } },
      { "scope": "entity.name.function.xql", "settings": { "foreground": "#A7EC21" } }
    ]
  }
}
```

Merge the example with any existing customization instead of replacing it. The
extension contributes defaults but does not write user settings. Adapt or omit the
colors to meet your contrast needs. Semantic and lexical theme rules and user
overrides can differ; no palette can guarantee readability for every configuration.

## Privacy

No telemetry, uploads, credential access, workspace scanning or network requests.
Open documents are analyzed in memory by a bundled language server. See
[PRIVACY.md](PRIVACY.md).

## Contributing and feedback

Report bugs and suggestions on
[GitHub Issues](https://github.com/FantasticSalad/xqlibur/issues) using synthetic
examples only. Never include real queries, tenant identifiers, query output or
credentials. Report security problems privately as described in
[SECURITY.md](SECURITY.md). See [CONTRIBUTING.md](CONTRIBUTING.md) to build and
test from source.

## Development

`packages/core` holds editor-independent analysis, `packages/language-server`
exposes it through LSP and `packages/vscode` is the thin client. Reference data is
bundled; `npm run reference:update` fetches public symbol names and links and
requires review before commit. Build with Node.js 22 or later:

```
npm ci
npm run check
npm test
npm run package
npm run test:package
```

`npm run test:package` checks the VSIX file allowlist and runs the extracted
package in an isolated VS Code profile in Restricted Mode. Set
`XQLIBUR_TEST_VSCODE_EXECUTABLE` to reuse an existing VS Code executable. The
parser limits are in [docs/parser.md](docs/parser.md); release steps are in
[docs/RELEASING.md](docs/RELEASING.md). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

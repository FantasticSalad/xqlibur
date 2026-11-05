# Highlighting specification

## Dark 2026 defaults

Dark 2026 XQL defaults now distinguish stages (blue `#6CB6FF`), calls (teal), operators
(lavender) and brackets (grey). Variables/fields retain the theme foreground.
Synthetic lexical/semantic fallback probes cover adjacent calls, brackets, `=`,
`in`, `and` and `~=`; proposed colours meet 4.5:1 against `#121314`. The installed
Dark 2026 include chain is tested through XQL lexical and semantic fallback scopes.
Eclipse Dark retains its existing defaults. Automated checks do not establish
actual editor readability. Bracket pair colourization and user rules can override
these defaults;
other themes keep their own palette. Earlier measurements below are historical.

The blue stage/clause revision separates keywords from Dark 2026's orange
`@element` parameter fallback (`#FFA657`). Against `#121314`, blue has 8.66:1
contrast; teal/lavender/grey have 9.13:1 / 8.45:1 / 9.76:1. Installed build
`a717861c07` resolves the expected lexical and semantic fallback colours,
including the parameter. Normal-vision OKLab distances from blue are 0.145 to
teal, 0.123 to lavender, 0.117 to grey and 0.273 to orange. These bounded
comparisons support the proposal; they are not colour-vision accessibility or
actual rendered-editor acceptance. Other roles and Eclipse Dark are unchanged.

## Theme compatibility follow-up

Evaluate a dated selection of popular theme families, built-in light and dark, and
both high-contrast variants. Check resolved lexical and semantic styles for stages,
known and unknown calls, declarations, fields, aliases, options, parameters,
strings, numbers, operators and comments with semantic highlighting on and off.
Token roles alone do not demonstrate visible styles. Preserve user customizations;
consider an optional language-scoped fallback for themes without generic rules.
Test Eclipse Dark separately as a theme with language-specific keyword rules.

### Initial lexical style probe, 2026-10-28

An independent synthetic query was tokenized with `vscode-textmate` against
Dark+, Light+, Default High Contrast, Default High Contrast Light (VS Code's
`vscode.theme-defaults` 10.0.0), GitHub Dark Default and GitHub Light Default
(`GitHub.github-vscode-theme` 6.3.5), One Dark Pro
(`zhuangtongfa.Material-theme` 3.20.4), and Dracula Theme
(`dracula-theme.theme-dracula` 2.25.1). Selection evidence: Marketplace-derived
install counts reported by PluginStats for [GitHub Theme](https://www.pluginstats.com/plugins/vscode/github.github-vscode-theme)
(20,458,794 on 2026-10-26) and [One Dark Pro](https://www.pluginstats.com/plugins/vscode/zhuangtongfa.material-theme)
(12,853,087 on 2026-10-21); Dracula was included as an additional family, without
a verified count here. Counts are dated cumulative observations, not a ranking claim.

The probe found distinct theme-assigned foregrounds for stages, calls and strings
in those variants; some roles share the editor foreground or each other's colors.
Eclipse Dark (`zerodind.familiar-java-themes` 0.1.7) left stages and calls at its
foreground for both the earlier installed grammar and current source. Quote-specific
scopes improve strings. The extension now contributes Eclipse-specific defaults
for XQL stage and function scopes; the README shows user customization.
The lexical probe does not establish semantic-token style resolution, perceptual
readability, accessibility or behavior under user overrides. The later renderer
probe below supplies bounded semantic-on/off evidence; independent visual and
accessibility review remains useful beyond these synthetic checks.

The README's Eclipse Dark palette was tested with a synthetic theme
that reproduces the relevant Java-only selectors. TextMate tokenization resolves
the documented XQL rules for stages and known/unknown calls; a separate synthetic
grammar probes the contributed semantic fallback scopes. For the theme's default
`#2F2F2F` background, the suggested stage and call foregrounds have contrast ratios
of approximately 5.00:1 and 9.35:1. This arithmetic does not cover user overrides,
font rendering, theme changes, other token colors or VS Code semantic-rule precedence.
The four-theme host test exercises token roles and setting changes, not rendered colors.

On 2026-10-29 an isolated VS Code renderer probe read computed colors for synthetic
stages, known and unknown calls, fields and declarations, datasets and query aliases,
configuration and join options, callback parameters, strings, numbers, operators
and comments across the eight variants above, with semantic highlighting on and off.
The dataset color changed in several themes when semantic highlighting was enabled;
some fields and aliases retained the theme's foreground. A theme-only copy of the
Eclipse rules reproduced the unstyled stages and calls in both modes. The extension's
default palette colored those roles in both modes without a user setting, and a later
explicit stage-color override won in both. This is a bounded rendered-style check,
not a guarantee for other themes, configurations or visual acuity.

To repeat the local renderer probe, first build the extension, provide an existing
VS Code executable as `XQLIBUR_TEST_VSCODE_EXECUTABLE`, and set
`XQLIBUR_THEME_TEST_EXTENSIONS` to an isolated extensions directory under this
worktree's `artifacts` directory, containing
the three listed theme families. Run `node scripts/test-theme-renderer.cjs`, then
repeat with `XQL_RENDER_CASE=roles`. The `eclipse` case additionally requires an
isolated theme-only extension named Eclipse Dark containing the exact theme rules;
do not execute the original theme extension in Restricted Mode merely to test it.
The probe opens an ephemeral localhost debugging endpoint with broad renderer access,
creates synthetic test documents and retains its isolated directory for review.
Do not point it at an existing user profile. It never ships in the VSIX.

Status: H01-H04 implemented; H05 remains separately scoped. This is the visual
acceptance contract for highlighting, not evidence that every XQL construct has
already been implemented or run on Cortex.

## What highlighting communicates

Show the role of text where it occurs. A word such as `filter` is a stage at a
pipeline boundary and a field in `payload.filter`. A derived name keeps its base
role when later referenced. Highlighting does not establish that a field exists
in a dataset or that a query executes successfully.

Use two layers. TextMate supplies immediate, stateful lexical scopes even without
the server. Semantic tokens refine names only where structural/scope knowledge
adds useful information. Comments, strings and their escapes stay with TextMate
unless H05 has an exact, supported embedded context. This avoids a broad semantic
string token obscuring fine-grained lexical scopes.

This follows the layering documented by
[VS Code](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)
and [Pylance](https://github.com/microsoft/pylance-release#semantic-highlighting).
The principle of classifying references consistently with their definitions is
also documented by [rust-analyzer](https://rust-analyzer.github.io/book/features.html#semantic-syntax-highlighting).
These are design references, not source-code dependencies or XQL semantics.

## Role matrix

The scope names below are planned public theme hooks. Keep `source.cortex-xql` and
the existing language identifier. Existing roles must have a documented migration
if renamed. A dash means TextMate is sufficient; do not emit a semantic override
just to fill every token with a semantic classification.

| Text/context | TextMate scope | Semantic classification | Detail |
| --- | --- | --- | --- |
| Line/block comments | `comment.line.double-slash.xql`, `comment.block.xql` | — | TODO-like words may remain plain comment text |
| Single/double/triple quoted text | `string.quoted.*.xql` | — | Preserve delimiters and incomplete-string recovery |
| Supported string escape | `constant.character.escape.xql` | — | Quote-form facts decide escapes; do not assume Python rules |
| Integer/decimal/exponent | `constant.numeric.xql` | `number` only if useful | A unary sign is an operator, not a field identifier |
| true/false/null | `constant.language.xql` | — | Avoid repainting constants as ordinary stage keywords |
| Pipeline stage at a stage boundary | `keyword.control.xql` | `keyword` | Same text inside a field/member is not a stage |
| Contextual clauses such as as/by | `keyword.control.clause.xql` | `keyword` | Only in a supported clause position |
| Word operators | `keyword.operator.word.xql` | `operator` | And/or/in etc. remain properties in member access |
| Symbol operators, including full !~= and -> | `keyword.operator.xql` | `operator` | Longest operator wins; -> is JSON navigation unless facts say otherwise |
| Pipeline separator | `punctuation.separator.pipeline.xql` | `operator` | A pipe inside a literal/comment has no pipeline role |
| Parentheses/brackets/braces | `punctuation.section.*.xql` | — | Native bracket-pair coloring remains the editor's concern |
| Commas/dots/path separators | `punctuation.separator.*.xql` | — | Do not include them in neighboring identifier spans |
| Documented built-in function call | `support.function.xql` | `function.defaultLibrary` | All supported names; selected overload does not change the role |
| Unknown syntactic function call | `entity.name.function.xql` | `function` | No defaultLibrary or error coloring merely for being unknown |
| Field/path component | `variable.other.property.xql` | `property` | Unresolved fields retain neutral field styling |
| Derived field declaration | `variable.other.xql` | `variable.declaration` | Syntactically established complete LHS or supported output alias |
| Resolved derived field reference | `variable.other.xql` | `variable` | H04 uses binding identity, including overwrites and nesting |
| Subquery/execution alias declaration | `entity.name.namespace.xql` | `namespace.declaration` | Distinct from an ordinary field renamed with as |
| Visible subquery alias reference | `entity.name.namespace.xql` | `namespace` | Only within its established lifetime/scope |
| Dataset source atom | `entity.name.type.xql` | `xqlDataset` subtype of namespace | Retain custom role and explicit fallback; existence is unverified |
| Preset/view/saved-query source reference | `entity.name.namespace.xql` | `namespace` | No remote resolution; quoted forms may remain lexical strings |
| Supported stage/config option name | `variable.parameter.option.xql` | `parameter` | This is a named query option, not a row field |
| Documented option enum value | `constant.language.option.xql` | — | Apply only in a supported option slot |
| Quoted array callback placeholder | `variable.parameter.xql` subspan | `parameter` subspan | H04/H05 only in documented callback-argument contexts |
| Ordinary argument expression | Its normal lexical role | Its normal resolved role | Do not paint all function arguments as parameters |
| JSON object member after -> | Property/quoted-string scopes as appropriate | `property` for a bare identifier | No inference that the same member exists in all rows |
| Field wildcard in field-list context | `keyword.operator.wildcard.xql` | — | Keep separate from multiplication and wildcard text in strings |
| Time/unit or format token | Context-specific numeric/string scopes | — | Add only from documented lexical facts |

Public role names identify concepts, not colors. Two roles may share a color in a
particular theme. No requirement for a unique color per field, argument or dataset.
No Python-only roles such as decorators/classes should be invented for XQL.

## Context and ambiguity rules

1. Scan literals/comments first. Preserve their state across lines; a pipe, comma,
   closing bracket or keyword inside them must not affect query parsing.
2. Recognize stages only at query entry/pipeline positions, including supported
   nested queries. Global whole-word stage matching is insufficient. In lexical
   fallback, prefer neutral identifiers where multiline context cannot be proved.
3. Differentiate field-list renaming, aggregate output aliases and join execution
   aliases. One token-after-as heuristic cannot express all three.
4. Resolve a full assignment path, not just the identifier before `=`. Comparisons
   and stage options using `=` must not become derived-field declarations.
5. Resolve `qualified.member` through an established alias when one is visible;
   otherwise treat it as a field path. Do not assume every dotted root is a namespace.
6. A field/member named `filter`, `in`, `true` or `lowercase` keeps a field role in
   that position. Keyword/function matching must not win over a known member path.
7. The quoted `@element` placeholder is conditional. Highlight its interior only
   in documented array-callback argument positions, with the innermost supported
   callback owning it. An identical ordinary string stays a string. No decoded
   escape-to-source mapping may be guessed.
8. A literal source name may be semantically identified without looking up tenant
   data. Cover optional dataset equals, dataset lists and documented cold-storage
   entries only after source-form fixtures exist. Unknown source forms stay neutral.
9. Unfinished supported code keeps useful roles up to the known boundary. A limit,
   unknown stage or parse failure must not paint the remainder of a document as a
   proven declaration scope. No infinite scan or unbounded regular expression.

Quoted callback behavior is supported by public syntax/usage facts for
[arraymap](https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/arraymap)
and [arrayfilter](https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/arrayfilter).
More elaborate lambda/JSON forms require their own evidence. A synthetic recovery
fixture containing an arrow is not that evidence.

## Theme and protocol contract

Keep the existing semantic legend entries in order; append new types/modifiers
and share one exported definition between core, server and tests. Existing
`declaration` remains modifier bit zero; append `defaultLibrary` rather than
reusing the bit. Ensure function references in built-in docs do not accidentally
become definitions. Emit only non-overlapping, positive-length, sorted spans at
actual source boundaries. Never emit type index -1 or a modifier beyond the legend.
Split any intentionally emitted multiline subspan into legal line pieces; avoid
multiline string overrides in the first place.

Keep xqlDataset's namespace supertype, but explicitly provide its TextMate fallback:
custom mappings are not inherited automatically. Add language-scoped fallbacks
for standard roles where needed; do not globally restyle all languages. Semantic
highlighting defaults on for Cortex XQL, and explicit user/theme settings win.
H01's fallback must still be readable when semantic highlighting is off.
[Semantic theming/fallback reference](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide).

Test built-in Dark+, Light+, High Contrast and High Contrast Light (or their current
equivalents), plus semantic on/off. Check token/scope resolution and readable
default fallbacks; do not lock RGB codes or force theme changes. Document how to
use Developer: Inspect Editor Tokens and Scopes for synthetic examples. Do not
inspect the user's screen or install a theme merely to obtain test evidence.

## Required fixture matrix

For each row, assert ranges and roles, not just that some tokens were returned.
Use independent synthetic values and public dataset names.

| ID | Case | Expected distinction |
| --- | --- | --- |
| H-T01 | Comments containing pipes, functions, quotes and brackets | Comment scopes throughout |
| H-T02 | Each quote form, escapes and unfinished/multiline literals | String boundaries recover without semantic overwrite |
| H-T03 | Numeric exponents, unary minus, true/false/null | Numeric/operator/constant roles stay separate |
| H-T04 | Known and future function calls, nested calls | Built-in modifier only on known documented functions |
| H-T05 | `fields payload.filter, payload.lowercase` | Properties, not stage/function tokens, with semantics on and off |
| H-T06 | `alter alpha = 1` then later read alpha | Declaration and reference share variable role after H04 |
| H-T07 | fields alias versus join execution alias | Variable versus namespace; correct declaration spans |
| H-T08 | Dotted LHS, comparison equals, named stage option | Full field path versus read versus option |
| H-T09 | Nested queries with the same field spelling | No binding or role leak between scopes |
| H-T10 | Dataset equals/list/optional-equals/nested forms | Source atoms distinct from row fields when supported |
| H-T11 | `@element` inside/outside supported callback context | Parameter subspan only where justified |
| H-T12 | Full !~=, ->, wildcard, multiplication and literal pipes | Longest tokens and contextual operators |
| H-T13 | Edit an earlier declaration/projection, then request tokens | New roles/ranges; no stale references |
| H-T14 | CRLF and non-BMP characters before identifiers | Correct UTF-16 positions and LSP encoding |
| H-T15 | Missing delimiter, oversized/deep document | Bounded recovery or explicit soft limit |

Run actual Oniguruma grammar fixtures and decoded LSP token assertions. For the
extracted artifact, request semantic tokens and compare selected named positions
with the legend; a nonempty data array alone is insufficient. Keep lexical scope
tests separate from semantic-role tests so one layer cannot hide the other's bugs.

## H05: later embedded-string detail

Potential useful additions are regex operators/groups, JSONPath path segments and
time-format specifiers inside the documented argument slots of known functions.
First record which function/form/parameter contains which embedded language. Use
original small grammar rules or separately reviewed dependencies. Keep surrounding
quotes/string scopes and escape-offset mappings. An ordinary string passed to
concat must not be interpreted as regex/JSONPath just because it contains `$` or `*`.

Do not execute user regexes or parse arbitrary JSON payloads for highlighting.
Unsupported/ambiguous strings retain normal styling. H05 is independently
releasable after the baseline works; it must not block ordinary highlighting,
signatures or field completion. Actual type/schema coloring remains evidence-based.

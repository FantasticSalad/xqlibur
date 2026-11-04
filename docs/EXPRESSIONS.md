# Expression subset and operator evidence

Checked 2026-10-26. This table defines the supported structural subset before its
parser is enabled. A complete node means the supported local production is closed;
it does not establish Cortex validity, operand types or runtime behavior.

| Production | Evidence | Precedence / associativity | Planned local representation |
|---|---|---|---|
| Parenthesized conditions | [filter](https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/stages/filter) | Explicit grouping establishes the boundary | Group with its own expression child |
| Calls and direct arguments | Reviewed per-function syntax forms | Explicit delimiters/separators establish structure | Call plus argument child IDs; no type/arity inference |
| Dotted field path / JSON arrow | Existing path roles and [JSON access](https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/json_extract_scalar) | Retain path sequence; no numeric binding power is asserted | Member sequence, opaque quoted keys remain unsupported |
| Single comparison: = != < <= > >= ~= !~= | [operators](https://cortex-docs.paloaltonetworks.com/cortex-xsiam/reference-and-developer-docs/cortex-agentix-xql/get-started-with-xql/supported-operators), filter | Relative binding and chained associativity unproved | One unambiguous binary node; chains stay ambiguous |
| Single and / or, unary not | Operators, filter | Mixed boolean/comparison binding unproved | One binary or one unary production; mixed chains stay ambiguous |
| in / not in / contains / not contains / incidr / not incidr / incidr6 / not incidr6 | Operators, filter | Relative binding and chained associativity unproved | One binary production; membership list/subquery boundary explicit |
| Membership parenthesized lists/subqueries | Filter | Explicit group boundary only | List or opaque query reference; child query analyzed independently |
| Numeric/string/boolean/null atoms | Existing lexer and function/filter forms | Atom boundary only | Source spans; no copied literal payload or decoded escape validation |
| Adjacent minus plus numeric token at an operand position | [cbrt](https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/cbrt) negative argument examples | One adjacent numeric operand boundary only; no relative binding claim | Unary node with a numeric child; exact spans, no value payload or evaluation |
| + - * / % and == expressions | Existing scanner recovery only | No public complete arithmetic/alias precedence table established | Unsupported sequence; retain spans without rejection |
| Array/object literals, special infix JSON forms, unknown productions | Individual forms need further grammar facts | Unproved | Unsupported nodes; no blanket invalid-expression error |

The inspected operator/filter sources establish spellings and parentheses but do
not publish a complete relative-precedence/associativity table. A bounded Pratt
parser with guessed numeric binding powers would overstate the evidence. Implement
explicit groups, calls, path sequences and single unambiguous operators first;
retain flat ambiguous chains with their source-order operands/operators. A later
reviewed table can replace those neutral nodes without changing framing.

The implementation uses an iterative arena of child IDs, bounded frames/work/nodes/roots and explicit
complete/incomplete/unsupported state. Parent queries reference nested query spans;
they do not parse or inherit the child's field scope as an outer expression. Keep
every-prefix recovery, full-document cursor spans and current delimiter diagnostics.
No new expression error code is enabled by this subset. Unsupported or limited
coverage may suppress dependent diagnostics; it must not create red error cascades.

Default subset bounds: 512 expression frames, 50,000 arena nodes, 200,000 token
steps and 20,000 roots per analysis. Allocation/root guards enforce these bounds
even during finalization. A limited index retains prior nodes and suppresses new
dependent diagnostics; the existing structural/document limits remain separate.
Arena nodes contain spans, kinds, state, operator spellings and child IDs, never
copied literal payloads. Legacy single quotes and delimiter-adjacent backslash
recovery stay unsupported for stronger checks. Field/member case is preserved.

The shared analysis builds this index once per open document/version. Full-document
caret lookup uses the smallest containing source node without reparsing prefixes.
No evaluation, formatting, type inference, regex execution or new expression error
code is included. Full implicit precedence remains blocked on missing public facts.

Adjacent negative numeric atoms are supported only at operand positions: for
example, `cbrt(-8)` or the right operand of a single comparison. They do not enable
binary subtraction, spaced/general negation, unary plus or chained signs. A minus
after an existing operand remains an unsupported arithmetic operator. Mixed chains
retain the same ambiguous/unsupported state and dependent-rule suppression.

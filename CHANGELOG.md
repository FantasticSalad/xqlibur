# Changelog

## 0.3.1 (2026-11-06)

The language-mode menu and status bar identify the language as XQL.

Every supported stage now has a short definition in hover and completion help,
including `fields`. Editor help and diagnostic messages omit reference dates;
documentation links are labelled Supporting Documentation.

Dark 2026 receives distinct stage, function, operator and bracket colours. Nested
XQL literal blocks in YAML retain highlighting without affecting other scalars.
Derived-field hovers explain their role in the query more directly.

The new pixel-sword icon and feature-led front page include focused screenshots
with line numbers and scheduling details removed.

## 0.3.0 — first Marketplace preview (2026-11-04)

Packaging for Visual Studio Marketplace: extension icon, gallery metadata, a
user-facing README, preview flag, security policy and contribution guide. The
packaging tool now resolves a patched authentication library, clearing the two
high-severity development-dependency advisories that blocked release.


Plain `xql: |` blocks in YAML now receive XQL completion, hovers, argument hints
and diagnostics while ordinary YAML keeps its existing language support. Each
literal block is analyzed independently; folded, quoted and templated values
remain outside this first scope. XQL inside those blocks is also highlighted.

Eclipse Dark now receives default XQL-only stage and function colours, including
with semantic highlighting disabled. User token-colour settings retain precedence.

Completion and signature documentation preserve reviewed function-summary caveats from hovers,
including uncertain minimum counts and parsing-only availability. Unreviewed
signed-null window bounds leave outputs uncertain and suppress dependent findings.

Function completion now shares reviewed call-context selection with signature help
and count checks. Aggregates are suggested in their declared comp/windowcomp stages;
child queries use their own stage, field collisions retain field candidates, and
entries without reviewed forms retain inventory fallback suggestions.

Reference accounting for 142 names, with 130 functions having verified call counts, eight
partial help entries and four explicit link-only fallbacks. Context-specific, optional/repeated and zero-slot
forms share source-backed hovers and parameter help. JSON infix alternatives stay
out of call signatures. Added query IDs, complete path/assignment/field-list/source
nodes and full-document cursor context. Contextual TextMate grammar and semantic
roles preserve member names and append namespace/parameter and built-in modifiers
without reordering the existing legend. Shared version-owned symbols/transfers add
query-local field completion with exact edits, value-free hovers and consistent
reference roles, including reviewed callback subspans. Conservative projection,
aggregate/window and independent join/union rules retain explicit uncertainty.
Evidence-gated removed-binding and count checks for 130 functions clear on correction.
An iterative expression subset retains unsupported/ambiguous forms without guessed
precedence or new error cascades.
Parenthesized word-operator right operands retain operator roles and do not show
fake function signatures; genuine operand-position CIDR calls retain their help.
Format-string help avoids an unproved minimum; parsing-only regex captures and
licensed wildcard matching display their availability limits.
JSON call counts remain separate from four display-only arrow forms; no JSONPath
validation or additional expression grammar is implied.
Conditional help preserves short-form hints and uses an unknown-count fallback
for longer public examples. Object-pair semantics stay unverified.
Aggregate count facts apply only in their reviewed `comp`/`windowcomp` contexts,
with warnings cleared after correction and no aggregate output/type inference.
Adjacent negative numeric atoms now retain supported expression boundaries, allowing
independent count/scope proofs. General arithmetic and negation remain unsupported.
Signature schema v3 separates verified direct counts from special display labels;
callback help keeps no invented slots. Conflicting arrayindexof optionality stays partial.

## 0.2.0 — local alpha

Structural parsing for nested query/call context, recovery from unfinished input,
and nested-stage name warnings. Semantic tokens distinguish function calls, field
identifiers, declarations and dataset sources. Selected documented function forms
provide argument hints and richer hovers. Local-only work, not a published release.
Fixed reference ingestion of stage-qualified aggregate function names.

## 0.1.0 — local alpha

Initial highlighting, name completion, reference hovers and structural diagnostics
with a bundled TypeScript language server and offline runtime.

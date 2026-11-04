# Structural analysis and signature coverage

The current source uses an iterative structural parser over a location-preserving
lexer. It recognizes query stages, nested query groups, function calls, direct
argument separators and field/alias declaration sites. Every node retains UTF-16
locations. Strings and comments stay opaque, so commas and pipes inside them do
not change argument or pipeline structure.

## Design choice

Options considered were a stage splitter, a recursive expression parser, and a
bounded structural parser that could later support an expression grammar. The
splitter could not distinguish nested query stages and call arguments. A complete
expression grammar would require documented precedence, context and recovery rules
beyond the current catalogue. The structural parser supplies useful editor context
without inventing those semantics. No third-party parser has been benchmarked or
claimed as unsuitable; grammar-library evaluation remains open for deeper parsing.

The implementation is iterative, with a 4,096-frame nesting cap and the existing
document-length cap. When a limit is hit it pauses analysis with information,
rather than declaring the query invalid. Unfinished calls retain argument context.
Closing delimiter errors do not clear all context or generate unlimited cascades.

## Coverage and limits

Synthetic acceptance cases cover nested joins, membership subqueries, multiple
assignments, opaque callback-like expressions, JSON access, multiline literals, member names that resemble
keywords and unfinished edits. Prefix recovery tests try every truncation of the
corpus. These tests establish our tool's behavior, not acceptance by Cortex.

This is not a complete syntax/type parser. Nested query recognition currently
depends on documented entry patterns or a join/union child group. Unknown
names are reference warnings; incomplete syntax is not subjected to argument-count
or type rejection. Schema intelligence, full operator precedence, complete scope
resolution beyond the supported transfers and safe formatting remain future work. Multi-form signature selection
uses context and direct argument positions without inferred argument types.

The shared expression subset adds an iterative arena for explicit groups, calls,
paths, membership lists/subqueries and single unambiguous operations. Mixed chains
remain ambiguous because full precedence/associativity facts are missing. Unknown
arithmetic/special forms and unreviewed quotes remain unsupported without new
expression errors. Its 512-frame/50,000-node/200,000-step/20,000-root bounds pause
only that subset and suppress dependent findings. Nodes retain spans and child IDs,
not literal payloads. There is no expression evaluator, formatter or type inference.

Open-document analysis is shared and bounded by URI/version. Query-local bindings
and conservative alter/fields transfers support field completion and local hovers.
Complete projections/removals affect downstream candidates; system-field retention
does not establish presence. Same-stage ordering and unknown transforms remain
uncertain. Completion replaces the full active identifier segment, preserves
qualifiers and inserts names only. Unknown object/JSON paths have no inferred keys.
Comp/window outputs and conservative join/union transfers use reviewed explicit
names. Join-predicate alias members use independent child outputs; downstream alias
lifetime, implicit aggregate names and both-strategy collision naming remain unresolved.
Local hovers expose names, role, origin and confidence, never expression values.

Diagnostics distinguish inventory warnings from proven local scope evidence. A
removed-name warning requires a known binding, exact supported removal proof and
closed safe context; open/wildcard/uncertain/partial/system/JSON cases stay quiet.
Arity rejection requires fully verified applicable forms. Current bundled facts
include verified call counts for 130 functions (rand/current_time/time_frame_end: zero;
lowercase/uppercase/ceil/floor/sqrt/exp/acos/asin/cos/sin/tan/ln/log10,
cbrt/cot/csc/sec/sign/round/safe_negate and the six
reviewed scalar converters including to_float, array_length/len/arraymerge, four IP
predicates, md5/sha1/sha256/sha512, convert_from_base_64/convert_to_base_64,
extract_url_host/extract_url_pub_suffix/extract_url_registered_domain and
int_to_ip/ip_to_int/timestamp_seconds/is_sla_breached/sla_time_remaining: one;
log/pow/power/incidr/incidr6/arrayindex/arraymap/arraystring and
add/subtract/multiply/divide/mod/safe_add/safe_subtract/safe_multiply/safe_divide,
bitwise_and/bitwise_or/bitwise_xor/bitwise_sleft/bitwise_sright and
cosine_distance/euclidean_distance/string_count/regextract/wildcard_match and
json_extract_scalar/json_extract/json_extract_array/json_extract_scalar_array/
json_path_extract/extract_time/range_bucket: two;
replace/arrayrange/replex/timestamp_diff: three;
trim/ltrim/rtrim/to_timestamp/trunc/split: one or two;
parse_timestamp/format_timestamp/date_floor: two or three; parse_epoch: two, three
or four; hierarchy_match: zero, one or two;
concat/arrayconcat/greatest/least/object_merge: two or more). Callback, element and index semantics
remain unverified; unsupported inner expressions still suppress count findings.
Avg/min/max/median/sum/latest/stddev_population/stddev_sample take one argument only
in comp/windowcomp; list/values/earliest/approx_count/var only in comp. Count takes
zero or one in comp/windowcomp. Approx_quantiles takes two or three and approx_top
one, two or three only in comp. These facts establish no input type, ordering,
grouping/window-frame behavior or implicit output names.
First/last take one argument only in comp; first_value/last_value one, rank/row_number
zero and lag one, two or three only in windowcomp. Required ordering/sort, frames,
ties, offsets/default values and chronology remain unvalidated.
Arrayfilter/array_all/array_any have exactly two direct arguments across their
reviewed forms. Special labels retain no positional parameter hints; callback
grammar, component types and empty/null behavior remain unverified. Arrayindexof
stays partial because its condition optionality conflicts across public sections.
Adjacent negative numeric atoms are supported at operand positions without value
copies or evaluation. General/spaced negation, subtraction and mixed arithmetic
remain unsupported; no relative precedence table is inferred.
Other partial/display-only forms produce no argument-count rejection. No type,
unused-field or generic missing-source-field checks are enabled.

Semantic roles describe syntax and supported local binding identity, not schema ownership: stages are
keywords, call sites are functions, ordinary field identifiers are properties,
declaration sites are variables and dataset source identifiers have a dataset type.
Resolved derived references share variable roles with complete declarations. Stale
or uncertain reads remain properties. Exact quoted callback-placeholder interiors
receive parameter subspans only in reviewed callback contexts; ordinary strings
stay lexical. Member keywords are properties. Predicates inside nested calls are not field
declarations. Standard theme scopes and a dataset fallback are provided; users can
override semantic highlighting. The extension never installs a color theme.

## Signatures

`reference/signatures.json` schema v3 contains 159 forms for 130 count-verified and
eight partial function entries; four blocked entries retain links only. Each form records contexts,
an official source URL and its own checked
date. Names and parameter facts are retained, without copying vendor
examples or descriptive paragraphs. Variadic repeat slots are explicitly marked.
Optional/repeated parameters are displayed explicitly; unknown or special parameter
shapes never invent an active index. Only documented forms receive argument hints.
Unknown inner calls suppress
outer hints to avoid displaying the wrong signature. This is documentation-based
assistance, not proof of runtime behavior, types or overload completeness.

To extend coverage, check the current public syntax page, record the facts and
source, and add nested/incomplete-call tests. Do not derive public fixtures or
signatures from private queries or tenant output.

## Evidence and acceptance contracts

Versioned `reference/syntax-facts.json` and `reference/stage-facts.json` separate
verified public facts from partial or blocked behavior. Each fact has an original
behavior summary, checked date, official source, explicit conservative fallback and
links to `tests/fixtures/acceptance-cases.json`. Run `node scripts/validate-facts.mjs`.
These development records are excluded from the VSIX. Corpus recovery tests verify
ranges and bounded parsing; expectations for later scope/role features are acceptance
contracts, not claims that the baseline already implements those features.

The conceptual shared contracts remain unchanged: half-open
UTF-16 spans, certainty, versioned binding identity, query-scope ownership and explicit
completion replacement spans. No runtime contract migration is needed in R00.
Same-stage assignment ordering, post-join alias lifetime, complete operator precedence
and escape validity remain evidence gaps. An arrow alone never establishes a lambda.

## Current reference and role coverage

R03 accounting covers 142 names: 130 count-verified, eight partial and four
blocked/link-only entries, with 159 forms. Four forms describe infix JSON access and
appear in hovers only. Only 145 reviewed call forms across those 130 functions enable argument-count
warnings; types remain unverified. The inventory now
includes the documented cold_dataset spelling alongside 27 earlier stage names.

Schema v3 keeps positional parameter layout (`arityKnown`/`parameters`) separate
from an explicit special-form `callCount` range. Special direct-count evidence must
be verified, finite safe integers, belong to a call rather than infix notation,
and retain unknown parameter layout with no invented slots. Unknown or unverified
special forms fail open. The build rejects v2; there is no runtime data migration.

Optional bundled function summaries accompany signature results as well as hovers.
The LSP adapter escapes their uncertainty/availability notes into each form's
documentation beside its source/date; argument values are never interpolated.

The structure service records query ancestry, direct argument spans, full dotted
assignment paths, field-list aliases, source variants, stage options, aggregate
outputs and join aliases. Reviewed callback metadata maps only exact placeholder
interiors to parameter subspans. Cursor context uses the full document and completion
edits replace identifier suffixes correctly when the caret is in the middle.

Semantic tokens consume those roles. Existing indexes and declaration bit zero are
stable; namespace/parameter and defaultLibrary are appended. Tokens are sanitized
for positive, sorted, non-overlapping single-line UTF-16 spans, with explicit theme
fallbacks. Ordinary strings, escapes, constants and punctuation stay lexical.
Resolved derived references follow binding identity through supported transfers;
unknown or stale references remain neutral properties.

The desktop analysis store retains bounded in-memory content digests with open
versions so eviction cannot disable same-version consistency checks. Digests cover
exact UTF-16 code units on cache misses only; hits compare the actual text.
Oversized bodies remain limit-only without hashing or extra source retention.
Inconsistent versions suppress providers and clear old diagnostics; a higher
version restores analysis. Digests are not returned, logged or written to disk.

Window boundary coverage distinguishes unsigned null from signed integer tokens.
A sign before null leaves the stage/output uncertain and suppresses dependent
findings; no bound evaluation or new syntax diagnostic is implied.

The lexical grammar prefers neutral fields when multiline query/clause context
cannot be proved. Only reviewed triple-double n/t/backslash sequences get escape
scopes; delimiter-edge and legacy single-quote semantics remain structural recovery,
not full Cortex validation. See HIGHLIGHTING_SPEC.md for the fixture matrix and limits.

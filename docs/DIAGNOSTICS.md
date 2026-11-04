# Diagnostic evidence and recovery policy

The runtime registry in packages/core/diagnostics.ts records each rule's parser
prerequisites, fact dependencies, confidence, severity and suppression requirements.
The server uses only its bundled data and the current open document. It never
executes a query or loads schemas, executable configuration or remote facts.

Window frames with a sign before null are outside reviewed structural coverage.
They leave outputs uncertain and suppress dependent count findings; this adds no
syntax error or frame-validity evaluation. Unsigned null and signed integer bounds
retain their existing structural handling.

| Code | Default | Meaning | Required evidence / limits |
|---|---|---|---|
| XQL000 | information | Local length/frame limit reached | Existing bounded analysis; replaces dependent findings |
| XQL101 | error | Unterminated string | Existing scanner recovery, not complete escape validation |
| XQL102 | error | Unterminated block comment | Existing opaque-comment scanner |
| XQL103 | error | Unexpected/mismatched closing delimiter | Existing framing; no expression/type inference |
| XQL104 | error | Unclosed opening delimiter | Existing framing and recovery |
| XQL201 | warning | Stage absent from bundled inventory | Catalogue date retained; newer Cortex syntax may exist |
| XQL202 | warning | Function absent from bundled inventory | Catalogue date retained; this does not establish a Cortex error |
| XQL301 | warning | Established local binding removed/renamed | Complete supported stage, closed safe ordinary input and known earlier binding/removal proof |
| XQL302 | warning, evidence gated | Proven direct argument-count mismatch | Closed complete call and all applicable call counts fully verified; 130 explicitly reviewed functions only |

301–399 are reserved for evidence-gated local-name/call rules. 401–499 are reserved
for future supported expression-production diagnostics; no such rule is enabled by
this registry work. Type mismatch, unused fields, implicit aggregate names and
guessed missing fields remain off. Inventory warnings are not syntax contradictions.

Coverage is computed before dependent rules: analysis limits, supported/complete
stage transfer, closed input shape, closed call, opaque-token/framing damage and
known nested calls. Unknown stages, unknown inner calls and recovery boundaries
block dependent rules. Existing structural/reference codes retain their exact
messages, severities and locations. At most 100 findings are published, owned by
the same URI/version as every other provider. Corrections invalidate the analysis;
close/shutdown releases state and clears diagnostics.

Dependent rules must select one minimal finding per supported failure, suppress
cascades and document nearby valid, uncertain and unfinished cases. A partial
signature, open schema, wildcard or ambiguous query composition cannot establish
a contradiction. Public fact provenance lives in the reviewed syntax/stage/function
ledgers; local tests prove tool behavior, not tenant acceptance.

XQL301 requires an exact removal/rename proof tied to a known binding. Open sources,
candidate-only observations, wildcard histories, uncertain joins/unions, unsupported
transfers, protected system fields, query qualifiers and JSON members are excluded.
Same-stage writes suppress dependent reads. A bare trailing identifier at EOF is
treated as a live edit; a later operator/operand or verified stage boundary is
needed. Reintroduced names cancel the old proof. One warning per stage/path avoids
repeated mentions of the same removed binding.

XQL302 requires function status verified and every applicable call form arityVerified.
Positional forms require known parameter layout; special displays require a separate
explicit `callCount` range under schema v3. Optional/repeated and all possible
overload counts are considered; types never select a form. Partial/display-only
and unproved special/unknown call alternatives fail open. 145 call forms across
130 functions have verified counts:
rand/current_time/time_frame_end take none; lowercase/uppercase/ceil/floor/sqrt/exp/acos/asin/cos/
sin/tan/ln/log10/to_number/to_string/to_integer/to_boolean/to_json_string/array_length/
len/arraymerge/is_ipv4/is_ipv6/is_known_private_ipv4/is_known_private_ipv6/to_float/
md5/sha1/sha256/sha512/convert_from_base_64/convert_to_base_64/extract_url_host/
extract_url_pub_suffix/extract_url_registered_domain/int_to_ip/ip_to_int/cbrt/cot/
csc/sec/sign/round/safe_negate/timestamp_seconds/is_sla_breached/sla_time_remaining take one;
log/pow/power/incidr/incidr6/arrayindex/arraymap/arraystring/
add/subtract/multiply/divide/mod/safe_add/safe_subtract/safe_multiply/safe_divide/
bitwise_and/bitwise_or/bitwise_xor/bitwise_sleft/bitwise_sright/cosine_distance/
euclidean_distance/string_count/regextract/wildcard_match/json_extract_scalar/
json_extract/json_extract_array/json_extract_scalar_array/json_path_extract/extract_time/range_bucket take two;
replace/arrayrange/replex/timestamp_diff take three; trim/ltrim/rtrim/trunc/split take one or two;
concat/arrayconcat/greatest/least/object_merge take two or more;
hierarchy_match takes zero, one or two; to_timestamp takes one or two; parse_timestamp and
format_timestamp and date_floor take two or three; parse_epoch takes two, three or
four. Unit/format/timezone/conversion behavior is
not validated. Coalesce/arraycreate minimum counts remain unresolved.
Avg/min/max/median/sum/latest/stddev_population/stddev_sample take one argument only
in their reviewed comp/windowcomp contexts; list/values/earliest/approx_count/var
only in comp. Count takes zero or one in comp/windowcomp; no star form is inferred.
Approx_quantiles takes two or three and approx_top one, two or three only in comp.
Approximate result accuracy, value bounds, weights and distinct behavior are unchecked.
Unsupported stages/window shapes,
unrelated expression contexts and child-query scope boundaries cannot broaden
these call facts. Input types, aggregation/null/order, window frames and implicit
output names remain unverified.
First/last take one argument in comp; first_value/last_value take one, rank/row_number
zero and lag one/two/three in windowcomp. Ordering/sort requirements, frame validity,
ties, chronological selection and offset/default/null/type semantics stay unchecked.
Arrayfilter/array_all/array_any take exactly two direct arguments across their
reviewed positional/special forms. A special label keeps unknown parameter layout
and no active parameter hint. This does not validate callback grammar or components.
Format_string's minimum is also unresolved: variable-slot help has no invented
active parameter. Regexcapture is parsing-rule-only in the public reference and
stays partial. Wildcard_match's Cortex Cloud license availability is noted, not
checked. Regex syntax, captures, replacements and format specifiers are unchecked.
To_epoch's required-unit table conflicts with omission notes; it stays partial,
with no rejection of an omitted unit. Calendar/timeframe and unit order are unchecked.
If's short-form hints coexist with an unknown-count fallback for longer public
examples; no maximum, condition/type or branching rule is inferred. Object_create
remains special/partial: key/value parity and its minimum are not positional rules.
Object merging, comparison types, hierarchy availability/path/ID semantics, bucket
sorting and timer/SLA behavior remain unchecked. Types never choose an overload.
Array element/type/index/bounds, callback validity and JSON contents are unverified.
Arrayindexof stays partial because its rendered condition slot conflicts with
optional table entries. Unsupported or unknown nested callback expressions suppress
dependent arity checks, including on functions with verified direct counts.
Parenthesized CIDR word-operator operands are groups, not one-argument calls; no
function-count rule applies to them. Address/CIDR/private-space behavior is unverified.
URL validity, public suffixes, signed integer ranges and IP conversions are unchecked.
Four JSON arrow forms are display-only non-call notation. They do not enter the
applicable call-form set, signature argument selection or count diagnostics. JSON
contents/keys/JSONPath, output types and additional expression grammar stay unverified.
Other partial
forms cannot produce XQL302. This verification covers counts, not types or runtime
behavior. Synthetic injected facts independently test optional/repeat/overload
gates. D03 supplies argument completeness for its supported literal/path/
group/call/single-operation productions; unproved expression shapes stay quiet. Empty/trailing arguments,
unknown inner calls and incomplete stages suppress the rule. An inner proven
failure suppresses its enclosing arity cascade. No auto-corrections are offered.

D03 ambiguous/unsupported/incomplete expression roots suppress dependent rules in
that stage. Expression work/frame/node/root limits pause this subset without adding
an invalid-expression diagnostic; existing framing and other provider results
remain available. Relative precedence, associativity and unreviewed quote recovery
cannot silently become rejection rules.

Adjacent negative numeric atoms can provide complete supported operands for an
independent count or local-name proof. This does not validate numeric domains or
enable subtraction/general negation. Spaced signs, nonnumeric operands, mixed
arithmetic and ambiguous chains retain their dependent-rule suppression.

# Reference catalogue

Names and source links extracted from the public Cortex XQL indexes by
`npm run reference:update`. Generated data is reviewed and committed, never fetched
by the installed extension. Descriptions and vendor examples are not copied.

The checked date describes this snapshot, not a supported product release.
Review dates are internal provenance and are not displayed in editor help or
diagnostics. `packages/core/stage-help.ts` provides reviewed, independently written
definitions for every catalogued stage, using each catalogue entry's official
source link. Reviewed on 2026-11-05 against the individual stage pages; transpose
has only the official stage-index description, and datamodel uses the linked XDM
best-practices page. The index's conflicting preset/view descriptions are not used.
Unknown names produce warnings, because the catalogue can be incomplete.
External draft links in the indexes are replaced by citations to the official index.
The separately documented `datamodel` entry is curated in the update script.

Stage-qualified function labels retain their context annotations and public source
links. A function used by both comp and windowcomp has one completion entry with
both source contexts; do not discard it because the display label has extra text.

`signatures.json` schema v2 is a separate curated set of call forms. Each form has
contexts, parameter optional/repeat flags, known/unknown arity, positional/special
syntax, validation permission, source and checked date. Empty parameters mean zero
arguments only when arityKnown is true. Special forms need their own display label.
All eight migrated baseline forms remain displayOnly; none authorizes rejection.

Migration is one-way: only v2 persisted facts pass build validation. The existing
core facade temporarily derives its old display shape from v2; it does not accept
v1 data. Runtime code reads curated forms only. `coverage.json` accounts for every
catalogue name, including aggregate contexts, and stays out of the VSIX along with
syntax/stage development facts. Run `node scripts/validate-reference.mjs` or check.

The name-index refresh does not overwrite curated facts. It fails before writing
if a previously reviewed name disappears; intentional removals require a separately
reviewed inventory change. After a refresh, reconcile coverage/date/context/source
changes before check can pass. No automatic signature extraction or network tests.

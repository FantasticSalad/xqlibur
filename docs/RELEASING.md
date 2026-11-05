# Releasing to the Visual Studio Marketplace

Publication is manual. Nothing is published by pushing or tagging. The
[Publish workflow](../.github/workflows/publish.yml) runs only when the maintainer
starts it, types the version and approves the `marketplace` environment.

## One-time setup (maintainer)

1. **Publisher.** Sign in at <https://marketplace.visualstudio.com/manage> with the
   Microsoft account that will own the extension and create a publisher whose
   **ID** is `FantasticSalad` (it must equal `publisher` in `package.json`). If
   that ID is taken, choose another and change `publisher` in `package.json`.
2. **Token.** In Azure DevOps (<https://dev.azure.com>, same account), open
   *User settings → Personal access tokens → New token*:
   - Organization: **All accessible organizations**
   - Scopes: *Custom defined → Marketplace → **Manage***
   - Expiry: short (for example 30–90 days)
3. **GitHub environment.** In this repository: *Settings → Environments → New
   environment* named `marketplace`.
   - Enable **Required reviewers** and add yourself.
   - Under *Deployment branches and tags*, choose **Selected branches** and add `main`.
   - Add an environment secret `VSCE_PAT` with the token from step 2.
4. **Optional: Open VSX** (used by VSCodium, Cursor and others). Create an
   account at <https://open-vsx.org>, sign the publisher agreement, create the
   `FantasticSalad` namespace (`npx ovsx create-namespace FantasticSalad -p <token>`)
   and add an `OVSX_PAT` environment secret. Without it, that step is skipped.

## Each release

1. On a branch, update `version` in `package.json` and the matching
   `CHANGELOG.md` heading, then merge to `main` after CI passes (including the
   `package-host` job, which runs the packaged VSIX in Restricted Mode).
2. Optionally install the CI VSIX locally (*Extensions: Install from VSIX*) and try it.
3. *Actions → Publish → Run workflow* on `main`, entering the exact version.
4. Approve the `marketplace` deployment when GitHub asks.
5. The workflow re-runs every check, records the VSIX SHA-256 in the run summary,
   uploads the VSIX as a run artifact and publishes it.
6. The listing appears at
   <https://marketplace.visualstudio.com/items?itemName=FantasticSalad.xqlibur>
   after Marketplace validation (usually minutes).
7. Optionally create a GitHub release for the tag `v<version>` and attach the VSIX.

## Before the first release

- Review the README, icon and listing text for the name and vendor-affiliation
  wording (independent, not affiliated with or endorsed by Palo Alto Networks).
- `preview: true` in `package.json` shows a **Preview** badge. Remove it when the
  extension is considered stable.

## Artifact metadata gate for every release

Review the exact public source export, README image targets and final VSIX before
uploading them, including CI artifact uploads. A source or secret scan does not
inspect image metadata or ZIP timestamps.

- Use descriptive screenshot names, such as `completion-menu.png`, with no capture
  date/time in the filename or URL. Update references and review image content.
- Check final images for PNG text/time fields, EXIF/XMP and analogous metadata in
  other formats. Renaming does not remove embedded metadata.
- Build from the reviewed public tree. Exclude unintended local paths, private
  revision IDs, build dates, source maps and internal reports. Preserve required
  licence notices and public-source attribution.
- Use a documented constant `SOURCE_DATE_EPOCH` when invoking the pinned vsce;
  `946684800` is 2000-01-01 UTC. It is an archive convention, not a capture or
  development date. Do not derive it from a private source commit. Check and
  Publish workflows set this epoch and TZ=UTC for consistent DOS and extended ZIP
  timestamps. Manual package builds must supply the same values before distribution.
- Inspect the resulting VSIX's entry timestamps, extra fields and comments,
  including nested archives. Match the extracted payloads to the reviewed build.
  Rebuild with different staging mtimes and verify the archive dates stay constant.
- Review CI logs, provenance, source downloads and all release attachments. After
  publication, download the served images/package and verify those bytes too.

These are manual release requirements. The existing automated checks do not yet
enforce this metadata gate. File sanitisation does not remove the hosting
service's publication, update or workflow timestamps.

References: [vsce 4.1.0 packaging](https://github.com/microsoft/vscode-vsce/blob/v4.1.0/src/package.ts),
[README image links](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#markdown-links).

## If something goes wrong

- A published version cannot be replaced. Fix forward with a new version, or
  unpublish from the publisher management page.
- Revoke the token in Azure DevOps if it may have leaked, then replace the secret.

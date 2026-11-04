# Contributing

Issues and pull requests are welcome. XQLibur is an independent project and is
not affiliated with Palo Alto Networks.

## Ground rules

- Use only public sources and independently written synthetic examples. Never
  submit private queries, tenant identifiers, raw query output, credentials or
  private screenshots, in code, tests, issues or pull requests.
- Reference entries need provenance: an official public source URL and the date
  it was checked. Do not copy documentation examples verbatim.
- Unknown names are warnings, not authoritative syntax failures. Keep
  diagnostics conservative where public evidence is incomplete.
- Do not add runtime query execution, uploads, telemetry or workspace discovery.
  See [PRIVACY.md](PRIVACY.md).

## Development

```bash
npm ci
npm run check
npm run build
npm test
npm run package
npm run test:package
```

`npm run test:package` runs the packaged extension in an isolated VS Code host.
Review the VSIX contents when changing packaging or bundled files.

Report security issues privately as described in [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE).

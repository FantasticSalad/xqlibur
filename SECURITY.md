# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository. Do not open a public
issue for security problems.

Include the XQLibur version, VS Code version, operating system and the smallest
synthetic input that reproduces the problem. Never include private queries,
tenant identifiers, raw query output, credentials or private screenshots.

## Scope

XQLibur is a local editor extension. Its installed runtime makes no network
requests, sends no telemetry, discovers no credentials and executes no queries
(see [PRIVACY.md](PRIVACY.md)). Reports about the bundled language server, the
VS Code client, packaged files or the build and packaging pipeline are in scope.
Cortex XQL itself and Palo Alto Networks products are out of scope; report those
to the vendor.

## Supported versions

XQLibur is an alpha. Only the latest source on `main` receives fixes.

# Privacy

Installed runtime: no telemetry, upload, credential discovery, reference refresh,
workspace crawl or query execution. Open documents are processed in memory by a
bundled server. With Remote Development that host may be remote. Documentation
links open only when selected. Trace/output channels discard content. VS Code
and other extensions have their own privacy behavior.

YAML support reads open YAML document text in memory to locate plain `xql: |`
literal blocks. Only those block contents reach the XQL analysis core. It does
not search the workspace or read closed YAML files.

Development dependency installation and reference updates use the network.
Reports must use independently constructed synthetic examples. Do not submit
private queries, tenant identifiers, raw output, credentials or private screenshots.

import {createConnection, TextDocuments, TextDocumentSyncKind, CompletionItemKind, DiagnosticSeverity, MarkupKind, SemanticTokensBuilder} from 'vscode-languageserver/node';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {AnalysisStore, createAnalysis, completionCandidates, localHover, hover, signatureHelp, contextAt} from '../core';
import {hoverHelp,localExplanation} from '../core/hover-help';
import type {DocumentAnalysis} from '../core';
import {semanticTokens, tokenTypes, tokenModifiers, semanticModifierBits} from '../core/semantic';
import {displayForm} from '../core/signatures';
import {xqlRegions} from './yaml-regions';
import type {Position} from 'vscode-languageserver';
import {createHash} from 'node:crypto';

const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');

const connection=createConnection();
const documents=new TextDocuments(TextDocument);
const analyses=new AnalysisStore();
const yamlVersions=new Map<string,{version:number;digest:string;inconsistent:boolean}>();
const yamlDigest=(text:string)=>createHash('sha256').update(text,'utf16le').digest('hex');
const analysisFor=(document:TextDocument)=>analyses.get(document.uri,document.version,document.getText());
type View={text:string;analysis:DocumentAnalysis;offset:number;position:(offset:number)=>Position};
function viewsFor(document:TextDocument):View[] {
  if(document.languageId!=='yaml') {
    const analysis=analysisFor(document);
    return analysis?[{text:document.getText(),analysis,offset:0,position:offset=>document.positionAt(offset)}]:[];
  }
  if(yamlVersions.get(document.uri)?.inconsistent!==false) return [];
  return xqlRegions(document).map(region=>({text:region.document.getText(),analysis:createAnalysis(region.document.getText()),offset:0,position:region.position}));
}
function viewAt(document:TextDocument,position:Position):View|undefined {
  if(document.languageId!=='yaml') {
    const analysis=analysisFor(document);
    return analysis?{text:document.getText(),analysis,offset:document.offsetAt(position),position:offset=>document.positionAt(offset)}:undefined;
  }
  if(yamlVersions.get(document.uri)?.inconsistent!==false) return;
  for(const region of xqlRegions(document)) {
    const offset=region.at(position);
    if(offset!==undefined) return {text:region.document.getText(),analysis:createAnalysis(region.document.getText()),offset,position:region.position};
  }
}
const pending=new Map<string,ReturnType<typeof setTimeout>>();
connection.onInitialize(() => ({capabilities:{positionEncoding:'utf-16',textDocumentSync:TextDocumentSyncKind.Incremental,completionProvider:{triggerCharacters:['.','>']},hoverProvider:true,
  signatureHelpProvider:{triggerCharacters:['(', ','],retriggerCharacters:[')']},
  semanticTokensProvider:{legend:{tokenTypes:[...tokenTypes],tokenModifiers:[...tokenModifiers]},full:true}
}}));
documents.onDidOpen(({document})=>{
  analyses.open(document.uri,document.version);
  if(document.languageId==='yaml') yamlVersions.set(document.uri,{version:document.version,digest:yamlDigest(document.getText()),inconsistent:false});
});
documents.onDidChangeContent(({document}) => {
  const uri=document.uri,version=document.version;
  clearTimeout(pending.get(uri));pending.delete(uri);
  if(document.languageId==='yaml') {
    const previous=yamlVersions.get(uri),digest=yamlDigest(document.getText());
    if(!previous||version<previous.version||version===previous.version&&(previous.inconsistent||digest!==previous.digest)) {
      if(previous&&version===previous.version) previous.inconsistent=true;
      connection.sendDiagnostics({uri,diagnostics:[]});return;
    }
    if(version>previous.version) yamlVersions.set(uri,{version,digest,inconsistent:false});
  }
  if(!analyses.change(uri,version)) {yamlVersions.delete(uri);connection.sendDiagnostics({uri,diagnostics:[]});return;}
  pending.set(uri,setTimeout(() => {
    pending.delete(uri);
    const current=documents.get(uri);
    if(!current||current.version!==version) return;
    const diagnostics=viewsFor(current).flatMap(view=>view.analysis.findings.map(f => ({
      code:f.code,source:'XQLibur',message:f.message,
      severity:f.severity==='error'?DiagnosticSeverity.Error:f.severity==='warning'?DiagnosticSeverity.Warning:DiagnosticSeverity.Information,
      range:{start:view.position(f.start),end:view.position(f.end)}
    })));
    connection.sendDiagnostics({uri,version,diagnostics});
  },200));
});
documents.onDidClose(({document}) => {
  analyses.close(document.uri);
  yamlVersions.delete(document.uri);
  clearTimeout(pending.get(document.uri)); pending.delete(document.uri);
  connection.sendDiagnostics({uri:document.uri,diagnostics:[]});
});
connection.onCompletion((params) => {
  const doc=documents.get(params.textDocument.uri);
  const view=doc?viewAt(doc,params.position):undefined;
  if(view&&params.context?.triggerKind===2) {
    const offset=view.offset,trigger=params.context.triggerCharacter;
    if(trigger==='>'&&view.text.slice(offset-2,offset)!=='->'||['.','>'].includes(trigger??'')&&contextAt(view.analysis.structure,offset).kind!=='member') return [];
  }
  const kinds={stage:CompletionItemKind.Keyword,function:CompletionItemKind.Function,field:CompletionItemKind.Field,alias:CompletionItemKind.Module,option:CompletionItemKind.Property};
  return view?completionCandidates(view.analysis,view.offset).map(s => ({label:s.label,kind:kinds[s.kind],detail:s.detail,
    sortText:String(s.rank).padStart(3,'0')+':'+s.label,filterText:s.insertText,insertText:s.insertText,
    ...(s.summary?{documentation:{kind:MarkupKind.Markdown,value:escapeMarkdown(s.summary)+(s.source?`\n\n[Supporting Documentation](${s.source})`:'')}}:{}),
    textEdit:{range:{start:view.position(s.replace.start),end:view.position(s.replace.end)},newText:s.insertText}})):[];
});
connection.onHover(params => {
  const doc=documents.get(params.textDocument.uri);
  if(!doc) return null;
  const view=viewAt(doc,params.position);
  if(!view) return null;
  const local=localHover(view.analysis,view.offset);
  if(local) return {contents:{kind:MarkupKind.Markdown,value:`**${escapeMarkdown(local.name)}** — ${escapeMarkdown(local.role)}\n\n${escapeMarkdown(localExplanation(local.role,local.origin,local.certainty))}`},
    range:{start:view.position(local.start),end:view.position(local.end)}};
  const result=hover(view.text,view.offset,view.analysis);
  if(!result) return null;
  const help=hoverHelp[result.symbol.kind+':'+result.symbol.name];
  const signatureLine=help?.syntax?`\n\n${escapeMarkdown(help.syntax)}`:result.signature?.forms.map(form => {
    const display=displayForm(result.signature!.name,form);
    return `\n\n${escapeMarkdown(display.label)}`;
  }).join('')??'';
  const description=result.symbol.kind==='stage'?result.summary:help?.summary??result.summary;
  const summary=description?`\n\n${escapeMarkdown(description)}`:'';
  // Only bundled, reviewed HTTPS source links; no query text or executable markdown.
  return {contents:{kind:MarkupKind.Markdown,value:`**${escapeMarkdown(result.symbol.name)}** — XQL ${result.symbol.kind}${summary}${signatureLine}\n\n[Supporting Documentation](${help?.source??result.symbol.source})`},range:{start:view.position(result.start),end:view.position(result.end)}};
});
connection.onSignatureHelp(params => {
  const doc=documents.get(params.textDocument.uri);
  if(!doc) return null;
  const view=viewAt(doc,params.position);
  if(!view) return null;
  const help=signatureHelp(view.text,view.offset,undefined,view.analysis.structure.tree);
  if(!help) return null;
  const summary=help.summary?`\n\n${escapeMarkdown(help.summary)}`:'';
  return {
    signatures:help.signatures.map(s => ({label:s.label,parameters:[...s.parameters],
      ...(s.activeParameter!==undefined?{activeParameter:s.activeParameter}:{}),
      documentation:{kind:MarkupKind.Markdown,value:`[Supporting Documentation](${s.source})${summary}`}})),
    activeSignature:help.activeSignature,
    ...(help.activeParameter!==undefined?{activeParameter:help.activeParameter}:{})
  };
});
connection.languages.semanticTokens.on(params => {
  const doc=documents.get(params.textDocument.uri);
  const builder=new SemanticTokensBuilder();
  if(doc?.languageId==='yaml') return builder.build();
  const analysis=doc?analysisFor(doc):undefined;
  if(doc&&analysis) for(const token of semanticTokens(doc.getText(),analysis)) {
    const position=doc.positionAt(token.start);
    const type=tokenTypes.indexOf(token.type);
    if(type>=0) builder.push(position.line,position.character,token.end-token.start,type,semanticModifierBits(token));
  }
  return builder.build();
});
connection.onShutdown(() => {for(const timer of pending.values()) clearTimeout(timer); pending.clear(); analyses.clear(); yamlVersions.clear();});
documents.listen(connection);
connection.listen();

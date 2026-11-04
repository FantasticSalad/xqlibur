import {createHash} from 'node:crypto';
import {MAX_LENGTH} from './lexer';
import {Structure, structure} from './roles';
import {SymbolIndex, buildSymbols} from './symbols';
import {Pipeline} from './pipeline';
import {collectDiagnostics, DiagnosticCoverage, diagnosticCoverage, Finding} from './diagnostics';
import {buildExpressions, ExpressionIndex} from './expressions';
export type {Finding} from './diagnostics';

export interface AnalysisIdentity {documentId:string; version:number}
export interface DocumentAnalysis {identity:AnalysisIdentity; structure:Structure; expressions:ExpressionIndex; symbols:SymbolIndex; pipeline:Pipeline; coverage:DiagnosticCoverage; findings:readonly Finding[]}
export function createAnalysis(text:string,identity:AnalysisIdentity={documentId:'standalone',version:0}):DocumentAnalysis {
  const doc=structure(text);
  const symbols=buildSymbols(doc,identity.documentId,identity.version);
  const pipeline=new Pipeline(doc,symbols),input={structure:doc,expressions:buildExpressions(doc),symbols,pipeline},coverage=diagnosticCoverage(input);
  return {identity:{...identity},...input,coverage,findings:collectDiagnostics(input,coverage)};
}
interface OpenDocument {documentId:string; version:number; inconsistent?:boolean; fingerprint?:string}
interface Cached {analysis:DocumentAnalysis; characters:number; tokens:number}
export interface AnalysisStoreOptions {
  maxDocuments?:number; maxCharacters?:number; maxTokens?:number;
  factory?:(text:string,identity:AnalysisIdentity)=>DocumentAnalysis;
}
/** One analysis per open URI/version; bounded LRU stores no closed document text. */
export class AnalysisStore {
  private readonly openDocuments=new Map<string,OpenDocument>();
  private readonly cache=new Map<string,Cached>();
  private serial=0;
  private characters=0;
  private tokens=0;
  private builds=0;
  private readonly maxDocuments:number;
  private readonly maxCharacters:number;
  private readonly maxTokens:number;
  private readonly factory:(text:string,identity:AnalysisIdentity)=>DocumentAnalysis;
  constructor(options:AnalysisStoreOptions={}) {
    this.maxDocuments=options.maxDocuments??16;this.maxCharacters=options.maxCharacters??4*MAX_LENGTH;this.maxTokens=options.maxTokens??100000;
    for(const value of [this.maxDocuments,this.maxCharacters,this.maxTokens]) if(!Number.isSafeInteger(value)||value<1) throw new RangeError('Invalid analysis cache bound');
    this.factory=options.factory??createAnalysis;
  }
  private drop(uri:string) {
    const previous=this.cache.get(uri);
    if(previous) {this.characters-=previous.characters;this.tokens-=previous.tokens;this.cache.delete(uri);}
  }
  open(uri:string,version:number) {
    if(!Number.isSafeInteger(version)) return false;
    this.drop(uri);this.openDocuments.set(uri,{documentId:'document-'+(++this.serial),version});
    return true;
  }
  change(uri:string,version:number):boolean {
    const current=this.openDocuments.get(uri);
    if(!current||!Number.isSafeInteger(version)||version<current.version) return false;
    if(version!==current.version) {this.drop(uri);current.version=version;current.inconsistent=false;current.fingerprint=undefined;}
    return !current.inconsistent;
  }
  get(uri:string,version:number,text:string):DocumentAnalysis|undefined {
    const current=this.openDocuments.get(uri);
    if(!current||current.version!==version||current.inconsistent) return;
    const previous=this.cache.get(uri);
    if(previous) {
      if(previous.analysis.structure.text!==text) {this.drop(uri);current.inconsistent=true;return;}
      this.cache.delete(uri);this.cache.set(uri,previous);return previous.analysis;
    }
    // Cache eviction must not forget version/content consistency. Store only a
    // bounded digest, never extra query text; cache hits compare the exact text.
    // UTF-16LE preserves even unpaired code units. Oversized input stays limit-only
    // without hashing its body, and cannot become analysable at the same version.
    const fingerprint=text.length>MAX_LENGTH?'limited:'+text.length:createHash('sha256').update(text,'utf16le').digest('hex');
    if(current.fingerprint!==undefined&&current.fingerprint!==fingerprint) {current.inconsistent=true;return;}
    current.fingerprint=fingerprint;
    const analysis=this.factory(text,{documentId:current.documentId,version});this.builds++;
    const characters=text.length,tokens=analysis.structure.tree.tokens.length;
    if(characters>MAX_LENGTH||characters>this.maxCharacters||tokens>this.maxTokens) return analysis;
    while(this.cache.size>=this.maxDocuments||this.characters+characters>this.maxCharacters||this.tokens+tokens>this.maxTokens) this.drop(this.cache.keys().next().value!);
    this.cache.set(uri,{analysis,characters,tokens});this.characters+=characters;this.tokens+=tokens;
    return analysis;
  }
  close(uri:string) {this.drop(uri);this.openDocuments.delete(uri);}
  clear() {this.cache.clear();this.openDocuments.clear();this.characters=0;this.tokens=0;}
  get stats() {return {open:this.openDocuments.size,cached:this.cache.size,characters:this.characters,tokens:this.tokens,builds:this.builds};}
}

import catalogue from '../../reference/catalogue.json';
import type {Structure} from './roles';
import type {Pipeline} from './pipeline';
import type {SymbolIndex} from './symbols';
import type {Span} from './syntax';
import {functionFact, FunctionFact,callFormsForStage} from './reference';
import {pathKey} from './symbols';
import type {ExpressionIndex} from './expressions';

export interface Finding extends Span {code:string; message:string; severity:'error'|'warning'|'information'}
export interface DiagnosticRule {
  code:string; category:'limit'|'structure'|'reference'|'localName'|'arity'; enabled:boolean;
  severity:Finding['severity']; confidence:'structural'|'inventoryOnly'|'provenLocal'|'verifiedForms';
  parser:readonly string[]; facts:readonly string[]; suppress:readonly string[];
}
/** Explicit runtime registry. Development fact ledgers are never loaded by the server. */
export const diagnosticRules:readonly DiagnosticRule[]=Object.freeze([
  {code:'XQL000',category:'limit',enabled:true,severity:'information',confidence:'structural',parser:['document/frame limits'],facts:[],suppress:[]},
  ...['XQL101','XQL102','XQL103','XQL104'].map(code=>({code,category:'structure' as const,enabled:true,severity:'error' as const,confidence:'structural' as const,
    parser:['opaque literals/comments','balanced framing'],facts:['double-quote-escapes'],suppress:['analysis limit']})),
  ...['XQL201','XQL202'].map(code=>({code,category:'reference' as const,enabled:true,severity:'warning' as const,confidence:'inventoryOnly' as const,
    parser:['recognized stage/call site'],facts:['bundled catalogue date'],suppress:['analysis limit','members/literal interiors']})),
  {code:'XQL301',category:'localName',enabled:true,severity:'warning',confidence:'provenLocal',parser:['complete supported stage','closed ordinary input shape','resolved earlier binding'],
    facts:['fields-transfer','system-field-retention','alter-order','aggregate-output-transfer'],suppress:['open/uncertain/wildcard inputs','unknown transfer','query alias/JSON member','incomplete syntax','system retention exception']},
  {code:'XQL302',category:'arity',enabled:true,severity:'warning',confidence:'verifiedForms',parser:['closed complete call','known nested calls','complete stage'],
    facts:['complete contextual arityVerified forms','explicit direct counts for special displays'],suppress:['displayOnly/partial facts','unverified special call alternatives','infix notation','incomplete arguments','unsupported stage','unknown inner call']}
]);
const names=new Set(catalogue.symbols.map(s=>s.kind+':'+s.name));
export interface DiagnosticInput {structure:Structure; expressions:ExpressionIndex; symbols:SymbolIndex; pipeline:Pipeline}
export interface StageCoverage {stageStart:number; queryId:string; complete:boolean; supported:boolean; closedInput:boolean; dependentRules:boolean}
export interface CallCoverage extends Span {stageStart?:number; complete:boolean; knownNestedCalls:boolean; dependentRules:boolean}
export interface DiagnosticCoverage {limited:boolean; stages:ReadonlyMap<number,StageCoverage>; calls:ReadonlyMap<number,CallCoverage>; rootFindings:readonly Finding[]}

function baseline(doc:Structure):Finding[] {
  const tree=doc.tree;
  if(tree.limited) return [{code:'XQL000',severity:'information',message:'Analysis paused: document length or nesting exceeds the local analysis limit.',start:0,end:0}];
  const findings:Finding[]=tree.issues.map(f=>({...f,severity:'error'}));
  for(const stage of tree.stages) if(!names.has('stage:'+stage.name.text)) findings.push({code:'XQL201',severity:'warning',start:stage.name.start,end:stage.name.end,
    message:"Stage '"+stage.name.text+"' is not in the bundled reference; newer syntax may be supported by Cortex."});
  for(const call of tree.calls) if(!names.has('function:'+call.name.text)) findings.push({code:'XQL202',severity:'warning',start:call.name.start,end:call.name.end,
    message:"Function '"+call.name.text+"' is not in the bundled reference; this does not establish a Cortex error."});
  return findings.sort((a,b)=>a.start-b.start).slice(0,100);
}
/** Compute coverage before dependent rules. Existing baseline findings retain their meanings. */
export function diagnosticCoverage(input:DiagnosticInput):DiagnosticCoverage {
  const {structure:doc,pipeline}=input,rootFindings=baseline(doc),stages=new Map<number,StageCoverage>(),calls=new Map<number,CallCoverage>();
  if(doc.tree.limited) return {limited:true,stages,calls,rootFindings};
  const unsupportedStages=new Set<number>();
  for(const [stageStart,ids] of input.expressions.byStage) if(ids.some(id=>input.expressions.nodes[id]!.state!=='complete')) unsupportedStages.add(stageStart);
  for(const transfer of pipeline.stages) {
    const supported=transfer.kind!=='unknown',complete=transfer.complete;
    const blocked=rootFindings.some(f=>f.start>=transfer.stage.name.start&&f.start<transfer.stage.end);
    stages.set(transfer.stage.name.start,{stageStart:transfer.stage.name.start,queryId:transfer.stage.queryId,complete,supported,
      closedInput:!transfer.before.open,dependentRules:supported&&complete&&!blocked&&!input.expressions.limited&&!unsupportedStages.has(transfer.stage.name.start)});
  }
  // Prefix counts answer interval prerequisites without scanning all nested calls per call.
  const tokens=doc.tree.tokens,unclosed=[0],unknownCalls=[0];
  const unknownStarts=new Set(rootFindings.filter(f=>f.code==='XQL202').map(f=>f.start));
  for(const token of tokens) {unclosed.push(unclosed.at(-1)!+(token.closed?0:1));unknownCalls.push(unknownCalls.at(-1)!+(unknownStarts.has(token.start)?1:0));}
  const lower=(offset:number)=>{let lo=0,hi=tokens.length;while(lo<hi) {const mid=(lo+hi)>>>1;if(tokens[mid]!.start<offset) lo=mid+1;else hi=mid;}return lo;};
  const contexts=new Map(doc.tree.contexts.map(c=>[c.token.start,c]));
  for(const call of doc.tree.calls) {
    const start=call.name.start,end=call.close?.end??call.end,from=lower(start),to=lower(end),context=contexts.get(start);
    const complete=!!call.close&&unclosed[to]===unclosed[from]&&!doc.tree.issues.some(i=>i.start>=start&&i.start<end);
    const knownNestedCalls=unknownCalls[to]===unknownCalls[from];
    calls.set(start,{start,end,stageStart:context?.stageStart,complete,knownNestedCalls,
      dependentRules:complete&&knownNestedCalls&&context?.stageStart!==undefined&&!!stages.get(context.stageStart)?.dependentRules});
  }
  return {limited:false,stages,calls,rootFindings};
}
export function collectDiagnostics(input:DiagnosticInput,coverage=diagnosticCoverage(input)):Finding[] {
  if(coverage.limited||coverage.rootFindings.length>=100) return [...coverage.rootFindings];
  return [...coverage.rootFindings,...removedNameFindings(input,coverage),...arityFindings(input,coverage)].sort((a,b)=>a.start-b.start).slice(0,100);
}

export function removedNameFindings(input:DiagnosticInput,coverage=diagnosticCoverage(input)):Finding[] {
  const result:Finding[]=[],reported=new Set<string>(),{structure:doc,pipeline,symbols}=input;
  const writtenRoots=new Map<number,Set<string>>(),lastTokens=new Map<number,number>();
  for(const assignment of doc.assignments) {const roots=writtenRoots.get(assignment.stageStart)??new Set();roots.add(assignment.path.components[0]!.text);writtenRoots.set(assignment.stageStart,roots);}
  for(const context of doc.tree.contexts) if(context.stageStart!==undefined) lastTokens.set(context.stageStart,context.token.end);
  for(const use of symbols.uses) {
    if(use.access!=='read'||use.role!=='field'||use.qualifierBindingId||use.navigation.includes('->')||use.stageStart===undefined) continue;
    const stage=coverage.stages.get(use.stageStart),transfer=pipeline.transferAt(use.stageStart);
    if(!stage?.dependentRules||!stage.closedInput||!transfer?.before.absenceSafe||writtenRoots.get(use.stageStart)?.has(use.path[0]!)) continue;
    // A bare trailing identifier is still a live edit; wait for following syntax or a pipe.
    if(transfer.stage.boundary==='eof'&&use.span.end===(lastTokens.get(use.stageStart)??-1)) continue;
    const proof=pipeline.removal(transfer.before,use.path);
    if(!proof?.bindingId||proof.certainty!=='known'||!symbols.byId.has(proof.bindingId)) continue;
    const key=use.stageStart+':'+pathKey(use.path);if(reported.has(key)) continue;reported.add(key);
    const reason=proof.reason==='renamed'?"was renamed to '"+proof.replacement+"'":"was removed";
    result.push({code:'XQL301',severity:'warning',start:use.span.start,end:use.span.end,
      message:"Local binding '"+use.path.join('.')+"' "+reason+' by an earlier supported projection. This is local scope evidence, not tenant validation.'});
    if(result.length>=100) break;
  }
  return result;
}

/** Only complete supported expression productions; unproved shapes fail open. */
export function arityFindings(input:DiagnosticInput,coverage=diagnosticCoverage(input),lookup:(name:string)=>FunctionFact|undefined=functionFact):Finding[] {
  if(coverage.limited) return [];
  const {structure:doc}=input,result:Finding[]=[],tokens=doc.tree.tokens.filter(t=>t.kind!=='comment');
  const lower=(offset:number)=>{let lo=0,hi=tokens.length;while(lo<hi) {const mid=(lo+hi)>>>1;if(tokens[mid]!.start<offset) lo=mid+1;else hi=mid;}return lo;};
  for(const call of [...doc.tree.calls].reverse()) {
    const expressionId=input.expressions.byCall.get(call.name.start);
    if(!coverage.calls.get(call.name.start)?.dependentRules||expressionId===undefined||input.expressions.nodes[expressionId]!.state!=='complete') continue;
    if(result.some(f=>f.start>call.name.start&&f.start<call.end)) continue;
    const fact=lookup(call.name.text);if(fact?.status!=='verified') continue;
    const stageStart=coverage.calls.get(call.name.start)?.stageStart,stage=stageStart===undefined?undefined:input.pipeline.transferAt(stageStart)?.stage;
    const forms=callFormsForStage(fact,stage?.name.text);
    if(!forms.length||forms.some(f=>f.validation!=='arityVerified')) continue;
    const empty=lower(call.open.end)===lower(call.close?.start??call.end),count=empty&&!call.commas.length?0:call.arguments.length;
    const allowed=forms.map(form=>form.syntaxKind==='positional'&&form.arityKnown?
      {min:form.parameters.filter(p=>!p.optional).length,max:form.parameters.at(-1)?.repeat?Infinity:form.parameters.length}:
      form.syntaxKind==='special'&&!form.arityKnown?form.callCount:undefined);
    if(allowed.some(range=>!range)) continue;
    if(allowed.some(range=>range&&count>=range.min&&count<=range.max)) continue;
    result.push({code:'XQL302',severity:'warning',start:call.name.start,end:call.name.end,
      message:"Call to '"+call.name.text+"' has "+count+' arguments; no fully verified applicable call form accepts that count. No argument types were inferred.'});
    if(result.length>=100) break;
  }
  return result;
}

import {MAX_LENGTH} from './lexer';
import {RoleSpan, Structure} from './roles';
import {createAnalysis, DocumentAnalysis} from './analysis';

// Append only: clients retain the seven original indexes and declaration bit zero.
export const tokenTypes: readonly string[] = Object.freeze(['keyword','function','property','variable','xqlDataset','number','operator','namespace','parameter']);
export const tokenModifiers: readonly string[] = Object.freeze(['declaration','defaultLibrary']);
export interface SemanticToken {start:number; end:number; type:string; declaration:boolean; defaultLibrary:boolean}
const supported=new Set(tokenTypes);
const splitSurrogate=(text: string,offset: number)=>offset>0&&offset<text.length&&
  text.charCodeAt(offset)>=0xdc00&&text.charCodeAt(offset)<=0xdfff&&text.charCodeAt(offset-1)>=0xd800&&text.charCodeAt(offset-1)<=0xdbff;

/** Sanitize at the protocol boundary; lexical strings/constants stay unmasked. */
export function semanticTokensForRoles(text: string, roles: readonly RoleSpan[]): SemanticToken[] {
  if(text.length>MAX_LENGTH) return [];
  const result: SemanticToken[]=[];
  for(const role of [...roles].sort((a,b)=>a.start-b.start||a.end-b.end)) {
    if(!supported.has(role.type)||!Number.isInteger(role.start)||!Number.isInteger(role.end)||role.start<0||
      role.end<=role.start||role.end>text.length||role.start<(result.at(-1)?.end??0)||
      splitSurrogate(text,role.start)||splitSurrogate(text,role.end)||/[\r\n]/.test(text.slice(role.start,role.end))) continue;
    result.push({start:role.start,end:role.end,type:role.type,
      declaration:role.declaration===true&&['variable','namespace'].includes(role.type),
      defaultLibrary:role.defaultLibrary===true&&role.type==='function'});
  }
  return result;
}
export function semanticTokens(text: string, input: Structure|DocumentAnalysis = createAnalysis(text)): SemanticToken[] {
  const analysis='structure' in input?input:undefined,doc=analysis?.structure??input as Structure;
  if(doc.text!==text||doc.tree.limited) return [];
  if(!analysis) return semanticTokensForRoles(text,doc.roles);
  const roles=new Map(doc.roles.map(r=>[r.start,{...r}]));
  for(const use of analysis.symbols.uses) {
    if(use.role==='parameter') {roles.set(use.span.start,{...use.span,type:'parameter',declaration:false,defaultLibrary:false});continue;}
    if(use.role==='queryAlias') continue; // Structural namespace roles already carry predicate ownership.
    const terminal=use.parts[(use.resolvedPathLength??use.parts.length)-1];if(!terminal) continue;
    let known=use.role==='derivedField'&&use.certainty==='known'&&!!use.bindingId;
    if(use.access==='write'&&use.stageStart!==undefined) {
      const transfer=analysis.pipeline.transferAt(use.stageStart),field=transfer?analysis.pipeline.lookup(transfer.after,use.path):undefined;
      known=!!transfer?.complete&&field?.certainty==='known'&&field.bindingId===use.bindingId;
    }
    if(known||use.access==='write') roles.set(terminal.start,{...terminal,type:known?'variable':'property',declaration:known&&use.access==='write',defaultLibrary:false});
  }
  return semanticTokensForRoles(text,[...roles.values()]);
}
export function semanticModifierBits(token: SemanticToken): number {
  return (token.declaration?1:0)|(token.defaultLibrary?2:0);
}

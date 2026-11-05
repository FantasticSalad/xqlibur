import catalogue from '../../reference/catalogue.json';
import {DocumentAnalysis} from './analysis';
import {contextAt} from './roles';
import {VisibleField} from './pipeline';
import {Span} from './syntax';
import {canSuggestFunction,functionFact} from './reference';

import {stageHelp} from './stage-help';
export interface CompletionCandidate {
  label:string; kind:'stage'|'function'|'field'|'alias'|'option'; replace:Span; insertText:string;
  detail:string; source?:string; summary?:string; rank:number;
}
const starts=new Set(['dataset','cold_dataset','datamodel','preset','config']);
/** Contextual candidates contain names/origins only, never expression/literal values. */
export function completionCandidates(analysis:DocumentAnalysis,offset:number):readonly CompletionCandidate[] {
  const {structure:doc,pipeline,symbols}=analysis,context=contextAt(doc,offset);
  if(!['stage','expression','fieldList','member'].includes(context.kind)||context.access==='write') return [];
  const prefix=doc.text.slice(context.replace.start,offset),result:CompletionCandidate[]=[];
  const stageName=doc.tree.stages.find(stage=>stage.name.start===context.stageStart&&stage.queryId===context.queryId)?.name.text;
  const add=(label:string,kind:CompletionCandidate['kind'],detail:string,rank:number,source?:string,insertText=label)=>{
    if(insertText.startsWith(prefix)) {
      const summary=kind==='function'?functionFact(label)?.summary:kind==='stage'?stageHelp(label)?.summary:undefined;
      result.push({label,kind,replace:{...context.replace},insertText,detail,rank,source,...(summary?{summary}:{})});
    }
  };
  if(context.kind==='stage') {
    const entry=!doc.tree.stages.some(s=>s.queryId===context.queryId&&s.name.start<context.replace.start);
    for(const symbol of catalogue.symbols) if(symbol.kind==='stage'&&(!entry||starts.has(symbol.name))) add(symbol.name,'stage','XQL stage',30,symbol.source);
  } else {
    let environment=pipeline.environmentAt(context.queryId,offset),qualifier=context.qualifier??[];
    const aliases=symbols.bindings.filter(b=>b.role==='queryAlias'&&b.queryId===context.queryId&&b.stageStart===context.stageStart&&offset>=b.availableFrom);
    const alias=context.kind==='member'?aliases.find(b=>b.name===qualifier[0]):undefined;
    if(context.kind==='member') {
      // JSON keys have no discovered schema; '>' only triggers after the actual arrow.
      if(context.navigation?.some(n=>n==='->')) return [];
      if(alias) {environment=pipeline.output(alias.childQueryId!);qualifier=qualifier.slice(1);}
    }
    const fields:VisibleField[]=environment?[...pipeline.fields(environment)]:[];
    const currentWrites=new Set(doc.assignments.filter(a=>a.stageStart===context.stageStart).map(a=>a.path.components[0]?.text));
    // Earlier observations in the active stage are candidates only. Do not offer the
    // word currently being typed, later tokens or names explicitly removed upstream.
    if(context.kind!=='member'&&environment?.open) for(const observation of symbols.observations) {
      if(observation.queryId!==context.queryId||observation.stageStart!==context.stageStart||observation.seenAt>=context.replace.start||observation.navigation.includes('->')||pipeline.removal(environment,observation.path)) continue;
      fields.push({name:observation.name,path:observation.path,certainty:'possible',epoch:environment.epoch,origin:'observed'});
    }
    for(const field of fields) {
      if(currentWrites.has(field.path[0])) continue;
      const local=field.path.slice(qualifier.length);
      if(qualifier.some((part,index)=>field.path[index]!==part)||!local.length) continue;
      const member=context.kind==='member',name=(member?local:field.path).join('.');
      add(name,'field',field.certainty==='known'?'Query-local derived field · '+field.origin:'Observed field candidate · presence unverified',field.certainty==='known'?0:10);
    }
    if(context.kind!=='member') {
      for(const alias of aliases) add(alias.name,'alias','Query alias · join predicate',1);
      if(context.kind==='expression') for(const symbol of catalogue.symbols) if(symbol.kind==='function'&&canSuggestFunction(symbol.name,stageName)) add(symbol.name,'function','XQL function',30,symbol.source);
    }
  }
  const unique=new Map<string,CompletionCandidate>();
  for(const candidate of result.sort((a,b)=>a.rank-b.rank||(a.label<b.label?-1:a.label>b.label?1:0)||a.kind.localeCompare(b.kind))) {
    const key=candidate.replace.start+':'+candidate.replace.end+':'+candidate.insertText;
    if(!unique.has(key)) unique.set(key,candidate);
  }
  return [...unique.values()].slice(0,1000);
}

export interface LocalHover {name:string; role:string; certainty:string; origin:string; start:number; end:number}
export function localHover(analysis:DocumentAnalysis,offset:number):LocalHover|undefined {
  if(!Number.isInteger(offset)||offset<0||offset>=analysis.structure.text.length) return;
  const uses=analysis.symbols.uses.filter(u=>offset>=u.span.start&&offset<u.span.end);
  // A predicate namespace qualifier has priority over its containing member path.
  const use=uses.find(u=>u.role==='queryAlias')??uses[0];if(!use) return;
  const part=use.parts.findIndex(p=>offset>=p.start&&offset<p.end);if(part<0) return;
  const binding=use.bindingId?analysis.symbols.byId.get(use.bindingId):undefined;
  const resolved=use.resolvedPathLength??use.path.length;
  if(part>=resolved&&use.navigation.includes('->')) return {name:use.path.slice(resolved).join('.'),role:'JSON member',certainty:'possible',origin:'No local schema',...use.parts[part]!};
  let certainty=use.certainty;
  if(use.access==='write'&&use.stageStart!==undefined&&binding?.role==='derivedField') {
    const environment=analysis.pipeline.transferAt(use.stageStart)?.after;
    certainty=environment?analysis.pipeline.lookup(environment,use.path)?.certainty??'possible':'possible';
  }
  return {name:binding?.name??use.path.join('.'),role:binding?.role==='queryAlias'?'query alias':binding?.role==='parameter'?'callback parameter':binding?'derived field':'field candidate',
    certainty,origin:binding?.origin??'Observed name; source membership unverified',start:use.parts[0]!.start,end:use.parts[resolved-1]!.end};
}

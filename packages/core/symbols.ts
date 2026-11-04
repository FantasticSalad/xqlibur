import {Structure} from './roles';
import {Span} from './syntax';

export type Certainty='known'|'possible'|'unknown';
export type NameRole='field'|'derivedField'|'queryAlias'|'parameter';
export interface QueryScope extends Span {id:string; queryId:string; parentId?:string; kind:'query'|'callback'}
export interface NameBinding {
  id:string; name:string; path:readonly string[]; role:NameRole; scopeId:string; queryId:string;
  declaration?:Span; availableFrom:number; certainty:Certainty; version:number;
  stageStart?:number; childQueryId?:string; origin:'alter'|'projection'|'aggregate'|'join'|'callback';
  sourcePath?:readonly string[];
}
export interface NameUse {
  span:Span; parts:readonly Span[]; path:readonly string[]; navigation:readonly string[];
  scopeId:string; queryId:string; stageStart?:number; bindingId?:string; qualifierBindingId?:string;
  role:NameRole; access:'read'|'write'; certainty:Certainty; resolvedPathLength?:number;
}
export interface Observation {name:string; path:readonly string[]; navigation:readonly string[]; scopeId:string; queryId:string; stageStart?:number; seenAt:number; certainty:'possible'}
export interface SymbolIndex {
  scopes:QueryScope[]; bindings:NameBinding[]; uses:NameUse[]; observations:Observation[];
  byId:ReadonlyMap<string,NameBinding>; writes:ReadonlyMap<number,NameBinding>;
}
export const pathKey=(parts:readonly string[])=>parts.join('\0');

/** Bind declarations now; pipeline-sensitive field reads are resolved by S02. */
export function buildSymbols(doc:Structure,documentId:string,documentVersion:number):SymbolIndex {
  const prefix=documentId+'@'+documentVersion;
  const scopeId=(queryId:string)=>prefix+'/'+queryId;
  const result:SymbolIndex={scopes:doc.tree.queries.map(q=>({id:scopeId(q.id),queryId:q.id,
    parentId:q.parentId?scopeId(q.parentId):undefined,start:q.start,end:q.end,kind:'query'})),bindings:[],uses:[],observations:[],byId:new Map(),writes:new Map()};
  if(doc.tree.limited) return result;
  const stages=new Map(doc.tree.stages.map(s=>[s.name.start,s]));
  const records:{binding:Omit<NameBinding,'id'|'version'>;key:number;parts:Span[];navigation:string[]}[]=[];
  const boundary=(stageStart:number)=>{
    const stage=stages.get(stageStart)!;
    return stage.end+(stage.boundary==='close'?0:1);
  };
  const add=(binding:Omit<NameBinding,'id'|'version'>,key:number,parts:Span[],navigation:string[]=[])=>records.push({binding,key,parts,navigation});
  for(const assignment of doc.assignments) {
    const path=assignment.path.components.map(t=>t.text),terminal=assignment.path.components.at(-1)!;
    add({name:path.join('.'),path,role:'derivedField',scopeId:scopeId(assignment.queryId),queryId:assignment.queryId,
      declaration:{start:assignment.path.start,end:assignment.path.end},availableFrom:boundary(assignment.stageStart),
      certainty:assignment.complete?'known':'possible',stageStart:assignment.stageStart,origin:'alter'},terminal.start,
      assignment.path.components.map(t=>({start:t.start,end:t.end})),assignment.path.separators.map(t=>t.text));
  }
  for(const list of doc.fieldLists) for(const entry of list.entries) if(entry.alias) {
    const token=entry.alias,path=[token.text];
    add({name:token.text,path,role:'derivedField',scopeId:scopeId(list.queryId),queryId:list.queryId,declaration:{start:token.start,end:token.end},
      availableFrom:boundary(list.stageStart),certainty:list.complete&&entry.complete?'known':'possible',stageStart:list.stageStart,
      origin:'projection',sourcePath:entry.path.components.map(t=>t.text)},token.start,[{start:token.start,end:token.end}]);
  }
  for(const output of doc.outputs) {
    const token=output.name;
    add({name:token.text,path:[token.text],role:'derivedField',scopeId:scopeId(output.queryId),queryId:output.queryId,
      declaration:{start:token.start,end:token.end},availableFrom:boundary(output.stageStart),certainty:output.complete?'known':'possible',
      stageStart:output.stageStart,origin:'aggregate'},token.start,[{start:token.start,end:token.end}]);
  }
  for(const alias of doc.queryAliases) {
    const token=alias.name;
    add({name:token.text,path:[token.text],role:'queryAlias',scopeId:scopeId(alias.queryId),queryId:alias.queryId,
      declaration:{start:token.start,end:token.end},availableFrom:token.end,certainty:'known',stageStart:alias.stageStart,
      childQueryId:alias.childQueryId,origin:'join'},token.start,[{start:token.start,end:token.end}]);
  }
  const callbackOwners=new Map<number,NameBinding>();
  const callsByStart=new Map(doc.tree.calls.map(c=>[c.name.start,c]));
  const versions=new Map<string,number>(),byId=new Map<string,NameBinding>(),writes=new Map<number,NameBinding>();
  records.sort((a,b)=>a.key-b.key);
  for(const record of records) {
    if(writes.has(record.key)) continue;
    const identity=record.binding.scopeId+'/'+(record.binding.role==='queryAlias'?'namespace':'field')+'/'+pathKey(record.binding.path);
    const version=(versions.get(identity)??0)+1;versions.set(identity,version);
    const binding:NameBinding={...record.binding,id:prefix+'/'+record.binding.queryId+'/'+record.key+':'+version,version};
    result.bindings.push(binding);byId.set(binding.id,binding);writes.set(record.key,binding);
    result.uses.push({span:binding.declaration!,parts:record.parts,path:binding.path,navigation:record.navigation,
      scopeId:binding.scopeId,queryId:binding.queryId,stageStart:binding.stageStart,bindingId:binding.id,
      role:binding.role,access:'write',certainty:binding.certainty});
  }
  const aliases=new Map(result.bindings.filter(b=>b.role==='queryAlias').map(b=>[b.stageStart,b]));
  const roleAt=new Map(doc.roles.map(r=>[r.start,r]));
  const wildcards=new Set(doc.fieldLists.flatMap(f=>f.entries.filter(e=>e.path.wildcard).map(e=>e.path.start)));
  const observed=new Set<string>();
  for(const path of doc.paths) {
    const terminal=path.components.at(-1)!;
    if(writes.has(terminal.start)||!path.complete||wildcards.has(path.start)) continue;
    if(!['property','variable'].includes(roleAt.get(terminal.start)?.type??'')) continue;
    const parts=path.components.map(t=>({start:t.start,end:t.end})),names=path.components.map(t=>t.text),navigation=path.separators.map(t=>t.text);
    const alias=path.stageStart===undefined?undefined:aliases.get(path.stageStart);
    const qualified=alias&&path.start>=alias.availableFrom&&names.length>1&&names[0]===alias.name&&navigation[0]==='.'?alias:undefined;
    if(qualified) result.uses.push({span:parts[0]!,parts:[parts[0]!],path:[qualified.name],navigation:[],
      scopeId:qualified.scopeId,queryId:path.queryId,stageStart:path.stageStart,bindingId:qualified.id,role:'queryAlias',access:'read',certainty:'known'});
    const use:NameUse={span:{start:path.start,end:path.end},parts,path:names,navigation,scopeId:scopeId(path.queryId),queryId:path.queryId,
      stageStart:path.stageStart,qualifierBindingId:qualified?.id,role:'field',access:'read',certainty:'possible'};
    result.uses.push(use);
    const key=use.scopeId+'/'+pathKey(names)+'/'+navigation.join('');
    if(!qualified&&!observed.has(key)) {
      observed.add(key);result.observations.push({name:names.join('.'),path:names,navigation,scopeId:use.scopeId,queryId:use.queryId,stageStart:use.stageStart,seenAt:path.start,certainty:'possible'});
    }
  }
  for(const placeholder of doc.placeholders) {
    let binding=callbackOwners.get(placeholder.ownerCallStart);
    if(!binding) {
      const call=callsByStart.get(placeholder.ownerCallStart)!;
      const callbackScope=scopeId(placeholder.queryId)+'/callback:'+placeholder.ownerCallStart;
      result.scopes.push({...call.arguments[1]!,id:callbackScope,queryId:placeholder.queryId,parentId:scopeId(placeholder.queryId),kind:'callback'});
      binding={id:callbackScope+'/element',name:'@element',path:['@element'],role:'parameter',scopeId:callbackScope,queryId:placeholder.queryId,
        availableFrom:call.arguments[1]!.start,certainty:'known',version:1,origin:'callback'};
      callbackOwners.set(placeholder.ownerCallStart,binding);result.bindings.push(binding);byId.set(binding.id,binding);
    }
    result.uses.push({span:{start:placeholder.start,end:placeholder.end},parts:[{start:placeholder.start,end:placeholder.end}],path:['@element'],navigation:[],
      scopeId:binding.scopeId,queryId:placeholder.queryId,bindingId:binding.id,role:'parameter',access:'read',certainty:'known'});
  }
  result.bindings.sort((a,b)=>(a.declaration?.start??a.availableFrom)-(b.declaration?.start??b.availableFrom));
  result.uses.sort((a,b)=>a.span.start-b.span.start||a.span.end-b.span.end);
  result.byId=byId;result.writes=writes;
  return result;
}

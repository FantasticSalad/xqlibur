import {FieldEntry, Structure} from './roles';
import {Certainty, NameBinding, SymbolIndex, pathKey} from './symbols';
import {Span, StageNode, TokenContext} from './syntax';

export interface VisibleField {
  name:string; path:readonly string[]; certainty:Certainty; bindingId?:string; originBindingId?:string;
  epoch:number; origin:'observed'|'alter'|'projection'|'aggregate'|'window'|'union'; ambiguous?:boolean;
}
export interface RemovalProof {path:readonly string[]; reason:'excluded'|'projected'|'renamed'; stage:Span; replacement?:string; epoch:number; bindingId?:string; certainty:Certainty}
export type SystemPolicy='dataset'|'xdm'|'unknown';
/** Delta nodes retain stage snapshots without copying every field at every pipe. */
export interface FieldEnvironment {
  readonly id:number; readonly queryId:string; readonly parent?:FieldEnvironment; readonly reset:boolean; readonly open:boolean;
  readonly epoch:number; readonly systemPolicy:SystemPolicy;
  readonly proofBoundary?:boolean;
  readonly absenceSafe:boolean;
  readonly changes:ReadonlyMap<string,VisibleField|null>; readonly removals:ReadonlyMap<string,RemovalProof|null>;
  readonly touchedRoots:ReadonlySet<string>;
}
export interface StageTransfer {stage:StageNode; before:FieldEnvironment; after:FieldEnvironment; complete:boolean; kind:'source'|'alter'|'projection'|'aggregate'|'window'|'join'|'union'|'preserve'|'unknown'; conflictStrategy?:'left'|'right'|'both'}
// Public fields stage retention exceptions, checked 2026-10-25. Presence is never inferred.
// https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/stages/fields
export const datasetSystemFields=Object.freeze(['_time','_insert_time','_raw_log','_product','_vendor','_tag','_snapshot_id','_snapshot_log_count','_snapshot_collection_ts','_id']);
export const xdmSystemFields=Object.freeze(['_time']);
const protectedField=(path:readonly string[],policy:SystemPolicy)=>path.length===1&&(policy==='xdm'?xdmSystemFields:datasetSystemFields).includes(path[0]!);
const possible=(field:VisibleField):VisibleField=>({...field,certainty:'possible',bindingId:undefined});
const exactPath=(entry:FieldEntry)=>entry.path.components.map(t=>t.text);
const wordOperators=new Set(['and','or','not','in','contains','incidr','incidr6']);
function unsupportedExpression(items:readonly TokenContext[]):boolean {
  for(let index=0;index<items.length;index++) {
    const token=items[index]!.token,prior=items[index-1]?.token;
    if(token.kind==='punctuation'&&!['(',')','[',']','{','}',',','.'].includes(token.text)) return true;
    if(prior&&['identifier','number','string'].includes(prior.kind)&&['identifier','number','string'].includes(token.kind)&&
      !wordOperators.has(prior.text)&&!wordOperators.has(token.text)) return true;
  }
  return false;
}

/** Only '*' is an operator. Literal segments use prefix tables, never query regexes. */
function fieldPatternMatcher(pattern:string):(value:string)=>boolean {
  if(!pattern.includes('*')) return value=>pattern===value;
  const parts=pattern.split('*'),prefix=parts[0]!,suffix=parts.at(-1)!;
  const segments=parts.slice(1,-1).filter(Boolean).map(literal=>{
    const failure=new Uint32Array(literal.length);
    for(let index=1,matched=0;index<literal.length;index++) {
      while(matched&&literal[index]!==literal[matched]) matched=failure[matched-1]!;
      if(literal[index]===literal[matched]) matched++;
      failure[index]=matched;
    }
    return {literal,failure};
  });
  return value=>{
    let cursor=prefix.length;
    const end=value.length-suffix.length;
    if(cursor>end||!value.startsWith(prefix)||!value.endsWith(suffix)) return false;
    for(const {literal,failure} of segments) {
      if(literal.length>end-cursor) return false;
      let matched=0;
      for(;cursor<end;cursor++) {
        while(matched&&value[cursor]!==literal[matched]) matched=failure[matched-1]!;
        if(value[cursor]===literal[matched]) matched++;
        if(matched===literal.length) {cursor++;break;}
      }
      if(matched!==literal.length) return false;
    }
    return true;
  };
}
export function fieldPatternMatches(pattern:string,value:string):boolean {return fieldPatternMatcher(pattern)(value);}

/** Repeated or ancestor/descendant writes have no evidenced same-stage ordering. */
function ambiguousWrites(bindings:readonly NameBinding[]):Set<string> {
  interface Trie {children:Map<string,Trie>; terminals:string[]; count:number}
  const root:Trie={children:new Map(),terminals:[],count:0};
  for(const binding of bindings) {
    let node=root;node.count++;
    for(const part of binding.path) {
      let child=node.children.get(part);
      if(!child) {child={children:new Map(),terminals:[],count:0};node.children.set(part,child);}
      node=child;node.count++;
    }
    node.terminals.push(pathKey(binding.path));
  }
  const result=new Set<string>(),stack=[{node:root,ancestor:false}];
  while(stack.length) {
    const {node,ancestor}=stack.pop()!;
    if(ancestor||node.count>1) for(const key of node.terminals) result.add(key);
    for(const child of node.children.values()) stack.push({node:child,ancestor:ancestor||node.terminals.length>0});
  }
  return result;
}

export class Pipeline {
  readonly stages:StageTransfer[]=[];
  private serial=0;
  private readonly byStage=new Map<number,StageTransfer>();
  private readonly byQuery=new Map<string,StageTransfer[]>();
  private readonly initial=new Map<string,FieldEnvironment>();
  private readonly writtenRoots=new Map<number,ReadonlySet<string>>();
  private readonly firstDeltaByQuery=new Map<string,Map<string,number>>();
  private readonly memo=new Map<string,VisibleField|null>();
  private readonly views=new Map<number,readonly VisibleField[]>();
  private viewFields=0;
  constructor(readonly structure:Structure,readonly symbols:SymbolIndex) {this.build();this.resolve();}
  private env(parent?:FieldEnvironment,options:Partial<Omit<FieldEnvironment,'id'|'parent'>>={}):FieldEnvironment {
    const environment:FieldEnvironment={id:++this.serial,queryId:parent?.queryId??'q0',parent,reset:false,open:parent?.open??true,epoch:parent?.epoch??0,
      systemPolicy:parent?.systemPolicy??'dataset',absenceSafe:parent?.absenceSafe??false,changes:new Map(),removals:new Map(),touchedRoots:new Set(),...options};
    const firstDelta=this.firstDeltaByQuery.get(environment.queryId)??new Map<string,number>();
    for(const key of environment.changes.keys()) if(!firstDelta.has(key)) firstDelta.set(key,environment.id);
    for(const key of environment.removals.keys()) if(!firstDelta.has(key)) firstDelta.set(key,environment.id);
    this.firstDeltaByQuery.set(environment.queryId,firstDelta);
    return environment;
  }
  private uncertain(parent:FieldEnvironment):FieldEnvironment {return this.env(parent,{open:true,epoch:parent.epoch+1,systemPolicy:'unknown',absenceSafe:false});}
  lookup(environment:FieldEnvironment,path:readonly string[]):VisibleField|undefined {
    const key=pathKey(path),memoKey=environment.id+':'+key;
    // A negative prefilter only: older snapshots and other query scopes cannot
    // acquire a name before its first candidate/declaration/proof delta in this query.
    const firstDelta=this.firstDeltaByQuery.get(environment.queryId)?.get(key);
    if(firstDelta===undefined||firstDelta>environment.id) return;
    if(this.memo.has(memoKey)) return this.memo.get(memoKey)??undefined;
    let field:VisibleField|undefined,shadowed=false;
    for(let node:FieldEnvironment|undefined=environment;node;node=node.parent) {
      if(node.changes.has(key)) {field=node.changes.get(key)??undefined;break;}
      if(node.touchedRoots.has(path[0]!)) shadowed=true;
      if(node.reset) break;
      const prior=this.memo.get((node.parent?.id??-1)+':'+key);
      if(prior!==undefined) {field=prior??undefined;break;}
    }
    if(field&&(shadowed||field.epoch!==environment.epoch)) field=possible(field);
    if(this.memo.size>=4096) this.memo.delete(this.memo.keys().next().value!);
    this.memo.set(memoKey,field??null);return field;
  }
  fields(environment:FieldEnvironment):readonly VisibleField[] {
    const cached=this.views.get(environment.id);if(cached) return cached;
    const seen=new Set<string>(),roots=new Set<string>(),result:VisibleField[]=[];
    for(let node:FieldEnvironment|undefined=environment;node;node=node.parent) {
      for(const [key,value] of node.changes) if(!seen.has(key)) {
        seen.add(key);
        if(value) result.push(value.epoch!==environment.epoch||roots.has(value.path[0]!)?possible(value):value);
      }
      for(const root of node.touchedRoots) roots.add(root);
      if(node.reset) break;
    }
    if(result.length<=20000) {
      while(this.views.size>=6||this.viewFields+result.length>20000) {
        const first=this.views.keys().next().value!;this.viewFields-=this.views.get(first)!.length;this.views.delete(first);
      }
      this.views.set(environment.id,result);this.viewFields+=result.length;
    }
    return result;
  }
  removal(environment:FieldEnvironment,path:readonly string[]):RemovalProof|undefined {
    if(protectedField(path,environment.systemPolicy)) return;
    const key=pathKey(path);
    const firstDelta=this.firstDeltaByQuery.get(environment.queryId)?.get(key);
    if(firstDelta===undefined||firstDelta>environment.id) return;
    for(let node:FieldEnvironment|undefined=environment;node;node=node.parent) {
      if(node.removals.has(key)) {const proof=node.removals.get(key);return proof?.epoch===environment.epoch?proof:undefined;}
      if(node.changes.get(key)||node.touchedRoots.has(path[0]!)) return;
      if(node.reset||node.proofBoundary) break;
    }
    return;
  }
  environmentAt(queryId:string,offset:number):FieldEnvironment|undefined {
    const stages=this.byQuery.get(queryId)??[];
    // Stage counts are bounded by the document; binary search avoids per-request scans.
    let lo=0,hi=stages.length;
    while(lo<hi) {const mid=(lo+hi)>>>1;if(stages[mid]!.stage.name.start<=offset) lo=mid+1;else hi=mid;}
    const transfer=stages[lo-1];
    return transfer?(offset<=transfer.stage.end?transfer.before:transfer.after):this.initial.get(queryId);
  }
  output(queryId:string):FieldEnvironment|undefined {return this.byQuery.get(queryId)?.at(-1)?.after??this.initial.get(queryId);}
  transferAt(stageStart:number) {return this.byStage.get(stageStart);}
  private build() {
    const doc=this.structure;
    if(doc.tree.limited) return;
    const contexts=new Map<number,TokenContext[]>(),bindings=new Map<number,NameBinding[]>(),observed=new Map<number,typeof this.symbols.observations>();
    for(const item of doc.tree.contexts) if(item.stageStart!==undefined) {const list=contexts.get(item.stageStart)??[];list.push(item);contexts.set(item.stageStart,list);}
    for(const binding of this.symbols.bindings) if(binding.stageStart!==undefined&&binding.role==='derivedField') {
      const list=bindings.get(binding.stageStart)??[];list.push(binding);bindings.set(binding.stageStart,list);
    }
    for(const observation of this.symbols.observations) if(observation.stageStart!==undefined&&!observation.navigation.includes('->')) {
      const list=observed.get(observation.stageStart)??[];list.push(observation);observed.set(observation.stageStart,list);
    }
    const assignments=new Map<number,typeof doc.assignments>(),lists=new Map<number,typeof doc.fieldLists>(),sources=new Map(doc.sources.filter(s=>s.stageStart!==undefined).map(s=>[s.stageStart!,s]));
    for(const item of doc.assignments) {const list=assignments.get(item.stageStart)??[];list.push(item);assignments.set(item.stageStart,list);}
    for(const item of doc.fieldLists) {const list=lists.get(item.stageStart)??[];list.push(item);lists.set(item.stageStart,list);}
    const queryEnvs=new Map<string,FieldEnvironment>();
    for(const query of doc.tree.queries) {const initial=this.env(undefined,{queryId:query.id});this.initial.set(query.id,initial);queryEnvs.set(query.id,initial);}
    const queryStages=new Map<string,StageNode[]>(),childrenByStage=new Map<number,typeof doc.tree.queries>(),aliasesByStage=new Map(doc.queryAliases.map(a=>[a.stageStart,a]));
    for(const stage of doc.tree.stages) {const items=queryStages.get(stage.queryId)??[];items.push(stage);queryStages.set(stage.queryId,items);}
    for(const query of doc.tree.queries) if(query.parentStageStart!==undefined) {const items=childrenByStage.get(query.parentStageStart)??[];items.push(query);childrenByStage.set(query.parentStageStart,items);}
    // Iterative child-first evaluation: no recursion and no parent/sibling field inheritance.
    const ordered=[...doc.tree.queries].reverse().flatMap(q=>queryStages.get(q.id)??[]);
    for(const stage of ordered) {
      const before=queryEnvs.get(stage.queryId)!;
      // Candidate observations remain possible and never establish source membership.
      const additions=new Map<string,VisibleField|null>();
      for(const item of observed.get(stage.name.start)??[]) if(before.open&&!this.lookup(before,item.path)&&!this.removal(before,item.path)) additions.set(pathKey(item.path),{
        name:item.name,path:item.path,certainty:'possible',epoch:before.epoch,origin:'observed'});
      const input=additions.size?this.env(before,{changes:additions}):before;
      const all=(contexts.get(stage.name.start)??[]).filter(c=>c.token.start>=stage.name.end&&c.token.start<stage.end);
      const root=all.filter(c=>c.depth===stage.depth),tail=all.at(-1)?.token;
      const damaged=all.some(c=>!c.token.closed)||doc.tree.issues.some(i=>i.start>=stage.name.start&&i.start<stage.end);
      const tailIncomplete=!tail||tail.kind==='operator'||['and','or','not','in','contains','incidr','incidr6','as','by'].includes(tail.text)||['.',',','(','[','{'].includes(tail.text);
      let after:FieldEnvironment,complete=!damaged&&!tailIncomplete,kind:StageTransfer['kind']='unknown';
      let conflictStrategy:StageTransfer['conflictStrategy'];
      const source=sources.get(stage.name.start);
      if(source) {
        complete=source.complete&&!damaged;kind='source';
        after=this.env(undefined,{queryId:stage.queryId,reset:true,epoch:input.epoch+1,systemPolicy:source.kind==='datamodel'?'xdm':['dataset','cold_dataset'].includes(source.kind)?'dataset':'unknown'});
      } else if(stage.name.text==='alter') {
        const declared=bindings.get(stage.name.start)??[],parsed=assignments.get(stage.name.start)??[];
        complete=complete&&!unsupportedExpression(all)&&parsed.length===1+root.filter(c=>c.token.text===',').length&&parsed.every(a=>a.complete);
        kind='alter';
        const base=complete?input:this.uncertain(input),ambiguous=ambiguousWrites(declared),changes=new Map<string,VisibleField|null>(),removals=new Map<string,RemovalProof|null>();
        this.writtenRoots.set(stage.name.start,new Set(declared.map(b=>b.path[0]!)));
        for(const binding of declared) {
          const key=pathKey(binding.path),known=complete&&binding.certainty==='known'&&!ambiguous.has(key);
          changes.set(key,{name:binding.name,path:binding.path,certainty:known?'known':'possible',bindingId:known?binding.id:undefined,
            epoch:base.epoch,origin:'alter',ambiguous:ambiguous.has(key)});removals.set(key,null);
        }
        after=this.env(base,{changes,removals,touchedRoots:new Set(declared.map(b=>b.path[0]!))});
      } else if(stage.name.text==='fields') {
        const list=lists.get(stage.name.start)?.find(l=>l.kind==='fields');complete=!damaged&&!!list?.complete;
        kind='projection';
        const inputFields=this.fields(input),wildcards=list?.entries.filter(e=>e.path.wildcard)??[];
        if(!complete||!list||wildcards.length*inputFields.length>200000||list.entries.some(e=>e.path.separators.some(t=>t.text==='->')||list.exclude&&!!e.alias||e.path.wildcard&&!!e.alias)) {complete=false;after=this.uncertain(input);}
        else {
          const changes=new Map<string,VisibleField|null>(),removals=new Map<string,RemovalProof|null>();
          const pattern=(entry:FieldEntry)=>doc.text.slice(entry.path.start,entry.path.end).replace(/\s/g,'');
          const patterns=wildcards.map(entry=>({entry,matches:fieldPatternMatcher(pattern(entry))})),exactEntries=new Map<string,FieldEntry[]>();
          for(const entry of list.entries) if(!entry.path.wildcard) {const key=pathKey(exactPath(entry)),items=exactEntries.get(key)??[];items.push(entry);exactEntries.set(key,items);}
          const entries=list.entries,declared=bindings.get(stage.name.start)??[],ambiguous=ambiguousWrites(declared);
          const aliasBindings=new Map(declared.map(b=>[b.declaration?.start,b]));
          const proof=(field:VisibleField,reason:RemovalProof['reason'],replacement?:string)=>{
            if(!protectedField(field.path,input.systemPolicy)) removals.set(pathKey(field.path),{path:field.path,reason,replacement,stage:{start:stage.name.start,end:stage.end},epoch:input.epoch,bindingId:field.bindingId,certainty:field.certainty});
          };
          for(const field of inputFields) {
            const matched=[...(exactEntries.get(pathKey(field.path))??[]),...patterns.filter(p=>p.matches(field.name)).map(p=>p.entry)],protectedName=protectedField(field.path,input.systemPolicy);
            const retained=list.exclude?!matched.length||protectedName:protectedName||matched.some(e=>!e.alias);
            if(retained) changes.set(pathKey(field.path),field);
            else {changes.set(pathKey(field.path),null);proof(field,list.exclude?'excluded':matched.some(e=>e.alias)?'renamed':'projected',matched.find(e=>e.alias)?.alias?.text);}
          }
          // Exact exclusions carry an explicit proof even when their source presence is unknown.
          if(list.exclude) for(const entry of entries.filter(e=>!e.path.wildcard)) {
            const path=exactPath(entry);if(!protectedField(path,input.systemPolicy)) {changes.set(pathKey(path),null);proof(this.lookup(input,path)??{name:path.join('.'),path,certainty:'possible',epoch:input.epoch,origin:'observed'},'excluded');}
          }
          if(!list.exclude) for(const entry of entries) if(!entry.path.wildcard) {
            const path=exactPath(entry),sourceField=this.lookup(input,path),binding=entry.alias?aliasBindings.get(entry.alias.start):undefined;
            const outputPath=binding?.path??path,key=pathKey(outputPath);
            const field:VisibleField=binding?{name:binding.name,path:outputPath,certainty:ambiguous.has(key)?'possible':'known',bindingId:ambiguous.has(key)?undefined:binding.id,
              originBindingId:sourceField?.bindingId,epoch:input.epoch,origin:'projection',ambiguous:ambiguous.has(key)}:
              sourceField??{name:path.join('.'),path,certainty:'possible',epoch:input.epoch,origin:'observed'};
            const prior=changes.get(key);
            // Two selected sources reaching one output name have no unique identity.
            changes.set(key,prior&&prior.bindingId!==field.bindingId?possible({...field,ambiguous:true}):field);
            removals.set(key,null);
          }
          after=this.env(input,{reset:true,changes,removals,open:list.exclude?input.open:entries.some(e=>e.path.wildcard)&&input.open,
            absenceSafe:!wildcards.length&&(!list.exclude||input.absenceSafe)});
        }
      } else if(['join','union'].includes(stage.name.text)) {
        kind=stage.name.text as 'join'|'union';
        const children=childrenByStage.get(stage.name.start)??[],child=children.length===1?children[0]:undefined;
        const childOutput=child?.close?this.output(child.id):undefined;
        const named=kind==='union'&&!child&&root.length===1&&['identifier','string'].includes(root[0]!.token.kind);
        complete=!damaged&&(!!childOutput||named);
        if(kind==='join') {
          const alias=aliasesByStage.get(stage.name.start),prefix=root.filter(c=>c.token.start<(child?.open?.start??stage.end));
          conflictStrategy='right';
          for(let index=0;index<prefix.length;index+=3) {
            const name=prefix[index]?.token.text,value=prefix[index+2]?.token.text;
            if(prefix[index+1]?.token.text!=='='||!name||!value||
              name==='type'&&!['inner','left','right'].includes(value)||name==='conflict_strategy'&&!['both','left','right'].includes(value)||!['type','conflict_strategy'].includes(name)) complete=false;
            if(name==='conflict_strategy'&&['both','left','right'].includes(value??'')) conflictStrategy=value as typeof conflictStrategy;
          }
          if(new Set(prefix.filter((_,i)=>i%3===0).map(c=>c.token.text)).size!==prefix.length/3) complete=false;
          const predicate=alias?all.filter(c=>c.token.start>=alias.name.end):[];
          complete=complete&&!!alias&&predicate.length>0&&!tailIncomplete&&!unsupportedExpression(predicate);
        } else if(child) complete=complete&&root.at(-1)?.token.start===child.close?.start;
        const changes=new Map<string,VisibleField|null>();
        if(!complete) after=this.uncertain(input);
        else if(kind==='union') {
          const epoch=input.epoch+1;
          for(const field of childOutput?this.fields(childOutput):[]) changes.set(pathKey(field.path),{
            ...possible(field),epoch,origin:'union',ambiguous:true});
          after=this.env(input,{changes,epoch,open:input.open||!childOutput||childOutput.open,systemPolicy:'unknown',proofBoundary:true,absenceSafe:false});
        } else {
          const epoch=input.epoch+(childOutput!.open&&conflictStrategy!=='left'?1:0);
          const left=new Map(this.fields(input).map(f=>[pathKey(f.path),f])),right=new Map(this.fields(childOutput!).map(f=>[pathKey(f.path),f]));
          const leftRoots=new Map<string,Set<string>>(),rightRoots=new Map<string,Set<string>>();
          for(const [map,roots] of [[left,leftRoots],[right,rightRoots]] as const) for(const [key,field] of map) {
            const keys=roots.get(field.path[0]!)??new Set<string>();keys.add(key);roots.set(field.path[0]!,keys);
          }
          for(const key of new Set([...left.keys(),...right.keys()])) {
            const l=left.get(key),r=right.get(key),selected=conflictStrategy==='left'?l??r:r??l;
            const side=selected===l?'left':'right',other=side==='left'?right:left,otherEnv=side==='left'?childOutput!:input;
            const otherRoots=(side==='left'?rightRoots:leftRoots).get(selected!.path[0]!);
            const relatedCollision=!!otherRoots&&(otherRoots.size>1||!otherRoots.has(key));
            const ambiguous=relatedCollision||!!l&&!!r&&conflictStrategy==='both'||
              otherEnv.open&&(conflictStrategy==='both'||conflictStrategy!==side)||other.has(key)&&conflictStrategy==='both';
            const field=ambiguous?possible({...selected!,ambiguous:true}):selected!;
            const inherited=l&&(l.epoch===epoch?l:possible(l));
            if(!inherited||inherited.bindingId!==field.bindingId||inherited.certainty!==field.certainty||inherited.ambiguous!==field.ambiguous) changes.set(key,{...field,epoch});
          }
          after=this.env(input,{changes,epoch,open:input.open||childOutput!.open,systemPolicy:'unknown',proofBoundary:true,absenceSafe:false});
        }
      } else if(['comp','windowcomp'].includes(stage.name.text)) {
        const plan=doc.aggregates.get(stage.name.start)!;complete=plan.complete;kind=stage.name.text==='comp'?'aggregate':'window';
        if(!complete) after=this.uncertain(input);
        else {
          const changes=new Map<string,VisibleField|null>(),removals=new Map<string,RemovalProof|null>();
          if(kind==='aggregate') {
            for(const group of plan.groups) {
              const path=group.components.map(t=>t.text),key=pathKey(path);
              changes.set(key,this.lookup(input,path)??{name:path.join('.'),path,certainty:'possible',epoch:input.epoch,origin:'observed'});
            }
            for(const field of this.fields(input)) if(!changes.has(pathKey(field.path))) removals.set(pathKey(field.path),{path:field.path,reason:'projected',epoch:input.epoch,stage:{start:stage.name.start,end:stage.end},bindingId:field.bindingId,certainty:field.certainty});
          }
          const declared=(bindings.get(stage.name.start)??[]).filter(b=>b.certainty==='known'),ambiguous=ambiguousWrites(declared);
          for(const binding of declared) {
            const key=pathKey(binding.path),collision=ambiguous.has(key)||changes.has(key);
            changes.set(key,{name:binding.name,path:binding.path,certainty:collision?'possible':'known',bindingId:collision?undefined:binding.id,
              epoch:input.epoch,origin:kind,ambiguous:collision});removals.set(key,null);
          }
          after=this.env(input,{reset:kind==='aggregate',changes,removals,open:kind==='aggregate'?plan.unknownNames:input.open||plan.unknownNames,
            absenceSafe:!plan.unknownNames&&(kind==='aggregate'||input.absenceSafe),
            touchedRoots:new Set(declared.map(b=>b.path[0]!))});
        }
      } else {
        if(stage.name.text==='filter') {kind='preserve';complete=complete&&!unsupportedExpression(all);}
        if(['sort','dedup'].includes(stage.name.text)) {kind='preserve';complete=complete&&(lists.get(stage.name.start)?.every(l=>l.complete)??false);}
        if(stage.name.text==='limit') {kind='preserve';complete=complete&&root.length===1&&root[0]!.token.kind==='number'&&/^\d+$/.test(root[0]!.token.text);}
        if(stage.name.text==='config') {kind='preserve';complete=complete&&root[0]?.token.text==='case_sensitive'&&root[1]?.token.text==='='&&root.length===3&&['true','false'].includes(root[2]!.token.text);}
        after=kind==='preserve'&&complete?input:this.uncertain(input);
      }
      const transfer={stage,before,after,complete,kind,conflictStrategy};this.stages.push(transfer);this.byStage.set(stage.name.start,transfer);
      const queryStages=this.byQuery.get(stage.queryId)??[];queryStages.push(transfer);this.byQuery.set(stage.queryId,queryStages);queryEnvs.set(stage.queryId,after);
    }
    this.stages.sort((a,b)=>a.stage.name.start-b.stage.name.start);
  }
  private resolve() {
    for(const use of this.symbols.uses) {
      if(use.access!=='read'||use.role!=='field'||use.stageStart===undefined) continue;
      const transfer=this.byStage.get(use.stageStart);if(!transfer) continue;
      const arrow=use.navigation.indexOf('->'),length=arrow<0?use.path.length:arrow+1,path=use.path.slice(0,length);
      // Same-stage ordering is unresolved, including reads of earlier versions of a written name.
      if(transfer.kind==='alter'&&this.writtenRoots.get(use.stageStart)?.has(path[0]!)) continue;
      const qualifier=use.qualifierBindingId?this.symbols.byId.get(use.qualifierBindingId):undefined;
      const environment=qualifier?.childQueryId?this.output(qualifier.childQueryId):transfer.before;
      const field=environment?this.lookup(environment,qualifier?path.slice(1):path):undefined;
      if(field?.certainty==='known'&&field.bindingId) {use.bindingId=field.bindingId;use.role='derivedField';use.certainty='known';use.resolvedPathLength=length;}
    }
  }
}

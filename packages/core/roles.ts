import catalogue from '../../reference/catalogue.json';
import {functionFact} from './reference';
import {parse, Span, StageNode, SyntaxTree, TokenContext} from './syntax';
import {Token} from './lexer';
import {aggregatePlan, AggregatePlan} from './aggregate';

export type RoleKind = 'keyword' | 'function' | 'property' | 'variable' | 'xqlDataset' | 'namespace' | 'parameter' | 'number' | 'operator' | 'constant';
export interface RoleSpan extends Span {type: RoleKind; declaration: boolean; defaultLibrary: boolean}
export interface FieldPath extends Span {components: Token[]; separators: Token[]; queryId: string; stageStart?: number; complete: boolean; wildcard: boolean}
export interface Assignment extends Span {path: FieldPath; value: Span; queryId: string; stageStart: number; complete: boolean}
export interface FieldEntry extends Span {path: FieldPath; alias?: Token; complete: boolean}
export interface FieldList extends Span {queryId: string; stageStart: number; kind: 'fields' | 'group' | 'sort' | 'dedup'; exclude: boolean; entries: FieldEntry[]; complete: boolean}
export interface SourceClause extends Span {queryId: string; stageStart?: number; kind: 'dataset' | 'cold_dataset' | 'datamodel' | 'preset' | 'savedQuery' | 'implicit'; names: Token[]; complete: boolean}
export interface StageOption extends Span {queryId: string; stageStart: number; name: Token; value: Span; complete: boolean}
export interface OutputAlias extends Span {queryId: string; stageStart: number; name: Token; expression: Span; complete: boolean}
export interface QueryAlias extends Span {queryId: string; childQueryId: string; stageStart: number; name: Token}
export interface CallbackPlaceholder extends Span {queryId: string; ownerCallStart: number; argument: number}
export interface Structure {
  text: string; tree: SyntaxTree; roles: RoleSpan[]; paths: FieldPath[];
  assignments: Assignment[]; fieldLists: FieldList[]; sources: SourceClause[];
  options: StageOption[]; outputs: OutputAlias[]; queryAliases: QueryAlias[];
  placeholders: CallbackPlaceholder[];
  aggregates:ReadonlyMap<number,AggregatePlan>;
}
const builtins = new Set(catalogue.symbols.filter(s=>s.kind==='function').map(s=>s.name));
const wordOperators = new Set(['and','or','not','in','contains','incidr','incidr6']);
const constants = new Set(['true','false','null']);
const callbacks = new Set(['arraymap','arrayfilter','array_all','array_any','arrayindexof']);
const optionEnums: Record<string,readonly string[]> = {
  'config.case_sensitive':['true','false'], 'join.type':['inner','left','right'],
  'join.conflict_strategy':['both','left','right'], 'windowcomp.frame_type':['rows','range'],
  'view.type':['pie','column','area','bubble','line','map','scatter'], 'view.order':['default','populated']
};
const span = (first: Token, last: Token = first): Span => ({start:first.start,end:last.end});
const lower = (token?: Token) => token?.text.toLowerCase();

function pathAt(items: TokenContext[], start: number, wildcard = false) {
  const first=items[start];
  if(wildcard&&first?.token.text==='*') return {path:{...span(first.token),components:[],separators:[],queryId:first.queryId,stageStart:first.stageStart,complete:true,wildcard:true} as FieldPath,next:start+1};
  if(first?.token.kind!=='identifier') return;
  const path: FieldPath = {...span(first.token),components:[first.token],separators:[],queryId:first.queryId,
    stageStart:first.stageStart,complete:true,wildcard:false};
  let next=start+1;
  while(items[next] && items[next]!.queryId===first.queryId && items[next]!.depth===first.depth &&
    items[next]!.stageStart===first.stageStart && ['.','->'].includes(items[next]!.token.text)) {
    const separator=items[next++]!.token;
    path.separators.push(separator); path.end=separator.end;
    const component=items[next];
    if(component?.queryId===first.queryId && component.depth===first.depth && component.stageStart===first.stageStart && component.token.kind==='identifier') {
      path.components.push(component.token); path.end=component.token.end; next++;
    } else if(wildcard && component?.token.text==='*') {
      path.wildcard=true; path.end=component.token.end; next++; break;
    } else {path.complete=false; break;}
  }
  if(wildcard && items[next]?.token.text==='*' && items[next]!.depth===first.depth) {
    path.wildcard=true; path.end=items[next++]!.token.end;
  }
  return {path,next};
}
function split(items: TokenContext[]) {
  const groups: TokenContext[][]=[[]];
  for(const item of items) item.token.text===','?groups.push([]):groups.at(-1)!.push(item);
  return groups;
}

/** Bounded structural facts only. No field existence, transfer or type proofs. */
export function structure(text: string, tree: SyntaxTree = parse(text)): Structure {
  const result: Structure = {text,tree,roles:[],paths:[],assignments:[],fieldLists:[],sources:[],options:[],outputs:[],queryAliases:[],placeholders:[],aggregates:new Map()};
  if(tree.limited) return result;
  const roles=new Map<number,RoleSpan>();
  const put=(token: Token,type: RoleKind,declaration=false,defaultLibrary=false)=>{
    if(token.kind!=='string'&&token.kind!=='comment') roles.set(token.start,{...span(token),type,declaration,defaultLibrary});
  };
  const byStage=new Map<number,TokenContext[]>();
  const stageMap=new Map(tree.stages.map(s=>[s.name.start,s]));
  for(let index=0;index<tree.contexts.length;index++) {
    const item=tree.contexts[index]!, token=item.token;
    if(item.stageStart!==undefined) {
      const items=byStage.get(item.stageStart)??[]; items.push(item); byStage.set(item.stageStart,items);
    }
    if(token.kind==='identifier') {
      const previous=tree.contexts[index-1];
      const member=previous?.queryId===item.queryId && ['.','->'].includes(previous.token.text);
      put(token,!member&&constants.has(lower(token)!)?'constant':!member&&wordOperators.has(lower(token)!)?'operator':'property');
    } else if(token.kind==='number') put(token,'number');
    else if(token.kind==='operator'||token.text==='|') put(token,'operator');
  }
  for(let index=0;index<tree.contexts.length;) {
    const parsed=pathAt(tree.contexts,index);
    if(parsed) {result.paths.push(parsed.path);index=parsed.next;} else index++;
  }
  for(const stage of tree.stages) put(stage.name,'keyword');
  for(const call of tree.calls) put(call.name,'function',false,builtins.has(call.name.text)&&functionFact(call.name.text)?.status!=='blocked');
  const callsByName=new Map(tree.calls.map(c=>[c.name.start,c]));
  const pathsByStage=new Map<number,FieldPath[]>();
  for(const path of result.paths) if(path.stageStart!==undefined) {
    const list=pathsByStage.get(path.stageStart)??[];list.push(path);pathsByStage.set(path.stageStart,list);
  }

  const fieldList=(stage: StageNode, items: TokenContext[], kind: FieldList['kind'], start: number, end=stage.end) => {
    const entries: FieldEntry[]=[];
    const exclude=kind==='fields'&&items[0]?.token.text==='-';
    if(exclude) items=items.slice(1);
    for(let chunk of split(items)) {
      let duplicateDirection=false, initialDirection=false;
      if(kind==='sort'&&['asc','desc'].includes(lower(chunk[0]?.token)??'')) {put(chunk[0]!.token,'keyword');chunk=chunk.slice(1);initialDirection=true;}
      if(kind==='sort'&&chunk.length>1&&['asc','desc'].includes(lower(chunk.at(-1)?.token)??'')) {
        put(chunk.at(-1)!.token,'keyword');chunk=chunk.slice(0,-1);duplicateDirection=initialDirection;
      }
      const parsed=pathAt(chunk,0,true);
      if(!parsed) continue;
      const {path}=parsed; let next=parsed.next, alias: Token|undefined;
      for(const component of path.components) put(component,'property');
      if(kind==='fields'&&lower(chunk[next]?.token)==='as'&&chunk[next+1]?.token.kind==='identifier') {
        put(chunk[next++]!.token,'keyword'); alias=chunk[next++]!.token; put(alias,'variable',true);
      }
      entries.push({start:path.start,end:(alias??chunk.at(-1)!.token).end,path,alias,complete:path.complete&&next===chunk.length&&!duplicateDirection});
    }
    const node: FieldList={start,end,queryId:stage.queryId,stageStart:stage.name.start,kind,exclude,entries,
      complete:entries.length===split(items).length&&entries.every(e=>e.complete)&&!items.at(-1)?.token.text.endsWith(',')};
    result.fieldLists.push(node);
  };
  for(const stage of tree.stages) {
    const all=(byStage.get(stage.name.start)??[]).filter(c=>c.token.start>=stage.name.end&&c.token.start<stage.end);
    const root=all.filter(c=>c.depth===stage.depth);
    const name=stage.name.text;
    const assignmentEnds=root.filter(c=>c.token.text===',').map(c=>c.token.start);
    if(name==='alter') for(const [index,chunk] of split(root).entries()) {
      const parsed=pathAt(chunk,0);
      if(!parsed||parsed.path.separators.some(t=>t.text==='->')||chunk[parsed.next]?.token.text!=='=') continue;
      const equal=chunk[parsed.next]!.token, path=parsed.path;
      for(const component of path.components) put(component,'property');
      put(path.components.at(-1)!,'variable',true);
      const value={start:equal.end,end:assignmentEnds[index]??stage.end};
      result.assignments.push({start:path.start,end:value.end,path,value,queryId:stage.queryId,stageStart:stage.name.start,
        complete:path.complete&&chunk.length>parsed.next+1&&!tree.issues.some(i=>i.start>=value.start&&i.start<value.end)});
    }
    if(name==='fields') fieldList(stage,root,'fields',stage.name.end);
    if(name==='sort') fieldList(stage,root,'sort',stage.name.end);
    if(name==='dedup') {
      const by=root.findIndex((c,i)=>lower(c.token)==='by'&&root[i-1]?.token.text!=='.');
      fieldList(stage,by<0?root:root.slice(0,by),'dedup',stage.name.end);
      if(by>=0) {put(root[by]!.token,'keyword');fieldList(stage,root.slice(by+1),'sort',root[by]!.token.end);}
    }
    if(['dataset','cold_dataset','datamodel','preset','call'].includes(name)) {
      let items=all, kind: SourceClause['kind']=name==='call'?'savedQuery':name as SourceClause['kind'];
      if(name==='datamodel') {
        if(lower(items[0]?.token)!=='dataset') {
          result.sources.push({start:stage.name.start,end:stage.end,queryId:stage.queryId,stageStart:stage.name.start,kind:'datamodel',names:[],complete:false});
          continue;
        }
        put(items[0]!.token,'keyword');items=items.slice(1);
      }
      if(items[0]?.token.text==='=') items=items.slice(1);
      const names: Token[]=[]; let complete=false;
      if(lower(items[0]?.token)==='in'&&items[1]?.token.text==='(') {
        put(items[0]!.token,'operator'); let expectName=true;
        for(let i=2;i<items.length;i++) {
          const token=items[i]!.token;
          if(expectName&&(token.kind==='identifier'||token.kind==='string')) {names.push(token);expectName=false;}
          else if(!expectName&&token.text===',') expectName=true;
          else if(!expectName&&token.text===')') {complete=i===items.length-1;break;}
          else break;
        }
      } else if(['identifier','string'].includes(items[0]?.token.kind??'')) {names.push(items[0]!.token);complete=items.length===1;}
      for(const token of names) put(token,['preset','savedQuery'].includes(kind)?'namespace':'xqlDataset');
      result.sources.push({start:stage.name.start,end:stage.end,queryId:stage.queryId,stageStart:stage.name.start,kind,names,complete});
    }
    if(name==='union'&&root.length===1&&['identifier','string'].includes(root[0]!.token.kind)) put(root[0]!.token,'xqlDataset');
    if(['config','join','windowcomp','view'].includes(name)) {
      const allowed: Record<string,readonly string[]>={join:['type','conflict_strategy'],windowcomp:['frame_type'],view:['fields','values','type','xaxis','yaxis','series','order']};
      const childStart=root.findIndex(c=>c.token.text==='(');
      const prefix=name==='join'?root.slice(0,childStart<0?root.length:childStart):root;
      for(let i=0;i<prefix.length;i++) {
        const token=prefix[i]!.token;
        if(token.kind!=='identifier'||prefix[i+1]?.token.text!=='='||name!=='config'&&!allowed[name]?.includes(token.text)) continue;
        put(token,'parameter');
        const value=prefix[i+2]?.token;
        let next=i+2;
        while(next<prefix.length&&!(prefix[next]!.token.kind==='identifier'&&prefix[next+1]?.token.text==='='&&
          (name==='config'||allowed[name]?.includes(prefix[next]!.token.text)))) next++;
        const valueEnd=prefix[next-1]?.token.end??prefix[i+1]!.token.end;
        result.options.push({start:token.start,end:valueEnd,queryId:stage.queryId,stageStart:stage.name.start,name:token,
          value:{start:value?.start??prefix[i+1]!.token.end,end:valueEnd},complete:!!value&&value.closed&&
            !tree.issues.some(issue=>issue.start>token.end&&issue.start<valueEnd)});
        if(name==='config') for(const part of prefix.slice(i+2,next)) if(part.token.kind==='identifier') put(part.token,'constant');
        if(value?.kind==='identifier'&&optionEnums[name+'.'+token.text]?.includes(value.text)) put(value,'constant');
      }
      if(name==='config'&&root[0]?.token.text==='timeframe'&&lower(root[1]?.token)==='between') {
        put(root[0]!.token,'parameter');put(root[1]!.token,'keyword');
        const and=root.findIndex(c=>lower(c.token)==='and');
        if(and>=0) put(root[and]!.token,'keyword');
        result.options.push({start:root[0]!.token.start,end:stage.end,queryId:stage.queryId,stageStart:stage.name.start,name:root[0]!.token,
          value:{start:root[1]!.token.end,end:stage.end},complete:and>2&&root.length>and+1});
      }
    }
    if(['comp','windowcomp'].includes(name)) {
      const clauseNames=new Set(name==='comp'?['by','addrawdata']:['by','sort','between','over']);
      const clause=(i: number)=>clauseNames.has(lower(root[i]?.token)??'')&&root[i-1]?.token.text!=='.'&&root[i-1]?.token.text!=='->';
      let currentCall: typeof tree.calls[number]|undefined, segmentStart=stage.name.end, inClause=false;
      for(let i=0;i<root.length;i++) {
        const token=root[i]!.token;
        const candidate=callsByName.get(token.start);
        if(candidate?.depth===stage.depth+1) currentCall=candidate;
        if(token.text===','&&!inClause) segmentStart=token.end;
        if(lower(token)==='as'&&root[i+1]?.token.kind==='identifier'&&(name==='windowcomp'||!inClause)) {
          put(token,'keyword');const alias=root[++i]!.token;put(alias,'variable',true);
          const fact=currentCall?functionFact(currentCall.name.text):undefined;
          result.outputs.push({...span(alias),queryId:stage.queryId,stageStart:stage.name.start,name:alias,
            expression:{start:segmentStart,end:token.start},complete:!!currentCall?.close&&currentCall.name.start>=segmentStart&&
              !!fact?.forms.some(f=>f.contexts.includes(name))});
        } else if(clause(i)) {
          put(token,'keyword');inClause=true;
          if(['by','sort'].includes(lower(token)!)) {
            let end=i+1;while(end<root.length&&!clause(end)&&lower(root[end]?.token)!=='as') end++;
            fieldList(stage,root.slice(i+1,end),lower(token)==='by'?'group':'sort',token.end,root[end]?.token.start??stage.end);
          }
        }
      }
      if(name==='windowcomp') {
        // The reviewed over alternative is clause syntax, never a generic call.
        const over=all.findIndex(c=>lower(c.token)==='over'&&c.depth===stage.depth);
        if(over>=0&&all[over+1]?.token.text==='(') {
          const close=all.slice(over+2).find(c=>c.token.text===')'&&c.depth===stage.depth)?.token.start??stage.end;
          const contents=all.slice(over+2).filter(c=>c.depth===stage.depth+1&&c.token.start<close);
          for(let i=0;i<contents.length;i++) if(['partition','order'].includes(lower(contents[i]?.token)??'')&&lower(contents[i+1]?.token)==='by') {
            put(contents[i]!.token,'keyword');put(contents[i+1]!.token,'keyword');
            let end=i+2;while(end<contents.length&&!['partition','order'].includes(lower(contents[end]?.token)??'')) end++;
            fieldList(stage,contents.slice(i+2,end),lower(contents[i]!.token)==='partition'?'group':'sort',contents[i+1]!.token.end,contents[end]?.token.start??close);
          }
        }
      }
    }
  }
  const sourcedQueries=new Set(result.sources.map(s=>s.queryId));
  for(const query of tree.queries) {
    if(!sourcedQueries.has(query.id)) result.sources.push({start:query.start,end:query.start,queryId:query.id,kind:'implicit',names:[],complete:true});
    if(!query.close||query.parentStageStart===undefined) continue;
    const stage=stageMap.get(query.parentStageStart);
    if(stage?.name.text!=='join') continue;
    const root=(byStage.get(stage.name.start)??[]).filter(c=>c.depth===stage.depth&&c.token.start>=query.close!.end);
    if(lower(root[0]?.token)!=='as'||root[1]?.token.kind!=='identifier') continue;
    put(root[0]!.token,'keyword');const alias=root[1]!.token;put(alias,'namespace',true);
    result.queryAliases.push({...span(alias),queryId:stage.queryId,childQueryId:query.id,stageStart:stage.name.start,name:alias});
    for(const path of pathsByStage.get(stage.name.start)??[]) if(path.queryId===stage.queryId&&path.start>alias.end&&path.components.length>1&&path.components[0]!.text===alias.text) put(path.components[0]!,'namespace');
  }
  // Sweep callback-argument intervals per query, so nested queries never inherit
  // a parent's placeholder and strings*calls does not become a quadratic scan.
  const intervals=new Map<string,{start:number;end:number;owner:number}[]>();
  for(const call of tree.calls) if(callbacks.has(call.name.text)&&call.arguments[1]) {
    const list=intervals.get(call.queryId)??[];
    list.push({...call.arguments[1],owner:call.name.start});intervals.set(call.queryId,list);
  }
  const states=new Map([...intervals].map(([id,list])=>[id,{list:list.sort((a,b)=>a.start-b.start||b.end-a.end),index:0,active:[] as typeof list}]));
  for(const item of tree.contexts) if(item.token.text==='"@element"') {
    const state=states.get(item.queryId);if(!state) continue;
    while(state.active.length&&state.active.at(-1)!.end<item.token.end) state.active.pop();
    while(state.index<state.list.length&&state.list[state.index]!.start<=item.token.start) {
      const candidate=state.list[state.index++]!;
      if(candidate.end>=item.token.end) state.active.push(candidate);
    }
    const owner=state.active.at(-1);
    if(owner) result.placeholders.push({start:item.token.start+1,end:item.token.end-1,queryId:item.queryId,ownerCallStart:owner.owner,argument:1});
  }
  const aggregates=new Map<number,AggregatePlan>();
  const listsByStage=new Map<number,FieldList[]>();
  for(const list of result.fieldLists) {const lists=listsByStage.get(list.stageStart)??[];lists.push(list);listsByStage.set(list.stageStart,lists);}
  for(const stage of tree.stages) if(['comp','windowcomp'].includes(stage.name.text)) aggregates.set(stage.name.start,
    aggregatePlan(result,stage,byStage.get(stage.name.start)??[],callsByName,listsByStage.get(stage.name.start)??[]));
  const aliasSets=new Map([...aggregates].map(([start,plan])=>[start,new Set(plan.aliases)]));
  for(const output of result.outputs) {
    const plan=aggregates.get(output.stageStart)!;
    output.complete=output.complete&&plan.complete&&aliasSets.get(output.stageStart)!.has(output.name.start);
    if(!output.complete) put(output.name,'property');
  }
  result.aggregates=aggregates;
  result.roles=[...roles.values()].sort((a,b)=>a.start-b.start);
  return result;
}

export type CursorKind='stage'|'expression'|'fieldList'|'fieldWrite'|'source'|'stageOption'|'member'|'comment'|'string'|'unsupported';
export interface CursorContext {kind: CursorKind; queryId: string; stageStart?: number; replace: Span; qualifier?: readonly string[]; navigation?:readonly string[]; access?:'read'|'write'}
/** Full-document view: replacement spans include suffixes after a mid-word caret. */
export function contextAt(doc: Structure, offset: number): CursorContext {
  const safeOffset=Number.isInteger(offset)?Math.max(0,Math.min(offset,doc.text.length)):0;
  const empty: CursorContext={kind:'unsupported',queryId:'q0',replace:{start:safeOffset,end:safeOffset}};
  if(doc.tree.limited||!Number.isInteger(offset)||offset<0||offset>doc.text.length) return empty;
  const query=doc.tree.queries.filter(q=>offset>=q.start&&offset<=q.end).at(-1)!;
  const context={...empty,queryId:query.id};
  const literal=doc.tree.tokens.find(t=>['comment','string'].includes(t.kind)&&offset>=t.start&&(offset<t.end||!t.closed&&offset<=t.end||t.text.startsWith('//')&&offset===t.end));
  if(literal) return {...context,kind:literal.kind as 'comment'|'string'};
  const token=doc.tree.tokens.find(t=>t.kind==='identifier'&&offset>=t.start&&offset<=t.end);
  const replace=token?span(token):context.replace;
  const stage=doc.tree.stages.filter(s=>s.queryId===query.id&&s.name.start<=offset&&s.end>=offset).at(-1);
  const base={...context,replace,stageStart:stage?.name.start};
  const root=stage?doc.tree.contexts.filter(c=>c.stageStart===stage.name.start&&c.depth===stage.depth&&c.token.start>=stage.name.end&&c.token.start<replace.start):[];
  let separator=-1;for(let index=root.length-1;index>=0;index--) if(root[index]!.token.text===',') {separator=index;break;}
  const segment=root.slice(separator+1);
  const write=stage?.name.text==='alter'&&!segment.some(c=>c.token.text==='=')||
    ['fields','comp','windowcomp'].includes(stage?.name.text??'')&&segment.at(-1)?.token.text==='as'||
    doc.fieldLists.some(l=>l.stageStart===stage?.name.start&&l.entries.some(e=>e.alias&&offset>=e.alias.start&&offset<=e.alias.end))||
    doc.outputs.some(o=>o.stageStart===stage?.name.start&&offset>=o.name.start&&offset<=o.name.end);
  const path=doc.paths.find(p=>p.queryId===query.id&&p.stageStart===stage?.name.start&&p.start<=offset&&
    (p.end>=offset||!p.complete&&doc.text.slice(p.end,offset).trim()==='')&&p.separators.length);
  if(path) {
    const component=path.components.findIndex(t=>t.start<=offset&&offset<=t.end);
    if(component>0||component<0&&path.separators.at(-1)!.end<=offset) return {...base,kind:'member',access:write?'write':'read',
      navigation:path.separators.slice(0,component<0?undefined:component).map(t=>t.text),qualifier:path.components.slice(0,component<0?undefined:component).map(t=>t.text)};
  }
  if(!stage||offset<=stage.name.end) return {...base,kind:'stage'};
  if(doc.sources.some(s=>s.stageStart===stage.name.start)) return {...base,kind:'source'};
  if(doc.options.some(o=>offset>=o.start&&offset<=o.end)) return {...base,kind:'stageOption'};
  if(write) return {...base,kind:'fieldWrite',access:'write'};
  if(doc.fieldLists.some(f=>f.stageStart===stage.name.start&&offset>=f.start&&offset<=f.end)) return {...base,kind:'fieldList'};
  if(['alter','filter','comp','windowcomp'].includes(stage.name.text)) return {...base,kind:'expression'};
  return base;
}

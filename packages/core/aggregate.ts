import type {FieldList, FieldPath, Structure} from './roles';
import type {CallNode, StageNode, TokenContext} from './syntax';
import {functionFact} from './reference';

export interface AggregatePlan {complete:boolean; aliases:readonly number[]; groups:readonly FieldPath[]; unknownNames:boolean; form:'comp'|'direct'|'over'}
/** Recognize only reviewed stage productions, without frame/type/arity inference. */
export function aggregatePlan(doc:Structure,stage:StageNode,all:readonly TokenContext[],calls:ReadonlyMap<number,CallNode>,stageLists:readonly FieldList[]):AggregatePlan {
  const fallback:AggregatePlan={complete:false,aliases:[],groups:[],unknownNames:true,form:stage.name.text==='comp'?'comp':'direct'};
  if(all.some(c=>!c.token.closed)||doc.tree.issues.some(i=>i.start>=stage.name.start&&i.start<stage.end)) return fallback;
  const root=all.filter(c=>c.depth===stage.depth&&c.token.start>=stage.name.end&&c.token.start<stage.end);
  const aliases:number[]=[],groups:FieldPath[]=[];let index=0,unknownNames=false;
  const consumeCall=()=>{
    const call=calls.get(root[index]?.token.start??-1);
    if(!call?.close||!functionFact(call.name.text)?.forms.some(f=>f.contexts.includes(stage.name.text))) return;
    if(call.commas.length&&call.arguments.some(a=>!doc.text.slice(a.start,a.end).trim())) return;
    while(index<root.length&&root[index]!.token.start<call.close.end) index++;
    return call;
  };
  const consumeAlias=()=>{
    if(root[index]?.token.text!=='as'||root[index+1]?.token.kind!=='identifier') return false;
    aliases.push(root[index+1]!.token.start);index+=2;return true;
  };
  const consumeList=(kind:'group'|'sort',end:number)=>{
    const keyword=root[index]!,list=stageLists.find(l=>l.kind===kind&&l.start===keyword.token.end);
    if(!list?.complete||list.entries.some(e=>e.path.wildcard||e.alias||e.path.separators.some(t=>t.text==='->'))) return false;
    if(list.end<(root[end-1]?.token.end??0)||list.end>(root[end]?.token.start??stage.end)) return false;
    if(kind==='group') groups.push(...list.entries.map(e=>e.path));index=end;return true;
  };
  if(stage.name.text==='comp') {
    do {
      if(!consumeCall()) return fallback;
      if(!consumeAlias()) unknownNames=true;
      if(root[index]?.token.text!==',') break;
      index++;
      if(index===root.length) return fallback;
    } while(index<root.length);
    if(root[index]?.token.text==='by'&&!consumeList('group',root.length)) return fallback;
    return index===root.length?{complete:true,aliases,groups,unknownNames,form:'comp'}:fallback;
  }
  const call=consumeCall();if(!call) return fallback;
  if(root[index]?.token.text==='as'&&root[index+2]?.token.text==='over') {
    if(!['first_value','last_value','lag'].includes(call.name.text)||!consumeAlias()) return fallback;
    const over=root[index]!,open=root[index+1]!,close=root[index+2];
    if(open?.token.text!=='('||close?.token.text!==')'||index+3!==root.length) return fallback;
    const contents=all.filter(c=>c.depth===stage.depth+1&&c.token.start>open.token.start&&c.token.end<=close.token.start);
    const partition=contents[0],orderIndex=contents.findIndex(c=>c.token.text==='order');
    if(partition?.token.text!=='partition'||contents[1]?.token.text!=='by'||orderIndex<3||contents[orderIndex+1]?.token.text!=='by') return fallback;
    const lists=stageLists.filter(l=>l.start>over.token.end);
    if(lists.length!==2||lists.some(l=>!l.complete||l.entries.some(e=>e.path.wildcard||e.path.separators.some(t=>t.text==='->')))) return fallback;
    return {complete:true,aliases,groups:[],unknownNames:false,form:'over'};
  }
  // Direct form has optional by, sort, between/frame, then an optional final alias.
  let end=root.length;
  if(root[end-2]?.token.text==='as'&&root[end-1]?.token.kind==='identifier') {aliases.push(root[end-1]!.token.start);end-=2;}
  else unknownNames=true;
  for(const [word,kind] of [['by','group'],['sort','sort']] as const) if(root[index]?.token.text===word) {
    let next=index+1;while(next<end&&!['sort','between','frame_type'].includes(root[next]!.token.text)) next++;
    if(!consumeList(kind,next)) return fallback;
  }
  if(root[index]?.token.text==='between') {
    index++;
    const bound=()=>{
      // Public bounds distinguish unbounded null from signed numeric offsets.
      // A sign before null is outside this reviewed subset, not a numeric atom.
      if(root[index]?.token.text==='null') {index++;return true;}
      if(['-','+'].includes(root[index]?.token.text??'')) index++;
      const token=root[index]?.token;
      if(token?.kind==='number'&&/^\d+$/.test(token.text)) {index++;return true;}
      return false;
    };
    if(!bound()) return fallback;
    if(root[index]?.token.text==='and') {index++;if(!bound()) return fallback;}
    if(root[index]?.token.text==='frame_type') {
      if(root[index+1]?.token.text!=='='||!['rows','range'].includes(root[index+2]?.token.text??'')) return fallback;
      index+=3;
    }
  }
  return index===end?{complete:true,aliases,groups:[],unknownNames,form:'direct'}:fallback;
}

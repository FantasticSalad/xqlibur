import {functionFact} from './reference';
import type {Structure} from './roles';
import type {Span, TokenContext, CallNode} from './syntax';
import type {Token} from './lexer';

export type ExpressionState='complete'|'incomplete'|'unsupported';
export type ExpressionKind='literal'|'name'|'member'|'call'|'group'|'list'|'subquery'|'unary'|'binary'|'ambiguous'|'unsupported'|'missing';
export interface ExpressionNode extends Span {
  id:number; kind:ExpressionKind; state:ExpressionState; children:readonly number[];
  operators?:readonly (Span&{text:string})[]; queryId:string; callStart?:number; reason?:string;
}
export interface ExpressionRoot extends Span {nodeId:number; queryId:string; stageStart?:number; purpose:'filter'|'assignment'|'call'|'argument'; ownerStart:number}
export interface ExpressionIndex {
  nodes:ExpressionNode[]; roots:ExpressionRoot[]; byCall:ReadonlyMap<number,number>;
  byAssignment:ReadonlyMap<number,number>; byStage:ReadonlyMap<number,readonly number[]>;
  limited:boolean;
}
export interface ExpressionLimits {maxFrames?:number; maxNodes?:number; maxWork?:number; maxRoots?:number}
export const expressionOperators=Object.freeze(['=','!=','<','<=','>','>=','~=','!~=','and','or','in','not in','contains','not contains','incidr','not incidr','incidr6','not incidr6']);
const binary=new Set<string>(expressionOperators),words=new Set(['and','or','not','in','contains','incidr','incidr6']);
interface Part {node?:number; operator?:Span&{text:string}}
interface Frame {
  kind:'root'|'call'|'group'|'list'|'unsupported'; start:number; contentStart:number;
  parts:Part[]; children:number[]; comma:boolean; call?:CallNode; close?:string;
}
interface Spec extends Span {queryId:string; stageStart?:number; purpose:'filter'|'assignment'|'call'; ownerStart:number}

/** Iterative, source-span-only subset. No guessed precedence, recursive tree or evaluation. */
export function buildExpressions(doc:Structure,limits:ExpressionLimits={}):ExpressionIndex {
  const maxFrames=limits.maxFrames??512,maxNodes=limits.maxNodes??50000,maxWork=limits.maxWork??200000,maxRoots=limits.maxRoots??20000;
  for(const value of [maxFrames,maxNodes,maxWork,maxRoots]) if(!Number.isSafeInteger(value)||value<1) throw new RangeError('Invalid expression analysis bound');
  const result:ExpressionIndex={nodes:[],roots:[],byCall:new Map(),byAssignment:new Map(),byStage:new Map(),limited:doc.tree.limited};
  if(doc.tree.limited) return result;
  const byCall=new Map<number,number>(),byAssignment=new Map<number,number>(),byStage=new Map<number,number[]>();
  const calls=new Map(doc.tree.calls.map(c=>[c.name.start,c])),children=new Map(doc.tree.queries.filter(q=>q.open).map(q=>[q.open!.start,q]));
  const contexts=new Map<string,TokenContext[]>();
  for(const context of doc.tree.contexts) {const list=contexts.get(context.queryId)??[];list.push(context);contexts.set(context.queryId,list);}
  const specs:Spec[]=[];
  for(const stage of doc.tree.stages) if(stage.name.text==='filter') specs.push({start:stage.name.end,end:stage.end,queryId:stage.queryId,stageStart:stage.name.start,purpose:'filter',ownerStart:stage.name.start});
  for(const assignment of doc.assignments) specs.push({...assignment.value,queryId:assignment.queryId,stageStart:assignment.stageStart,purpose:'assignment',ownerStart:assignment.path.start});
  const callContexts=new Map(doc.tree.contexts.map(c=>[c.token.start,c]));
  for(const call of doc.tree.calls) specs.push({start:call.name.start,end:call.end,queryId:call.queryId,stageStart:callContexts.get(call.name.start)?.stageStart,purpose:'call',ownerStart:call.name.start});
  specs.sort((a,b)=>a.start-b.start||b.end-a.end);
  const covered=new Map<string,number>();let work=0;
  const limit=Symbol('expression-analysis-limit');
  const node=(kind:ExpressionKind,state:ExpressionState,span:Span,queryId:string,ids:readonly number[]=[],extra:Partial<ExpressionNode>={}):number=>{
    if(result.nodes.length>=maxNodes) {result.limited=true;throw limit;}
    const id=result.nodes.length;result.nodes.push({id,kind,state,start:span.start,end:span.end,queryId,children:ids,...extra});return id;
  };
  const stateOf=(ids:readonly number[]):ExpressionState=>ids.some(id=>result.nodes[id]!.state==='unsupported')?'unsupported':ids.some(id=>result.nodes[id]!.state==='incomplete')?'incomplete':'complete';
  try {for(const spec of specs) {
    if(spec.start<(covered.get(spec.queryId)??-1)) continue;
    if(result.limited) break;
    covered.set(spec.queryId,spec.end);
    const items=contexts.get(spec.queryId)??[];
    const lower=(offset:number)=>{let lo=0,hi=items.length;while(lo<hi) {const mid=(lo+hi)>>>1;if(items[mid]!.token.start<offset) lo=mid+1;else hi=mid;}return lo;};
    const frames:Frame[]=[{kind:'root',start:spec.start,contentStart:spec.start,parts:[],children:[],comma:false}];
    const expression=(frame:Frame,end:number):number=>{
      if(!frame.parts.length) return node('missing','incomplete',{start:frame.contentStart,end:frame.contentStart},spec.queryId,[],{reason:'missingOperand'});
      const parts:Part[]=[];
      for(let at=0;at<frame.parts.length;at++) {
        const part=frame.parts[at]!;
        if(part.node!==undefined) {
          const ids=[part.node],ops:(Span&{text:string})[]=[];let next=at;
          while(['.','->'].includes(frame.parts[next+1]?.operator?.text??'')&&frame.parts[next+2]?.node!==undefined) {
            ops.push(frame.parts[next+1]!.operator!);ids.push(frame.parts[next+2]!.node!);next+=2;
          }
          if(ids.length>1) {
            const names=ids.every(id=>result.nodes[id]!.kind==='name');
            parts.push({node:node('member',names?stateOf(ids):'unsupported',{start:result.nodes[ids[0]!]!.start,end:result.nodes[ids.at(-1)!]!.end},spec.queryId,ids,{operators:ops,...(!names?{reason:'unreviewedMemberTarget'}:{})})});at=next;
          } else parts.push(part);
        } else if(part.operator?.text==='not'&&['in','contains','incidr','incidr6'].includes(frame.parts[at+1]?.operator?.text??'')) {
          const next=frame.parts[++at]!.operator!;parts.push({operator:{start:part.operator.start,end:next.end,text:'not '+next.text}});
        } else parts.push(part);
      }
      const ids=parts.flatMap(p=>p.node===undefined?[]:[p.node]),operators=parts.flatMap(p=>p.operator?[p.operator]:[]);
      const span={start:parts[0]?.operator?.start??result.nodes[ids[0]!]!.start,end};
      if(parts.length===1&&ids.length===1) return ids[0]!;
      if(parts.length===2&&parts[0]?.operator?.text==='not'&&parts[1]?.node!==undefined) return node('unary',stateOf(ids),span,spec.queryId,ids,{operators});
      if(parts.length===3&&parts[0]?.node!==undefined&&parts[1]?.operator&&binary.has(parts[1].operator.text)&&parts[2]?.node!==undefined) return node('binary',stateOf(ids),span,spec.queryId,ids,{operators});
      if(parts.at(-1)?.operator&&(binary.has(parts.at(-1)!.operator!.text)||['not','.','->'].includes(parts.at(-1)!.operator!.text))) {
        ids.push(node('missing','incomplete',{start:end,end},spec.queryId,[],{reason:'missingOperand'}));
        return node('unsupported','incomplete',span,spec.queryId,ids,{operators,reason:'unfinishedProduction'});
      }
      const known=operators.every(op=>binary.has(op.text)||op.text==='not');
      return node(known&&operators.length>1?'ambiguous':'unsupported','unsupported',span,spec.queryId,ids,{operators,reason:known&&operators.length>1?'precedenceUnverified':'unreviewedProduction'});
    };
    const argument=(frame:Frame,end:number)=>{
      const id=expression(frame,end);frame.children.push(id);
      if(frame.kind==='call') {
        if(result.roots.length>=maxRoots) {result.limited=true;throw limit;}
        result.roots.push({start:frame.contentStart,end,nodeId:id,queryId:spec.queryId,stageStart:spec.stageStart,purpose:'argument',ownerStart:frame.call!.name.start});
      }
      frame.parts=[];frame.contentStart=end;
    };
    const finish=(frame:Frame,end:number,closed:boolean):number=>{
      if(frame.parts.length||frame.comma||frame.kind==='group'||frame.kind==='root') argument(frame,end);
      const ids=frame.children,kind=frame.kind==='root'?'group':frame.kind;
      const invalidGroup=frame.kind==='group'&&ids.length!==1||frame.kind==='list'&&!ids.length;
      const state:ExpressionState=!closed?'incomplete':frame.kind==='unsupported'||invalidGroup?'unsupported':stateOf(ids);
      if(frame.kind==='root') return ids.length===1?ids[0]!:node('unsupported','unsupported',{start:frame.start,end},spec.queryId,ids,{reason:'unexpectedSeparator'});
      const knownCall=frame.call?!!functionFact(frame.call.name.text)&&functionFact(frame.call.name.text)?.status!=='blocked':true;
      const id=node(kind,knownCall?state:'unsupported',{start:frame.start,end},spec.queryId,ids,{...(frame.call?{callStart:frame.call.name.start}:{}),
        ...(!closed?{reason:'unclosedProduction'}:!knownCall?{reason:'unknownCall'}:frame.kind==='unsupported'?{reason:'unreviewedLiteralProduction'}:invalidGroup?{reason:'unreviewedGrouping'}:{})});
      if(frame.call) byCall.set(frame.call.name.start,id);return id;
    };
    let at=lower(spec.start),end=lower(spec.end);
    for(;at<end;at++) {
      if(++work>maxWork||result.nodes.length+frames.length+8>=maxNodes||frames.length>maxFrames||result.roots.length>=maxRoots) {result.limited=true;break;}
      const token=items[at]!.token,frame=frames.at(-1)!;
      const child=children.get(token.start);
      if(child) {
        const childEnd=child.close?.end??Math.min(spec.end,child.end);
        frame.parts.push({node:node('subquery',child.close?'complete':'incomplete',{start:token.start,end:childEnd},child.id,[],{...(!child.close?{reason:'unclosedQuery'}:{})})});
        at=lower(childEnd)-1;continue;
      }
      const call=calls.get(token.start);
      if(call&&items[at+1]?.token.start===call.open.start) {
        if(frames.length>=maxFrames) {result.limited=true;break;}
        frames.push({kind:'call',start:token.start,contentStart:call.open.end,parts:[],children:[],comma:false,call,close:')'});at++;continue;
      }
      if(['(','[','{'].includes(token.text)&&token.kind==='punctuation') {
        if(frames.length>=maxFrames) {result.limited=true;break;}
        const op=frame.parts.at(-1)?.operator?.text,kind=token.text!=='('?'unsupported':op==='in'||op==='not in'?'list':'group';
        frames.push({kind,start:token.start,contentStart:token.end,parts:[],children:[],comma:false,close:token.text==='('?')':token.text==='['?']':'}'});continue;
      }
      if([')',']','}'].includes(token.text)&&token.kind==='punctuation') {
        if(frames.length===1||frame.close!==token.text) {frame.parts.push({operator:{start:token.start,end:token.end,text:token.text}});continue;}
        frames.pop();const id=finish(frame,token.start,true);result.nodes[id]!.end=token.end;frames.at(-1)!.parts.push({node:id});continue;
      }
      if(token.text===',') {argument(frame,token.start);frame.comma=true;frame.contentStart=token.end;continue;}
      const member=['.','->'].includes(frame.parts.at(-1)?.operator?.text??'');
      if(token.kind==='identifier'&&(member||!words.has(token.text))) frame.parts.push({node:node(!member&&['true','false','null'].includes(token.text)?'literal':'name','complete',token,spec.queryId)});
      else if(['number','string'].includes(token.kind)) {
        const unreviewedQuote=token.kind==='string'&&(token.text.startsWith("'")||token.text.includes('\\'+String.fromCharCode(34)));
        const literal=node('literal',!token.closed?'incomplete':unreviewedQuote?'unsupported':'complete',token,spec.queryId,[],
          !token.closed?{reason:'unclosedLiteral'}:unreviewedQuote?{reason:'unreviewedQuoteRecovery'}:{});
        const sign=frame.parts.at(-1)?.operator,before=frame.parts.at(-2);
        // Adjacent negative numeric atoms have an explicit operand boundary. This
        // does not admit binary subtraction, spaced/general negation or precedence.
        if(token.kind==='number'&&sign?.text==='-'&&sign.end===token.start&&
          (!before||!!before.operator&&(binary.has(before.operator.text)||before.operator.text==='not'))) {
          frame.parts.pop();
          frame.parts.push({node:node('unary',stateOf([literal]),{start:sign.start,end:token.end},spec.queryId,[literal],
            {operators:[sign],reason:'negativeNumericAtom'})});
        } else frame.parts.push({node:literal});
      }
      else frame.parts.push({operator:{start:token.start,end:token.end,text:token.text}});
    }
    if(result.limited) break;
    while(frames.length>1) {const frame=frames.pop()!,id=finish(frame,spec.end,false);frames.at(-1)!.parts.push({node:id});}
    const id=finish(frames[0]!,spec.end,true);
    if(result.roots.length>=maxRoots) {result.limited=true;break;}
    result.roots.push({...spec,nodeId:id});
    if(spec.purpose==='assignment') byAssignment.set(spec.ownerStart,id);
    const list=byStage.get(spec.stageStart??-1)??[];list.push(id);if(spec.stageStart!==undefined) byStage.set(spec.stageStart,list);
  }} catch(error) {if(error!==limit) throw error;}
  result.byCall=byCall;result.byAssignment=byAssignment;result.byStage=byStage;
  return result;
}

/** Smallest source node at a full-document UTF-16 caret; no prefix parsing. */
export function expressionAt(index:ExpressionIndex,offset:number):ExpressionNode|undefined {
  if(!Number.isInteger(offset)||offset<0) return;
  let best:ExpressionNode|undefined;
  for(const node of index.nodes) if(offset>=node.start&&offset<node.end&&(!best||node.end-node.start<best.end-best.start)) best=node;
  return best;
}

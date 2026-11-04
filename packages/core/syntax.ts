import {MAX_LENGTH, scan, Token} from './lexer';

export interface Span {start: number; end: number}
export interface QueryNode extends Span {id: string; parentId?: string; parentStageStart?: number; depth: number; open?: Token; close?: Token}
export interface StageNode {name: Token; end: number; depth: number; queryId: string; boundary: 'pipe' | 'close' | 'eof'}
export interface CallNode {name: Token; open: Token; close?: Token; end: number; commas: number[]; depth: number; queryId: string; arguments: Span[]}
export interface TokenContext {token: Token; queryId: string; stageStart?: number; depth: number}
export interface SyntaxIssue {code: string; message: string; start: number; end: number}
export interface SyntaxTree {
  tokens: Token[];
  stages: StageNode[];
  calls: CallNode[];
  issues: SyntaxIssue[];
  declarations: Token[];
  stageSlot: boolean;
  entrySlot: boolean;
  limited: boolean;
  queries: QueryNode[];
  contexts: TokenContext[];
}
interface Frame {open?: Token; query: boolean; queryNode: QueryNode; ownerStage?: StageNode; expectStage: boolean; stage?: StageNode; call?: CallNode; childStarted?: boolean}
const entryPoints = new Set(['dataset', 'cold_dataset', 'datamodel', 'preset', 'config']);
const nonCalls = new Set(['in', 'and', 'or', 'not', 'by', 'as', 'over']);
const parenthesizedWordOperators = new Set(['contains','incidr','incidr6']);
const wordOperators = new Set(['and','or','not','in','contains','incidr','incidr6']);
const matching: Record<string, string> = {')': '(', ']': '[', '}': '{'};

/** A bounded, iterative structural parser, not a full expression/type grammar. */
export function parse(text: string): SyntaxTree {
  const root: QueryNode = {id:'q0', start:0, end:text.length, depth:0};
  const tree: SyntaxTree = {tokens: [], stages: [], calls: [], issues: [], declarations: [], stageSlot: true, entrySlot: true, limited: false, queries:[root], contexts:[]};
  if (text.length > MAX_LENGTH) { tree.limited = true; return tree; }
  tree.tokens = scan(text);
  const tokens = tree.tokens.filter(t => t.kind !== 'comment');
  const frames: Frame[] = [{query: true, queryNode:root, expectStage: true}];
  const stageTokens = new Set<number>();
  const issue = (token: Token, code: string, message: string) => {
    if (tree.issues.length < 100) tree.issues.push({code, message, start: token.start, end: token.end});
  };
  for (const token of tree.tokens) {
    if (!token.closed) issue(token, token.kind === 'comment' ? 'XQL102' : 'XQL101', `Unterminated ${token.kind}.`);
  }
  let unexpected = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!, frame = frames.at(-1)!;
    const context: TokenContext = {token, queryId:frame.queryNode.id, stageStart:(frame.stage ?? frame.ownerStage)?.name.start, depth:frames.length-1};
    tree.contexts.push(context);
    if (token.kind === 'string') continue;
    if (token.text === '|' && frame.query) {
      if (frame.stage) { frame.stage.end = token.start; frame.stage.boundary = 'pipe'; }
      frame.expectStage = true;
      continue;
    }
    if ('([{'.includes(token.text) && token.kind === 'punctuation') {
      if (frames.length >= 4096) { tree.limited = true; break; }
      const previous = tokens[i - 1], next = tokens[i + 1], after = tokens[i + 2];
      const sourceEntry = !!next && entryPoints.has(next.text) &&
        (after?.text === '=' || after?.kind === 'identifier' || after?.kind === 'string');
      const stageChild = frame.query && !frame.childStarted && ['join','union'].includes(frame.stage?.name.text ?? '');
      const query = token.text === '(' && (sourceEntry || stageChild);
      const ownerStage = frame.stage ?? frame.ownerStage;
      const queryNode: QueryNode = query ? {id:'q'+tree.queries.length, start:token.end, end:text.length,
        parentId:frame.queryNode.id, parentStageStart:ownerStage?.name.start, depth:frame.queryNode.depth+1, open:token} : frame.queryNode;
      if (query) { tree.queries.push(queryNode); frame.childStarted = true; }
      const child: Frame = {open:token, query, queryNode, ownerStage:query?undefined:ownerStage, expectStage:query};
      let operandIndex=i-2;
      if(tokens[operandIndex]?.text.toLowerCase()==='not'&&!['.','->'].includes(tokens[operandIndex-1]?.text??'')) operandIndex--;
      const operand=tokens[operandIndex],memberOperand=['.','->'].includes(tokens[operandIndex-1]?.text??'');
      const endsOperand=!!operand&&(['number','string'].includes(operand.kind)||[')',']','}'].includes(operand.text)||
        operand.kind==='identifier'&&!stageTokens.has(operand.start)&&(memberOperand||!wordOperators.has(operand.text.toLowerCase())));
      const wordOperatorGroup=parenthesizedWordOperators.has(previous?.text.toLowerCase()??'')&&endsOperand;
      if (!query && token.text === '(' && previous?.kind === 'identifier' && !['.','->'].includes(tokens[i-2]?.text ?? '') && !nonCalls.has(previous.text.toLowerCase()) && !stageTokens.has(previous.start)&&!wordOperatorGroup) {
        child.call = {name:previous, open:token, end:text.length, commas:[], depth:frames.length, queryId:frame.queryNode.id, arguments:[]};
        tree.calls.push(child.call);
      }
      frames.push(child);
      continue;
    }
    if (matching[token.text] && token.kind === 'punctuation') {
      if (frame.open?.text === matching[token.text]) {
        if (frame.call) { frame.call.close = token; frame.call.end = token.end; }
        if (frame.stage) { frame.stage.end = token.start; frame.stage.boundary = 'close'; }
        if (frame.query) { frame.queryNode.end = token.start; frame.queryNode.close = token; }
        frames.pop();
        const parent = frames.at(-1)!;
        context.queryId = parent.queryNode.id;
        context.stageStart = (parent.stage ?? parent.ownerStage)?.name.start;
        context.depth = frames.length-1;
      } else { issue(token, 'XQL103', `Unexpected '${token.text}'.`); unexpected = true; }
      continue;
    }
    if (token.text === ',' && frame.call) { frame.call.commas.push(token.start); continue; }
    if (frame.query && token.kind === 'identifier' &&
      ((frame.stage?.name.text === 'alter' && tokens[i+1]?.text === '=') || tokens[i-1]?.text === 'as')) {
      tree.declarations.push(token);
    }
    if (frame.query && frame.expectStage && token.kind === 'identifier') {
      const stage: StageNode = {name:token, end:text.length, depth:frames.length-1, queryId:frame.queryNode.id, boundary:'eof'};
      tree.stages.push(stage); stageTokens.add(token.start);
      frame.stage = stage; frame.expectStage = false;
      frame.childStarted = false;
      context.stageStart = stage.name.start;
    }
  }
  if (!unexpected && !tree.limited) {
    const unclosed = frames.at(-1)?.open;
    if (unclosed) issue(unclosed, 'XQL104', `Unclosed '${unclosed.text}'.`);
  }
  tree.stageSlot = frames.at(-1)!.query && frames.at(-1)!.expectStage;
  tree.entrySlot = !frames.at(-1)!.stage;
  for (const call of tree.calls) {
    let start = call.open.end;
    for (const comma of call.commas) { call.arguments.push({start,end:comma}); start = comma+1; }
    call.arguments.push({start,end:call.close?.start ?? call.end});
  }
  return tree;
}

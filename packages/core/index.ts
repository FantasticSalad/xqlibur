import data from '../../reference/catalogue.json';
import {MAX_LENGTH} from './lexer';
import {functionFact,canSuggestFunction} from './reference';
import {stageHelp} from './stage-help';
import {contextAt} from './roles';
import {createAnalysis, DocumentAnalysis, Finding} from './analysis';
export {MAX_LENGTH, scan} from './lexer';
export type {Token} from './lexer';
export {parse} from './syntax';
export {structure, contextAt} from './roles';
export type {Structure, CursorContext, RoleSpan, FieldPath} from './roles';
export {signatureHelp} from './signatures';
export {createAnalysis, AnalysisStore} from './analysis';
export type {DocumentAnalysis, AnalysisIdentity, Finding} from './analysis';
export type {NameBinding, NameUse, SymbolIndex, Certainty} from './symbols';
export {completionCandidates,localHover} from './completion';
export type {CompletionCandidate,LocalHover} from './completion';
export {diagnosticRules,diagnosticCoverage} from './diagnostics';
export type {DiagnosticRule,DiagnosticCoverage} from './diagnostics';
export {buildExpressions,expressionAt} from './expressions';
export type {ExpressionIndex,ExpressionNode,ExpressionState} from './expressions';

export type SymbolEntry = {name: string; kind: string; source: string};
export const catalogue: readonly SymbolEntry[] = data.symbols;
export const checked = data.checked;
const symbols = new Map(catalogue.map(s => [s.kind + ':' + s.name, s]));
const starts = new Set(['dataset', 'cold_dataset', 'datamodel', 'preset', 'config']);

export function analyze(text: string, analysis: DocumentAnalysis = createAnalysis(text)): Finding[] {
  return analysis.structure.text===text?[...analysis.findings]:[];
}

export function completions(text: string, offset: number, analysis: DocumentAnalysis = createAnalysis(text)): readonly SymbolEntry[] {
  if (text.length>MAX_LENGTH||analysis.structure.text!==text) return [];
  const context=contextAt(analysis.structure,offset);
  if(!['stage','expression'].includes(context.kind)) return [];
  const prefix=text.slice(context.replace.start,offset);
  const stage=context.kind==='stage';
  const entry=!analysis.structure.tree.stages.some(s=>s.queryId===context.queryId&&s.name.start<context.replace.start);
  const stageName=analysis.structure.tree.stages.find(s=>s.name.start===context.stageStart&&s.queryId===context.queryId)?.name.text;
  return catalogue.filter(s => s.kind === (stage?'stage':'function') &&
    (!stage || !entry || starts.has(s.name)) && s.name.startsWith(prefix)&&
    (stage||canSuggestFunction(s.name,stageName)));
}

export function hover(text: string, offset: number, analysis: DocumentAnalysis = createAnalysis(text)) {
  if(analysis.structure.text!==text) return;
  const tree = analysis.structure.tree;
  if (tree.limited) return;
  const call = tree.calls.find(c => offset >= c.name.start && offset < c.name.end);
  const stage = tree.stages.find(s => offset >= s.name.start && offset < s.name.end);
  const token = call?.name ?? stage?.name;
  if (!token) return;
  const symbol = symbols.get((call?'function:':'stage:') + token.text);
  if (symbol) return {symbol, start:token.start, end:token.end, signature:call?functionFact(token.text):undefined,
    summary:call?functionFact(token.text)?.summary:stageHelp(token.text)?.summary};
}

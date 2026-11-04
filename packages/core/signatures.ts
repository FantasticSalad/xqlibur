import {CallForm, FunctionFact, functionFact, parameterLabel,callFormsForStage} from './reference';
import {parse, SyntaxTree} from './syntax';

export interface DisplaySignature {
  formId: string;
  label: string;
  parameters: readonly {label: [number, number]}[];
  activeParameter?: number;
  source: string;
  checked: string;
}
export function displayForm(name: string, form: CallForm, argument?: number): DisplaySignature {
  let label = name + '(';
  const parameters: {label: [number, number]}[] = [];
  if (form.syntaxKind === 'special') label = form.syntaxLabel!;
  else if (!form.arityKnown) label += '…';
  else for (const [index, parameter] of form.parameters.entries()) {
    if (index) label += ', ';
    const start = label.length;
    label += parameter.optional ? '[' + parameterLabel(parameter) + ']' : parameterLabel(parameter);
    parameters.push({label: [start, label.length]});
  }
  if (form.syntaxKind !== 'special') label += ')';
  return {
    formId: form.id, label, parameters,
    ...(argument !== undefined && parameters.length ? {activeParameter: Math.min(argument, parameters.length - 1)} : {}),
    source: form.source, checked: form.checked
  };
}
export function signatureHelp(text: string, offset: number, lookup: (name: string) => FunctionFact | undefined = functionFact, tree: SyntaxTree = parse(text)) {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return;
  if (tree.limited || tree.tokens.some(t => t.kind === 'comment' && offset > t.start && offset <= t.end)) return;
  const call = tree.calls.filter(c => offset >= c.open.end && offset <= (c.close?.start ?? c.end)).at(-1);
  if (!call) return;
  // Resolve the innermost call first: an unknown child never inherits outer help.
  const fact = lookup(call.name.text);
  if (!fact || fact.status === 'blocked') return;
  const stage = tree.stages.filter(s => s.name.start < call.name.start && s.end >= call.name.end).at(-1);
  const forms = callFormsForStage(fact,stage?.name.text);
  if (!forms.length) return;
  const argument = call.commas.filter(position => position < offset).length;
  const signatures = forms.map(form => displayForm(fact.name, form, argument));
  const argumentEnd = call.close?.start ?? call.end;
  const empty = !tree.tokens.some(t => t.kind !== 'comment' && t.start >= call.open.end && t.end <= argumentEnd);
  const zero = empty ? forms.findIndex(f => f.syntaxKind === 'positional' && f.arityKnown && f.parameters.length === 0) : -1;
  // Stable arity ranking only; unknown types never eliminate plausible overloads.
  const activeSignature = zero >= 0 ? zero : Math.max(0, forms.findIndex(form => form.syntaxKind === 'positional' && form.arityKnown &&
    (argument < form.parameters.length || !!form.parameters.at(-1)?.repeat)));
  const selected = signatures[activeSignature]!;
  return {signatures, activeSignature, ...(fact.summary?{summary:fact.summary}:{}),
    ...(selected.activeParameter !== undefined ? {activeParameter:selected.activeParameter} : {})};
}

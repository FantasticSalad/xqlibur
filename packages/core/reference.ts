import data from '../../reference/signatures.json';

export interface ParameterFact {
  name: string;
  optional: boolean;
  repeat: boolean;
  typeLabel?: string;
}
export interface CallForm {
  id: string;
  contexts: readonly string[];
  parameters: readonly ParameterFact[];
  // Positional parameter layout; special displays may have a separate direct count.
  arityKnown: boolean;
  syntaxKind: 'positional' | 'special';
  syntaxLabel?: string;
  invocation?: 'call' | 'infix';
  validation: 'displayOnly' | 'arityVerified';
  callCount?: Readonly<{min:number; max:number}>;
  source: string;
  checked: string;
}
export interface FunctionFact {
  name: string;
  status: 'verified' | 'partial' | 'blocked';
  summary?: string;
  forms: readonly CallForm[];
}
// Build/test validation accepts only v3; no indefinite dual-shape runtime fallback.
export const reference = data.functions as readonly FunctionFact[];
const byName = new Map(reference.map(f => [f.name, f]));
export function functionFact(name: string): FunctionFact | undefined { return byName.get(name); }
/** Reviewed call contexts, shared by help, counts and suggestion filtering. */
export function callFormsForStage(fact:FunctionFact,stageName?:string):readonly CallForm[] {
  return fact.forms.filter(form=>form.invocation!=='infix'&&
    (form.contexts.includes('expression')||stageName!==undefined&&form.contexts.includes(stageName)));
}
/** Unknown/blocked coverage keeps inventory suggestions; this is not runtime availability. */
export function canSuggestFunction(name:string,stageName?:string):boolean {
  const fact=functionFact(name);
  return !fact?.forms.length||callFormsForStage(fact,stageName).length>0;
}
export function parameterLabel(parameter: ParameterFact): string {
  return (parameter.repeat ? '...' : '') + parameter.name;
}

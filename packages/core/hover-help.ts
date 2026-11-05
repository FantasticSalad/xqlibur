// Concise presentation facts. These do not authorize diagnostics or runtime claims.
// Sources and checked dates stay here rather than in editor hover text.
export const hoverHelp: Readonly<Record<string, {summary:string; syntax?:string; source:string; checked:string}>> = {
  'stage:alter': {
    summary:'Creates fields or changes existing field values using constants, other fields or function results.',
    source:'https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/stages/alter', checked:'2026-11-05'
  },
  'function:json_extract_scalar': {
    summary:'Extracts a scalar value from a JSON-formatted string at the specified path and returns it as a string.',
    source:'https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/json_extract_scalar', checked:'2026-11-05'
  },
  'stage:filter': {
    summary:'Keeps records where the condition is true.', syntax:'filter <boolean_expression>',
    source:'https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/stages/filter', checked:'2026-11-05'
  },
  'function:if': {
    summary:'Returns a value according to whether a condition is true or false. The false value is optional; when omitted, a false condition returns null.',
    syntax:'if(boolean_expression, true_return_expression, [false_return_expression])',
    source:'https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/if', checked:'2026-11-05'
  }
};

export function localExplanation(role:string, origin:string, certainty:string):string {
  if(role==='query alias') return 'Names the joined query in this join condition.';
  if(role==='callback parameter') return 'Represents an element inside this callback expression.';
  if(role==='JSON member') return 'A JSON member access. Its contents are not available to the editor.';
  if(role==='derived field') {
    const description:Record<string,string>={alter:'Created or replaced by alter in this query.',projection:'Named by fields in this query.',aggregate:'Names an aggregate result in this query.'};
    return (description[origin]??'Defined in this query.')+(certainty==='known'?'':' This definition is incomplete or uncertain.');
  }
  return 'Referenced in this query. The editor has no source schema to confirm this field.';
}

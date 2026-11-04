import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const ident = '[A-Za-z_][A-Za-z_0-9]*';
const include = name => ({include:'#'+name});
const scope = (name, match) => ({name, match});
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeGrammar(catalogue) {
  const keys = new Set();
  for (const symbol of catalogue.symbols) {
    assert.ok(['stage','function'].includes(symbol.kind));
    assert.match(symbol.name, /^[a-z][a-z0-9_]*$/);
    const key = symbol.kind + ':' + symbol.name;
    assert.ok(!keys.has(key), 'Duplicate grammar symbol'); keys.add(key);
  }
  const names = kind => catalogue.symbols.filter(s=>s.kind===kind).map(s=>s.name).sort();
  const functions = names('function').map(escapeRegex).join('|');
  // cold_dataset is a separately documented source spelling in stage-facts.
  const stages = [...new Set([...names('stage'),'cold_dataset'])].sort();
  const entries = new Set(['dataset','cold_dataset','datamodel','preset','config']);
  const comments = [
    {name:'comment.line.double-slash.xql',begin:'//',end:'$'},
    {name:'comment.block.xql',begin:'/\\*',end:'\\*/'}
  ];
  // Delimiter recovery stays compatible with the scanner. Ordinary double-quoted
  // backslashes remain plain string text; only reviewed triple-quote escapes gain
  // an escape scope. Other quote/escape semantics remain partial fact coverage.
  const opaqueBackslash = {match:'\\\\.'};
  const strings = ['"',"'"].flatMap(q=>[
    {name:`string.quoted.${q==='"'?'double':'single'}.multi.xql`,begin:q.repeat(3),end:q.repeat(3),patterns:[
      ...(q==='"'?[scope('constant.character.escape.xql','\\\\[nt\\\\]')]:[]),opaqueBackslash
    ]},
    {name:`string.quoted.${q==='"'?'double':'single'}.xql`,begin:q,end:q,patterns:[opaqueBackslash]}
  ]);
  const members = ['\\.','->'].map(separator=>({
    match:`(?<=${separator})\\s*(${ident})`,captures:{1:{name:'variable.other.property.xql'}}
  }));
  const numbers = scope('constant.numeric.xql','\\b[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\\b');
  const operators = scope('keyword.operator.xql','!~=|->|!=|>=|<=|~=|==|[=<>+*/%-]');
  const punctuation = [scope('punctuation.separator.pipeline.xql','\\|'),
    scope('punctuation.separator.comma.xql',','),scope('punctuation.separator.path.xql','\\.')];
  const property = scope('variable.other.property.xql',`\\b${ident}\\b`);
  const groups = [['\\(','\\)','parens'],['\\[','\\]','brackets'],['\\{','\\}','braces']].map(([begin,end,name])=>({
    begin,end,beginCaptures:{0:{name:`punctuation.section.${name}.begin.xql`}},
    endCaptures:{0:{name:`punctuation.section.${name}.end.xql`}},patterns:[include('main')]
  }));
  // A documented word operator can have a parenthesized RHS. It is not a
  // one-argument function call merely because '(' follows the spelling.
  const wordOp='((?i:contains|incidr6?))',negation='(?:((?i:not))\\s+)?';
  const leftField=`(?!(?i:and|or|not|in|contains|incidr|incidr6|true|false|null)\\b)${ident}`;
  const wordScope={name:'keyword.operator.word.xql'};
  const infixGroups=[
    ...['\\.','->'].map(separator=>({match:`(?<=${separator})\\s*(${ident})\\s+${negation}${wordOp}(?=\\s*\\()`,
      captures:{1:{name:'variable.other.property.xql'},2:wordScope,3:wordScope}})),
    {match:`\\b(${leftField})\\s+${negation}${wordOp}(?=\\s*\\()`,captures:{
      1:{name:'variable.other.property.xql'},2:wordScope,3:wordScope}},
    {match:`\\b((?i:true|false|null))\\s+${negation}${wordOp}(?=\\s*\\()`,captures:{1:{name:'constant.language.xql'},2:wordScope,3:wordScope}},
    ...[')',']','}',String.fromCharCode(34),"'",'[0-9]'].map(end=>({
      match:`(?<=${end==='[0-9]'?end:escapeRegex(end)})\\s+${negation}${wordOp}(?=\\s*\\()`,captures:{1:wordScope,2:wordScope}})),
    // At an unproved continuation-line boundary prefer the word-operator fallback.
    {match:`^\\s*${wordOp}(?=\\s*\\()`,captures:{1:wordScope}}
  ];
  const expression = [include('comments'),include('strings'),include('wordOperatorGroups'),...members,
    scope('support.function.xql',`\\b(?:${functions})(?=\\s*\\()`),
    scope('entity.name.function.xql',`\\b(?!(?i:in|and|or|not|as|by|over)\\b)${ident}(?=\\s*\\()`),
    scope('constant.language.xql','\\b(?i:true|false|null)\\b'),
    scope('keyword.operator.word.xql','\\b(?i:and|or|not|in|contains|incidr|incidr6)\\b(?!\\s*=)'),
    numbers,...groups,operators,...punctuation,property
  ];
  const fieldAlias = {
    match:`\\b(${ident}(?:\\.${ident})*)\\s+((?i:as))\\s+(${ident})\\b`,
    captures:{1:{name:'meta.field.path.xql',patterns:[include('pathParts')]},
      2:{name:'keyword.control.clause.xql'},3:{name:'variable.other.xql'}}
  };
  const alias = namespace => ({
    match:`(?<=\\))\\s+((?i:as))\\s+(${ident})(?:\\s+((?i:by))\\b)?`,
    captures:{1:{name:'keyword.control.clause.xql'},2:{name:namespace?'entity.name.namespace.xql':'variable.other.xql'},3:{name:'keyword.control.clause.xql'}}
  });
  const directBy = {match:'(?<=\\))\\s+((?i:by))\\b',captures:{1:{name:'keyword.control.clause.xql'}}};
  const stageRules = stages.map(name=>{
    const extras = name==='fields'?[fieldAlias,scope('keyword.operator.wildcard.xql','\\*')]:
      ['comp','windowcomp'].includes(name)?[alias(false),directBy]:name==='join'?[alias(true)]:
      name==='sort'?[scope('keyword.control.clause.xql','\\b(?i:asc|desc)(?=\\s+[A-Za-z_])')]:
      name==='config'?[scope('variable.parameter.option.xql',`\\b${ident}(?=\\s*=)`)]:[];
    const body = name==='fields'?[include('comments'),include('strings'),...extras,...members,...groups,...punctuation,property]:
      [include('comments'),include('strings'),include('wordOperatorGroups'),...members,...extras,include('expression')];
    return {
      name:`meta.stage.${name}.xql`,
      begin:`(?:(\\|)|\\A)\\s*(${escapeRegex(name)})\\b`+
        (entries.has(name)?`|(?<=\\()\\s*(${escapeRegex(name)})\\b(?=\\s*(?:=|[A-Za-z_]))`:''),
      beginCaptures:{1:{name:'punctuation.separator.pipeline.xql'},2:{name:'keyword.control.xql'},3:{name:'keyword.control.xql'}},
      end:'(?=\\||\\))',patterns:body
    };
  });
  return {name:'Cortex XQL',scopeName:'source.cortex-xql',patterns:[include('main')],repository:{
    main:{patterns:[include('comments'),include('strings'),...stageRules,include('expression')]},
    expression:{patterns:expression},
    wordOperatorGroups:{patterns:infixGroups},
    comments:{patterns:comments},strings:{patterns:strings},
    pathParts:{patterns:[scope('punctuation.separator.path.xql','\\.'),property]}
  }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../',import.meta.url);
  const catalogue = JSON.parse(await readFile(new URL('reference/catalogue.json',root),'utf8'));
  await mkdir(new URL('syntaxes/',root),{recursive:true});
  await writeFile(new URL('syntaxes/xql.tmLanguage.json',root),JSON.stringify(makeGrammar(catalogue),null,2)+'\n');
}

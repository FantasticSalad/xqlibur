const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAnalysis,analyze}=require('../.build/packages/core');
const {arityFindings}=require('../.build/packages/core/diagnostics');
const {reference}=require('../.build/packages/core/reference');
const verifiedArityFixtures=require('./fixtures/verified-arities.json');
const removed=text=>analyze(text).filter(f=>f.code==='XQL301');
test('established rename/removal in a supported closed context yields one precise warning',()=>{
  const text='// 🗡\r\nalter alpha = 1 | fields alpha as beta | filter (alpha = beta) and (alpha = 1)';
  const findings=removed(text);assert.equal(findings.length,1);assert.equal(findings[0].severity,'warning');
  assert.equal(text.slice(findings[0].start,findings[0].end),'alpha');assert.equal(findings[0].start,text.indexOf('alpha = beta'));
  assert.match(findings[0].message,/renamed to 'beta'/);assert.match(findings[0].message,/not tenant validation/);
  assert.equal(removed('alter alpha = 1, beta = 2 | fields alpha | filter beta = 2').length,1);
  assert.equal(removed('alter alpha = 1 | fields alpha | fields - alpha | filter alpha = 1').length,1);
  assert.equal(removed('alter alpha = 1, beta = 2 | comp count() as total by beta | filter alpha = 1').length,1);
});
test('nearby valid names, reintroduction, system retention, open schemas and observations do not warn',()=>{
  for(const text of [
    'alter alpha = 1 | fields alpha as beta | filter beta = 1',
    'alter alpha = 1 | fields alpha as beta | alter alpha = 2 | filter alpha = 2',
    'alter alpha = 1 | fields - alpha | filter alpha = 1',
    'fields alpha | fields - alpha | filter alpha = 1',
    'alter _time = 1, alpha = 2 | fields alpha | filter _time = 1',
    'alter _id = 1, alpha = 2 | fields alpha | fields - _id | filter _id = 1',
    'alter alpha = 1 | fields alpha | fields alpha* | fields - alpha | filter alpha = 1',
    'alter alpha = 1 | fields alpha as beta | filter alpha->member = 1',
    'alter payload.branch = 1 | fields payload.branch | fields - payload.branch | filter payload->branch = 1'
  ]) assert.deepEqual(removed(text),[],text);
});
test('unknown/partial/join/union boundaries invalidate absence proof and dependent findings',()=>{
  for(const stage of ['mystery alpha','alter gamma =','fields beta,','join (alter gamma = 1) as child child.gamma = beta','union (alter gamma = 1)','windowcomp sum(beta) as rolling over(partition by beta order by beta)']) {
    const text='alter alpha = 1 | fields alpha as beta | '+stage+' | filter alpha = 1';assert.deepEqual(removed(text),[],stage);
  }
  assert.deepEqual(removed('alter alpha = 1 | fields alpha as beta | filter alpha = future_function(1)'),[]);
  assert.deepEqual(removed('alter alpha = 1 | fields alpha as beta | alter alpha = alpha + 1'),[]);
});
test('incomplete field reads stay quiet and correction removes the warning',()=>{
  const prefix='alter alpha = 1 | fields alpha as beta | filter ';
  for(const tail of ['a','alph','alpha','alpha =','alpha = ','alpha = lowercase(','alpha = "open']) assert.deepEqual(removed(prefix+tail),[],tail);
  assert.equal(removed(prefix+'alpha = 1').length,1);assert.deepEqual(removed(prefix+'beta = 1'),[]);
});
const parameter=(name,optional=false,repeat=false)=>({name,optional,repeat});
const form=(parameters,patch={})=>({id:'synthetic-form',contexts:['expression'],parameters,arityKnown:true,syntaxKind:'positional',validation:'arityVerified',source:'https://cortex-docs.paloaltonetworks.com/xql-command-reference-guide/readme/functions/lowercase',checked:'2026-10-25',...patch});
const fact=(forms,patch={})=>({name:'lowercase',status:'verified',forms,...patch});
function arity(text,facts) {const analysis=createAnalysis(text);return arityFindings(analysis,analysis.coverage,name=>facts[name]);}
test('synthetic fully verified positional forms warn only when all applicable arities contradict',()=>{
  const facts={lowercase:fact([form([parameter('value')])])};
  for(const call of ['lowercase()','lowercase(1, 2)']) {const findings=arity('alter alpha = '+call,facts);assert.equal(findings.length,1);assert.equal(findings[0].code,'XQL302');assert.equal(findings[0].severity,'warning');assert.equal(('alter alpha = '+call).slice(findings[0].start,findings[0].end),'lowercase');}
  assert.deepEqual(arity('alter alpha = lowercase(1)',facts),[]);
  const nested=arity('alter alpha = lowercase(lowercase(), 2)',facts);assert.equal(nested.length,1);assert.equal(nested[0].start,'alter alpha = lowercase('.length);
  const overloads={lowercase:fact([form([]),form([parameter('first'),parameter('second',true)],{id:'other'})])};
  for(const args of ['','1','1, 2']) assert.deepEqual(arity('alter alpha = lowercase('+args+')',overloads),[]);
  assert.equal(arity('alter alpha = lowercase(1, 2, 3)',overloads).length,1);
});
test('optional/repeat/context alternatives and unverified/special facts fail open',()=>{
  const variadic={lowercase:fact([form([parameter('value'),parameter('more',true,true)])])};
  assert.equal(arity('alter alpha = lowercase()',variadic).length,1);assert.deepEqual(arity('alter alpha = lowercase(1, 2, 3, 4)',variadic),[]);
  for(const candidate of [fact([form([parameter('value')])],{status:'partial'}),fact([form([parameter('value')],{validation:'displayOnly'})]),fact([form([],{arityKnown:false})]),fact([form([],{syntaxKind:'special',syntaxLabel:'lowercase(special form)'})]),fact([form([parameter('value')]),form([],{id:'unknown',arityKnown:false})]),fact([form([parameter('value')],{contexts:['comp']})])]) assert.deepEqual(arity('alter alpha = lowercase()', {lowercase:candidate}),[]);
});
test('incomplete/unsupported arguments and unknown inner calls suppress arity instead of guessing',()=>{
  const facts={lowercase:fact([form([parameter('value')])])};
  for(const call of ['lowercase(','lowercase(1,','lowercase(1,)','lowercase(,1)','lowercase(1 + )','lowercase([1,2], 3)','lowercase(future_function(1), 2)','lowercase("open','lowercase(1 2, 3)']) assert.deepEqual(arity('alter alpha = '+call,facts),[],call);
  assert.equal(arity('alter alpha = lowercase(concat("a", "b"), 2)',facts).length,1);
  const typeOverload={lowercase:fact([form([parameter('value')]),form([parameter('value')],{id:'same-arity-other-type'})])};
  assert.deepEqual(arity('alter alpha = lowercase(1)',typeOverload),[]);
});
test('reviewed production arities warn on contradictions and keep types/other forms unverified',()=>{
  assert.deepEqual(reference.filter(f=>f.status==='verified').map(f=>f.name).sort(),verifiedArityFixtures.map(f=>f.name).sort());
  for(const fixture of verifiedArityFixtures) {
    for(const context of fixture.contexts??['expression']) {
      assert.ok(['expression','comp','windowcomp'].includes(context));
      const query=call=>context==='expression'?'alter alpha = '+call:context+' '+call+(fixture.suffix??' as result');
      for(const call of fixture.invalid) assert.equal(analyze(query(call)).filter(f=>f.code==='XQL302').length,1,context+': '+call);
      for(const call of fixture.valid) assert.deepEqual(analyze(query(call)),[],context+': '+call+' tests counts, not operand types');
    }
  }
  for(const text of ['alter alpha = lowercase(1)','alter alpha = uppercase("amber")','alter alpha = rand()','alter alpha = current_time()','alter alpha = coalesce()','alter alpha = coalesce(1)','alter alpha = arraycreate()','alter alpha = count(1, 2)','alter alpha = lag()','alter alpha = lowercase(alpha = 1 or beta = 2, 3)']) assert.ok(!analyze(text).some(f=>f.code==='XQL302'),text);
  for(const text of ['alter alpha = lowercase(','alter alpha = lowercase(1,)','alter alpha = lowercase(future_function(1), 2)','alter alpha = lowercase([1, 2], 3)']) assert.ok(!analyze(text).some(f=>f.code==='XQL302'),text);
});

test('array count checks preserve callback uncertainty and suppress enclosing cascades',()=>{
  for(const call of [
    'arrayfilter(items, future_function(1), 2)', 'arrayfilter(items, "@element" + 1, 2)', 'arrayindexof()',
    'arraymap(items, future_function(1), 2)',
    'arraymap(items, "@element" + 1, 2)',
    'arrayrange([1, 2], 0)', 'arraymap(items, lowercase("@element"),)'
  ]) assert.ok(!analyze('alter result = '+call).some(f=>f.code==='XQL302'),call);
  const text='alter result = arraymap(items, lowercase(), 3)';
  const findings=analyze(text).filter(f=>f.code==='XQL302');
  assert.equal(findings.length,1);
  assert.equal(text.slice(findings[0].start,findings[0].end),'lowercase');
});

test('uncertain format minima and parsing-only capture availability never become count rejections',()=>{
  const {signatureHelp}=require('../.build/packages/core/signatures');
  const {hover}=require('../.build/packages/core');
  for(const call of ['format_string()','format_string("literal")','format_string("%s", "amber")','format_string("%s %s", 1, 2)','regexcapture()','regexcapture(1, 2, 3)']) {
    const text='alter result = '+call;
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),call);
    if(call.startsWith('format_string')) {
      const display=signatureHelp(text,text.lastIndexOf(')')).signatures[0];
      assert.equal(display.label,'format_string(format_string, ...format_values)');
      assert.deepEqual(display.parameters,[]);assert.equal(display.activeParameter,undefined);
    }
  }
  const capture='alter result = regexcapture(1, 2)';
  assert.match(hover(capture,capture.indexOf('regexcapture')).signature.summary,/parsing rules; unavailable in interactive Query Builder/);
  const wildcard='alter result = wildcard_match(1, 2)';
  assert.match(hover(wildcard,wildcard.indexOf('wildcard_match')).signature.summary,/license.*Cortex Cloud.*not checked locally/);
});

test('JSON call counts do not reinterpret infix notation as function arguments or validate strings',()=>{
  const {signatureHelp}=require('../.build/packages/core/signatures');
  for(const expression of ['payload -> branch','payload -> branch{}','payload -> branch[]','payload ->-> "$.branch"']) {
    const text='alter result = '+expression;
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),expression);
    assert.equal(signatureHelp(text,text.length),undefined);
  }
  for(const name of ['json_extract_scalar','json_extract','json_extract_array','json_path_extract']) {
    const text='alter result = '+name+'("not-json", "not-a-path")';
    const help=signatureHelp(text,text.lastIndexOf(')'));
    assert.equal(help.signatures.length,1);
    assert.ok(help.signatures.every(s=>!s.label.includes('->')));
    assert.deepEqual(analyze(text),[]);
  }
});

test('production parse_epoch accepts every documented overload and selects matching argument help',()=>{
  const {signatureHelp}=require('../.build/packages/core/signatures');
  for(const args of ['"%Y", "2026"','"%Y", "2026", "UTC"','"%Y", "2026", "UTC", "SECONDS"']) {
    const text='alter result = parse_epoch('+args+')',help=signatureHelp(text,text.lastIndexOf(')'));
    assert.equal(help.signatures.length,3);
    assert.equal(help.signatures[help.activeSignature].parameters.length,args.split(',').length);
    assert.deepEqual(analyze(text),[]);
  }
});

test('conflicting to_epoch unit requirement remains explicit and cannot reject omission',()=>{
  const {hover}=require('../.build/packages/core');
  for(const call of ['to_epoch()','to_epoch(source_time)','to_epoch(source_time, "unreviewed-unit")']) {
    const text='alter result = '+call;
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),call);
    assert.match(hover(text,text.indexOf('to_epoch')).signature.summary,/usage notes describe omitting the unit.*unverified/);
  }
});

test('extended conditional help preserves short hints without inventing a maximum or branching rules',()=>{
  const {signatureHelp}=require('../.build/packages/core/signatures');
  for(const args of ['true, 1','true, 1, 2']) {
    const text='alter result = if('+args+')',help=signatureHelp(text,text.lastIndexOf(')'));
    assert.equal(help.signatures.length,2);
    assert.equal(help.signatures[help.activeSignature].parameters.length,3);
    assert.ok(help.activeParameter>=0&&help.activeParameter<3);
  }
  for(const call of ['if()','if(1)','if(true, 1, false, 2, 3)','if(true, 1, false, 2, true, 3)']) {
    const text='alter result = '+call;
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),call);
    if(call.includes('false')) {
      const help=signatureHelp(text,text.lastIndexOf(')')),selected=help.signatures[help.activeSignature];
      assert.equal(selected.label,'if(condition, value, ...conditional_values)');
      assert.deepEqual(selected.parameters,[]);assert.equal(help.activeParameter,undefined);
    }
  }
});

test('object pair syntax stays outside positional checks and hierarchy types cannot select an overload',()=>{
  for(const call of ['object_create()','object_create(1)','object_create("key", 1, "unpaired")','hierarchy_match(1, 2)'])
    assert.ok(!analyze('alter result = '+call).some(f=>f.code==='XQL302'),call);
});

test('aggregate count facts apply only in their declared query-local stage contexts',()=>{
  for(const name of ['avg','min','max','median','sum','list','values','earliest','latest'])
    assert.ok(!analyze('alter result = '+name+'()').some(f=>f.code==='XQL302'),name);
  for(const name of ['list','values','earliest'])
    assert.ok(!analyze('windowcomp '+name+'() as result').some(f=>f.code==='XQL302'),name);
  assert.ok(!analyze('windowcomp avg() over(partition by source_value) as result').some(f=>f.code==='XQL302'));
  const text='comp avg() as result | union (alter result = avg())';
  const findings=analyze(text).filter(f=>f.code==='XQL302');
  assert.equal(findings.length,1);assert.equal(findings[0].start,text.indexOf('avg'));
});

test('count zero/field overload selection remains contextual and never imports a star form',()=>{
  const {signatureHelp}=require('../.build/packages/core/signatures');
  for(const context of ['comp','windowcomp']) for(const argument of ['', 'source_value']) {
    const text=context+' count('+argument+') as result';
    const help=signatureHelp(text,text.indexOf(')'));
    assert.equal(help.signatures.length,2);
    assert.equal(help.signatures[help.activeSignature].parameters.length,argument?1:0);
    assert.equal(help.activeParameter,argument?0:undefined);
    assert.deepEqual(analyze(text),[]);
  }
  for(const text of ['alter result = count(1, 2)','comp count(*) as result','windowcomp count(1,) as result'])
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),text);
});

test('approximate/statistical count rules do not validate values or leak into other stages',()=>{
  for(const name of ['approx_count','approx_quantiles','approx_top','stddev_population','stddev_sample','var'])
    assert.ok(!analyze('alter result = '+name+'()').some(f=>f.code==='XQL302'),name);
  for(const name of ['approx_count','approx_quantiles','approx_top','var'])
    assert.ok(!analyze('windowcomp '+name+'() as result').some(f=>f.code==='XQL302'),name);
  const {signatureHelp}=require('../.build/packages/core/signatures');
  for(const args of ['source_value','source_value, 4','source_value, 4, "weight"']) {
    const text='comp approx_top('+args+') as result',help=signatureHelp(text,text.indexOf(')'));
    assert.equal(help.signatures[help.activeSignature].parameters.length,args.split(',').length===3?3:2);
    assert.deepEqual(analyze(text),[]);
  }
});

test('negative numeric atoms permit independent count and removed-name proofs without numeric validation',()=>{
  for(const call of ['cbrt(-8)','cot(-1)','sqrt(-4)','pow(-2, 3)','trunc(-1.25, 0)']) assert.deepEqual(analyze('alter result = '+call),[],call);
  for(const call of ['pow(-2, 3, 4)','cbrt(-8, 1)','trunc(-1.25, 0, 1)']) {
    const text='alter result = '+call,findings=analyze(text).filter(f=>f.code==='XQL302');
    assert.equal(findings.length,1,call);assert.equal(text.slice(findings[0].start,findings[0].end),call.slice(0,call.indexOf('(')));
  }
  for(const call of ['pow(- 2, 3, 4)','pow(-source_value, 3, 4)','pow(1-2, 3, 4)','pow(-2 + 1, 3, 4)','pow(-, 3, 4)'])
    assert.ok(!analyze('alter result = '+call).some(f=>f.code==='XQL302'),call);
  assert.equal(removed('alter alpha = 1 | fields alpha as beta | filter alpha = -1').length,1);
  assert.deepEqual(removed('alter alpha = 1 | fields alpha as beta | filter beta = -1'),[]);
  assert.deepEqual(removed('alter alpha = 1 | fields alpha as beta | filter alpha = -1 or beta = -2'),[]);
});

test('navigation and ranking counts preserve stage boundaries and incomplete ordering suppression',()=>{
  for(const name of ['first','last','first_value','last_value','lag','rank','row_number'])
    assert.ok(!analyze('alter result = '+name+'(1, 2, 3, 4)').some(f=>f.code==='XQL302'),name);
  for(const name of ['first_value','last_value','lag','rank','row_number'])
    assert.ok(!analyze('comp '+name+'(1, 2, 3, 4) as result').some(f=>f.code==='XQL302'),name);
  for(const text of ['windowcomp lag() as result over(partition by group_key order by)','windowcomp rank(1) sort','windowcomp row_number(1) sort order_value as'])
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),text);
  assert.deepEqual(analyze('windowcomp lag(source_value, -1, "default") as result over(partition by group_key order by order_value)'),[]);
});

test('adjacent sign changes preserve count decisions across independent contextual fixtures',()=>{
  const {scan}=require('../.build/packages/core/lexer');
  let exercised=0;
  for(const fixture of verifiedArityFixtures) for(const context of fixture.contexts??['expression'])
    for(const [calls,expected] of [[fixture.valid,0],[fixture.invalid,1]]) for(const call of calls) {
      const tokens=scan(call),positions=tokens.filter((token,index)=>token.kind==='number'&&['(',','].includes(tokens[index-1]?.text)).map(token=>token.start);
      if(!positions.length) continue;
      let signed=call;
      for(const start of positions.reverse()) signed=signed.slice(0,start)+'-'+signed.slice(start);
      const text=context==='expression'?'alter result = '+signed:context+' '+signed+(fixture.suffix??' as result');
      assert.equal(analyze(text).filter(f=>f.code==='XQL302').length,expected,context+': '+signed);
      exercised++;
    }
  assert.ok(exercised>0);
});

test('special labels need explicit direct-count proof without inventing parameter or callback grammar',()=>{
  const {signatureHelp}=require('../.build/packages/core/signatures');
  for(const name of ['array_all','array_any']) {
    const text='alter result = '+name+'(items, "@element" = 1)',help=signatureHelp(text,text.lastIndexOf(')'));
    const selected=help.signatures[help.activeSignature];
    assert.deepEqual(selected.parameters,[]);assert.equal(selected.activeParameter,undefined);assert.equal(help.activeParameter,undefined);
    assert.match(selected.label,/@element/);
  }
  const explicit=form([],{arityKnown:false,syntaxKind:'special',syntaxLabel:'lowercase(array, condition)',callCount:{min:2,max:2}});
  const facts={lowercase:fact([explicit])};
  assert.equal(arity('alter result = lowercase(1)',facts).length,1);
  assert.deepEqual(arity('alter result = lowercase(1, 2)',facts),[]);
  const missing={...explicit};delete missing.callCount;
  assert.deepEqual(arity('alter result = lowercase(1)',{lowercase:fact([missing])}),[]);
  assert.deepEqual(arity('alter result = lowercase(1)',{lowercase:fact([explicit],{status:'partial'})}),[]);
  const mixed={lowercase:fact([explicit,form([parameter('value')],{id:'positional'})])};
  assert.deepEqual(arity('alter result = lowercase(1)',mixed),[]);
  assert.equal(arity('alter result = lowercase(1, 2, 3)',mixed).length,1);
  for(const text of ['alter result = array_all(items, future_function(1), 2)','alter result = array_any(items, "@element" + 1, 2)','alter result = arrayfilter(items, 1,)','alter result = arrayindexof(items)','alter result = arrayindexof(items, 1, 2)'])
    assert.ok(!analyze(text).some(f=>f.code==='XQL302'),text);
});

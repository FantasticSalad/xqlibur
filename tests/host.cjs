const vscode=require('vscode');
const assert=require('node:assert/strict');
const {decode}=require('./semantic-protocol.cjs');
exports.run=async()=>{
  assert.equal(vscode.workspace.isTrusted,false,'Test host must be in Restricted Mode');
  const extension=vscode.extensions.getExtension('FantasticSalad.xqlibur');
  assert.ok(extension,'Extension is discoverable');
  await extension.activate();
  const doc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'dataset = xdr_data | '});
  let completion;
  for(let i=0;i<50;i++) {
    completion=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',doc.uri,new vscode.Position(0,20));
    if(completion?.items.some(item=>item.label==='filter')) break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(completion?.items.some(item=>item.label==='filter'));
  const yamlText='name: ordinary\nxql: |\n  dataset = xdr_data\n  | fi\n';
  const yamlDoc=await vscode.workspace.openTextDocument({language:'yaml',content:yamlText});
  let yamlCompletion;
  for(let attempt=0;attempt<50;attempt++) {
    yamlCompletion=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',yamlDoc.uri,new vscode.Position(3,6));
    if(yamlCompletion?.items.some(item=>item.label==='filter')) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const yamlFilter=yamlCompletion?.items.find(item=>item.label==='filter');
  assert.ok(yamlFilter);
  assert.equal(yamlDoc.getText(yamlFilter.range),'fi');
  const yamlOutside=await vscode.commands.executeCommand('vscode.executeHoverProvider',yamlDoc.uri,new vscode.Position(0,2));
  assert.ok(!yamlOutside?.some(item=>JSON.stringify(item.contents).includes('XQLibur')));
  for(const [text,available] of [
    ['alter result = av',false],['comp av',true],['windowcomp av',true],
    ['comp count() as total | union (alter result = av',false],['join (comp av',true]
  ]) {
    const contextDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:text});
    const candidates=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',contextDoc.uri,contextDoc.positionAt(text.length));
    const avg=candidates.items.find(item=>item.label==='avg'&&item.kind===vscode.CompletionItemKind.Function);
    assert.equal(!!avg,available,text);
    if(avg) {
      assert.equal(contextDoc.getText(avg.range),'av');
      const completionEdit=new vscode.WorkspaceEdit();completionEdit.replace(contextDoc.uri,avg.range,avg.insertText);
      assert.ok(await vscode.workspace.applyEdit(completionEdit));
      assert.equal(contextDoc.getText(),text.slice(0,-2)+'avg');
    }
  }
  const hover=await vscode.commands.executeCommand('vscode.executeHoverProvider',doc.uri,new vscode.Position(0,2));
  assert.ok(hover.length);
  for(const [name,caveat] of [['coalesce',/minimum .*count remains unverified/],['arraycreate',/minimum .*count remains unverified/],['regexcapture',/unavailable in interactive Query Builder queries/]]) {
    const text='alter result = '+name+'()';
    const partialDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:text});
    const partialHover=await vscode.commands.executeCommand('vscode.executeHoverProvider',partialDoc.uri,partialDoc.positionAt(text.indexOf(name)+1));
    assert.ok(partialHover.some(h=>h.contents.some(c=>caveat.test(c.value??''))));
    const suggestions=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',partialDoc.uri,partialDoc.positionAt(text.indexOf(name)+name.length));
    const candidate=suggestions.items.find(item=>item.label===name&&item.kind===vscode.CompletionItemKind.Function);
    const suggestionNote=typeof candidate.documentation==='string'?candidate.documentation:candidate.documentation?.value;
    assert.match(suggestionNote,caveat);
    const partialHelp=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',partialDoc.uri,partialDoc.positionAt(text.lastIndexOf(')')),'(');
    for(const signature of partialHelp.signatures) {
      const note=typeof signature.documentation==='string'?signature.documentation:signature.documentation?.value;
      assert.match(note,caveat);
    }
  }
  const edit=new vscode.WorkspaceEdit();
  edit.insert(doc.uri,new vscode.Position(0,20),'alter sample = )');
  await vscode.workspace.applyEdit(edit);
  for(let i=0;i<50&&!vscode.languages.getDiagnostics(doc.uri).length;i++) await new Promise(r=>setTimeout(r,100));
  assert.ok(vscode.languages.getDiagnostics(doc.uri).some(d=>d.code==='XQL103'));
  const signatureDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'dataset = xdr_data | alter sample = json_extract_scalar("{}", '});
  const hint=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',signatureDoc.uri,signatureDoc.positionAt(signatureDoc.getText().length),'(');
  assert.equal(hint.activeParameter,1);
  assert.ok(hint.signatures[0].label.includes('json_path'));
  const multiDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'dataset = xdr_data | alter result = arrayfilter([3, 4], "@element" = 3)'});
  const multiple=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',multiDoc.uri,multiDoc.positionAt(multiDoc.getText().indexOf('"@element"')),'(');
  assert.equal(multiple.signatures.length,2);
  assert.equal(multiple.activeParameter,1);
  assert.ok(multiple.signatures[1].label.includes('comparison value'));
  const optionalDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'dataset = xdr_data | alter result = trim("~amber~", "~")'});
  const optional=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',optionalDoc.uri,optionalDoc.positionAt(optionalDoc.getText().lastIndexOf('"~"')),'(');
  assert.equal(optional.activeParameter,1);
  assert.ok(optional.signatures[0].label.includes('[trim_characters]'));
  {
    const text='alter alpha = 1 | windowcomp sum() sort alpha between -null and 0 as rolling';
    const frameDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:text});
    const frameLegend=await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend',frameDoc.uri);
    const roles=decode(text,await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',frameDoc.uri),frameLegend);
    assert.equal(roles.find(token=>token.text==='rolling').type,'property');
    await new Promise(resolve=>setTimeout(resolve,350));
    assert.ok(!vscode.languages.getDiagnostics(frameDoc.uri).some(d=>d.code==='XQL302'));
    const sign=text.indexOf('-null'),frameEdit=new vscode.WorkspaceEdit();
    frameEdit.delete(frameDoc.uri,new vscode.Range(frameDoc.positionAt(sign),frameDoc.positionAt(sign+1)));
    assert.ok(await vscode.workspace.applyEdit(frameEdit));
    for(let attempt=0;attempt<50&&!vscode.languages.getDiagnostics(frameDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(vscode.languages.getDiagnostics(frameDoc.uri).some(d=>d.code==='XQL302'));
    const completed=decode(frameDoc.getText(),await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',frameDoc.uri),frameLegend);
    assert.equal(completed.find(token=>token.text==='rolling').type,'variable');
    const argumentEdit=new vscode.WorkspaceEdit();argumentEdit.insert(frameDoc.uri,frameDoc.positionAt(frameDoc.getText().indexOf('sum(')+4),'1');
    assert.ok(await vscode.workspace.applyEdit(argumentEdit));
    for(let attempt=0;attempt<50&&vscode.languages.getDiagnostics(frameDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(!vscode.languages.getDiagnostics(frameDoc.uri).some(d=>d.code==='XQL302'));
  }
  const tokens=await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',signatureDoc.uri);
  assert.ok(tokens?.data?.length,'Semantic token provider is registered and returns tokens');
  // Inspect returned field items and apply their edits. This editor command also
  // includes bundled snippets; IPC tests assert the server's exact full result.
  const fieldText='// 🗡\r\nalter alpha = "synthetic-private-value", payload.branch = 1 | fields alpha as gamma, payload.branch | filter gaamma = 1';
  const fieldDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:fieldText});
  const fieldItems=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',fieldDoc.uri,fieldDoc.positionAt(fieldText.indexOf('gaamma')+2));
  const gamma=fieldItems.items.find(i=>i.label==='gamma');
  assert.equal(gamma.kind,vscode.CompletionItemKind.Field);assert.equal(fieldDoc.getText(gamma.range),'gaamma');
  assert.equal(gamma.insertText,'gamma');assert.ok(!fieldItems.items.some(i=>i.label==='alpha'));
  const fieldEdit=new vscode.WorkspaceEdit();fieldEdit.replace(fieldDoc.uri,gamma.range,gamma.insertText);
  await vscode.workspace.applyEdit(fieldEdit);assert.equal(fieldDoc.getText(),fieldText.replace('gaamma','gamma'));
  const localInfo=await vscode.commands.executeCommand('vscode.executeHoverProvider',fieldDoc.uri,fieldDoc.positionAt(fieldText.indexOf('gamma')));
  assert.ok(localInfo.some(h=>h.contents.some(c=>c.value?.includes('derived field'))));
  assert.ok(!JSON.stringify(localInfo).includes('synthetic-private-value'));
  const memberDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'alter payload.branch = 1 | filter payload.'});
  const wildcardText='alter alpha = 1, alphabet = 2, beta = 3 | fields alpha* | filter al';
  const wildcardDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:wildcardText});
  const wildcardItems=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',wildcardDoc.uri,wildcardDoc.positionAt(wildcardText.length));
  assert.deepEqual(wildcardItems.items.filter(item=>item.kind===vscode.CompletionItemKind.Field).map(item=>item.label).sort(),['alpha','alphabet']);
  const memberItems=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',memberDoc.uri,memberDoc.positionAt(memberDoc.getText().length),'.');
  assert.deepEqual(memberItems.items.map(i=>i.label),['branch']);assert.equal(memberItems.items[0].insertText,'branch');
  const aggregateDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'alter alpha = 1, beta = 2 | comp count() as total by alpha | fields '});
  const aggregateItems=await vscode.commands.executeCommand('vscode.executeCompletionItemProvider',aggregateDoc.uri,aggregateDoc.positionAt(aggregateDoc.getText().length));
  assert.deepEqual(aggregateItems.items.filter(i=>i.kind===vscode.CompletionItemKind.Field).map(i=>i.label).sort(),['alpha','total']);
  const removedText='alter alpha = 1 | fields alpha as beta | filter alpha = 1';
  const removedDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:removedText});
  for(let attempt=0;attempt<50&&!vscode.languages.getDiagnostics(removedDoc.uri).some(d=>d.code==='XQL301');attempt++) await new Promise(r=>setTimeout(r,100));
  const removedFinding=vscode.languages.getDiagnostics(removedDoc.uri).find(d=>d.code==='XQL301');assert.ok(removedFinding);assert.equal(removedFinding.severity,vscode.DiagnosticSeverity.Warning);assert.equal(removedDoc.getText(removedFinding.range),'alpha');
  const correction=new vscode.WorkspaceEdit();correction.replace(removedDoc.uri,removedFinding.range,'beta');await vscode.workspace.applyEdit(correction);
  for(let attempt=0;attempt<50&&vscode.languages.getDiagnostics(removedDoc.uri).some(d=>d.code==='XQL301');attempt++) await new Promise(r=>setTimeout(r,100));
  assert.ok(!vscode.languages.getDiagnostics(removedDoc.uri).some(d=>d.code==='XQL301'));
  const arityDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'alter alpha = rand(1)'});
  for(let attempt=0;attempt<50&&!vscode.languages.getDiagnostics(arityDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  const arityFinding=vscode.languages.getDiagnostics(arityDoc.uri).find(d=>d.code==='XQL302');assert.ok(arityFinding);assert.equal(arityDoc.getText(arityFinding.range),'rand');
  const arityEdit=new vscode.WorkspaceEdit(),argument=arityDoc.getText().indexOf('1');arityEdit.delete(arityDoc.uri,new vscode.Range(arityDoc.positionAt(argument),arityDoc.positionAt(argument+1)));await vscode.workspace.applyEdit(arityEdit);
  for(let attempt=0;attempt<50&&vscode.languages.getDiagnostics(arityDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  assert.ok(!vscode.languages.getDiagnostics(arityDoc.uri).some(d=>d.code==='XQL302'));
  const aggregateArityDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'comp avg(1, 2) as result'});
  for(let attempt=0;attempt<50&&!vscode.languages.getDiagnostics(aggregateArityDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  const aggregateFinding=vscode.languages.getDiagnostics(aggregateArityDoc.uri).find(d=>d.code==='XQL302');
  assert.ok(aggregateFinding);assert.equal(aggregateArityDoc.getText(aggregateFinding.range),'avg');
  const aggregateEdit=new vscode.WorkspaceEdit(),extraArgument=aggregateArityDoc.getText().indexOf(', 2');
  aggregateEdit.delete(aggregateArityDoc.uri,new vscode.Range(aggregateArityDoc.positionAt(extraArgument),aggregateArityDoc.positionAt(extraArgument+3)));
  assert.equal(await vscode.workspace.applyEdit(aggregateEdit),true);
  for(let attempt=0;attempt<50&&vscode.languages.getDiagnostics(aggregateArityDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  assert.ok(!vscode.languages.getDiagnostics(aggregateArityDoc.uri).some(d=>d.code==='XQL302'));
  const negativeArityDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'alter result = pow(-2, 3, 4)'});
  for(let attempt=0;attempt<50&&!vscode.languages.getDiagnostics(negativeArityDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  const negativeFinding=vscode.languages.getDiagnostics(negativeArityDoc.uri).find(d=>d.code==='XQL302');
  assert.ok(negativeFinding);assert.equal(negativeArityDoc.getText(negativeFinding.range),'pow');
  const negativeEdit=new vscode.WorkspaceEdit(),lastArgument=negativeArityDoc.getText().indexOf(', 4');
  negativeEdit.delete(negativeArityDoc.uri,new vscode.Range(negativeArityDoc.positionAt(lastArgument),negativeArityDoc.positionAt(lastArgument+3)));
  assert.equal(await vscode.workspace.applyEdit(negativeEdit),true);
  for(let attempt=0;attempt<50&&vscode.languages.getDiagnostics(negativeArityDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  assert.ok(!vscode.languages.getDiagnostics(negativeArityDoc.uri).some(d=>d.code==='XQL302'));
  const specialCountDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:'alter result = array_all(items, 1, 2)'});
  for(let attempt=0;attempt<50&&!vscode.languages.getDiagnostics(specialCountDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  const specialFinding=vscode.languages.getDiagnostics(specialCountDoc.uri).find(d=>d.code==='XQL302');
  assert.ok(specialFinding);assert.equal(specialCountDoc.getText(specialFinding.range),'array_all');
  const specialEdit=new vscode.WorkspaceEdit(),specialExtra=specialCountDoc.getText().indexOf(', 2');
  specialEdit.delete(specialCountDoc.uri,new vscode.Range(specialCountDoc.positionAt(specialExtra),specialCountDoc.positionAt(specialExtra+3)));
  assert.equal(await vscode.workspace.applyEdit(specialEdit),true);
  for(let attempt=0;attempt<50&&vscode.languages.getDiagnostics(specialCountDoc.uri).some(d=>d.code==='XQL302');attempt++) await new Promise(r=>setTimeout(r,100));
  assert.ok(!vscode.languages.getDiagnostics(specialCountDoc.uri).some(d=>d.code==='XQL302'));
  const specialHelp=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',specialCountDoc.uri,specialCountDoc.positionAt(specialCountDoc.getText().lastIndexOf(')')));
  assert.equal(specialHelp.signatures.length,1);assert.deepEqual(specialHelp.signatures[0].parameters,[]);
  assert.match(specialHelp.signatures[0].label,/@element/);
  const source='// 🗡\r\nconfig case_sensitive = true\r\n| dataset in (xdr_data, xdr_data)\r\n| alter note = "🗡", payload.branch = lowercase("amber")\r\n| join type = left (dataset xdr_data | fields _time) as child child._time = _time';
  const classified=await vscode.workspace.openTextDocument({language:'cortex-xql',content:source});
  const resolvedText='// 🗡\r\nalter alpha = arraymap(items, to_string("@element")) | fields alpha as beta | filter alpha = beta';
  const resolvedDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:resolvedText});
  const operatorText='filter source_field incidr ("synthetic-range")';
  const operatorDoc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:operatorText});
  await vscode.window.showTextDocument(classified,{preview:false});
  const legend=await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend',classified.uri);
  assert.deepEqual(legend.tokenModifiers,['declaration','defaultLibrary']);
  const fallback=extension.packageJSON.contributes.semanticTokenScopes.find(s=>s.language==='cortex-xql').scopes;
  assert.deepEqual(fallback.xqlDataset,['entity.name.type.xql']);
  assert.deepEqual(fallback.namespace,['entity.name.namespace.xql']);
  assert.deepEqual(fallback.parameter,['variable.parameter.option.xql']);
  assert.deepEqual(fallback['function.defaultLibrary'],['support.function.xql']);
  const themes=[['Default Dark+',vscode.ColorThemeKind.Dark],['Default Light+',vscode.ColorThemeKind.Light],
    ['Default High Contrast',vscode.ColorThemeKind.HighContrast],['Default High Contrast Light',vscode.ColorThemeKind.HighContrastLight]];
  for(const [theme,kind] of themes) {
    // This runner has isolated user/extensions directories, never the user's profile.
    await vscode.workspace.getConfiguration('workbench').update('colorTheme',theme,vscode.ConfigurationTarget.Global);
    for(let attempt=0;attempt<50&&vscode.window.activeColorTheme.kind!==kind;attempt++) await new Promise(r=>setTimeout(r,100));
    assert.equal(vscode.window.activeColorTheme.kind,kind,theme);
    for(const enabled of [true,false]) {
      const editor=vscode.workspace.getConfiguration('editor',classified);
      await editor.update('semanticHighlighting.enabled',enabled,vscode.ConfigurationTarget.Global,true);
      assert.equal(vscode.workspace.getConfiguration('editor',classified).get('semanticHighlighting.enabled'),enabled);
      const semantic=await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',classified.uri);
      const decoded=decode(source,semantic,legend);
      const named=name=>{const pos=classified.positionAt(source.indexOf(name));return decoded.find(t=>t.line===pos.line&&t.character===pos.character);};
      assert.equal(named('case_sensitive').type,'parameter');
      assert.equal(named('xdr_data').type,'xqlDataset');
      assert.deepEqual(named('branch').modifiers,['declaration']);
      assert.deepEqual(named('lowercase').modifiers,['defaultLibrary']);
      assert.equal(named('child').type,'namespace');
      const resolved=decode(resolvedText,await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',resolvedDoc.uri),legend);
      assert.deepEqual(resolved.filter(t=>t.text==='alpha').map(t=>t.type),['variable','variable','property']);
      assert.deepEqual(resolved.filter(t=>t.text==='beta').map(t=>[t.type,t.modifiers]),[['variable',['declaration']],['variable',[]]]);
      assert.deepEqual(resolved.filter(t=>t.text==='@element').map(t=>t.type),['parameter']);
      const operatorTokens=decode(operatorText,await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',operatorDoc.uri),legend);
      assert.equal(operatorTokens.find(t=>t.text==='incidr').type,'operator');
    }
  }
  const operatorHelp=await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider',operatorDoc.uri,operatorDoc.positionAt(operatorText.lastIndexOf(')')),'(');
  assert.ok(!operatorHelp?.signatures?.length);
  console.log('XQLibur token-role checks passed under four built-in theme kinds with semantic on/off; these checks do not measure resolved colors.');
  console.log('XQLibur host checks passed: Restricted Mode, untitled completion, hover, diagnostics, signature help and semantic tokens.');
};

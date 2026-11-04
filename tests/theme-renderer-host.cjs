const vscode=require('vscode');
const fs=require('node:fs');
exports.run=async()=>{
  const roles=process.env.XQL_RENDER_CASE==='roles';
  const source=roles?'config case_sensitive = true\n| dataset = xdr_data\n| join type = left (dataset xdr_data | fields _time) as child child._time = _time\n| alter output = arraymap(items, to_string("@element"))':'dataset = xdr_data | alter result = lowercase("amber") + 3 | filter result = future_call(4) // note';
  const doc=await vscode.workspace.openTextDocument({language:'cortex-xql',content:source});
  await vscode.window.showTextDocument(doc,{preview:false});
  const eclipse=process.env.XQL_RENDER_CASE==='eclipse';
  if(!eclipse) for(const id of ['GitHub.github-vscode-theme','zhuangtongfa.material-theme','dracula-theme.theme-dracula']){
    if(!vscode.extensions.getExtension(id)) throw Error('Missing isolated theme extension '+id);
  }
  for(const theme of eclipse?['Eclipse Dark']:['Default Dark+','Default Light+','Default High Contrast','Default High Contrast Light','GitHub Dark Default','GitHub Light Default','One Dark Pro','Dracula Theme']){
    await vscode.workspace.getConfiguration('workbench').update('colorTheme',theme,vscode.ConfigurationTarget.Global);
    for(const mode of eclipse?['baseline','fallback','override']:['baseline']){
      if(eclipse){
        const snippet=fs.readFileSync(require('node:path').join(__dirname,'../README.md'),'utf8').match(/## Theme fallback[\s\S]*?```jsonc\s*([\s\S]*?)```/);
        const value=mode==='baseline'?undefined:JSON.parse('{'+snippet[1]+'}')['editor.tokenColorCustomizations'];
        if(mode==='override')value['[Eclipse Dark]'].textMateRules.push({scope:'keyword.control.xql',settings:{foreground:'#ABCDEF'}});
        await vscode.workspace.getConfiguration('editor').update('tokenColorCustomizations',value,vscode.ConfigurationTarget.Global);
      }
    for(const enabled of [false,true]){
      await vscode.workspace.getConfiguration('editor',doc).update('semanticHighlighting.enabled',enabled,vscode.ConfigurationTarget.Global,true);
      await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens',doc.uri);
      await new Promise(r=>setTimeout(r,1800));
      console.log('XQLSTYLE READY '+JSON.stringify({theme,enabled,mode}));
      await new Promise(r=>setTimeout(r,3000));
    }
    }
  }
};

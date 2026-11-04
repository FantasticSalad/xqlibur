import * as vscode from 'vscode';
import {LanguageClient, TransportKind} from 'vscode-languageclient/node';
let client:LanguageClient|undefined;
export async function activate(context:vscode.ExtensionContext):Promise<void> {
  // The server is shipped with the extension. Workspace contents cannot select code.
  const module=context.asAbsolutePath('dist/server.cjs');
  const discard:vscode.OutputChannel={name:'XQLibur',append:()=>{},appendLine:()=>{},replace:()=>{},clear:()=>{},show:()=>{},hide:()=>{},dispose:()=>{}};
  client=new LanguageClient('xqlibur','XQLibur',{run:{module,transport:TransportKind.ipc},debug:{module,transport:TransportKind.ipc}},{
    documentSelector:[{language:'cortex-xql'},{language:'yaml'}],
    markdown:{isTrusted:false,supportHtml:false},
    // Protocol traces include source text. Never honor workspace trace settings.
    outputChannel:discard,traceOutputChannel:discard
  });
  context.subscriptions.push({dispose:()=>{void client?.stop();}});
  await client.start();
}
export async function deactivate():Promise<void> {await client?.stop(); client=undefined;}

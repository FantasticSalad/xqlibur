import {TextDocument} from 'vscode-languageserver-textdocument';
import type {Position} from 'vscode-languageserver';

type Line = {text:string; indent:number; sourceLine:number};

export type XqlRegion = {
  document:TextDocument;
  sourceLine:number;
  lines:readonly Line[];
  at(position:Position):number|undefined;
  position(offset:number):Position;
};

// Recognize only plain YAML mapping keys and literal scalars. Other scalar styles
// need separate decoding rules before their contents can safely be analyzed as XQL.
const blockKey=/^( *)(?:- +)?([A-Za-z_][\w-]*):[ \t]*([|>])([+-]?)[ \t]*(?:#.*)?$/;
const indentation=(line:string)=>line.match(/^ */)![0].length;

export function xqlRegions(source:TextDocument):XqlRegion[] {
  const raw=source.getText().split(/\r\n|\n|\r/);
  const regions:XqlRegion[]=[];
  for(let marker=0;marker<raw.length;marker++) {
    const head=raw[marker]!,match=blockKey.exec(head);
    if(!match) continue;
    const keyIndent=match[1]!.length;
    let end=marker+1;
    while(end<raw.length && (!raw[end]!.trim() || indentation(raw[end]!)>keyIndent)) end++;
    if(match[2]==='xql' && match[3]==='|') {
      const body=raw.slice(marker+1,end);
      const nonblank=body.filter(line=>line.trim());
      const indent=Math.min(...nonblank.map(indentation));
      if(nonblank.length && indent>keyIndent && nonblank.every(line=>indentation(line)>=indent)) {
        const firstLine=marker+1;
        const lines:Line[]=body.map((text,index)=>({text:text.trim()?text.slice(indent):'',indent,sourceLine:firstLine+index}));
        const document=TextDocument.create(`${source.uri}#xql-${marker}`,'cortex-xql',source.version,lines.map(line=>line.text).join('\n'));
        regions.push({document,sourceLine:firstLine,lines,
          at(position) {
            const local=position.line-firstLine,line=lines[local];
            if(!line || position.character<indent || position.character>indent+line.text.length) return;
            return document.offsetAt({line:local,character:position.character-indent});
          },
          position(offset) {
            const local=document.positionAt(offset),line=lines[local.line]!;
            return {line:line.sourceLine,character:line.indent+local.character};
          }
        });
      }
    }
    // A block scalar may contain text that resembles another YAML key.
    marker=end-1;
  }
  return regions;
}

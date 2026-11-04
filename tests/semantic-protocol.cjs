const assert=require('node:assert/strict');
exports.decode=(text,semantic,legend)=>{
  assert.equal(semantic.data.length%5,0);
  const lines=text.split(/\r\n|\r|\n/), result=[];
  let line=0,character=0;
  for(let i=0;i<semantic.data.length;i+=5) {
    const [deltaLine,deltaCharacter,length,type,bits]=Array.from(semantic.data.slice(i,i+5));
    line+=deltaLine;character=deltaLine?deltaCharacter:character+deltaCharacter;
    assert.ok(length>0&&line<lines.length&&character+length<=lines[line].length);
    assert.ok(type>=0&&type<legend.tokenTypes.length);
    assert.ok(bits>=0&&bits<(1<<legend.tokenModifiers.length));
    const previous=result.at(-1);
    assert.ok(!previous||line>previous.line||character>=previous.character+previous.length);
    result.push({line,character,length,type:legend.tokenTypes[type],
      modifiers:legend.tokenModifiers.filter((_,index)=>bits&(1<<index)),text:lines[line].slice(character,character+length)});
  }
  return result;
};

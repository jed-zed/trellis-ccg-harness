import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../scripts/chatgpt-pro-agent-browser-v2.js',import.meta.url),'utf8');
const start=source.indexOf('  const exactComposerSelector =');
const end=source.indexOf('  const composers =',start);
const factory=new Function('document','visible',source.slice(start,end)+'return {exactComposerSelector,eligibleComposer};');
function fixture({visibleCopies=1,hiddenCopies=1,editable=true}={}) {
  const root={children:[]};const body={children:[],parentElement:root};root.children.push(body);
  const nodes=[];
  for(let i=0;i<visibleCopies+hiddenCopies;i++) {
    const parent={children:[],parentElement:body};body.children.push(parent);
    const node={children:[],parentElement:parent,isContentEditable:editable,tagName:'DIV',readOnly:false,hidden:i>=visibleCopies,getAttribute:()=>null,hasAttribute:()=>false,closest:()=>null};
    parent.children.push(node);nodes.push(node);
  }
  const document={documentElement:root,querySelectorAll(selector){
    if(selector==='#prompt-textarea')return nodes;
    assert.match(selector,/^#prompt-textarea:is\(:root(?: > :nth-child\([1-9][0-9]*\))+\)$/);
    let node=root;
    for(const [,index]of selector.matchAll(/:nth-child\(([0-9]+)\)/g))node=node.children[Number(index)-1];
    return nodes.includes(node)?[node]:[];
  }};
  return {...factory(document,node=>!node.hidden),nodes};
}
test('hidden layout copy yields the sole visible editable node and a unique numeric binding',()=>{
  const f=fixture();const selected=f.nodes.filter(f.eligibleComposer);
  assert.equal(selected.length,1);assert.match(f.exactComposerSelector(selected[0],'#prompt-textarea'),/:is\(:root/);
});
test('two visible editable nodes remain ambiguous; selection never takes the first',()=>{
  const f=fixture({visibleCopies:2});assert.equal(f.nodes.filter(f.eligibleComposer).length,2);
  assert.match(source,/const composerSelector = composers.length === 1/);
});
test('noneditable nodes are not send targets',()=>{
  const f=fixture({editable:false});assert.equal(f.nodes.filter(f.eligibleComposer).length,0);
});
test('an already unique selector retains the existing selector contract',()=>{
  const f=fixture({hiddenCopies:0});assert.equal(f.exactComposerSelector(f.nodes[0],'#prompt-textarea'),'#prompt-textarea');
});


// Complete assistant code extraction must survive CodeMirror virtualization.
const boundedStart=source.indexOf('  const boundedText =');
const boundedEnd=source.indexOf('  const composerPlainText =',boundedStart);
const boundedFactory=new Function('document','normalize','MAX_TEXT',source.slice(boundedStart,boundedEnd)+'return boundedText;');
function codeFixture({code='def example():\n    return 1\n',legacy=false,missing=false,wrongOwner=false,lengthDelta=0,maximum=200000}={}) {
  const original={};
  if(!missing) {
    const view={contentDOM:wrongOwner?{}:original,state:{doc:{length:code.length+lengthDelta,toString:()=>code}}};
    original[legacy?'cmView':'cmTile']={view};
  }
  let replacement=null;
  const copy={replaceWith:node=>{replacement=node.nodeValue;clone.childNodes=[node];}};
  const clone={nodeType:1,tagName:'DIV',childNodes:[{nodeType:3,nodeValue:'Python'}],querySelectorAll(selector){
    if(selector==='[data-code-block="true"] .cm-content')return [copy];
    if(selector==='code.user-message-inline-code')return [];
    return [];
  }};
  const element={cloneNode:()=>clone,querySelectorAll:()=>[original]};
  const document={createTextNode:text=>({nodeType:3,nodeValue:text})};
  const read=boundedFactory(document,value=>String(value??'').replace(/\r\n?/g,'\n').trimEnd(),maximum);
  return {read,preserve:()=>read(element,true),result:()=>read(element),replacement:()=>replacement};
}
test('complete code document replaces virtualized visible rows and preserves indentation',()=>{
  const code='def example():\n    return 1\n';const f=codeFixture({code});
  assert.equal(f.result().text,'\n\n```\n'+code+'\n```');assert.equal(f.result().truncated,false);
});
test('legacy cmView complete documents remain readable',()=>assert.match(codeFixture({legacy:true}).result().text,/return 1/));
test('an unavailable complete editor document fails closed',()=>assert.equal(codeFixture({missing:true}).result().issue,'AssistantCodeDocumentUnavailable'));
test('editor ownership mismatch fails closed',()=>assert.equal(codeFixture({wrongOwner:true}).result().issue,'AssistantCodeDocumentUnavailable'));
test('document length mismatch fails closed rather than accepting partial text',()=>assert.equal(codeFixture({lengthDelta:1}).result().issue,'AssistantCodeDocumentUnavailable'));
test('oversized code documents retain bounded failure evidence',()=>{
  const result=codeFixture({maximum:4}).result();assert.equal(result.issue,'AssistantCodeDocumentTooLarge');assert.equal(result.truncated,true);
});
test('literal fence text in generated code cannot terminate the wrapper fence',()=>{
  const f=codeFixture({code:'x = "```"'});assert.equal(f.result().text,'\n\n````\nx = "```"\n````');
});
test('user source extraction never reads or substitutes an assistant editor document',()=>{
  const f=codeFixture({missing:true});assert.equal(f.preserve().text,'Python');assert.equal(f.replacement(),null);
});
test('complete code errors are propagated to transcript ownership validation',()=>{
  assert.match(source,/if \(content\.issue\) \{ failTurn\(content\.issue\); continue; \}/);
});

import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../scripts/chatgpt-pro-thinking-mode.js',import.meta.url),'utf8');
function fixture({index=5,open=true,controls=1,sliders=1,statuses=1,models=['GPT-6'],otherForm=false,shortcut=true}={}){
 const counts={events:0,forbidden:0}; const form={}; const labels=['Instant','Medium','High','Extra High','Pro'];
 const rect={left:0,right:200,top:100,bottom:140,width:200,height:40};
 function node(kind,attrs={},label=''){
  return {id:kind==='control'?'control':kind==='menu'?'menu':'',form:otherForm&&kind==='control'?{}:form,hidden:false,
   getAttribute:n=>attrs[n]??null,hasAttribute:n=>n in attrs,setAttribute:(n,v)=>{attrs[n]=v;},removeAttribute:n=>{delete attrs[n];},getBoundingClientRect:()=>rect,
   closest(sel){if(sel==='form')return form;if(sel==='[role="menu"]')return ['slider','status','model'].includes(kind)?menu:null;return null;},focus(){},
   dispatchEvent(e){counts.events++;if(kind==='menu'&&e.key==='Escape'){control.setAttribute('aria-expanded','false');return;}if(e.type==='keydown') index+=e.key==='ArrowLeft'?-1:1;},
   get innerText(){return kind==='status'?labels[index-1]+', item '+index+' of 5':label;},get textContent(){return this.innerText;},
   querySelectorAll(sel){
    if(kind==='menu'){
     if(sel==='[data-reasoning-slider]')return Array(sliders).fill(slider);
     if(sel==='[data-model-selected][aria-checked="true"]')return models.map(x=>node('model',{},x));
     if(sel==='[role="status"][aria-live]')return Array(statuses).fill(status);
    }
    if(kind==='form'&&sel==='button[aria-haspopup="menu"]')return Array(controls).fill(control);
    throw Error('Unexpected bounded query '+kind+': '+sel);
   }};
 }
 const menu=node('menu');const control=node('control',{'aria-label':'Choose ChatGPT model','aria-expanded':open?'true':'false','aria-controls':'menu'},labels[index-1]);
 const slider=node('slider',{'aria-keyshortcuts':shortcut?'ArrowLeft ArrowRight':''});const status=node('status');const composer=node('composer');
 form.querySelectorAll=node('form').querySelectorAll;
 const document={querySelectorAll(sel){if(sel.startsWith('#prompt-textarea')){assert.match(sel,/:not\(\[data-message-author-role\]/);return [composer];}if(sel==='[role="menu"]')return [menu];if(sel.startsWith('[data-codex-thinking-control]'))return [];throw Error('Unbounded query '+sel);}};
 const context={document,getComputedStyle:()=>({display:'block',visibility:'visible'}),KeyboardEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}}};
 for(const key of ['cookie','localStorage','sessionStorage']) Object.defineProperty(key==='cookie'?document:context,key,{get(){counts.forbidden++;throw Error('Forbidden credential access');}});
 for(const key of ['fetch','XMLHttpRequest']) context[key]=()=>{counts.forbidden++;throw Error('Forbidden network');};
 return {context,counts,index:()=>index};
}
function run(f,step=0){return new vm.Script('(function(){'+source.replace('const step = 0; // CCG_MODE_STEP',`const step = ${step}; // CCG_MODE_STEP`)+'})()').runInNewContext(f.context,{timeout:1000});}
for(let index=1;index<=5;index++)test('proves real strength '+index+' separately from the model',()=>{const f=fixture({index});const r=run(f);assert.equal(r.ok,true);assert.equal(r.index,index);assert.equal(r.selectedModelLabels[0],'GPT-6');assert.equal(f.counts.events,0);assert.equal(f.counts.forbidden,0);});
test('closed control is only tagged for a bound click',()=>{const f=fixture({open:false});assert.equal(run(f).phase,'open-menu');assert.equal(f.counts.events,0);});
test('one advertised slider step changes strength without model radio clicks',()=>{const f=fixture();assert.equal(run(f,-1).phase,'slider-step');assert.equal(f.index(),4);assert.equal(run(f).currentLabel,'Extra High');assert.equal(f.counts.events,2);});
for(const options of [{controls:0},{controls:2},{otherForm:true},{sliders:2},{statuses:2},{models:[]},{models:['a','b']},{shortcut:false}])test('ambiguous or unsupported controls never dispatch keys '+JSON.stringify(options),()=>{const f=fixture(options);assert.equal(run(f,-1).ok,false);assert.equal(f.counts.events,0);assert.equal(f.counts.forbidden,0);});
test('a model-only menu never becomes a strength fallback',()=>{const f=fixture({sliders:0});assert.equal(run(f).reason,'thinking-slider-unavailable');assert.equal(f.counts.events,0);});

test('Escape closes only the bound popup and does not change its model or strength',()=>{const f=fixture();assert.equal(run(f,2).phase,'close-menu');assert.equal(run(f).phase,'open-menu');assert.equal(f.index(),5);assert.equal(f.counts.events,1);});

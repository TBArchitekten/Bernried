const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const M = require('../minds/core.js');

// Exercise data-loss regressions in the real event handlers without a browser dependency.
function harness() {
  const controls = new Map(), listeners = new Map();
  class Element {
    constructor() { this.value='';this.textContent='';this.checked=false;this.open=false;this.children=[];this.events={};this.dataset={}; }
    addEventListener(name, fn) { this.events[name]=fn; }
    setAttribute() {}
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children=[...nodes]; }
    add(option) { this.children.push(option); }
    reset() {}
    focus() {}
    showModal() { this.open=true; }
    close() { this.open=false; }
  }
  const get = id => {if(!controls.has(id)) controls.set(id,new Element()); return controls.get(id);};
  let stored=null;
  const storage={getItem:()=>stored,setItem:(_key,value)=>{stored=value;}};
  const parent={postMessage(){}};
  const window={MindsCore:M,localStorage:storage,parent,addEventListener:(name,fn)=>listeners.set(name,fn)};
  const context={window,document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[]},
    location:{origin:'https://test.invalid'},fetch:()=>new Promise(()=>{}),console,URL,
    crypto:require('node:crypto').webcrypto,Option:function(text,value){this.text=text;this.value=value;},setTimeout};
  vm.runInNewContext(fs.readFileSync(require.resolve('../minds/app.js'),'utf8'),context);
  const sendSources = sources => listeners.get('message')({origin:context.location.origin,source:parent,
    data:{type:'minds:context',project:'bernried',projectName:'Test',note:'Test sources',sources}});
  const open = title => {
    get('new-entry').events.click();
    get('entry-title').value=title;
  };
  const save = () => get('entry-form').events.submit({preventDefault(){}});
  return {get,sendSources,open,save,entries:()=>M.parse(stored),stored:()=>stored};
}
const source = (id,title) => ({id,title,url:`https://test.invalid/${id}.pdf`,kind:'document',meta:'',
  version:'original',capturedAt:'2026-09-24T10:00:00.000Z',mode:'hub-display'});
const incoming = {id:'imported',kind:'note',state:'open',title:'Imported',body:'',alternatives:'',outcome:'',
  owner:'',due:'',reference:'',source:null,createdAt:'2026-09-24T10:00:00.000Z',
  updatedAt:'2026-09-24T10:00:00.000Z',archived:false};

test('a catalogue refresh cannot change the source chosen in an open draft', () => {
  const h=harness();
  h.sendSources([source('eg','Erdgeschoss'),source('og','Obergeschoss')]);
  h.open('Source snapshot test');
  h.get('entry-source').value='0';
  h.sendSources([source('og','Obergeschoss'),source('eg','Erdgeschoss')]);
  h.save();
  assert.equal(h.entries()[0].source.id,'eg');
  assert.equal(h.entries()[0].source.title,'Erdgeschoss');
});

test('an import preserves notes saved while its file is still being read', async () => {
  const h=harness();
  let finishRead;
  const input={files:[{size:100,text:()=>new Promise(resolve=>{finishRead=resolve;})}],value:'file.json'};
  const pending=h.get('import').events.change({target:input});
  h.open('Saved during import');
  h.save();
  finishRead(JSON.stringify(M.envelope([incoming])));
  await pending;
  assert.deepEqual(h.entries().map(x=>x.title),['Saved during import','Imported']);
});

test('invalid import leaves previously saved memory unchanged', async () => {
  const h=harness(); h.open('Keep this'); h.save();
  const before=h.stored();
  await h.get('import').events.change({target:{files:[{size:12,text:async()=>'{bad json'}],value:''}});
  assert.equal(h.stored(),before);
  assert.match(h.get('feedback').textContent,/Import abgebrochen/);
});

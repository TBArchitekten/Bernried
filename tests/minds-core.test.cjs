const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../minds/core.js');
const make = (patch = {}) => ({id:'one',kind:'task',state:'open',title:'Prüfung der Höhen',body:'Achse B',
  alternatives:'',outcome:'',owner:'Projektleitung',due:'',reference:'Seite 2',source:null,
  createdAt:'2026-09-24T10:00:00.000Z',updatedAt:'2026-09-24T10:00:00.000Z',archived:false,...patch});
const serialize = entries => JSON.stringify(M.envelope(entries));

test('export/import retains provenance, decision reasoning and inert HTML text', () => {
  const value = make({kind:'decision',title:'<img src=x onerror=alert(1)>',alternatives:'A oder B',outcome:'Rückfrage',
    source:{id:'EG',title:'EG',url:'https://example.com/EG.pdf',kind:'document',meta:'Stand 05.08',
      version:'revision-1',capturedAt:'2026-09-24T10:00:00.000Z',mode:'hub-display'}});
  assert.deepEqual(M.parse(serialize([value])),[value]);
});
test('invalid backup never becomes project memory', () => {
  for(const raw of ['bad json', '{}', JSON.stringify({schemaVersion:2,project:'bernried',entries:[]}),
    JSON.stringify({schemaVersion:1,project:'other',entries:[]}),serialize([make(),make()]),
    serialize([make({due:'2026-02-30'})]),serialize([make({title:' '})]),serialize([make({state:'invented'})])]) {
    assert.throws(()=>M.parse(raw));
  }
});
test('source URLs reject script, data and credentials', () => {
  const base={id:'x',title:'x',kind:'document',meta:'',version:'',mode:'manual',capturedAt:'2026-09-24T10:00:00Z'};
  for(const url of ['javascript:alert(1)','data:text/html,hello','https://user:pass@example.com/a','file:///etc/passwd']) {
    assert.throws(()=>M.source({...base,url}));
  }
});
test('Today includes overdue and upcoming, excludes done, archive and future', () => {
  const list=[make({id:'overdue',due:'2026-09-23'}),make({id:'week',due:'2026-10-01'}),
    make({id:'later',due:'2026-10-02'}),make({id:'done',state:'done'}),make({id:'archive',archived:true}),
    make({id:'question',kind:'question'}),make({id:'note',kind:'note'})];
  assert.deepEqual(M.select(list,{screen:'today',today:'2026-09-24'}).map(x=>x.id),['overdue','week','question']);
});
test('text search includes owners, context and accents', () => {
  assert.equal(M.matches(make(),'hohen projektleitung'),true);
  assert.equal(M.matches(make(),'missing'),false);
});
test('merge is idempotent and never overwrites existing IDs', () => {
  const original=make(), incoming=[make({body:'changed elsewhere'}),make({id:'two'})];
  const result=M.merge([original],incoming);
  assert.equal(result.added,1); assert.equal(result.skipped,1); assert.deepEqual(result.entries[0],original);
  assert.equal(M.merge(result.entries,incoming).added,0);
});
test('blocked storage, quota errors and stale-tab writes preserve stored data', () => {
  let stored=serialize([make()]);
  const storage={getItem:key=>{assert.equal(key,M.KEY);return stored},setItem:()=>{throw new Error('Quota exceeded')}};
  assert.throws(()=>M.save(storage,stored,[make({body:'new'})]),/Quota/);
  assert.equal(M.parse(stored)[0].body,'Achse B');
  assert.throws(()=>M.save(storage,null,[]),/anderen Fenster/);
});
test('archive and restore preserve entry and source, date uses local day', () => {
  const original=make();
  assert.equal(M.select([{...original,archived:true}],{archived:true}).length,1);
  assert.equal(M.select([{...original,archived:false}]).length,1);
  assert.equal(M.todayLocal(new Date(2026,8,24,0,10)),'2026-09-24');
});
test('oversized records or files cannot silently exceed the import limit', () => {
  assert.throws(()=>M.parse(serialize([make({body:'x'.repeat(12001)})])));
  const many=Array.from({length:180},(_,n)=>make({id:String(n),body:'x'.repeat(12000)}));
  const store={getItem:()=>null,setItem:()=>assert.fail('Must not write oversized data')};
  assert.throws(()=>M.save(store,null,many),/voll/);
});

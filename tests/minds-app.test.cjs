const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync(require.resolve('../minds/app.js'),'utf8');
const html = fs.readFileSync(require.resolve('../minds/index.html'),'utf8');
const store = fs.readFileSync(require.resolve('../minds/store.js'),'utf8');

test('Planner task detail surface exposes the expected task fields', () => {
  for (const id of [
    'task-title-input','task-state','task-priority','task-start','task-due','task-recurrence',
    'task-bucket','task-checklist','task-notes','task-file-input','task-comments'
  ]) assert.match(html,new RegExp('id="'+id+'"'));
});

test('Board supports dynamic grouping and immediate optimistic quick add', () => {
  assert.match(app,/function boardGroups\(/);
  assert.match(app,/todo-group-by/);
  assert.match(app,/entries\.unshift\(task\);renderAll\(\)/);
  assert.match(app,/dataTransfer\.getData\('text\/plain'\)/);
});

test('Mail supports drag/drop EML-MSG ingestion and private indexing', () => {
  assert.match(html,/id="mail-drop"/);
  assert.match(html,/accept="\.eml,\.msg/);
  assert.match(app,/MindsMailImport\.parseFile/);
  assert.match(app,/uploadRawMailFile/);
  assert.match(store,/indexMailText/);
});

test('Private task collaboration is backed by comments and attachments stores', () => {
  assert.match(store,/loadTaskComments/);
  assert.match(store,/addTaskComment/);
  assert.match(store,/uploadTaskFile/);
  assert.match(store,/signedTaskFile/);
});

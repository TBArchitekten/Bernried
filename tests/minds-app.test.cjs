const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync(require.resolve('../minds/app.js'),'utf8');
const html = fs.readFileSync(require.resolve('../minds/index.html'),'utf8');
const store = fs.readFileSync(require.resolve('../minds/store.js'),'utf8');
const css = fs.readFileSync(require.resolve('../minds/style.css'),'utf8');

test('Planner views and grouping controls are wired', () => {
  for (const id of ['todo-view-grid','todo-view-board','todo-view-calendar','todo-view-charts','todo-group-by','todo-status-filter','todo-priority-filter','todo-bucket-filter','todo-owner-filter','todo-label-filter','todo-due-filter']) {
    assert.ok(html.includes('id="'+id+'"'), id+' missing from html');
    assert.ok(app.includes(id), id+' missing from app');
  }
});

test('task details expose Planner-like fields and persistence hooks', () => {
  for (const id of ['task-state','task-priority','task-start','task-due','task-recurrence','task-bucket','task-checklist','task-notes','task-show-card','task-file-input','task-comments','task-owner','task-labels']) {
    assert.ok(html.includes('id="'+id+'"'), id+' missing');
  }
  assert.ok(store.includes('loadTaskComments'));
  assert.ok(store.includes('uploadTaskFile'));
  assert.ok(app.includes('spawnNextOccurrence'));
});

test('mail ingestion is drag-drop and server-side', () => {
  assert.ok(html.includes('id="mail-drop"'));
  assert.ok(html.includes('.eml oder Outlook .msg'));
  assert.ok(app.includes('S.ingestMailFile(file)'));
  assert.ok(store.includes("client.functions.invoke('minds-ingest-mail'"));
  assert.ok(!html.includes('mail-import.js'));
});

test('quick task creation is optimistic and event logging is non-blocking', () => {
  assert.ok(app.includes('entries.unshift(task);renderAll()'));
  assert.ok(store.includes("event('entry', saved.id, existed ? 'updated' : 'created'"));
  assert.ok(!store.includes("await event('entry', saved.id, existed ? 'updated' : 'created'"));
});

test('workspace is no longer constrained to the former 1560px canvas', () => {
  assert.ok(css.includes('.workspace{max-width:none;width:100%'));
});

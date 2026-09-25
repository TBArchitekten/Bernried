(() => {
  'use strict';
  const M = window.MindsCore;
  const $ = id => document.getElementById(id);
  const labels = {task:'Offener Punkt', decision:'Entscheidung', lesson:'Erfahrung / Fehler',
    procedure:'Vorgehensweise', question:'Frage an KI', note:'Notiz'};
  const states = {open:'Offen', waiting:'Wartet auf Rückmeldung', done:'Abgeschlossen'};
  const screens = {
    today:['Was braucht deine Aufmerksamkeit?', 'Offene Punkte und Wiedervorlagen bis in sieben Tagen.'],
    memory:['Das Gedächtnis deines Projekts', 'Entscheidungen, Erfahrungen und Zusammenhänge wiederfinden.'],
    decision:['Warum haben wir das so entschieden?', 'Begründungen, Alternativen und Auswirkungen festhalten.'],
    question:['Welche Fragen beschäftigen dich?', 'Manuell erfasste Fragen. Antworten werden nicht automatisch zu Projektwissen.'],
    sources:['Worauf stützt sich dein Wissen?', 'Verweise auf bestehende Dokumente. Keine automatische Auswertung der Inhalte.']
  };
  let entries = [], sources = [], draftSources = [], screen = 'today', editing = null, originalSource = null;
  let raw = null, storage, readOnly = false, hubContext = false;
  function feedback(text) { $('feedback').textContent = text; }
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function action(text, fn) {
    const node = el('button', text);
    node.type = 'button';
    node.addEventListener('click', fn);
    node.disabled = readOnly;
    return node;
  }
  function dateLabel(value) {
    return value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('de-DE') : '';
  }
  function link(source) {
    const a = el('a', source.title + ' ↗');
    a.href = M.source(source).url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function commit(next) {
    if (readOnly) { feedback('Speichern ist gesperrt. Vorhandene Daten zuerst exportieren.'); return false; }
    try {
      raw = M.save(storage, raw, next);
      entries = next;
      render();
      return true;
    } catch (error) {
      feedback('Nicht gespeichert: ' + error.message + ' Der bisherige Stand bleibt erhalten.');
      return false;
    }
  }
  try {
    storage = window.localStorage;
    raw = storage.getItem(M.KEY);
    if (raw !== null) entries = M.parse(raw);
  } catch (error) {
    readOnly = true;
    feedback('Lokale Daten nicht lesbar. Änderungen sind gesperrt; Export sichert den gespeicherten Rohstand. ' + error.message);
  }

  function renderCard(item) {
    const card = el('article', undefined, 'entry');
    const head = el('div', undefined, 'entry-head');
    head.append(el('span', labels[item.kind], 'tag'), el('span', states[item.state], 'state'));
    if (item.archived) head.append(el('span', 'Archiviert'));
    card.append(head, el('h3', item.title));
    if (item.body) card.append(el('p', item.body));
    if (item.alternatives) card.append(el('p', 'Alternativen: ' + item.alternatives));
    if (item.outcome) card.append(el('p', 'Auswirkungen: ' + item.outcome));
    if (item.owner) card.append(el('p', 'Verantwortlich / beteiligt: ' + item.owner, 'meta'));
    if (item.due) card.append(el('p', 'Wiedervorlage / Termin: ' + dateLabel(item.due),
      'meta' + (item.due < M.todayLocal() && item.state !== 'done' && !item.archived ? ' overdue' : '')));
    if (item.source) {
      const p = el('p', 'Quelle: ', 'meta');
      p.append(link(item.source));
      card.append(p, el('p', 'Quellenverweis erfasst: ' + dateLabel(item.source.capturedAt) +
        (item.source.meta ? ' · ' + item.source.meta : ''), 'meta'));
    } else card.append(el('p', 'Eigene Notiz · ohne Dokumentbeleg', 'meta'));
    if (item.reference) card.append(el('p', 'Fundstelle: ' + item.reference, 'meta'));
    card.append(el('p', 'Erfasst ' + dateLabel(item.createdAt) + ' · Bearbeitet ' + dateLabel(item.updatedAt), 'meta'));
    if (item.kind === 'question') {
      const count = entries.filter(other => !other.archived && other.kind === 'question' &&
        M.normalize(other.title) === M.normalize(item.title)).length;
      if (count > 1) card.append(el('p', `Diese Frage wurde ${count}× erfasst (gleicher Titel).`, 'meta'));
    }
    const actions = el('div', undefined, 'entry-actions');
    actions.append(action('Bearbeiten', () => edit(item)));
    if (!item.archived) actions.append(action(item.state === 'done' ? 'Wieder öffnen' : 'Abschließen', () => {
      update(item.id, {state:item.state === 'done' ? 'open' : 'done'});
    }));
    actions.append(action(item.archived ? 'Wiederherstellen' : 'Archivieren', () => {
      update(item.id, {archived:!item.archived});
    }));
    card.append(actions);
    return card;
  }
  function update(id, changes) {
    if (commit(entries.map(item => item.id === id ? {...item, ...changes, updatedAt:new Date().toISOString()} : item))) {
      feedback('Eintrag lokal aktualisiert.');
    }
  }
  function render() {
    const isSources = screen === 'sources';
    $('screen-title').textContent = screens[screen][0];
    $('screen-description').textContent = screens[screen][1];
    document.querySelectorAll('[data-screen]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.screen === screen));
    });
    $('open-count').textContent = entries.filter(item => M.attention(item, M.todayLocal())).length;
    $('archive-label').hidden = isSources || screen === 'today';
    $('entries').hidden = isSources;
    $('source-panel').hidden = !isSources;
    $('search').disabled = isSources;
    $('new-entry').disabled = readOnly;
    $('import').disabled = readOnly;
    if (isSources) { $('result-summary').textContent = sources.length + ' Quellenverweise'; return; }
    const shown = M.select(entries, {screen, query:$('search').value,
      archived:screen !== 'today' && $('show-archived').checked});
    $('result-summary').textContent = shown.length + (shown.length === 1 ? ' Eintrag' : ' Einträge');
    $('entries').replaceChildren();
    if (shown.length) shown.forEach(item => $('entries').append(renderCard(item)));
    else {
      const empty = el('div', undefined, 'empty');
      empty.append(el('h3', entries.length ? 'Hier ist gerade nichts offen.' : 'Das Projekt erinnert sich ab hier.'),
        el('p', entries.length ? 'Andere Bereiche, Filter oder Suchbegriffe zeigen weitere Einträge.' :
          'Halte eine Entscheidung, eine offene Frage oder eine Erfahrung fest. Verknüpfe sie mit der passenden Quelle.'),
        action('Ersten oder weiteren Eintrag erfassen', () => edit()));
      $('entries').append(empty);
    }
  }
  function fillSourceOptions(selected = originalSource) {
    draftSources = sources.map(source => ({...source}));
    const select = $('entry-source');
    select.replaceChildren(new Option('Eigene Notiz · ohne Dokumentbeleg', ''));
    // An existing snapshot is kept even if the current hub document has changed.
    if (selected) select.add(new Option(selected.title + ' · gespeicherter Verweis', '__snapshot'));
    draftSources.forEach((source, index) => select.add(new Option(source.title, String(index))));
    select.value = selected ? '__snapshot' : '';
  }
  function edit(item = null) {
    editing = item;
    originalSource = item?.source || null;
    $('entry-form').reset();
    $('editor-title').textContent = item ? 'Erinnerung bearbeiten' : 'Erinnerung erfassen';
    $('entry-kind').value = item?.kind || (['decision', 'question'].includes(screen) ? screen : 'task');
    $('entry-state').value = item?.state || 'open';
    for (const field of ['title','body','alternatives','outcome','owner','due','reference']) $('entry-' + field).value = item?.[field] || '';
    fillSourceOptions();
    $('decision-fields').hidden = $('entry-kind').value !== 'decision';
    $('form-error').textContent = '';
    $('editor').showModal();
    $('entry-title').focus();
  }
  $('entry-kind').addEventListener('change', () => { $('decision-fields').hidden = $('entry-kind').value !== 'decision'; });
  $('new-entry').addEventListener('click', () => edit());
  for (const id of ['close-editor', 'cancel-editor']) $(id).addEventListener('click', () => $('editor').close());
  $('entry-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const now = new Date().toISOString(), selected = $('entry-source').value;
      const draft = {id:editing?.id || crypto.randomUUID(), createdAt:editing?.createdAt || now,
        updatedAt:now, kind:$('entry-kind').value, state:$('entry-state').value,
        archived:editing?.archived || false,
        source:selected === '__snapshot' ? originalSource : selected === '' ? null : draftSources[Number(selected)]};
      for (const field of ['title','body','alternatives','outcome','owner','due','reference']) draft[field] = $('entry-' + field).value.trim();
      const value = M.entry(draft);
      if (commit(editing ? entries.map(item => item.id === editing.id ? value : item) : [...entries, value])) {
        $('editor').close();
        feedback('Erinnerung lokal gespeichert.');
      } else $('form-error').textContent = $('feedback').textContent;
    } catch (error) { $('form-error').textContent = error.message; }
  });
  document.querySelectorAll('[data-screen]').forEach(button => button.addEventListener('click', () => {
    screen = button.dataset.screen;
    render();
  }));
  $('search').addEventListener('input', render);
  $('show-archived').addEventListener('change', render);

  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export').addEventListener('click', () => {
    if (readOnly && raw === null) { feedback('Kein lesbarer gespeicherter Rohstand verfügbar.'); return; }
    download(readOnly ? raw : JSON.stringify({...M.envelope(entries), exportedAt:new Date().toISOString()}),
      `minds-bernried-${M.todayLocal()}${readOnly ? '-recovery' : ''}.json`);
  });
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0];
    try {
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) throw new Error('Maximale Dateigröße: 2 MB.');
      const incoming = M.parse(await file.text());
      // Read current state after the asynchronous file read, so edits made meanwhile survive.
      const result = M.merge(entries, incoming);
      if (commit(result.entries)) feedback(`${result.added} Einträge importiert; ${result.skipped} vorhandene IDs übersprungen.`);
    } catch (error) { feedback('Import abgebrochen: ' + error.message + ' Vorhandene Daten bleiben erhalten.'); }
    finally { event.target.value = ''; }
  });

  function acceptContext(context) {
    if (context.project !== 'bernried' || !Array.isArray(context.sources) || context.sources.length > 500) return;
    try {
      const checked = context.sources.map(M.source);
      sources = checked;
      $('project-name').textContent = String(context.projectName || 'Bernried').slice(0, 200);
      $('source-note').textContent = String(context.note || '').slice(0, 1000);
      $('sources').replaceChildren();
      sources.forEach(source => {
        const card = el('article', undefined, 'source'), title = el('h3');
        title.append(link(source));
        card.append(title, el('p', source.meta || 'Quellenverweis ohne Inhaltsprüfung'),
          el('p', 'Erfasst: ' + dateLabel(source.capturedAt) + (source.version ? ' · Referenz: ' + source.version : '')));
        $('sources').append(card);
      });
      // Do not change options while the user is editing a draft.
      if (!$('editor').open) fillSourceOptions();
      render();
    } catch (error) { feedback('Quellen konnten nicht übernommen werden: ' + error.message); }
  }
  function requestContext() {
    if (window.parent !== window) window.parent.postMessage({type:'minds:request-context'}, location.origin);
    else feedback('Eigenständige Ansicht: Quellen zeigen den dokumentierten Repository-Stand.');
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'minds:context') return;
    hubContext = true;
    acceptContext(event.data);
  });
  $('refresh-sources').addEventListener('click', requestContext);
  fetch('sources.json').then(response => {
    if (!response.ok) throw new Error('Quellenkatalog nicht erreichbar.');
    return response.json();
  }).then(context => { if (!hubContext) acceptContext(context); }).catch(() => {
    if (!hubContext) $('source-note').textContent = 'Quellenkatalog nicht verfügbar. Eigene Notizen können weiterhin erfasst werden.';
  });
  requestContext();
  render();
})();

/* Shared, dependency-free model. No DOM, network or hub writes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MindsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'minds_work_bernried_v1';
  const MAIL_KEY = 'minds_work_bernried_mail_v1';
  const KINDS = ['task', 'decision', 'lesson', 'procedure', 'question', 'note'];
  const STATES = ['open', 'waiting', 'done'];
  const MAX_ENTRIES = 1000;
  const MAX_MAILS = 500;
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_MAIL_BYTES = 4 * 1024 * 1024;

  function string(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
      throw new Error('Ungültiges oder zu langes Textfeld.');
    }
    return value;
  }
  function stamp(value) {
    string(value, 40, true);
    if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) {
      throw new Error('Ungültiger Zeitstempel.');
    }
    return value;
  }
  function date(value) {
    if (value === '') return value;
    string(value, 10, true);
    if (!/^\d{4}-\d\d-\d\d$/.test(value) || value < '2000-01-01' || value > '2100-12-31' ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error('Ungültiges Datum.');
    }
    return value;
  }
  function source(value) {
    if (!value || typeof value !== 'object') throw new Error('Ungültige Quelle.');
    const url = new URL(string(value.url, 2048, true));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('Quellen müssen HTTP- oder HTTPS-Links ohne Zugangsdaten verwenden.');
    }
    return {
      id:string(value.id, 300, true), title:string(value.title, 300, true), url:url.href,
      kind:string(value.kind, 40, true), meta:string(value.meta || '', 1000),
      version:string(value.version || '', 160), capturedAt:stamp(value.capturedAt),
      mode:string(value.mode, 40, true)
    };
  }
  function entry(value) {
    if (!value || typeof value !== 'object' || !KINDS.includes(value.kind) ||
        !STATES.includes(value.state) || typeof value.archived !== 'boolean') {
      throw new Error('Ungültiger Eintrag.');
    }
    return {
      id:string(value.id, 100, true), kind:value.kind, state:value.state,
      title:string(value.title, 180, true), body:string(value.body, 12000),
      alternatives:string(value.alternatives || '', 4000), outcome:string(value.outcome || '', 4000),
      owner:string(value.owner, 160), due:date(value.due), reference:string(value.reference, 500),
      source:value.source === null ? null : source(value.source),
      createdAt:stamp(value.createdAt), updatedAt:stamp(value.updatedAt), archived:value.archived
    };
  }
  function mail(value) {
    if (!value || typeof value !== 'object') throw new Error('Ungültige E-Mail.');
    return {
      id:string(value.id, 100, true),
      sender:string(value.sender || '', 240),
      recipients:string(value.recipients || '', 1000),
      subject:string(value.subject, 300, true),
      body:string(value.body || '', 100000),
      date:date(value.date || ''),
      messageId:string(value.messageId || '', 1000),
      threadKey:string(value.threadKey || '', 1000),
      createdAt:stamp(value.createdAt),
      updatedAt:stamp(value.updatedAt),
      archived:Boolean(value.archived)
    };
  }
  function envelope(entries) { return {schemaVersion:1, project:'bernried', entries}; }
  function mailEnvelope(mails) { return {schemaVersion:1, project:'bernried', mails}; }

  function parse(raw) {
    if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('Maximale Dateigröße: 2 MB.');
    const data = JSON.parse(raw);
    if (!data || data.schemaVersion !== 1 || data.project !== 'bernried' ||
        !Array.isArray(data.entries) || data.entries.length > MAX_ENTRIES) {
      throw new Error('Keine gültige MINDS//WORK-Datei für Bernried (Version 1, maximal 1000 Einträge).');
    }
    const entries = data.entries.map(entry);
    if (new Set(entries.map(item => item.id)).size !== entries.length) throw new Error('Doppelte Eintrags-IDs in der Datei.');
    return entries;
  }
  function parseMails(raw) {
    if (new TextEncoder().encode(raw).length > MAX_MAIL_BYTES) throw new Error('Maximale Mail-Dateigröße: 4 MB.');
    const data = JSON.parse(raw);
    if (!data || data.schemaVersion !== 1 || data.project !== 'bernried' ||
        !Array.isArray(data.mails) || data.mails.length > MAX_MAILS) {
      throw new Error('Keine gültige MINDS//WORK-Maildatei für Bernried.');
    }
    const mails = data.mails.map(mail);
    if (new Set(mails.map(item => item.id)).size !== mails.length) throw new Error('Doppelte Mail-IDs in der Datei.');
    return mails;
  }
  function merge(existing, incoming) {
    const ids = new Set(existing.map(item => item.id));
    const added = incoming.filter(item => !ids.has(item.id));
    if (existing.length + added.length > MAX_ENTRIES) throw new Error('Maximal 1000 Einträge im Pilot.');
    return {entries:[...existing, ...added], added:added.length, skipped:incoming.length - added.length};
  }
  function normalize(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de').trim();
  }
  function words(value) {
    return normalize(value).split(/[^a-z0-9äöüß]+/i).filter(word => word.length > 2 && ![
      'und','oder','der','die','das','ein','eine','mit','von','für','auf','zum','zur','ich','was','wie',
      'que','del','los','las','una','uno','para','con','por','sobre','esta','este','dime','bitte'
    ].includes(word));
  }
  function matches(item, query) {
    const text = normalize([item.title, item.body, item.owner, item.reference, item.alternatives,
      item.outcome, item.source?.title || '', item.source?.meta || ''].join(' '));
    return words(query).every(word => text.includes(word));
  }
  function mailMatches(item, query) {
    const text = normalize([item.sender, item.recipients, item.subject, item.body, item.date, item.messageId, item.threadKey].join(' '));
    return words(query).every(word => text.includes(word));
  }
  function todayLocal(now = new Date()) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function attention(item, today) {
    if (item.archived || item.state === 'done') return false;
    const end = new Date(`${today}T12:00:00`);
    end.setDate(end.getDate() + 7);
    return item.due ? item.due <= todayLocal(end) : ['task', 'decision', 'question'].includes(item.kind);
  }
  function select(entries, {screen = 'memory', query = '', archived = false, today = todayLocal()} = {}) {
    return entries.filter(item => item.archived === archived && matches(item, query) &&
      (screen === 'today' ? attention(item, today) :
        ['decision', 'question'].includes(screen) ? item.kind === screen : true))
      .sort((a, b) => screen === 'today'
        ? (a.due || '9999').localeCompare(b.due || '9999') || b.updatedAt.localeCompare(a.updatedAt)
        : b.updatedAt.localeCompare(a.updatedAt));
  }
  function save(storage, expectedRaw, entries) {
    if (storage.getItem(KEY) !== expectedRaw) throw new Error('Daten wurden in einem anderen Fenster geändert. Seite neu laden.');
    const raw = JSON.stringify(envelope(entries));
    if (new TextEncoder().encode(raw).length > MAX_BYTES - 1024) throw new Error('Lokaler Pilot-Speicher ist voll (2 MB). Bitte zuerst exportieren.');
    parse(raw);
    storage.setItem(KEY, raw);
    return raw;
  }
  function saveMails(storage, expectedRaw, mails) {
    if (storage.getItem(MAIL_KEY) !== expectedRaw) throw new Error('Mail-Daten wurden in einem anderen Fenster geändert. Seite neu laden.');
    const raw = JSON.stringify(mailEnvelope(mails));
    if (new TextEncoder().encode(raw).length > MAX_MAIL_BYTES - 1024) throw new Error('Lokaler Mail-Speicher ist voll (4 MB).');
    parseMails(raw);
    storage.setItem(MAIL_KEY, raw);
    return raw;
  }
  function questionSignals(entries) {
    const questions = entries.filter(item => item.kind === 'question' && !item.archived);
    const exact = new Map();
    const terms = new Map();
    for (const item of questions) {
      const key = normalize(item.title);
      exact.set(key, {label:item.title, count:(exact.get(key)?.count || 0) + 1});
      for (const word of words(item.title)) terms.set(word, (terms.get(word) || 0) + 1);
    }
    return {
      repeated:[...exact.values()].filter(x => x.count > 1).sort((a,b)=>b.count-a.count).slice(0,5),
      terms:[...terms.entries()].filter(([,count]) => count > 1).sort((a,b)=>b[1]-a[1]).slice(0,6)
        .map(([label,count])=>({label,count}))
    };
  }
  function searchProject(entries, mails, query) {
    const entryHits = entries.filter(item => !item.archived && matches(item, query)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const mailHits = mails.filter(item => !item.archived && mailMatches(item, query)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    return {entries:entryHits, mails:mailHits};
  }

  return {KEY, MAIL_KEY, KINDS, STATES, source, entry, mail, envelope, mailEnvelope, parse, parseMails, merge,
    normalize, words, matches, mailMatches, todayLocal, attention, select, save, saveMails, questionSignals, searchProject};
});
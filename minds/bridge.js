/* Private-project bridge for MINDS//WORK. UI gate uses the existing Supabase session.
   Real confidentiality still requires server-side RLS/storage policies before storing sensitive data. */
(() => {
  'use strict';
  const nav = document.querySelector('.site-nav');
  const main = document.querySelector('main');
  if (!nav || !main || typeof showView !== 'function') return;

  let pendingOpen = false;
  const button = document.createElement('button');
  button.textContent = 'MINDS//WORK';
  button.dataset.view = 'minds';

  const section = document.createElement('section');
  section.className = 'view';
  section.id = 'view-minds';
  const frame = document.createElement('iframe');
  frame.title = 'MINDS//WORK · Bernried';
  frame.style.cssText = 'display:block;width:100%;height:calc(100dvh - 90px);min-height:680px;border:0;background:#f6f6f2';
  section.append(frame);
  main.append(section);
  nav.append(button);

  function signedIn() {
    return document.body.classList.contains('admin-mode');
  }
  function requestLogin() {
    pendingOpen = true;
    const entry = document.getElementById('adminEntry');
    if (entry) {
      showView('kontakt');
      entry.click();
    }
  }
  function open() {
    if (!signedIn()) { requestLogin(); return; }
    pendingOpen = false;
    if (!frame.hasAttribute('src')) frame.src = 'minds/index.html';
    showView('minds');
  }

  button.addEventListener('click', open);

  if (typeof supabaseClient !== 'undefined') {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (session && pendingOpen) setTimeout(open, 0);
      if (!session && document.getElementById('view-minds')?.classList.contains('active')) {
        showView('landing');
        frame.removeAttribute('src');
      }
    });
  }

  function publishContext() {
    if (!frame.hasAttribute('src') || !signedIn()) return;
    try {
      const capturedAt = new Date().toISOString();
      const sources = [];
      let usingFallback = false;
      const add = (id, title, locator, kind, meta = '', version = '', mode = 'hub-display') => {
        const url = new URL(locator, location.href);
        if (!['https:', 'http:'].includes(url.protocol)) return;
        sources.push({id, title, url:url.href, kind, meta, version, capturedAt, mode});
      };
      for (const category of ['grundrisse', 'schnitte']) {
        const loaded = docs[category].length > 0;
        if (!loaded) usingFallback = true;
        const rows = loaded ? docs[category] : LOCAL_DOCS[category];
        for (const row of rows) {
          add(String(row.id || row.file_path), row.title, storageUrl(row.file_path), 'document',
            (loaded ? '' : 'Repository-Fallback · ') + (row.meta || 'Veröffentlicht · Version nicht bestätigt'),
            String(row.updated_at || ''), loaded ? 'hub-display' : 'repository-fallback');
        }
      }
      add('schedule', 'Planungsterminplan LPH 3', document.getElementById('scheduleFrame').src,
        'schedule', 'Verweis auf den angezeigten Plan; Aufgaben werden nicht automatisch übernommen.');
      const model = document.getElementById('modelFrame').src;
      if (model !== 'about:blank') add('model', '3D Modell', model, 'model');
      frame.contentWindow.postMessage({
        type:'minds:context', project:'bernried',
        projectName:document.getElementById('homeBtn').textContent,
        capturedAt,
        note:(usingFallback ? 'Teilweise Repository-Fallback. ' : 'Quellen aus der Hub-Anzeige. ') +
          'Zeitstempel bezeichnet die Erfassung, nicht die Freigabe. Links können später auf geänderte Inhalte zeigen.',
        sources
      }, location.origin);
    } catch (error) {
      console.warn('MINDS: Hub-Kontext derzeit nicht verfügbar.', error.message);
    }
  }

  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === frame.contentWindow &&
        event.data?.type === 'minds:request-context') publishContext();
  });
  frame.addEventListener('load', publishContext);
  button.addEventListener('click', publishContext);

  if (location.hash === '#minds') {
    if (signedIn()) open();
    else pendingOpen = true;
  }
})();
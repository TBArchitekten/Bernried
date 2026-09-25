(() => {
  'use strict';
  const M = window.MindsCore;
  const $ = id => document.getElementById(id);
  const labels = {task:'To-Do', decision:'Entscheidung', lesson:'Erfahrung / Fehler',
    procedure:'Vorgehensweise', question:'AI-Frage', note:'Notiz'};
  const states = {open:'Offen', waiting:'Wartet', done:'Erledigt'};
  let entries = [], mails = [], sources = [], draftSources = [], editing = null, originalSource = null;
  let raw = null, mailRaw = null, storage, readOnly = false, hubContext = false, currentScreen = 'assistant';
  const chat = [];

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function feedback(text) { $('feedback').textContent = text; }
  function dateLabel(value) {
    return value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('de-DE') : '';
  }
  function tomorrow() {
    const d = new Date(); d.setDate(d.getDate() + 1); return M.todayLocal(d);
  }
  function link(source) {
    const a = el('a', source.title + ' ↗');
    a.href = M.source(source).url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function action(text, fn, className = '') {
    const node = el('button', text, className); node.type = 'button'; node.addEventListener('click', fn); node.disabled = readOnly;
    return node;
  }
  function commit(next) {
    if (readOnly) { feedback('Speichern ist gesperrt.'); return false; }
    try {
      raw = M.save(storage, raw, next); entries = next; renderAll(); return true;
    } catch (error) { feedback('Nicht gespeichert: ' + error.message); return false; }
  }
  function commitMails(next) {
    if (readOnly) { feedback('Speichern ist gesperrt.'); return false; }
    try {
      mailRaw = M.saveMails(storage, mailRaw, next); mails = next; renderAll(); return true;
    } catch (error) { feedback('E-Mail nicht gespeichert: ' + error.message); return false; }
  }

  try {
    storage = window.localStorage;
    raw = storage.getItem(M.KEY);
    mailRaw = storage.getItem(M.MAIL_KEY);
    if (raw !== null) entries = M.parse(raw);
    if (mailRaw !== null) mails = M.parseMails(mailRaw);
  } catch (error) {
    readOnly = true;
    feedback('Lokale Daten konnten nicht sicher gelesen werden. Änderungen sind gesperrt: ' + error.message);
  }

  function setScreen(name) {
    currentScreen = name;
    document.querySelectorAll('.screen').forEach(node => {
      const active = node.id === 'screen-' + name;
      node.hidden = !active; node.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-screen]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.screen === name)));
    if (name === 'assistant') $('ask-input').focus();
    renderAll();
  }

  function metrics() {
    const tasks = entries.filter(x => x.kind === 'task' && !x.archived);
    const open = tasks.filter(x => x.state === 'open').length;
    const waiting = tasks.filter(x => x.state === 'waiting').length;
    const decisions = entries.filter(x => x.kind === 'decision' && !x.archived).length;
    $('open-count').textContent = open + waiting;
    $('mail-nav-count').textContent = mails.filter(x => !x.archived).length;
    $('metric-open').textContent = open;
    $('metric-waiting').textContent = waiting;
    $('metric-decisions').textContent = decisions;
    $('metric-mail').textContent = mails.filter(x => !x.archived).length;
  }

  function addChat(role, text, extras = null) {
    chat.push({role, text, extras});
    renderChat();
  }
  function renderChat() {
    const host = $('chat-feed'); host.replaceChildren();
    if (!chat.length) {
      const intro = el('div', undefined, 'message assistant');
      intro.append(el('p','MINDS','message-label'),
        el('div','Ich kenne bisher nur das, was du in diesem Pilot als Projektgedächtnis, To-Do oder E-Mail erfasst hast. Frag mich nach offenen Punkten, Entscheidungen oder Korrespondenz – oder sag mir, was ich als To-Do festhalten soll.','message-text'));
      host.append(intro);
      return;
    }
    chat.forEach(item => {
      const box = el('div', undefined, 'message ' + item.role);
      box.append(el('p', item.role === 'user' ? 'DU' : 'MINDS', 'message-label'), el('div', item.text, 'message-text'));
      if (item.extras?.todo) {
        const p = item.extras.todo;
        const card = el('div', undefined, 'proposal');
        card.append(el('strong','Vorgeschlagenes To-Do'), el('div',p.title));
        if (p.due) card.append(el('small','Termin: ' + dateLabel(p.due)));
        card.append(action('Als To-Do speichern', () => {
          const now = new Date().toISOString();
          const task = M.entry({id:crypto.randomUUID(),kind:'task',state:'open',title:p.title,body:'Über MINDS vorgeschlagen.',
            alternatives:'',outcome:'',owner:'',due:p.due || '',reference:'MINDS conversation',source:null,
            createdAt:now,updatedAt:now,archived:false});
          if (commit([...entries, task])) addChat('assistant','Gespeichert. Das To-Do erscheint jetzt unter To-Dos.');
        }, 'small-primary'));
        box.append(card);
      }
      if (item.extras?.hits) {
        const list = el('div', undefined, 'answer-hits');
        item.extras.hits.forEach(hit => list.append(hit));
        box.append(list);
      }
      host.append(box);
    });
    host.scrollTop = host.scrollHeight;
  }

  function saveQuestionSignal(prompt) {
    if (readOnly || !prompt.trim()) return;
    const now = new Date().toISOString();
    const q = M.entry({id:crypto.randomUUID(),kind:'question',state:'open',title:prompt.trim().slice(0,180),
      body:'Frage an MINDS//WORK',alternatives:'',outcome:'',owner:'',due:'',reference:'Assistant',
      source:null,createdAt:now,updatedAt:now,archived:false});
    commit([...entries, q]);
  }
  function intentWords(prompt) {
    const ignore = new Set(['email','mail','e-mail','herr','frau','tema','thema','steht','stand','sagte','schrieb','geschrieben',
      'ayudame','ayúdame','antwort','antworten','responder','sobre','decía','decia','dazu','darin','diesem','dieser','projekt',
      'minds','bitte','kannst','puedes','quiero','saber','what','said','about','please']);
    return M.words(prompt).filter(word => !ignore.has(word)).join(' ');
  }
  function isTodoIntent(text) {
    const n = M.normalize(text);
    return /(to-?do|aufgabe|erinnere mich|füge|erstelle|anlegen|agrega|añade|crea|recu[eé]rdame)/.test(n) &&
      !/(was|welche|zeige|dime|cuales|cu[aá]les)/.test(n.slice(0,25));
  }
  function todoProposal(prompt) {
    let title = prompt.replace(/^(bitte\s+)?(füge|erstelle|lege|agrega|añade|crea|recu[eé]rdame)(\s+mir)?(\s+(ein|eine|un))?(\s+to-?do|\s+aufgabe)?\s*(für|para)?\s*/i,'').trim();
    title = title.replace(/\b(morgen|mañana)\b/gi,'').replace(/\s{2,}/g,' ').trim();
    return {title:title || prompt.trim(), due:/\b(morgen|mañana)\b/i.test(prompt) ? tomorrow() : ''};
  }
  function entryHit(item) {
    const node = el('div', undefined, 'hit');
    node.append(el('span', labels[item.kind], 'hit-kind'), el('strong', item.title));
    if (item.body) node.append(el('p', item.body.slice(0,260) + (item.body.length > 260 ? '…' : '')));
    if (item.source) { const p = el('p','Quelle: ','hit-meta'); p.append(link(item.source)); node.append(p); }
    return node;
  }
  function mailHit(item) {
    const node = el('div', undefined, 'hit');
    node.append(el('span','E-MAIL','hit-kind'), el('strong', item.subject));
    node.append(el('p', (item.sender ? item.sender + ' · ' : '') + (item.date ? dateLabel(item.date) : ''), 'hit-meta'));
    if (item.body) node.append(el('p', item.body.slice(0,320) + (item.body.length > 320 ? '…' : '')));
    return node;
  }
  function answer(prompt) {
    const n = M.normalize(prompt);
    if (isTodoIntent(prompt)) {
      const proposal = todoProposal(prompt);
      return {text:'Ich kann das als operatives To-Do festhalten. Bitte bestätige den Vorschlag.', extras:{todo:proposal}};
    }
    if (/(was ist.*offen|welche.*offen|pendient|to-?dos? offen|offene punkte)/.test(n)) {
      const list = entries.filter(x => x.kind === 'task' && !x.archived && x.state !== 'done')
        .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
      return list.length ? {text:`Aktuell sind ${list.length} To-Dos offen oder wartend.`,extras:{hits:list.slice(0,8).map(entryHit)}} :
        {text:'Im Projektgedächtnis ist aktuell kein offenes To-Do erfasst.'};
    }
    if (/(warte|wartet|waiting|esperando|rückmeldung)/.test(n)) {
      const list = entries.filter(x => x.kind === 'task' && !x.archived && x.state === 'waiting');
      return list.length ? {text:`Du wartest bei ${list.length} erfassten Punkten auf Rückmeldung.`,extras:{hits:list.slice(0,8).map(entryHit)}} :
        {text:'Ich finde derzeit kein To-Do mit Status „Wartet auf Rückmeldung“. '};
    }
    if (/(entscheidung|entscheidungen|decisi[oó]n|decisiones)/.test(n)) {
      const list = entries.filter(x => x.kind === 'decision' && !x.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      return list.length ? {text:'Das sind die zuletzt erfassten Entscheidungen.',extras:{hits:list.slice(0,6).map(entryHit)}} :
        {text:'Bisher ist noch keine Entscheidung als Projektgedächtnis erfasst.'};
    }
    if (/(fragen.*wieder|question.*signal|preguntas.*repet|fragensignal)/.test(n)) {
      const s = M.questionSignals(entries);
      const pieces = [];
      if (s.repeated.length) pieces.push('Wiederholt: ' + s.repeated.map(x=>`${x.label} (${x.count}×)`).join(' · '));
      if (s.terms.length) pieces.push('Wiederkehrende Begriffe: ' + s.terms.map(x=>`${x.label} (${x.count}×)`).join(' · '));
      return {text:pieces.length ? pieces.join('\n') : 'Noch gibt es zu wenig wiederholte Fragen, um ein Signal zu erkennen.'};
    }

    const query = intentWords(prompt) || prompt;
    const hits = M.searchProject(entries, mails, query);
    const wantsMail = /(mail|email|e-mail|correo|schrieb|geschrieben|dec[ií]a)/.test(n);
    const wantsReply = /(antwort|antworten|reply|responder|contestar)/.test(n);
    if (wantsMail && hits.mails.length) {
      const visible = hits.mails.slice(0,4);
      return {text:wantsReply
        ? 'Ich habe passenden Mail-Kontext gefunden. Ein echter KI-Entwurf ist noch nicht angeschlossen; in der nächsten Stufe kann MINDS daraus direkt eine Antwort mit vollständigem Projektkontext formulieren.'
        : `Ich habe ${hits.mails.length} passende E-Mail${hits.mails.length===1?'':'s'} im lokalen Projektgedächtnis gefunden.`,
        extras:{hits:visible.map(mailHit)}};
    }
    const combined = [...hits.entries.slice(0,5).map(entryHit), ...hits.mails.slice(0,3).map(mailHit)];
    if (combined.length) return {text:'Ich finde dazu folgenden Kontext in deiner eigenen Projektmemory.',extras:{hits:combined}};
    if (/(din|norm|baybo|regel|anforder|treppe|stair)/.test(n)) {
      return {text:'Dazu finde ich noch keine belastbare Information in deiner Projektmemory. Externe Normenrecherche („Beyond my memory“) ist bewusst noch nicht verbunden; ich würde diese Antwort sonst fälschlich wie internes Projektwissen aussehen lassen.'};
    }
    return {text:'Dazu finde ich in der bisher erfassten Projektmemory noch keinen belastbaren Kontext. Du kannst mir eine Entscheidung, ein To-Do oder eine E-Mail hinzufügen; externe Recherche kommt getrennt in „Beyond my memory“. '};
  }

  function ask(prompt, storeSignal = true) {
    if (!prompt.trim()) return;
    addChat('user', prompt.trim());
    const result = answer(prompt.trim());
    if (storeSignal) saveQuestionSignal(prompt.trim());
    addChat('assistant', result.text, result.extras || null);
  }

  function renderAssistantSide() {
    const next = $('assistant-next'); next.replaceChildren();
    const list = entries.filter(x => x.kind === 'task' && !x.archived && x.state !== 'done')
      .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,5);
    if (!list.length) next.append(el('p','Keine offenen To-Dos erfasst.','small'));
    list.forEach(item => {
      const row = el('div', undefined, 'mini-item');
      row.append(el('strong',item.title), el('span',item.state === 'waiting' ? 'Wartet' : (item.due ? dateLabel(item.due) : 'Offen')));
      next.append(row);
    });
    const signals = $('question-signals'); signals.replaceChildren();
    const s = M.questionSignals(entries);
    const all = [...s.repeated.map(x=>({label:x.label,count:x.count})), ...s.terms].slice(0,5);
    if (!all.length) signals.append(el('p','Noch keine wiederkehrenden Signale.','small'));
    all.forEach(x => {
      const row = el('div', undefined, 'signal-row'); row.append(el('span',x.label),el('strong',String(x.count)+'×')); signals.append(row);
    });
  }

  function todoCard(item) {
    const card = el('article', undefined, 'todo-card');
    const top = el('div',undefined,'todo-top');
    top.append(el('span', states[item.state], 'state'), item.due ? el('span',dateLabel(item.due),'due') : el('span','ohne Termin','due'));
    card.append(top,el('h4',item.title));
    if (item.body) card.append(el('p',item.body));
    if (item.owner) card.append(el('p','Verantwortlich: '+item.owner,'meta'));
    if (item.source) { const p=el('p','Quelle: ','meta'); p.append(link(item.source)); card.append(p); }
    const actions=el('div',undefined,'card-actions');
    actions.append(action('Bearbeiten',()=>editEntry(item)));
    if(item.state!=='done') actions.append(action(item.state==='waiting'?'Auf offen':'Wartet',()=>updateEntry(item.id,{state:item.state==='waiting'?'open':'waiting'})));
    actions.append(action(item.state==='done'?'Wieder öffnen':'Erledigt',()=>updateEntry(item.id,{state:item.state==='done'?'open':'done'})));
    card.append(actions); return card;
  }
  function renderTodos() {
    const groups={open:[],waiting:[],done:[]};
    entries.filter(x=>x.kind==='task'&&!x.archived).forEach(x=>groups[x.state].push(x));
    for (const state of Object.keys(groups)) {
      groups[state].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
      $(`todo-${state}-count`).textContent=groups[state].length;
      const host=$(`todo-${state}`); host.replaceChildren();
      if(!groups[state].length) host.append(el('p','Keine Einträge.','column-empty'));
      groups[state].forEach(item=>host.append(todoCard(item)));
    }
  }

  function renderMail() {
    const q=$('mail-search').value;
    const shown=mails.filter(x=>!x.archived && M.mailMatches(x,q)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    $('mail-count').textContent=`${shown.length} E-Mail${shown.length===1?'':'s'}`;
    const host=$('mail-list'); host.replaceChildren();
    if(!shown.length){host.append(el('div','Noch keine passende E-Mail im lokalen Pilot.','empty'));return;}
    shown.forEach(item=>{
      const card=el('article',undefined,'mail-card');
      const head=el('div',undefined,'mail-card-head');
      head.append(el('div',item.sender||'Absender nicht erfasst','mail-sender'),el('div',item.date?dateLabel(item.date):'ohne Datum','mail-date'));
      card.append(head,el('h3',item.subject),el('p',item.body||'Kein Inhalt erfasst.','mail-body'));
      const actions=el('div',undefined,'card-actions');
      actions.append(action('MINDS dazu fragen',()=>{setScreen('assistant');$('ask-input').value=`Was steht in der E-Mail „${item.subject}“?`;$('ask-input').focus();}));
      actions.append(action('Archivieren',()=>commitMails(mails.map(x=>x.id===item.id?{...x,archived:true,updatedAt:new Date().toISOString()}:x))));
      card.append(actions);host.append(card);
    });
  }

  function renderMemoryCard(item) {
    const card=el('article',undefined,'entry');
    const head=el('div',undefined,'entry-head');
    head.append(el('span',labels[item.kind],'tag'),el('span',states[item.state],'state'));
    if(item.archived) head.append(el('span','Archiviert'));
    card.append(head,el('h3',item.title));
    if(item.body) card.append(el('p',item.body));
    if(item.alternatives) card.append(el('p','Alternativen: '+item.alternatives));
    if(item.outcome) card.append(el('p','Auswirkungen: '+item.outcome));
    if(item.owner) card.append(el('p','Verantwortlich / beteiligt: '+item.owner,'meta'));
    if(item.due) card.append(el('p','Termin / Wiedervorlage: '+dateLabel(item.due),'meta'));
    if(item.source){const p=el('p','Quelle: ','meta');p.append(link(item.source));card.append(p);}
    if(item.reference) card.append(el('p','Fundstelle: '+item.reference,'meta'));
    const actions=el('div',undefined,'card-actions');
    actions.append(action('Bearbeiten',()=>editEntry(item)));
    actions.append(action(item.archived?'Wiederherstellen':'Archivieren',()=>updateEntry(item.id,{archived:!item.archived})));
    card.append(actions);return card;
  }
  function renderSources() {
    $('sources').replaceChildren();
    sources.forEach(source=>{
      const card=el('article',undefined,'source'),title=el('h3');title.append(link(source));
      card.append(title,el('p',source.meta||'Quellenverweis ohne Inhaltsprüfung'),
        el('p','Erfasst: '+dateLabel(source.capturedAt)+(source.version?' · Referenz: '+source.version:'')));
      $('sources').append(card);
    });
  }
  function renderMemory() {
    const filter=$('memory-filter').value, isSources=filter==='sources';
    $('entries').hidden=isSources; $('source-panel').hidden=!isSources;
    if(isSources){$('result-summary').textContent=sources.length+' Quellenverweise';renderSources();return;}
    const archived=$('show-archived').checked, query=$('search').value;
    let shown=entries.filter(x=>x.archived===archived && M.matches(x,query));
    if(filter!=='all') shown=shown.filter(x=>x.kind===filter);
    shown.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    $('result-summary').textContent=`${shown.length} Eintr${shown.length===1?'ag':'äge'}`;
    const host=$('entries');host.replaceChildren();
    if(!shown.length) host.append(el('div','Keine passenden Erinnerungen.','empty'));
    shown.forEach(item=>host.append(renderMemoryCard(item)));
  }
  function renderAll() {
    metrics(); renderAssistantSide(); renderTodos(); renderMail(); renderMemory();
  }

  function updateEntry(id, changes) {
    if(commit(entries.map(item=>item.id===id?{...item,...changes,updatedAt:new Date().toISOString()}:item))) feedback('Projektgedächtnis aktualisiert.');
  }
  function fillSourceOptions(selected=originalSource) {
    draftSources=sources.map(x=>({...x}));
    const select=$('entry-source');select.replaceChildren(new Option('Eigene Notiz · ohne Dokumentbeleg',''));
    if(selected) select.add(new Option(selected.title+' · gespeicherter Verweis','__snapshot'));
    draftSources.forEach((source,index)=>select.add(new Option(source.title,String(index))));
    select.value=selected?'__snapshot':'';
  }
  function editEntry(item=null, kind=null) {
    editing=item;originalSource=item?.source||null;$('entry-form').reset();
    $('editor-title').textContent=item?'Eintrag bearbeiten':(kind==='task'?'To-Do erfassen':'Erinnerung erfassen');
    $('entry-kind').value=item?.kind||kind||'note';$('entry-state').value=item?.state||'open';
    for(const field of ['title','body','alternatives','outcome','owner','due','reference']) $('entry-'+field).value=item?.[field]||'';
    fillSourceOptions();$('decision-fields').hidden=$('entry-kind').value!=='decision';$('form-error').textContent='';
    $('editor').showModal();$('entry-title').focus();
  }

  $('entry-kind').addEventListener('change',()=>{$('decision-fields').hidden=$('entry-kind').value!=='decision';});
  $('entry-form').addEventListener('submit',event=>{
    event.preventDefault();
    try{
      const now=new Date().toISOString(),selected=$('entry-source').value;
      const draft={id:editing?.id||crypto.randomUUID(),createdAt:editing?.createdAt||now,updatedAt:now,
        kind:$('entry-kind').value,state:$('entry-state').value,archived:editing?.archived||false,
        source:selected==='__snapshot'?originalSource:selected===''?null:draftSources[Number(selected)]};
      for(const field of ['title','body','alternatives','outcome','owner','due','reference']) draft[field]=$('entry-'+field).value.trim();
      const value=M.entry(draft);
      if(commit(editing?entries.map(x=>x.id===editing.id?value:x):[...entries,value])){$('editor').close();feedback('Gespeichert.');}
    }catch(error){$('form-error').textContent=error.message;}
  });

  function openMailEditor(){
    $('mail-form').reset();$('mail-date').value=M.todayLocal();$('mail-form-error').textContent='';$('mail-editor').showModal();$('mail-sender').focus();
  }
  $('mail-form').addEventListener('submit',event=>{
    event.preventDefault();
    try{
      const now=new Date().toISOString();
      const value=M.mail({id:crypto.randomUUID(),sender:$('mail-sender').value.trim(),subject:$('mail-subject').value.trim(),
        body:$('mail-body').value.trim(),date:$('mail-date').value,createdAt:now,updatedAt:now,archived:false});
      if(commitMails([...mails,value])){$('mail-editor').close();feedback('E-Mail lokal gespeichert.');}
    }catch(error){$('mail-form-error').textContent=error.message;}
  });

  $('ask-form').addEventListener('submit',event=>{event.preventDefault();const prompt=$('ask-input').value.trim();if(!prompt)return;$('ask-input').value='';ask(prompt,true);});
  document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>ask(button.dataset.prompt,true)));
  $('clear-chat').addEventListener('click',()=>{chat.length=0;renderChat();});
  document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>setScreen(button.dataset.screen)));
  $('new-todo').addEventListener('click',()=>editEntry(null,'task'));
  $('new-entry').addEventListener('click',()=>editEntry(null,'note'));
  $('new-mail').addEventListener('click',openMailEditor);
  for(const id of ['close-editor','cancel-editor']) $(id).addEventListener('click',()=>$('editor').close());
  for(const id of ['close-mail-editor','cancel-mail-editor']) $(id).addEventListener('click',()=>$('mail-editor').close());
  $('mail-search').addEventListener('input',renderMail);
  $('search').addEventListener('input',renderMemory);
  $('memory-filter').addEventListener('change',renderMemory);
  $('show-archived').addEventListener('change',renderMemory);

  function download(text,filename){
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('export').addEventListener('click',()=>{
    const backup={schemaVersion:2,project:'bernried',exportedAt:new Date().toISOString(),entries,mails};
    download(JSON.stringify(backup,null,2),`minds-work-bernried-${M.todayLocal()}.json`);
  });
  $('import').addEventListener('change',async event=>{
    const file=event.target.files[0];
    try{
      if(!file)return;
      const text=await file.text(),data=JSON.parse(text);
      if(data?.schemaVersion===1&&data?.entries){
        const incoming=M.parse(text),result=M.merge(entries,incoming);if(commit(result.entries))feedback(`${result.added} Erinnerungen importiert.`);
      }else if(data?.schemaVersion===2&&data?.project==='bernried'&&Array.isArray(data.entries)&&Array.isArray(data.mails)){
        const checkedEntries=data.entries.map(M.entry),checkedMails=data.mails.map(M.mail);
        const merged=M.merge(entries,checkedEntries);
        const mailIds=new Set(mails.map(x=>x.id)),newMails=checkedMails.filter(x=>!mailIds.has(x.id));
        if(commit(merged.entries)&&commitMails([...mails,...newMails])) feedback(`${merged.added} Erinnerungen und ${newMails.length} E-Mails importiert.`);
      }else throw new Error('Unbekanntes Backup-Format.');
    }catch(error){feedback('Import abgebrochen: '+error.message);}
    finally{event.target.value='';}
  });

  function acceptContext(context){
    if(context.project!=='bernried'||!Array.isArray(context.sources)||context.sources.length>500)return;
    try{
      sources=context.sources.map(M.source);$('project-name').textContent=String(context.projectName||'Bernried').slice(0,200);
      $('source-note').textContent=String(context.note||'').slice(0,1000);hubContext=true;
      if(!$('editor').open)fillSourceOptions();renderAll();
    }catch(error){feedback('Quellen konnten nicht übernommen werden: '+error.message);}
  }
  function requestContext(){
    if(window.parent!==window)window.parent.postMessage({type:'minds:request-context'},location.origin);
    else feedback('MINDS bitte über den geschützten Project Hub öffnen.');
  }
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='minds:context')return;
    acceptContext(event.data);
  });
  $('refresh-sources').addEventListener('click',requestContext);
  fetch('sources.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(context=>{if(!hubContext)acceptContext(context);}).catch(()=>{});
  requestContext();
  renderChat(); renderAll();
})();
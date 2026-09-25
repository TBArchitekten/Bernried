(() => {
  'use strict';
  const M = window.MindsCore;
  const S = window.MindsStore;
  const $ = id => document.getElementById(id);
  const labels = {task:'To-Do', decision:'Entscheidung', lesson:'Erfahrung / Fehler',
    procedure:'Vorgehensweise', question:'AI-Frage', note:'Notiz'};
  const states = {open:'Offen', waiting:'Wartet', done:'Erledigt'};

  let entries=[], mails=[], sources=[], draftSources=[], chat=[];
  let editing=null, originalSource=null, hubContext=false, busy=false;

  function el(tag,text,className){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;}
  function feedback(text){$('feedback').textContent=text; if(text) setTimeout(()=>{if($('feedback').textContent===text)$('feedback').textContent='';},5000);}
  function dateLabel(value){return value?new Date(value.length===10?value+'T12:00:00':value).toLocaleDateString('de-DE'):'';}
  function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);return M.todayLocal(d);}
  function link(source){const a=el('a',source.title+' ↗');a.href=M.source(source).url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function action(text,fn,className=''){const n=el('button',text,className);n.type='button';n.addEventListener('click',fn);n.disabled=busy;return n;}
  function setBusy(value){busy=value;document.querySelectorAll('button,input,textarea,select').forEach(x=>{if(x.id!=='mail-search'&&x.id!=='search')x.disabled=value;});}

  async function refresh(){
    [entries,mails,chat]=await Promise.all([S.loadEntries(),S.loadMails(),S.loadMessages()]);
    renderAll();
  }

  async function saveEntry(value,message='Gespeichert.'){
    setBusy(true);
    try{
      const saved=await S.saveEntry(value);
      const i=entries.findIndex(x=>x.id===saved.id);
      if(i>=0)entries[i]=saved;else entries.unshift(saved);
      renderAll();feedback(message);return saved;
    }catch(e){feedback(e.message);throw e;}finally{setBusy(false);}
  }

  async function saveMail(value,files=[]){
    setBusy(true);
    try{
      const saved=await S.saveMail(value);
      for(const file of files) await S.uploadMailFile(saved.id,file);
      const i=mails.findIndex(x=>x.id===saved.id);
      if(i>=0)mails[i]=saved;else mails.unshift(saved);
      renderAll();feedback(files.length?('E-Mail + '+files.length+' Anhänge privat gespeichert.'):'E-Mail privat gespeichert.');
      return saved;
    }catch(e){feedback(e.message);throw e;}finally{setBusy(false);}
  }

  function setScreen(name){
    document.querySelectorAll('.screen').forEach(node=>{const on=node.id==='screen-'+name;node.hidden=!on;node.classList.toggle('active',on);});
    document.querySelectorAll('[data-screen]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.screen===name)));
    if(name==='assistant')$('ask-input').focus();
    renderAll();
  }

  function metrics(){
    const tasks=entries.filter(x=>x.kind==='task'&&!x.archived);
    const open=tasks.filter(x=>x.state==='open').length, waiting=tasks.filter(x=>x.state==='waiting').length;
    $('open-count').textContent=open+waiting;$('mail-nav-count').textContent=mails.filter(x=>!x.archived).length;
    $('metric-open').textContent=open;$('metric-waiting').textContent=waiting;
    $('metric-decisions').textContent=entries.filter(x=>x.kind==='decision'&&!x.archived).length;
    $('metric-mail').textContent=mails.filter(x=>!x.archived).length;
  }

  function renderChat(){
    const host=$('chat-feed');host.replaceChildren();
    if(!chat.length){
      const intro=el('div',undefined,'message assistant');
      intro.append(el('p','MINDS','message-label'),el('div','Ich bin mit deiner privaten Bernried-Memory verbunden. Frag mich nach To-Dos, Entscheidungen oder Korrespondenz. Externe Normenrecherche bleibt bewusst getrennt.','message-text'));
      host.append(intro);return;
    }
    chat.forEach(item=>{
      const box=el('div',undefined,'message '+item.role);
      box.append(el('p',item.role==='user'?'DU':'MINDS','message-label'),el('div',item.text,'message-text'));
      const extras=item.extras||{};
      if(extras.todo){
        const p=extras.todo,card=el('div',undefined,'proposal');
        card.append(el('strong','Vorgeschlagenes To-Do'),el('div',p.title));
        if(p.due)card.append(el('small','Termin: '+dateLabel(p.due)));
        card.append(action('Als To-Do speichern',async()=>{
          const now=new Date().toISOString();
          await saveEntry(M.entry({id:crypto.randomUUID(),kind:'task',state:'open',title:p.title,body:'Über MINDS vorgeschlagen.',
            alternatives:'',outcome:'',owner:'',due:p.due||'',reference:'MINDS conversation',source:null,
            createdAt:now,updatedAt:now,archived:false}),'To-Do privat gespeichert.');
          const msg=await S.appendMessage('assistant','Gespeichert. Das To-Do erscheint unter To-Dos.',{});
          chat.push(msg);renderChat();
        },'small-primary'));
        box.append(card);
      }
      host.append(box);
    });
    host.scrollTop=host.scrollHeight;
  }

  function intentWords(prompt){
    const ignore=new Set(['email','mail','e-mail','herr','frau','tema','thema','steht','stand','sagte','schrieb','geschrieben',
      'ayudame','ayúdame','antwort','antworten','responder','sobre','decía','decia','dazu','darin','diesem','dieser','projekt',
      'minds','bitte','kannst','puedes','quiero','saber','what','said','about','please']);
    return M.words(prompt).filter(w=>!ignore.has(w)).join(' ');
  }
  function isTodoIntent(text){
    const n=M.normalize(text);
    return /(to-?do|aufgabe|erinnere mich|füge|erstelle|anlegen|agrega|añade|crea|recu[eé]rdame)/.test(n)&&
      !/(was|welche|zeige|dime|cuales|cu[aá]les)/.test(n.slice(0,25));
  }
  function todoProposal(prompt){
    let title=prompt.replace(/^(bitte\s+)?(füge|erstelle|lege|agrega|añade|crea|recu[eé]rdame)(\s+mir)?(\s+(ein|eine|un))?(\s+to-?do|\s+aufgabe)?\s*(für|para)?\s*/i,'').trim();
    title=title.replace(/\b(morgen|mañana)\b/gi,'').replace(/\s{2,}/g,' ').trim();
    return {title:title||prompt.trim(),due:/\b(morgen|mañana)\b/i.test(prompt)?tomorrow():''};
  }
  function entryText(item){return [labels[item.kind],item.title,item.body,item.owner,item.reference,item.outcome].filter(Boolean).join(' · ');}
  function mailText(item){return ['E-Mail',item.subject,item.sender,item.date?dateLabel(item.date):'',item.body.slice(0,600)].filter(Boolean).join(' · ');}

  function answer(prompt){
    const n=M.normalize(prompt);
    if(isTodoIntent(prompt))return {text:'Ich kann das als To-Do festhalten. Bitte bestätige den Vorschlag.',extras:{todo:todoProposal(prompt)}};
    if(/(was ist.*offen|welche.*offen|pendient|to-?dos? offen|offene punkte)/.test(n)){
      const list=entries.filter(x=>x.kind==='task'&&!x.archived&&x.state!=='done').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
      return {text:list.length?('Aktuell sind '+list.length+' To-Dos offen oder wartend:\n'+list.slice(0,8).map(x=>'• '+entryText(x)).join('\n')):'Im Projektgedächtnis ist aktuell kein offenes To-Do erfasst.'};
    }
    if(/(warte|wartet|waiting|esperando|rückmeldung)/.test(n)){
      const list=entries.filter(x=>x.kind==='task'&&!x.archived&&x.state==='waiting');
      return {text:list.length?('Du wartest bei '+list.length+' Punkten auf Rückmeldung:\n'+list.slice(0,8).map(x=>'• '+entryText(x)).join('\n')):'Ich finde derzeit kein To-Do mit Status „Wartet“. '};
    }
    if(/(entscheidung|entscheidungen|decisi[oó]n|decisiones)/.test(n)){
      const list=entries.filter(x=>x.kind==='decision'&&!x.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      return {text:list.length?('Letzte Entscheidungen:\n'+list.slice(0,6).map(x=>'• '+entryText(x)).join('\n')):'Bisher ist keine Entscheidung erfasst.'};
    }
    if(/(fragen.*wieder|question.*signal|preguntas.*repet|fragensignal)/.test(n)){
      const s=M.questionSignals(entries),p=[];
      if(s.repeated.length)p.push('Wiederholt: '+s.repeated.map(x=>x.label+' ('+x.count+'×)').join(' · '));
      if(s.terms.length)p.push('Wiederkehrende Begriffe: '+s.terms.map(x=>x.label+' ('+x.count+'×)').join(' · '));
      return {text:p.length?p.join('\n'):'Noch gibt es zu wenig wiederholte Fragen.'};
    }
    const query=intentWords(prompt)||prompt,h=M.searchProject(entries,mails,query);
    const wantsMail=/(mail|email|e-mail|correo|schrieb|geschrieben|dec[ií]a)/.test(n);
    const wantsReply=/(antwort|antworten|reply|responder|contestar)/.test(n);
    if(wantsMail&&h.mails.length){
      const context=h.mails.slice(0,4).map(x=>'• '+mailText(x)).join('\n');
      return {text:(wantsReply?'Ich habe passenden Mail-Kontext gefunden. Die LLM-Antwortfunktion ist noch nicht angeschlossen; der sichere Kontext ist aber jetzt vorhanden.':'Passende private E-Mails:')+'\n'+context};
    }
    const combined=[...h.entries.slice(0,5).map(x=>'• '+entryText(x)),...h.mails.slice(0,3).map(x=>'• '+mailText(x))];
    if(combined.length)return {text:'Ich finde dazu folgenden Kontext in deiner privaten Projektmemory:\n'+combined.join('\n')};
    if(/(din|norm|baybo|regel|anforder|treppe|stair)/.test(n))return {text:'Dazu finde ich noch keine belastbare interne Information. „Beyond my memory“ und verifizierte Normenrecherche sind bewusst noch nicht angeschlossen.'};
    return {text:'Dazu finde ich in deiner Projektmemory noch keinen belastbaren Kontext.'};
  }

  async function ask(prompt,storeSignal=true){
    if(!prompt.trim())return;
    const userMsg=await S.appendMessage('user',prompt.trim(),{mode:'memory'});chat.push(userMsg);renderChat();
    if(storeSignal){
      const now=new Date().toISOString();
      await saveEntry(M.entry({id:crypto.randomUUID(),kind:'question',state:'open',title:prompt.trim().slice(0,180),
        body:'Frage an MINDS//WORK',alternatives:'',outcome:'',owner:'',due:'',reference:'Assistant',source:null,
        createdAt:now,updatedAt:now,archived:false}),'');
    }
    const result=answer(prompt.trim());
    const assistantMsg=await S.appendMessage('assistant',result.text,result.extras||{});
    chat.push(assistantMsg);renderAll();
  }

  function renderAssistantSide(){
    const next=$('assistant-next');next.replaceChildren();
    const list=entries.filter(x=>x.kind==='task'&&!x.archived&&x.state!=='done').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,5);
    if(!list.length)next.append(el('p','Keine offenen To-Dos erfasst.','small'));
    list.forEach(item=>{const r=el('div',undefined,'mini-item');r.append(el('strong',item.title),el('span',item.state==='waiting'?'Wartet':(item.due?dateLabel(item.due):'Offen')));next.append(r);});
    const signals=$('question-signals');signals.replaceChildren();const s=M.questionSignals(entries);
    const all=[...s.repeated.map(x=>({label:x.label,count:x.count})),...s.terms].slice(0,5);
    if(!all.length)signals.append(el('p','Noch keine wiederkehrenden Signale.','small'));
    all.forEach(x=>{const r=el('div',undefined,'signal-row');r.append(el('span',x.label),el('strong',x.count+'×'));signals.append(r);});
  }

  function todoCard(item){
    const card=el('article',undefined,'todo-card'),top=el('div',undefined,'todo-top');
    top.append(el('span',states[item.state],'state'),el('span',item.due?dateLabel(item.due):'ohne Termin','due'));card.append(top,el('h4',item.title));
    if(item.body)card.append(el('p',item.body));if(item.owner)card.append(el('p','Verantwortlich: '+item.owner,'meta'));
    const actions=el('div',undefined,'card-actions');
    actions.append(action('Bearbeiten',()=>editEntry(item)));
    if(item.state!=='done')actions.append(action(item.state==='waiting'?'Auf offen':'Wartet',async()=>{await saveEntry({...item,state:item.state==='waiting'?'open':'waiting',updatedAt:new Date().toISOString()});}));
    actions.append(action(item.state==='done'?'Wieder öffnen':'Erledigt',async()=>{await saveEntry({...item,state:item.state==='done'?'open':'done',updatedAt:new Date().toISOString()});}));
    card.append(actions);return card;
  }
  function renderTodos(){
    const groups={open:[],waiting:[],done:[]};entries.filter(x=>x.kind==='task'&&!x.archived).forEach(x=>groups[x.state].push(x));
    for(const state of Object.keys(groups)){groups[state].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));$('todo-'+state+'-count').textContent=groups[state].length;const host=$('todo-'+state);host.replaceChildren();if(!groups[state].length)host.append(el('p','Keine Einträge.','column-empty'));groups[state].forEach(x=>host.append(todoCard(x)));}
  }

  function renderMail(){
    const q=$('mail-search').value,shown=mails.filter(x=>!x.archived&&M.mailMatches(x,q)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    $('mail-count').textContent=shown.length+' E-Mail'+(shown.length===1?'':'s');const host=$('mail-list');host.replaceChildren();
    if(!shown.length){host.append(el('div','Noch keine passende E-Mail in der privaten Memory.','empty'));return;}
    shown.forEach(item=>{const card=el('article',undefined,'mail-card'),head=el('div',undefined,'mail-card-head');
      head.append(el('div',item.sender||'Absender nicht erfasst','mail-sender'),el('div',item.date?dateLabel(item.date):'ohne Datum','mail-date'));
      card.append(head,el('h3',item.subject),el('p',item.body||'Kein Inhalt erfasst.','mail-body'));
      const actions=el('div',undefined,'card-actions');
      actions.append(action('MINDS dazu fragen',()=>{setScreen('assistant');$('ask-input').value='Was steht in der E-Mail „'+item.subject+'“?';$('ask-input').focus();}));
      actions.append(action('Archivieren',async()=>{await saveMail({...item,archived:true,updatedAt:new Date().toISOString()});}));
      card.append(actions);host.append(card);
    });
  }

  function renderMemoryCard(item){
    const card=el('article',undefined,'entry'),head=el('div',undefined,'entry-head');head.append(el('span',labels[item.kind],'tag'),el('span',states[item.state],'state'));if(item.archived)head.append(el('span','Archiviert'));card.append(head,el('h3',item.title));
    if(item.body)card.append(el('p',item.body));if(item.alternatives)card.append(el('p','Alternativen: '+item.alternatives));if(item.outcome)card.append(el('p','Auswirkungen: '+item.outcome));if(item.owner)card.append(el('p','Verantwortlich / beteiligt: '+item.owner,'meta'));if(item.due)card.append(el('p','Termin / Wiedervorlage: '+dateLabel(item.due),'meta'));if(item.source){const p=el('p','Quelle: ','meta');p.append(link(item.source));card.append(p);}if(item.reference)card.append(el('p','Fundstelle: '+item.reference,'meta'));
    const actions=el('div',undefined,'card-actions');actions.append(action('Bearbeiten',()=>editEntry(item)));actions.append(action(item.archived?'Wiederherstellen':'Archivieren',async()=>{await saveEntry({...item,archived:!item.archived,updatedAt:new Date().toISOString()});}));card.append(actions);return card;
  }
  function renderSources(){const h=$('sources');h.replaceChildren();sources.forEach(source=>{const card=el('article',undefined,'source'),title=el('h3');title.append(link(source));card.append(title,el('p',source.meta||'Quellenverweis ohne Inhaltsprüfung'),el('p','Erfasst: '+dateLabel(source.capturedAt)+(source.version?' · Referenz: '+source.version:'')));h.append(card);});}
  function renderMemory(){
    const filter=$('memory-filter').value,isSources=filter==='sources';$('entries').hidden=isSources;$('source-panel').hidden=!isSources;
    if(isSources){$('result-summary').textContent=sources.length+' Quellenverweise';renderSources();return;}
    const archived=$('show-archived').checked,query=$('search').value;let shown=entries.filter(x=>x.archived===archived&&M.matches(x,query));if(filter!=='all')shown=shown.filter(x=>x.kind===filter);shown.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));$('result-summary').textContent=shown.length+' Eintr'+(shown.length===1?'ag':'äge');const host=$('entries');host.replaceChildren();if(!shown.length)host.append(el('div','Keine passenden Erinnerungen.','empty'));shown.forEach(x=>host.append(renderMemoryCard(x)));
  }
  function renderAll(){metrics();renderChat();renderAssistantSide();renderTodos();renderMail();renderMemory();}

  function fillSourceOptions(selected=originalSource){draftSources=sources.map(x=>({...x}));const select=$('entry-source');select.replaceChildren(new Option('Eigene Notiz · ohne Dokumentbeleg',''));if(selected)select.add(new Option(selected.title+' · gespeicherter Verweis','__snapshot'));draftSources.forEach((s,i)=>select.add(new Option(s.title,String(i))));select.value=selected?'__snapshot':'';}
  function editEntry(item=null,kind=null){editing=item;originalSource=item?.source||null;$('entry-form').reset();$('editor-title').textContent=item?'Eintrag bearbeiten':(kind==='task'?'To-Do erfassen':'Erinnerung erfassen');$('entry-kind').value=item?.kind||kind||'note';$('entry-state').value=item?.state||'open';for(const f of ['title','body','alternatives','outcome','owner','due','reference'])$('entry-'+f).value=item?.[f]||'';fillSourceOptions();$('decision-fields').hidden=$('entry-kind').value!=='decision';$('form-error').textContent='';$('editor').showModal();$('entry-title').focus();}

  $('entry-kind').addEventListener('change',()=>{$('decision-fields').hidden=$('entry-kind').value!=='decision';});
  $('entry-form').addEventListener('submit',async event=>{event.preventDefault();try{const now=new Date().toISOString(),selected=$('entry-source').value,draft={id:editing?.id||crypto.randomUUID(),createdAt:editing?.createdAt||now,updatedAt:now,kind:$('entry-kind').value,state:$('entry-state').value,archived:editing?.archived||false,source:selected==='__snapshot'?originalSource:selected===''?null:draftSources[Number(selected)]};for(const f of ['title','body','alternatives','outcome','owner','due','reference'])draft[f]=$('entry-'+f).value.trim();await saveEntry(M.entry(draft));$('editor').close();}catch(e){$('form-error').textContent=e.message;}});

  function openMailEditor(){$('mail-form').reset();$('mail-date').value=M.todayLocal();$('mail-form-error').textContent='';$('mail-editor').showModal();$('mail-sender').focus();}
  $('mail-form').addEventListener('submit',async event=>{event.preventDefault();try{const now=new Date().toISOString(),value=M.mail({id:crypto.randomUUID(),sender:$('mail-sender').value.trim(),recipients:$('mail-recipients').value.trim(),subject:$('mail-subject').value.trim(),body:$('mail-body').value.trim(),date:$('mail-date').value,messageId:'',threadKey:'',createdAt:now,updatedAt:now,archived:false});await saveMail(value,[...$('mail-files').files]);$('mail-editor').close();}catch(e){$('mail-form-error').textContent=e.message;}});

  $('ask-form').addEventListener('submit',async event=>{event.preventDefault();const p=$('ask-input').value.trim();if(!p)return;$('ask-input').value='';try{await ask(p,true);}catch(e){feedback(e.message);}});
  document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>ask(b.dataset.prompt,true).catch(e=>feedback(e.message))));
  $('clear-chat').addEventListener('click',async()=>{try{await S.newConversation();chat=[];renderChat();feedback('Neue Arbeitskonversation gestartet.');}catch(e){feedback(e.message);}});
  document.querySelectorAll('[data-screen]').forEach(b=>b.addEventListener('click',()=>setScreen(b.dataset.screen)));
  $('new-todo').addEventListener('click',()=>editEntry(null,'task'));$('new-entry').addEventListener('click',()=>editEntry(null,'note'));$('new-mail').addEventListener('click',openMailEditor);
  for(const id of ['close-editor','cancel-editor'])$(id).addEventListener('click',()=>$('editor').close());
  for(const id of ['close-mail-editor','cancel-mail-editor'])$(id).addEventListener('click',()=>$('mail-editor').close());
  $('mail-search').addEventListener('input',renderMail);$('search').addEventListener('input',renderMemory);$('memory-filter').addEventListener('change',renderMemory);$('show-archived').addEventListener('change',renderMemory);

  function download(text,filename){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('export').addEventListener('click',()=>download(JSON.stringify({schemaVersion:3,project:'bernried',exportedAt:new Date().toISOString(),entries,mails,chat},null,2),'minds-work-bernried-'+M.todayLocal()+'.json'));
  $('import').addEventListener('change',async event=>{const file=event.target.files[0];try{if(!file)return;const data=JSON.parse(await file.text());if(data?.project!=='bernried')throw new Error('Falsches Projekt.');for(const e of data.entries||[])await saveEntry(M.entry(e),'');for(const m of data.mails||[])await saveMail(M.mail(m));await refresh();feedback('Backup in private Memory importiert.');}catch(e){feedback('Import abgebrochen: '+e.message);}finally{event.target.value='';}});

  function acceptContext(context){if(context.project!=='bernried'||!Array.isArray(context.sources)||context.sources.length>500)return;try{sources=context.sources.map(M.source);$('project-name').textContent=String(context.projectName||'Bernried').slice(0,200);$('source-note').textContent=String(context.note||'').slice(0,1000);hubContext=true;if(!$('editor').open)fillSourceOptions();renderAll();}catch(e){feedback('Quellen konnten nicht übernommen werden: '+e.message);}}
  function requestContext(){if(window.parent!==window)window.parent.postMessage({type:'minds:request-context'},location.origin);}
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='minds:context')return;acceptContext(event.data);});
  $('refresh-sources').addEventListener('click',requestContext);

  async function migrateLocalOnce(){
    if(localStorage.getItem('minds_work_bernried_supabase_migrated_v1')==='1')return;
    let localEntries=[],localMails=[];
    try{const r=localStorage.getItem(M.KEY);if(r)localEntries=M.parse(r);}catch{}
    try{const r=localStorage.getItem(M.MAIL_KEY);if(r)localMails=M.parseMails(r);}catch{}
    if(!localEntries.length&&!localMails.length){localStorage.setItem('minds_work_bernried_supabase_migrated_v1','1');return;}
    const result=await S.migrateLocal(localEntries,localMails);
    localStorage.setItem('minds_work_bernried_supabase_migrated_v1','1');
    feedback('Lokale Pilotdaten migriert: '+result.entries+' Memory, '+result.mails+' Mails.');
  }

  async function boot(){
    try{
      setBusy(true);
      await S.init();
      await migrateLocalOnce();
      await refresh();
      requestContext();
      fetch('sources.json').then(r=>r.ok?r.json():null).then(c=>{if(c&&!hubContext)acceptContext(c);}).catch(()=>{});
      document.querySelector('.pilot-label').innerHTML='<span class="dot"></span> Pilot 0.3 · private Supabase memory';
    }catch(e){
      document.querySelector('.workspace').innerHTML='<div class="notice"><strong>MINDS konnte nicht geöffnet werden.</strong><br>'+String(e.message).replace(/[<>&]/g,'')+'<br><br>Bitte zum Project Hub zurückkehren und erneut anmelden.</div>';
    }finally{setBusy(false);}
  }
  boot();
})();
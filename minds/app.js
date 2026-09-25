(() => {
  'use strict';

  const M = window.MindsCore;
  const S = window.MindsStore;
  const $ = id => document.getElementById(id);
  const labels = {task:'To-Do', decision:'Entscheidung', lesson:'Erfahrung / Fehler',
    procedure:'Vorgehensweise', question:'AI-Frage', note:'Notiz'};
  const states = {open:'Offen', waiting:'Wartet', done:'Erledigt'};
  const priorities = {low:'Niedrig', normal:'Normal', important:'Wichtig', urgent:'Dringend'};

  let entries=[], mails=[], buckets=[], sources=[], draftSources=[], chat=[];
  let editing=null, originalSource=null, hubContext=false, busy=false;
  let editingBucket=null, todoView='board';

  function el(tag,text,className){
    const n=document.createElement(tag);
    if(text!==undefined)n.textContent=text;
    if(className)n.className=className;
    return n;
  }

  function feedback(message){
    $('feedback').textContent=message || '';
    if(message) setTimeout(()=>{if($('feedback').textContent===message)$('feedback').textContent='';},5000);
  }

  function dateLabel(value){
    return value ? new Date(value.length===10 ? value+'T12:00:00' : value).toLocaleDateString('de-DE') : '';
  }

  function tomorrow(){
    const d=new Date(); d.setDate(d.getDate()+1); return M.todayLocal(d);
  }

  function isOverdue(item){
    return item.due && item.state!=='done' && item.due < M.todayLocal();
  }

  function initials(value){
    const parts=String(value||'').trim().split(/\s+/).filter(Boolean);
    return parts.length ? parts.slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('') : '';
  }

  function link(source){
    const a=el('a',source.title+' ↗');
    a.href=M.source(source).url;
    a.target='_blank';
    a.rel='noopener noreferrer';
    return a;
  }

  function action(text,fn,className=''){
    const n=el('button',text,className);
    n.type='button';
    n.addEventListener('click',fn);
    n.disabled=busy;
    return n;
  }

  function setBusy(value){
    busy=value;
  }

  function bucketName(id){
    return buckets.find(x=>x.id===id)?.name || 'Allgemein';
  }

  async function refresh(){
    [entries,mails,buckets,chat]=await Promise.all([
      S.loadEntries(),S.loadMails(),S.loadBuckets(),S.loadMessages()
    ]);
    if(!buckets.length){
      const saved=await S.saveBucket({name:'Allgemein',sortOrder:0,archived:false});
      buckets=[saved];
    }
    renderAll();
  }

  async function saveEntry(value,message='Gespeichert.'){
    setBusy(true);
    try{
      const saved=await S.saveEntry(value);
      const i=entries.findIndex(x=>x.id===saved.id);
      if(i>=0) entries[i]=saved; else entries.unshift(saved);
      renderAll();
      if(message) feedback(message);
      return saved;
    }catch(error){
      feedback(error.message);
      throw error;
    }finally{setBusy(false);}
  }

  async function saveMail(value,files=[]){
    setBusy(true);
    try{
      const saved=await S.saveMail(value);
      for(const file of files) await S.uploadMailFile(saved.id,file);
      const i=mails.findIndex(x=>x.id===saved.id);
      if(i>=0)mails[i]=saved;else mails.unshift(saved);
      renderAll();
      feedback(files.length ? 'E-Mail + '+files.length+' Anhänge privat gespeichert und indexiert.' : 'E-Mail privat gespeichert und indexiert.');
      return saved;
    }catch(error){
      feedback(error.message);
      throw error;
    }finally{setBusy(false);}
  }

  async function saveBucket(value){
    setBusy(true);
    try{
      const saved=await S.saveBucket(value);
      const i=buckets.findIndex(x=>x.id===saved.id);
      if(i>=0)buckets[i]=saved;else buckets.push(saved);
      buckets.sort((a,b)=>a.sortOrder-b.sortOrder || a.createdAt.localeCompare(b.createdAt));
      fillBucketOptions(editing?.bucketId || saved.id);
      renderTodos();
      feedback('Bucket gespeichert.');
      return saved;
    }catch(error){
      feedback(error.message);
      throw error;
    }finally{setBusy(false);}
  }

  function setScreen(name){
    document.querySelectorAll('.screen').forEach(node=>{
      const active=node.id==='screen-'+name;
      node.hidden=!active;
      node.classList.toggle('active',active);
    });
    document.querySelectorAll('[data-screen]').forEach(button=>{
      button.setAttribute('aria-pressed',String(button.dataset.screen===name));
    });
    if(name==='assistant')$('ask-input').focus();
    renderAll();
  }

  function metrics(){
    const tasks=entries.filter(x=>x.kind==='task'&&!x.archived);
    const open=tasks.filter(x=>x.state==='open').length;
    const waiting=tasks.filter(x=>x.state==='waiting').length;
    $('open-count').textContent=open+waiting;
    $('mail-nav-count').textContent=mails.filter(x=>!x.archived).length;
    $('metric-open').textContent=open;
    $('metric-waiting').textContent=waiting;
    $('metric-decisions').textContent=entries.filter(x=>x.kind==='decision'&&!x.archived).length;
    $('metric-mail').textContent=mails.filter(x=>!x.archived).length;
  }

  function renderChat(){
    const host=$('chat-feed');
    host.replaceChildren();
    if(!chat.length){
      const intro=el('div',undefined,'message assistant');
      intro.append(
        el('p','MINDS','message-label'),
        el('div','Ich bin mit deiner privaten Bernried-Memory verbunden. E-Mails werden bereits als durchsuchbare Quellen indexiert; externe Normenrecherche und ein LLM sind noch getrennt.','message-text')
      );
      host.append(intro);
      return;
    }

    chat.forEach(item=>{
      const box=el('div',undefined,'message '+item.role);
      box.append(
        el('p',item.role==='user'?'DU':'MINDS','message-label'),
        el('div',item.text,'message-text')
      );
      const extras=item.extras||{};
      if(extras.todo){
        const p=extras.todo;
        const card=el('div',undefined,'proposal');
        card.append(el('strong','Vorgeschlagenes To-Do'),el('div',p.title));
        if(p.due)card.append(el('small','Termin: '+dateLabel(p.due)));
        if(p.bucketName)card.append(el('small','Bucket: '+p.bucketName));
        card.append(action('Als To-Do speichern',async()=>{
          const now=new Date().toISOString();
          const bucket=buckets.find(x=>x.id===p.bucketId)||buckets[0];
          await saveEntry(M.entry({
            id:crypto.randomUUID(),kind:'task',state:'open',title:p.title,
            body:'Über MINDS vorgeschlagen.',alternatives:'',outcome:'',owner:'',
            due:p.due||'',reference:'MINDS conversation',source:null,
            bucketId:bucket?.id||'',sortOrder:0,priority:'normal',checklist:[],
            createdAt:now,updatedAt:now,archived:false
          }),'To-Do privat gespeichert.');
          const msg=await S.appendMessage('assistant','Gespeichert. Das To-Do liegt im Bucket „'+(bucket?.name||'Allgemein')+'“.',{});
          chat.push(msg);
          renderChat();
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
    return M.words(prompt).filter(word=>!ignore.has(word)).join(' ');
  }

  function isTodoIntent(text){
    const n=M.normalize(text);
    return /(to-?do|aufgabe|erinnere mich|füge|erstelle|anlegen|agrega|añade|crea|recu[eé]rdame)/.test(n) &&
      !/(was|welche|zeige|dime|cuales|cu[aá]les)/.test(n.slice(0,25));
  }

  function todoProposal(prompt){
    let title=prompt.replace(/^(bitte\s+)?(füge|erstelle|lege|agrega|añade|crea|recu[eé]rdame)(\s+mir)?(\s+(ein|eine|un))?(\s+to-?do|\s+aufgabe)?\s*(für|para)?\s*/i,'').trim();
    title=title.replace(/\b(morgen|mañana)\b/gi,'').replace(/\s{2,}/g,' ').trim();
    const named=buckets.find(bucket=>M.normalize(prompt).includes(M.normalize(bucket.name)));
    const bucket=named||buckets[0];
    return {
      title:title||prompt.trim(),
      due:/\b(morgen|mañana)\b/i.test(prompt)?tomorrow():'',
      bucketId:bucket?.id||'',
      bucketName:bucket?.name||'Allgemein'
    };
  }

  function entryText(item){
    return [labels[item.kind],item.title,item.body,item.owner,item.reference,item.outcome].filter(Boolean).join(' · ');
  }

  function mailText(item){
    return ['E-Mail',item.subject,item.sender,item.date?dateLabel(item.date):'',item.body.slice(0,600)].filter(Boolean).join(' · ');
  }

  async function answer(prompt){
    const n=M.normalize(prompt);

    if(isTodoIntent(prompt)){
      return {text:'Ich kann das als To-Do festhalten. Bitte bestätige den Vorschlag.',extras:{todo:todoProposal(prompt)}};
    }

    if(/(was ist.*offen|welche.*offen|pendient|to-?dos? offen|offene punkte)/.test(n)){
      const list=entries.filter(x=>x.kind==='task'&&!x.archived&&x.state!=='done')
        .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
      return {text:list.length
        ? 'Aktuell sind '+list.length+' To-Dos offen oder wartend:\n'+list.slice(0,8).map(x=>'• ['+bucketName(x.bucketId)+'] '+entryText(x)).join('\n')
        : 'Im Projektgedächtnis ist aktuell kein offenes To-Do erfasst.'};
    }

    if(/(warte|wartet|waiting|esperando|rückmeldung)/.test(n)){
      const list=entries.filter(x=>x.kind==='task'&&!x.archived&&x.state==='waiting');
      return {text:list.length
        ? 'Du wartest bei '+list.length+' Punkten auf Rückmeldung:\n'+list.slice(0,8).map(x=>'• ['+bucketName(x.bucketId)+'] '+entryText(x)).join('\n')
        : 'Ich finde derzeit kein To-Do mit Status „Wartet“. '};
    }

    if(/(entscheidung|entscheidungen|decisi[oó]n|decisiones)/.test(n)){
      const list=entries.filter(x=>x.kind==='decision'&&!x.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      return {text:list.length
        ? 'Letzte Entscheidungen:\n'+list.slice(0,6).map(x=>'• '+entryText(x)).join('\n')
        : 'Bisher ist keine Entscheidung erfasst.'};
    }

    if(/(fragen.*wieder|question.*signal|preguntas.*repet|fragensignal)/.test(n)){
      const s=M.questionSignals(entries),parts=[];
      if(s.repeated.length)parts.push('Wiederholt: '+s.repeated.map(x=>x.label+' ('+x.count+'×)').join(' · '));
      if(s.terms.length)parts.push('Wiederkehrende Begriffe: '+s.terms.map(x=>x.label+' ('+x.count+'×)').join(' · '));
      return {text:parts.length?parts.join('\n'):'Noch gibt es zu wenig wiederholte Fragen.'};
    }

    const query=intentWords(prompt)||prompt;
    const hits=M.searchProject(entries,mails,query);
    const wantsMail=/(mail|email|e-mail|correo|schrieb|geschrieben|dec[ií]a)/.test(n);
    const wantsReply=/(antwort|antworten|reply|responder|contestar)/.test(n);

    if(wantsMail&&hits.mails.length){
      const context=hits.mails.slice(0,4).map(x=>'• '+mailText(x)).join('\n');
      return {text:(wantsReply
        ? 'Ich habe passenden Mail-Kontext gefunden. Die LLM-Antwortfunktion ist noch nicht angeschlossen; der sichere Quellenkontext ist aber vorhanden.'
        : 'Passende private E-Mails:')+'\n'+context};
    }

    const combined=[
      ...hits.entries.slice(0,5).map(x=>'• '+entryText(x)),
      ...hits.mails.slice(0,3).map(x=>'• '+mailText(x))
    ];
    if(combined.length){
      return {text:'Ich finde dazu folgenden Kontext in deiner privaten Projektmemory:\n'+combined.join('\n')};
    }

    try{
      const chunkHits=await S.searchChunks(query,6);
      if(chunkHits.length){
        return {text:'Im Quellenindex finde ich dazu:\n'+chunkHits.map(hit=>{
          const loc=hit.locator||{};
          const where=[hit.sourceTitle,loc.sender,loc.date?dateLabel(loc.date):''].filter(Boolean).join(' · ');
          return '• ['+where+'] '+hit.content.slice(0,420)+(hit.content.length>420?'…':'');
        }).join('\n')};
      }
    }catch(error){
      console.warn('Chunk search failed',error);
    }

    if(/(din|norm|baybo|regel|anforder|treppe|stair)/.test(n)){
      return {text:'Dazu finde ich noch keine belastbare interne Quelle. „Beyond my memory“ und verifizierte Normenrecherche sind bewusst noch nicht angeschlossen.'};
    }
    return {text:'Dazu finde ich in deiner Projektmemory noch keinen belastbaren Kontext.'};
  }

  async function ask(prompt,storeSignal=true){
    if(!prompt.trim())return;
    const userMsg=await S.appendMessage('user',prompt.trim(),{mode:'memory'});
    chat.push(userMsg);
    renderChat();

    if(storeSignal){
      const now=new Date().toISOString();
      await saveEntry(M.entry({
        id:crypto.randomUUID(),kind:'question',state:'open',
        title:prompt.trim().slice(0,180),body:'Frage an MINDS//WORK',
        alternatives:'',outcome:'',owner:'',due:'',reference:'Assistant',source:null,
        bucketId:'',sortOrder:0,priority:'normal',checklist:[],
        createdAt:now,updatedAt:now,archived:false
      }),'');
    }

    const result=await answer(prompt.trim());
    const assistantMsg=await S.appendMessage('assistant',result.text,result.extras||{});
    chat.push(assistantMsg);
    renderAll();
  }

  function renderAssistantSide(){
    const next=$('assistant-next');
    next.replaceChildren();
    const list=entries.filter(x=>x.kind==='task'&&!x.archived&&x.state!=='done')
      .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,5);
    if(!list.length)next.append(el('p','Keine offenen To-Dos erfasst.','small'));
    list.forEach(item=>{
      const row=el('div',undefined,'mini-item');
      row.append(
        el('strong',item.title),
        el('span',item.state==='waiting'?'Wartet':(item.due?dateLabel(item.due):bucketName(item.bucketId)))
      );
      next.append(row);
    });

    const signals=$('question-signals');
    signals.replaceChildren();
    const s=M.questionSignals(entries);
    const all=[...s.repeated.map(x=>({label:x.label,count:x.count})),...s.terms].slice(0,5);
    if(!all.length)signals.append(el('p','Noch keine wiederkehrenden Signale.','small'));
    all.forEach(x=>{
      const row=el('div',undefined,'signal-row');
      row.append(el('span',x.label),el('strong',x.count+'×'));
      signals.append(row);
    });
  }

  function todoFiltered(){
    const q=$('todo-search')?.value||'';
    const filter=$('todo-status-filter')?.value||'active';
    return entries.filter(item=>{
      if(item.kind!=='task'||item.archived)return false;
      if(q && !M.matches(item,q))return false;
      if(filter==='active' && item.state==='done')return false;
      if(filter!=='active' && filter!=='all' && item.state!==filter)return false;
      return true;
    });
  }

  function taskChecklistMeta(item){
    const total=item.checklist?.length||0;
    if(!total)return '';
    const done=item.checklist.filter(x=>x.done).length;
    return done+'/'+total;
  }

  function taskCard(item){
    const card=el('article',undefined,'planner-task'+(item.state==='done'?' is-done':''));
    card.draggable=true;
    card.dataset.taskId=item.id;
    card.addEventListener('dragstart',event=>{
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',item.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));

    const main=el('div',undefined,'planner-task-main');
    const check=el('button',item.state==='done'?'✓':'','task-check');
    check.type='button';
    check.setAttribute('aria-label',item.state==='done'?'Wieder öffnen':'Als erledigt markieren');
    check.addEventListener('click',async event=>{
      event.stopPropagation();
      await saveEntry({...item,state:item.state==='done'?'open':'done',updatedAt:new Date().toISOString()},'');
    });
    const title=el('button',item.title,'task-title');
    title.type='button';
    title.addEventListener('click',()=>editEntry(item));
    main.append(check,title);
    card.append(main);

    if(item.body){
      const excerpt=el('p',item.body.length>140?item.body.slice(0,140)+'…':item.body,'task-excerpt');
      card.append(excerpt);
    }

    const meta=el('div',undefined,'planner-task-meta');
    if(item.state==='waiting')meta.append(el('span','Wartet','task-chip waiting'));
    if(item.priority==='urgent')meta.append(el('span','Dringend','task-chip urgent'));
    else if(item.priority==='important')meta.append(el('span','Wichtig','task-chip important'));
    if(item.due)meta.append(el('span','▣ '+dateLabel(item.due),'task-date'+(isOverdue(item)?' overdue':'')));
    const checklist=taskChecklistMeta(item);
    if(checklist)meta.append(el('span','☑ '+checklist,'task-smallmeta'));
    if(item.source)meta.append(el('span','⌕','task-smallmeta'));
    if(item.owner)meta.append(el('span',initials(item.owner),'task-avatar'));
    card.append(meta);
    return card;
  }

  function addTaskInline(bucket){
    const wrap=el('div',undefined,'bucket-add-wrap');
    const button=action('＋ Aufgabe hinzufügen',()=>openInline(),'bucket-add');
    const form=el('form',undefined,'bucket-quick-form');
    form.hidden=true;
    const input=document.createElement('input');
    input.type='text';input.maxLength=180;input.placeholder='Aufgabenname';
    const actions=el('div',undefined,'bucket-quick-actions');
    const add=el('button','Hinzufügen','small-primary');add.type='submit';
    const cancel=action('Abbrechen',()=>closeInline(),'quiet');
    actions.append(add,cancel);form.append(input,actions);

    function openInline(){button.hidden=true;form.hidden=false;input.focus();}
    function closeInline(){form.hidden=true;button.hidden=false;input.value='';}
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const title=input.value.trim();
      if(!title)return;
      const now=new Date().toISOString();
      const list=entries.filter(x=>x.kind==='task'&&x.bucketId===bucket.id);
      const max=list.reduce((m,x)=>Math.max(m,x.sortOrder||0),0);
      await saveEntry(M.entry({
        id:crypto.randomUUID(),kind:'task',state:'open',title,body:'',
        alternatives:'',outcome:'',owner:'',due:'',reference:'',source:null,
        bucketId:bucket.id,sortOrder:max+10,priority:'normal',checklist:[],
        createdAt:now,updatedAt:now,archived:false
      }),'');
      closeInline();
    });
    wrap.append(button,form);
    return wrap;
  }

  function bucketMenu(bucket){
    const wrap=el('div',undefined,'bucket-menu-wrap');
    const trigger=action('⋯',()=>{menu.hidden=!menu.hidden;},'bucket-menu-trigger');
    trigger.setAttribute('aria-label','Bucket-Menü');
    const menu=el('div',undefined,'bucket-menu');
    menu.hidden=true;
    menu.append(
      action('Umbenennen',()=>{menu.hidden=true;openBucketEditor(bucket);}),
      action('Nach links',async()=>{
        menu.hidden=true;
        const i=buckets.findIndex(x=>x.id===bucket.id);
        if(i<=0)return;
        const prev=buckets[i-1];
        const a=bucket.sortOrder,b=prev.sortOrder;
        await Promise.all([saveBucket({...bucket,sortOrder:b}),saveBucket({...prev,sortOrder:a})]);
        await refresh();
      }),
      action('Nach rechts',async()=>{
        menu.hidden=true;
        const i=buckets.findIndex(x=>x.id===bucket.id);
        if(i<0||i>=buckets.length-1)return;
        const next=buckets[i+1];
        const a=bucket.sortOrder,b=next.sortOrder;
        await Promise.all([saveBucket({...bucket,sortOrder:b}),saveBucket({...next,sortOrder:a})]);
        await refresh();
      }),
      action('Bucket archivieren',async()=>{
        menu.hidden=true;
        try{
          await S.archiveBucket(bucket.id);
          buckets=buckets.filter(x=>x.id!==bucket.id);
          renderTodos();
          feedback('Bucket archiviert.');
        }catch(error){feedback(error.message);}
      })
    );
    wrap.append(trigger,menu);
    return wrap;
  }

  function renderBoard(){
    const host=$('todo-board-view');
    host.replaceChildren();
    const tasks=todoFiltered();

    buckets.forEach(bucket=>{
      const column=el('section',undefined,'planner-bucket');
      column.dataset.bucketId=bucket.id;
      column.addEventListener('dragover',event=>{
        event.preventDefault();
        column.classList.add('drop-target');
      });
      column.addEventListener('dragleave',()=>column.classList.remove('drop-target'));
      column.addEventListener('drop',async event=>{
        event.preventDefault();
        column.classList.remove('drop-target');
        const taskId=event.dataTransfer.getData('text/plain');
        const item=entries.find(x=>x.id===taskId&&x.kind==='task');
        if(!item||item.bucketId===bucket.id)return;
        const max=entries.filter(x=>x.kind==='task'&&x.bucketId===bucket.id)
          .reduce((m,x)=>Math.max(m,x.sortOrder||0),0);
        await saveEntry({...item,bucketId:bucket.id,sortOrder:max+10,updatedAt:new Date().toISOString()},'Aufgabe verschoben.');
      });

      const header=el('div',undefined,'planner-bucket-head');
      const titleWrap=el('div',undefined,'planner-bucket-title');
      titleWrap.append(el('h3',bucket.name),el('span',String(tasks.filter(x=>x.bucketId===bucket.id).length),'bucket-count'));
      header.append(titleWrap,bucketMenu(bucket));
      column.append(header,addTaskInline(bucket));

      const list=el('div',undefined,'planner-bucket-tasks');
      const bucketTasks=tasks.filter(x=>x.bucketId===bucket.id)
        .sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||a.createdAt.localeCompare(b.createdAt));
      bucketTasks.forEach(item=>list.append(taskCard(item)));
      if(!bucketTasks.length)list.append(el('div','Keine Aufgaben','bucket-empty'));
      column.append(list);
      host.append(column);
    });

    const addColumn=el('section',undefined,'planner-add-bucket');
    addColumn.append(action('＋ Neuen Bucket hinzufügen',()=>openBucketEditor(null),'add-bucket-button'));
    host.append(addColumn);
  }

  function renderGrid(){
    const body=$('todo-grid-body');
    body.replaceChildren();
    const tasks=todoFiltered().sort((a,b)=>bucketName(a.bucketId).localeCompare(bucketName(b.bucketId))||(a.sortOrder||0)-(b.sortOrder||0));
    tasks.forEach(item=>{
      const tr=document.createElement('tr');
      const checkCell=document.createElement('td');
      const check=el('button',item.state==='done'?'✓':'','task-check');
      check.type='button';
      check.addEventListener('click',()=>saveEntry({...item,state:item.state==='done'?'open':'done',updatedAt:new Date().toISOString()},''));
      checkCell.append(check);
      const titleCell=document.createElement('td');
      const title=el('button',item.title,'grid-task-title');
      title.type='button';title.addEventListener('click',()=>editEntry(item));titleCell.append(title);
      for(const value of [bucketName(item.bucketId),states[item.state],priorities[item.priority]||'Normal',item.due?dateLabel(item.due):'',item.owner||'']){
        const td=document.createElement('td');td.textContent=value;tr.append(td);
      }
      tr.prepend(checkCell,titleCell);
      body.append(tr);
    });
    if(!tasks.length){
      const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=7;td.className='grid-empty';td.textContent='Keine passenden Aufgaben.';tr.append(td);body.append(tr);
    }
  }

  function renderTodos(){
    if(!$('todo-board-view'))return;
    $('todo-board-view').hidden=todoView!=='board';
    $('todo-grid-view').hidden=todoView!=='grid';
    $('todo-view-board').setAttribute('aria-pressed',String(todoView==='board'));
    $('todo-view-grid').setAttribute('aria-pressed',String(todoView==='grid'));
    renderBoard();
    renderGrid();
  }

  function renderMail(){
    const q=$('mail-search').value;
    const shown=mails.filter(x=>!x.archived&&M.mailMatches(x,q)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    $('mail-count').textContent=shown.length+' E-Mail'+(shown.length===1?'':'s');
    const host=$('mail-list');
    host.replaceChildren();
    if(!shown.length){
      host.append(el('div','Noch keine passende E-Mail in der privaten Memory.','empty'));
      return;
    }
    shown.forEach(item=>{
      const card=el('article',undefined,'mail-card');
      const head=el('div',undefined,'mail-card-head');
      head.append(
        el('div',item.sender||'Absender nicht erfasst','mail-sender'),
        el('div',item.date?dateLabel(item.date):'ohne Datum','mail-date')
      );
      card.append(head,el('h3',item.subject),el('p',item.body||'Kein Inhalt erfasst.','mail-body'));
      const actions=el('div',undefined,'card-actions');
      actions.append(
        action('MINDS dazu fragen',()=>{
          setScreen('assistant');
          $('ask-input').value='Was steht in der E-Mail „'+item.subject+'“?';
          $('ask-input').focus();
        }),
        action('Neu indexieren',async()=>{
          try{await S.indexMailText(item);feedback('E-Mail neu indexiert.');}catch(error){feedback(error.message);}
        }),
        action('Archivieren',async()=>{
          await saveMail({...item,archived:true,updatedAt:new Date().toISOString()});
        })
      );
      card.append(actions);
      host.append(card);
    });
  }

  function renderMemoryCard(item){
    const card=el('article',undefined,'entry');
    const head=el('div',undefined,'entry-head');
    head.append(el('span',labels[item.kind],'tag'),el('span',states[item.state],'state'));
    if(item.archived)head.append(el('span','Archiviert'));
    card.append(head,el('h3',item.title));
    if(item.body)card.append(el('p',item.body));
    if(item.kind==='task'&&item.bucketId)card.append(el('p','Bucket: '+bucketName(item.bucketId),'meta'));
    if(item.alternatives)card.append(el('p','Alternativen: '+item.alternatives));
    if(item.outcome)card.append(el('p','Auswirkungen: '+item.outcome));
    if(item.owner)card.append(el('p','Verantwortlich / beteiligt: '+item.owner,'meta'));
    if(item.due)card.append(el('p','Termin / Wiedervorlage: '+dateLabel(item.due),'meta'));
    if(item.source){const p=el('p','Quelle: ','meta');p.append(link(item.source));card.append(p);}
    if(item.reference)card.append(el('p','Fundstelle: '+item.reference,'meta'));
    const actions=el('div',undefined,'card-actions');
    actions.append(
      action('Bearbeiten',()=>editEntry(item)),
      action(item.archived?'Wiederherstellen':'Archivieren',()=>saveEntry({...item,archived:!item.archived,updatedAt:new Date().toISOString()},''))
    );
    card.append(actions);
    return card;
  }

  function renderSources(){
    const host=$('sources');
    host.replaceChildren();
    sources.forEach(source=>{
      const card=el('article',undefined,'source'),title=el('h3');
      title.append(link(source));
      card.append(
        title,
        el('p',source.meta||'Quellenverweis ohne Inhaltsprüfung'),
        el('p','Erfasst: '+dateLabel(source.capturedAt)+(source.version?' · Referenz: '+source.version:''))
      );
      host.append(card);
    });
  }

  function renderMemory(){
    const filter=$('memory-filter').value,isSources=filter==='sources';
    $('entries').hidden=isSources;
    $('source-panel').hidden=!isSources;
    if(isSources){
      $('result-summary').textContent=sources.length+' Quellenverweise';
      renderSources();
      return;
    }
    const archived=$('show-archived').checked,query=$('search').value;
    let shown=entries.filter(x=>x.archived===archived&&M.matches(x,query));
    if(filter!=='all')shown=shown.filter(x=>x.kind===filter);
    shown.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    $('result-summary').textContent=shown.length+' Eintr'+(shown.length===1?'ag':'äge');
    const host=$('entries');
    host.replaceChildren();
    if(!shown.length)host.append(el('div','Keine passenden Erinnerungen.','empty'));
    shown.forEach(item=>host.append(renderMemoryCard(item)));
  }

  function renderAll(){
    metrics();
    renderChat();
    renderAssistantSide();
    renderTodos();
    renderMail();
    renderMemory();
  }

  function fillSourceOptions(selected=originalSource){
    draftSources=sources.map(x=>({...x}));
    const select=$('entry-source');
    select.replaceChildren(new Option('Eigene Notiz · ohne Dokumentbeleg',''));
    if(selected)select.add(new Option(selected.title+' · gespeicherter Verweis','__snapshot'));
    draftSources.forEach((source,index)=>select.add(new Option(source.title,String(index))));
    select.value=selected?'__snapshot':'';
  }

  function fillBucketOptions(selected=''){
    const select=$('entry-bucket');
    if(!select)return;
    select.replaceChildren();
    buckets.forEach(bucket=>select.add(new Option(bucket.name,bucket.id)));
    select.value=selected&&buckets.some(x=>x.id===selected)?selected:(buckets[0]?.id||'');
  }

  function checklistText(item){
    return (item?.checklist||[]).map(x=>(x.done?'[x] ':'')+x.text).join('\n');
  }

  function parseChecklist(text,previous=[]){
    const byText=new Map(previous.map(x=>[M.normalize(x.text),x]));
    return String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).slice(0,100).map(line=>{
      const done=/^\[(x|✓)\]\s*/i.test(line);
      const clean=line.replace(/^\[(x|✓| )\]\s*/i,'').trim();
      const old=byText.get(M.normalize(clean));
      return {id:old?.id||crypto.randomUUID(),text:clean,done:old?old.done:done};
    });
  }

  function toggleTaskFields(){
    $('task-fields').hidden=$('entry-kind').value!=='task';
  }

  function editEntry(item=null,kind=null,presetBucket=''){
    editing=item;
    originalSource=item?.source||null;
    $('entry-form').reset();
    $('editor-title').textContent=item?'Eintrag bearbeiten':(kind==='task'?'Aufgabe':'Erinnerung erfassen');
    $('entry-kind').value=item?.kind||kind||'note';
    $('entry-state').value=item?.state||'open';
    for(const field of ['title','body','alternatives','outcome','owner','due','reference'])$('entry-'+field).value=item?.[field]||'';
    $('entry-priority').value=item?.priority||'normal';
    $('entry-checklist').value=checklistText(item);
    fillBucketOptions(item?.bucketId||presetBucket);
    fillSourceOptions();
    $('decision-fields').hidden=$('entry-kind').value!=='decision';
    toggleTaskFields();
    $('form-error').textContent='';
    $('editor').showModal();
    $('entry-title').focus();
  }

  function openBucketEditor(bucket=null){
    editingBucket=bucket;
    $('bucket-form').reset();
    $('bucket-editor-title').textContent=bucket?'Bucket umbenennen':'Neuen Bucket hinzufügen';
    $('bucket-name').value=bucket?.name||'';
    $('bucket-form-error').textContent='';
    $('bucket-editor').showModal();
    $('bucket-name').focus();
  }

  $('entry-kind').addEventListener('change',()=>{
    $('decision-fields').hidden=$('entry-kind').value!=='decision';
    toggleTaskFields();
  });

  $('entry-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const now=new Date().toISOString(),selected=$('entry-source').value;
      const isTask=$('entry-kind').value==='task';
      const draft={
        id:editing?.id||crypto.randomUUID(),
        createdAt:editing?.createdAt||now,
        updatedAt:now,
        kind:$('entry-kind').value,
        state:$('entry-state').value,
        archived:editing?.archived||false,
        source:selected==='__snapshot'?originalSource:selected===''?null:draftSources[Number(selected)],
        bucketId:isTask?$('entry-bucket').value:'',
        sortOrder:editing?.sortOrder||0,
        priority:isTask?$('entry-priority').value:'normal',
        checklist:isTask?parseChecklist($('entry-checklist').value,editing?.checklist||[]):[]
      };
      for(const field of ['title','body','alternatives','outcome','owner','due','reference'])draft[field]=$('entry-'+field).value.trim();
      await saveEntry(M.entry(draft));
      $('editor').close();
    }catch(error){
      $('form-error').textContent=error.message;
    }
  });

  $('bucket-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const name=$('bucket-name').value.trim();
      if(!name)throw new Error('Bucket braucht einen Namen.');
      const max=buckets.reduce((m,x)=>Math.max(m,x.sortOrder||0),0);
      await saveBucket({
        id:editingBucket?.id,
        name,
        sortOrder:editingBucket?.sortOrder ?? (max+10),
        archived:false,
        createdAt:editingBucket?.createdAt
      });
      $('bucket-editor').close();
      editingBucket=null;
    }catch(error){
      $('bucket-form-error').textContent=error.message;
    }
  });

  function openMailEditor(){
    $('mail-form').reset();
    $('mail-date').value=M.todayLocal();
    $('mail-form-error').textContent='';
    $('mail-editor').showModal();
    $('mail-sender').focus();
  }

  $('mail-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const now=new Date().toISOString();
      const value=M.mail({
        id:crypto.randomUUID(),
        sender:$('mail-sender').value.trim(),
        recipients:$('mail-recipients').value.trim(),
        subject:$('mail-subject').value.trim(),
        body:$('mail-body').value.trim(),
        date:$('mail-date').value,
        messageId:'',threadKey:'',
        createdAt:now,updatedAt:now,archived:false
      });
      await saveMail(value,[...$('mail-files').files]);
      $('mail-editor').close();
    }catch(error){
      $('mail-form-error').textContent=error.message;
    }
  });

  $('ask-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const prompt=$('ask-input').value.trim();
    if(!prompt)return;
    $('ask-input').value='';
    try{await ask(prompt,true);}catch(error){feedback(error.message);}
  });

  document.querySelectorAll('[data-prompt]').forEach(button=>{
    button.addEventListener('click',()=>ask(button.dataset.prompt,true).catch(error=>feedback(error.message)));
  });

  $('clear-chat').addEventListener('click',async()=>{
    try{
      await S.newConversation();
      chat=[];
      renderChat();
      feedback('Neue Arbeitskonversation gestartet.');
    }catch(error){feedback(error.message);}
  });

  document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>setScreen(button.dataset.screen)));
  document.querySelectorAll('[data-todo-view]').forEach(button=>button.addEventListener('click',()=>{
    todoView=button.dataset.todoView;
    renderTodos();
  }));

  $('new-todo').addEventListener('click',()=>editEntry(null,'task',buckets[0]?.id||''));
  $('new-entry').addEventListener('click',()=>editEntry(null,'note'));
  $('new-mail').addEventListener('click',openMailEditor);
  $('todo-search').addEventListener('input',renderTodos);
  $('todo-status-filter').addEventListener('change',renderTodos);

  for(const id of ['close-editor','cancel-editor'])$(id).addEventListener('click',()=>$('editor').close());
  for(const id of ['close-mail-editor','cancel-mail-editor'])$(id).addEventListener('click',()=>$('mail-editor').close());
  for(const id of ['close-bucket-editor','cancel-bucket-editor'])$(id).addEventListener('click',()=>$('bucket-editor').close());

  $('mail-search').addEventListener('input',renderMail);
  $('search').addEventListener('input',renderMemory);
  $('memory-filter').addEventListener('change',renderMemory);
  $('show-archived').addEventListener('change',renderMemory);

  function download(text,filename){
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  $('export').addEventListener('click',()=>{
    download(JSON.stringify({
      schemaVersion:4,project:'bernried',exportedAt:new Date().toISOString(),entries,mails,buckets,chat
    },null,2),'minds-work-bernried-'+M.todayLocal()+'.json');
  });

  $('import').addEventListener('change',async event=>{
    const file=event.target.files[0];
    try{
      if(!file)return;
      const data=JSON.parse(await file.text());
      if(data?.project!=='bernried')throw new Error('Falsches Projekt.');
      for(const bucket of data.buckets||[])await saveBucket(bucket);
      for(const entry of data.entries||[])await saveEntry(M.entry(entry),'');
      for(const mail of data.mails||[])await saveMail(M.mail(mail));
      await refresh();
      feedback('Backup in private Memory importiert.');
    }catch(error){
      feedback('Import abgebrochen: '+error.message);
    }finally{event.target.value='';}
  });

  function acceptContext(context){
    if(context.project!=='bernried'||!Array.isArray(context.sources)||context.sources.length>500)return;
    try{
      sources=context.sources.map(M.source);
      $('project-name').textContent=String(context.projectName||'Bernried').slice(0,200);
      $('source-note').textContent=String(context.note||'').slice(0,1000);
      hubContext=true;
      if(!$('editor').open)fillSourceOptions();
      renderAll();
    }catch(error){feedback('Quellen konnten nicht übernommen werden: '+error.message);}
  }

  function requestContext(){
    if(window.parent!==window)window.parent.postMessage({type:'minds:request-context'},location.origin);
  }

  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='minds:context')return;
    acceptContext(event.data);
  });

  $('refresh-sources').addEventListener('click',requestContext);

  async function migrateLocalOnce(){
    if(localStorage.getItem('minds_work_bernried_supabase_migrated_v1')==='1')return;
    let localEntries=[],localMails=[];
    try{const raw=localStorage.getItem(M.KEY);if(raw)localEntries=M.parse(raw);}catch{}
    try{const raw=localStorage.getItem(M.MAIL_KEY);if(raw)localMails=M.parseMails(raw);}catch{}
    if(!localEntries.length&&!localMails.length){
      localStorage.setItem('minds_work_bernried_supabase_migrated_v1','1');
      return;
    }
    const result=await S.migrateLocal(localEntries,localMails);
    localStorage.setItem('minds_work_bernried_supabase_migrated_v1','1');
    feedback('Lokale Pilotdaten migriert: '+result.entries+' Memory, '+result.mails+' Mails.');
  }

  async function indexExistingMailOnce(){
    if(localStorage.getItem('minds_work_bernried_mail_indexed_v1')==='1')return;
    for(const mail of mails){
      if(mail.archived || !mail.body.trim())continue;
      await S.indexMailText(mail);
    }
    localStorage.setItem('minds_work_bernried_mail_indexed_v1','1');
  }

  async function boot(){
    try{
      setBusy(true);
      await S.init();
      await migrateLocalOnce();
      await refresh();
      await indexExistingMailOnce();
      requestContext();
      fetch('sources.json').then(r=>r.ok?r.json():null).then(context=>{
        if(context&&!hubContext)acceptContext(context);
      }).catch(()=>{});
      const label=document.querySelector('.pilot-label');
      label.replaceChildren(el('span',undefined,'dot'),document.createTextNode(' Pilot 0.4 · Planner Board + indexed memory'));
    }catch(error){
      const box=el('div',undefined,'notice');
      box.append(el('strong','MINDS konnte nicht geöffnet werden.'),document.createElement('br'),document.createTextNode(error.message));
      $('feedback').replaceChildren();
      document.querySelector('.workspace').replaceChildren(box);
    }finally{setBusy(false);}
  }

  boot();
})();
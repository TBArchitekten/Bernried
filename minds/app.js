(() => {
  'use strict';

  const M = window.MindsCore;
  const S = window.MindsStore;
  const $ = id => document.getElementById(id);

  const labels = {task:'To-Do',decision:'Entscheidung',lesson:'Erfahrung / Fehler',procedure:'Vorgehensweise',question:'AI-Frage',note:'Notiz'};
  const states = {open:'Nicht begonnen',progress:'In Bearbeitung',waiting:'Wartet',done:'Abgeschlossen'};
  const priorities = {urgent:'Dringend',important:'Wichtig',medium:'Mittel',low:'Niedrig'};
  const recurrences = {none:'Wiederholt sich nicht',daily:'Täglich',weekdays:'Wochentage',weekly:'Wöchentlich',monthly:'Monatlich',yearly:'Jährlich'};
  const labelColors = ['sage','blue','violet','amber','rose','slate'];

  let entries=[], mails=[], buckets=[], sources=[], draftSources=[], chat=[];
  let editing=null, originalSource=null, hubContext=false, busy=false;
  let taskEditing=null, taskChecklistDraft=[], taskComments=[], taskFiles=[];
  let editingBucket=null, todoView='board', calendarDate=new Date();

  function el(tag,text,className){
    const n=document.createElement(tag);
    if(text!==undefined)n.textContent=text;
    if(className)n.className=className;
    return n;
  }

  function feedback(message){
    $('feedback').textContent=message||'';
    if(message)setTimeout(()=>{if($('feedback').textContent===message)$('feedback').textContent='';},5000);
  }

  function dateLabel(value){
    return value ? new Date(value.length===10?value+'T12:00:00':value).toLocaleDateString('de-DE') : '';
  }

  function stampLabel(value){
    return value ? new Date(value).toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}) : '';
  }

  function today(){return M.todayLocal();}
  function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);return M.todayLocal(d);}
  function isOverdue(item){return item.due&&item.state!=='done'&&item.due<today();}
  function initials(value){
    const parts=String(value||'').trim().split(/\s+/).filter(Boolean);
    return parts.length?parts.slice(0,2).map(x=>x[0]?.toUpperCase()||'').join(''):'';
  }

  function link(source){
    const a=el('a',source.title+' ↗');
    a.href=M.source(source).url;a.target='_blank';a.rel='noopener noreferrer';
    return a;
  }

  function action(text,fn,className=''){
    const n=el('button',text,className);n.type='button';n.addEventListener('click',fn);n.disabled=busy;return n;
  }

  function bucketName(id){return buckets.find(x=>x.id===id)?.name||'Allgemein';}
  function activeTasks(){return entries.filter(x=>x.kind==='task'&&!x.archived);}

  async function refresh(){
    [entries,mails,buckets,chat]=await Promise.all([S.loadEntries(),S.loadMails(),S.loadBuckets(),S.loadMessages()]);
    if(!buckets.length){
      const saved=await S.saveBucket({name:'Allgemein',sortOrder:0,archived:false});
      buckets=[saved];
    }
    renderAll();
  }

  async function saveEntry(value,message='Gespeichert.'){
    try{
      const saved=await S.saveEntry(value);
      const i=entries.findIndex(x=>x.id===saved.id);
      if(i>=0)entries[i]=saved;else entries.unshift(saved);
      renderAll();if(message)feedback(message);return saved;
    }catch(error){feedback(error.message);throw error;}
  }

  async function saveMail(value,files=[]){
    try{
      const saved=await S.saveMail(value);
      for(const file of files)await S.uploadMailFile(saved.id,file);
      const i=mails.findIndex(x=>x.id===saved.id);
      if(i>=0)mails[i]=saved;else mails.unshift(saved);
      renderAll();feedback(files.length?'E-Mail + '+files.length+' Anlagen gespeichert.':'E-Mail gespeichert.');
      return saved;
    }catch(error){feedback(error.message);throw error;}
  }

  async function saveBucket(value){
    const saved=await S.saveBucket(value);
    const i=buckets.findIndex(x=>x.id===saved.id);
    if(i>=0)buckets[i]=saved;else buckets.push(saved);
    buckets.sort((a,b)=>a.sortOrder-b.sortOrder||a.createdAt.localeCompare(b.createdAt));
    renderTodos();return saved;
  }

  function setScreen(name){
    document.querySelectorAll('.screen').forEach(node=>{
      const active=node.id==='screen-'+name;node.hidden=!active;node.classList.toggle('active',active);
    });
    document.querySelectorAll('[data-screen]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.screen===name)));
    if(name==='assistant')$('ask-input').focus();
    renderAll();
  }

  function metrics(){
    const tasks=activeTasks(),open=tasks.filter(x=>x.state==='open'||x.state==='progress').length,waiting=tasks.filter(x=>x.state==='waiting').length;
    $('open-count').textContent=open+waiting;$('mail-nav-count').textContent=mails.filter(x=>!x.archived).length;
    $('metric-open').textContent=open;$('metric-waiting').textContent=waiting;
    $('metric-decisions').textContent=entries.filter(x=>x.kind==='decision'&&!x.archived).length;
    $('metric-mail').textContent=mails.filter(x=>!x.archived).length;
  }

  function renderChat(){
    const host=$('chat-feed');host.replaceChildren();
    if(!chat.length){
      const intro=el('div',undefined,'message assistant');
      intro.append(el('p','MINDS','message-label'),el('div','Ich bin mit deiner privaten Bernried-Memory verbunden. E-Mails werden als Quellen indexiert; externe Normenrecherche und ein LLM folgen als getrennte Schicht.','message-text'));
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
        card.append(el('small','Bucket: '+(p.bucketName||'Allgemein')));
        card.append(action('Als To-Do speichern',async()=>{
          await createTaskFast(p.title,p.bucketId||buckets[0]?.id||'',{due:p.due||''});
          const msg=await S.appendMessage('assistant','Gespeichert. Das To-Do liegt im Bucket „'+(p.bucketName||'Allgemein')+'“.',{});
          chat.push(msg);renderChat();
        },'small-primary'));
        box.append(card);
      }
      host.append(box);
    });
    host.scrollTop=host.scrollHeight;
  }

  function intentWords(prompt){
    const ignore=new Set(['email','mail','e-mail','herr','frau','tema','thema','steht','stand','sagte','schrieb','geschrieben','ayudame','ayúdame','antwort','antworten','responder','sobre','decía','decia','dazu','darin','diesem','dieser','projekt','minds','bitte','kannst','puedes','quiero','saber','what','said','about','please']);
    return M.words(prompt).filter(word=>!ignore.has(word)).join(' ');
  }

  function isTodoIntent(text){
    const n=M.normalize(text);
    return /(to-?do|aufgabe|erinnere mich|füge|erstelle|anlegen|agrega|añade|crea|recu[eé]rdame)/.test(n)&&!/(was|welche|zeige|dime|cuales|cu[aá]les)/.test(n.slice(0,25));
  }

  function todoProposal(prompt){
    let title=prompt.replace(/^(bitte\s+)?(füge|erstelle|lege|agrega|añade|crea|recu[eé]rdame)(\s+mir)?(\s+(ein|eine|un))?(\s+to-?do|\s+aufgabe)?\s*(für|para)?\s*/i,'').trim();
    title=title.replace(/\b(morgen|mañana)\b/gi,'').replace(/\s{2,}/g,' ').trim();
    const named=buckets.find(bucket=>M.normalize(prompt).includes(M.normalize(bucket.name))),bucket=named||buckets[0];
    return {title:title||prompt.trim(),due:/\b(morgen|mañana)\b/i.test(prompt)?tomorrow():'',bucketId:bucket?.id||'',bucketName:bucket?.name||'Allgemein'};
  }

  function entryText(item){return [labels[item.kind],item.title,item.body,item.owner,item.reference,item.outcome].filter(Boolean).join(' · ');}
  function mailText(item){return ['E-Mail',item.subject,item.sender,item.date?dateLabel(item.date):'',item.body.slice(0,600)].filter(Boolean).join(' · ');}

  async function answer(prompt){
    const n=M.normalize(prompt);
    if(isTodoIntent(prompt))return {text:'Ich kann das als To-Do festhalten. Bitte bestätige den Vorschlag.',extras:{todo:todoProposal(prompt)}};
    if(/(was ist.*offen|welche.*offen|pendient|to-?dos? offen|offene punkte)/.test(n)){
      const list=activeTasks().filter(x=>x.state!=='done').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
      return {text:list.length?'Aktuell sind '+list.length+' To-Dos aktiv:\n'+list.slice(0,10).map(x=>'• ['+bucketName(x.bucketId)+'] '+entryText(x)).join('\n'):'Aktuell ist kein offenes To-Do erfasst.'};
    }
    if(/(warte|wartet|waiting|esperando|rückmeldung)/.test(n)){
      const list=activeTasks().filter(x=>x.state==='waiting');
      return {text:list.length?'Du wartest bei '+list.length+' Punkten auf Rückmeldung:\n'+list.slice(0,10).map(x=>'• ['+bucketName(x.bucketId)+'] '+entryText(x)).join('\n'):'Kein To-Do steht derzeit auf „Wartet“. '};
    }
    if(/(entscheidung|entscheidungen|decisi[oó]n|decisiones)/.test(n)){
      const list=entries.filter(x=>x.kind==='decision'&&!x.archived).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
      return {text:list.length?'Letzte Entscheidungen:\n'+list.slice(0,8).map(x=>'• '+entryText(x)).join('\n'):'Bisher ist keine Entscheidung erfasst.'};
    }
    if(/(fragen.*wieder|question.*signal|preguntas.*repet|fragensignal)/.test(n)){
      const s=M.questionSignals(entries),parts=[];
      if(s.repeated.length)parts.push('Wiederholt: '+s.repeated.map(x=>x.label+' ('+x.count+'×)').join(' · '));
      if(s.terms.length)parts.push('Wiederkehrende Begriffe: '+s.terms.map(x=>x.label+' ('+x.count+'×)').join(' · '));
      return {text:parts.length?parts.join('\n'):'Noch gibt es zu wenig wiederholte Fragen.'};
    }

    const query=intentWords(prompt)||prompt,hits=M.searchProject(entries,mails,query);
    const wantsMail=/(mail|email|e-mail|correo|schrieb|geschrieben|dec[ií]a)/.test(n);
    const wantsReply=/(antwort|antworten|reply|responder|contestar)/.test(n);
    if(wantsMail&&hits.mails.length){
      const context=hits.mails.slice(0,5).map(x=>'• '+mailText(x)).join('\n');
      return {text:(wantsReply?'Ich habe passenden Mail-Kontext gefunden. Die eigentliche LLM-Antwortfunktion ist noch nicht angeschlossen.':'Passende private E-Mails:')+'\n'+context};
    }
    const combined=[...hits.entries.slice(0,6).map(x=>'• '+entryText(x)),...hits.mails.slice(0,4).map(x=>'• '+mailText(x))];
    if(combined.length)return {text:'Ich finde dazu folgenden Kontext in deiner Projektmemory:\n'+combined.join('\n')};

    try{
      const chunkHits=await S.searchChunks(query,8);
      if(chunkHits.length){
        return {text:'Im Quellenindex finde ich dazu:\n'+chunkHits.map(hit=>{
          const loc=hit.locator||{},where=[hit.sourceTitle,loc.sender,loc.date?dateLabel(loc.date):''].filter(Boolean).join(' · ');
          return '• ['+where+'] '+hit.content.slice(0,520)+(hit.content.length>520?'…':'');
        }).join('\n')};
      }
    }catch(error){console.warn('Chunk search failed',error);}

    if(/(din|norm|baybo|regel|anforder|treppe|stair)/.test(n))return {text:'Dazu finde ich noch keine belastbare interne Quelle. „Beyond my memory“ und verifizierte Normenrecherche sind bewusst noch nicht angeschlossen.'};
    return {text:'Dazu finde ich in deiner Projektmemory noch keinen belastbaren Kontext.'};
  }

  async function ask(prompt,storeSignal=true){
    if(!prompt.trim())return;
    const userMsg=await S.appendMessage('user',prompt.trim(),{mode:'memory'});chat.push(userMsg);renderChat();
    if(storeSignal){
      const now=new Date().toISOString();
      await saveEntry(M.entry({id:crypto.randomUUID(),kind:'question',state:'open',title:prompt.trim().slice(0,180),body:'Frage an MINDS//WORK',alternatives:'',outcome:'',owner:'',due:'',reference:'Assistant',source:null,bucketId:'',sortOrder:0,priority:'medium',startDate:'',recurrence:'none',labels:[],showOnCard:false,checklist:[],createdAt:now,updatedAt:now,archived:false}),'');
    }
    const result=await answer(prompt.trim()),assistantMsg=await S.appendMessage('assistant',result.text,result.extras||{});
    chat.push(assistantMsg);renderAll();
  }

  function renderAssistantSide(){
    const next=$('assistant-next');next.replaceChildren();
    const list=activeTasks().filter(x=>x.state!=='done').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')).slice(0,6);
    if(!list.length)next.append(el('p','Keine offenen To-Dos erfasst.','small'));
    list.forEach(item=>{
      const row=el('div',undefined,'mini-item');
      row.append(el('strong',item.title),el('span',item.state==='waiting'?'Wartet':(item.due?dateLabel(item.due):bucketName(item.bucketId))));
      next.append(row);
    });
    const signals=$('question-signals');signals.replaceChildren();const s=M.questionSignals(entries);
    const all=[...s.repeated.map(x=>({label:x.label,count:x.count})),...s.terms].slice(0,5);
    if(!all.length)signals.append(el('p','Noch keine wiederkehrenden Signale.','small'));
    all.forEach(x=>{const row=el('div',undefined,'signal-row');row.append(el('span',x.label),el('strong',x.count+'×'));signals.append(row);});
  }

  function todoFiltered(){
    const q=$('todo-search')?.value||'';
    const status=$('todo-status-filter')?.value||'active';
    const priority=$('todo-priority-filter')?.value||'all';
    const bucket=$('todo-bucket-filter')?.value||'all';
    const owner=$('todo-owner-filter')?.value||'all';
    const label=$('todo-label-filter')?.value||'all';
    const due=$('todo-due-filter')?.value||'all';
    return activeTasks().filter(item=>{
      if(q&&!M.matches(item,q))return false;
      if(status==='active'&&item.state==='done')return false;
      if(status!=='active'&&status!=='all'&&item.state!==status)return false;
      if(priority!=='all'&&item.priority!==priority)return false;
      if(bucket!=='all'&&item.bucketId!==bucket)return false;
      if(owner!=='all'&&(owner==='__none'?!item.owner.trim():item.owner.trim()!==owner))return false;
      if(label!=='all'&&(label==='__none'?Boolean((item.labels||[]).length):!(item.labels||[]).some(x=>x.name===label)))return false;
      if(due!=='all'&&dueGroup(item)!==due)return false;
      return true;
    });
  }

  function refillSelect(select,items,placeholder='Alle'){
    if(!select)return;
    const current=select.value;
    select.replaceChildren(new Option(placeholder,'all'));
    items.forEach(item=>select.add(new Option(item.label,item.value)));
    if([...select.options].some(option=>option.value===current))select.value=current;
  }

  function renderTodoFilterOptions(){
    refillSelect($('todo-bucket-filter'),buckets.map(x=>({value:x.id,label:x.name})));
    const owners=[...new Set(activeTasks().map(x=>x.owner.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')).map(x=>({value:x,label:x}));
    owners.push({value:'__none',label:'Nicht zugewiesen'});
    refillSelect($('todo-owner-filter'),owners);
    const names=[...new Set(activeTasks().flatMap(x=>(x.labels||[]).map(l=>l.name)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')).map(x=>({value:x,label:x}));
    names.push({value:'__none',label:'Ohne Bezeichnung'});
    refillSelect($('todo-label-filter'),names);
  }

  function dueGroup(item){
    if(!item.due)return 'none';
    if(item.due<today()&&item.state!=='done')return 'overdue';
    if(item.due===today())return 'today';
    const d=new Date(today()+'T12:00:00');d.setDate(d.getDate()+7);
    if(item.due<=M.todayLocal(d))return 'week';
    return 'later';
  }

  function boardGroups(){
    const mode=$('todo-group-by')?.value||'bucket';
    if(mode==='bucket')return buckets.map(b=>({id:b.id,label:b.name,kind:'bucket'}));
    if(mode==='state')return [
      {id:'open',label:'Nicht begonnen',kind:'state'},{id:'progress',label:'In Bearbeitung',kind:'state'},
      {id:'waiting',label:'Wartet',kind:'state'},{id:'done',label:'Abgeschlossen',kind:'state'}
    ];
    if(mode==='priority')return [
      {id:'urgent',label:'Dringend',kind:'priority'},{id:'important',label:'Wichtig',kind:'priority'},
      {id:'medium',label:'Mittel',kind:'priority'},{id:'low',label:'Niedrig',kind:'priority'}
    ];
    if(mode==='owner'){
      const owners=[...new Set(activeTasks().map(x=>x.owner.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
      return [...owners.map(name=>({id:name,label:name,kind:'owner'})),{id:'__none',label:'Nicht zugewiesen',kind:'owner'}];
    }
    if(mode==='label'){
      const names=[...new Set(activeTasks().flatMap(x=>(x.labels||[]).map(l=>l.name)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
      return [...names.map(name=>({id:name,label:name,kind:'label'})),{id:'__none',label:'Ohne Bezeichnung',kind:'label'}];
    }
    return [
      {id:'overdue',label:'Überfällig',kind:'due'},{id:'today',label:'Heute',kind:'due'},
      {id:'week',label:'Nächste 7 Tage',kind:'due'},{id:'later',label:'Später',kind:'due'},{id:'none',label:'Ohne Termin',kind:'due'}
    ];
  }

  function groupMatches(item,group){
    if(group.kind==='bucket')return item.bucketId===group.id;
    if(group.kind==='state')return item.state===group.id;
    if(group.kind==='priority')return item.priority===group.id;
    if(group.kind==='owner')return group.id==='__none'?!item.owner.trim():item.owner.trim()===group.id;
    if(group.kind==='label')return group.id==='__none'?!(item.labels||[]).length:(item.labels||[]).some(label=>label.name===group.id);
    return dueGroup(item)===group.id;
  }

  function taskChecklistMeta(item){
    const total=item.checklist?.length||0;if(!total)return '';
    return item.checklist.filter(x=>x.done).length+'/'+total;
  }

  function labelChip(item,index){
    const chip=el('span',item.name,'task-label label-'+(item.color||labelColors[index%labelColors.length]));
    return chip;
  }

  function taskCard(item){
    const card=el('article',undefined,'planner-task'+(item.state==='done'?' is-done':''));
    card.draggable=true;card.dataset.taskId=item.id;
    card.addEventListener('dragstart',event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);card.classList.add('dragging');});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));

    if(item.labels?.length){
      const chips=el('div',undefined,'task-labels');
      item.labels.slice(0,5).forEach((x,i)=>chips.append(labelChip(x,i)));card.append(chips);
    }

    const main=el('div',undefined,'planner-task-main'),check=el('button',item.state==='done'?'✓':'','task-check');
    check.type='button';check.setAttribute('aria-label',item.state==='done'?'Wieder öffnen':'Als abgeschlossen markieren');
    check.addEventListener('click',async event=>{event.stopPropagation();if(item.state==='done')await saveEntry({...item,state:'open',updatedAt:new Date().toISOString()},'');else await completeTask(item);});
    const title=el('button',item.title,'task-title');title.type='button';title.addEventListener('click',()=>openTaskDetail(item));
    main.append(check,title);card.append(main);

    if(item.showOnCard&&item.body)card.append(el('p',item.body.length>180?item.body.slice(0,180)+'…':item.body,'task-excerpt'));

    const meta=el('div',undefined,'planner-task-meta');
    if(item.state==='progress')meta.append(el('span','In Bearbeitung','task-chip progress'));
    if(item.state==='waiting')meta.append(el('span','Wartet','task-chip waiting'));
    if(item.priority==='urgent')meta.append(el('span','Dringend','task-chip urgent'));
    else if(item.priority==='important')meta.append(el('span','Wichtig','task-chip important'));
    if(item.due)meta.append(el('span','▣ '+dateLabel(item.due),'task-date'+(isOverdue(item)?' overdue':'')));
    if(item.recurrence&&item.recurrence!=='none')meta.append(el('span','↻','task-smallmeta'));
    const checklist=taskChecklistMeta(item);if(checklist)meta.append(el('span','☑ '+checklist,'task-smallmeta'));
    if(item.source)meta.append(el('span','⌕','task-smallmeta'));
    if(item.owner)meta.append(el('span',initials(item.owner),'task-avatar'));
    card.append(meta);return card;
  }

  async function createTaskFast(title,bucketId,overrides={}){
    const now=new Date().toISOString(),id=crypto.randomUUID();
    const list=entries.filter(x=>x.kind==='task'&&x.bucketId===bucketId),max=list.reduce((m,x)=>Math.max(m,x.sortOrder||0),0);
    const task=M.entry({id,kind:'task',state:'open',title,body:'',alternatives:'',outcome:'',owner:'',due:'',reference:'',source:null,bucketId:bucketId||buckets[0]?.id||'',sortOrder:max+10,priority:'medium',startDate:'',recurrence:'none',labels:[],showOnCard:false,checklist:[],createdAt:now,updatedAt:now,archived:false,...overrides});
    entries.unshift(task);renderAll();
    try{
      const saved=await S.saveEntry(task),i=entries.findIndex(x=>x.id===id);if(i>=0)entries[i]=saved;renderAll();return saved;
    }catch(error){
      entries=entries.filter(x=>x.id!==id);renderAll();feedback('Aufgabe nicht gespeichert: '+error.message);throw error;
    }
  }

  function addTaskInline(group){
    const wrap=el('div',undefined,'bucket-add-wrap'),button=action('＋ Aufgabe hinzufügen',()=>openInline(),'bucket-add');
    const form=el('form',undefined,'bucket-quick-form');form.hidden=true;
    const input=document.createElement('input');input.type='text';input.maxLength=180;input.placeholder='Aufgabenname';
    const actions=el('div',undefined,'bucket-quick-actions'),add=el('button','Hinzufügen','small-primary');add.type='submit',cancel=action('Abbrechen',()=>closeInline(),'quiet');
    actions.append(add,cancel);form.append(input,actions);
    function openInline(){button.hidden=true;form.hidden=false;input.focus();}
    function closeInline(){form.hidden=true;button.hidden=false;input.value='';}
    form.addEventListener('submit',event=>{
      event.preventDefault();const title=input.value.trim();if(!title)return;
      closeInline();
      const bucketId=group.kind==='bucket'?group.id:(buckets[0]?.id||'');
      const overrides={};
      if(group.kind==='state')overrides.state=group.id;
      if(group.kind==='priority')overrides.priority=group.id;
      if(group.kind==='owner'&&group.id!=='__none')overrides.owner=group.id;
      if(group.kind==='label'&&group.id!=='__none')overrides.labels=[{id:crypto.randomUUID(),name:group.id,color:'sage'}];
      if(group.kind==='due'&&group.id==='today')overrides.due=today();
      createTaskFast(title,bucketId,overrides).catch(()=>{});
    });
    wrap.append(button,form);return wrap;
  }

  function bucketMenu(group){
    if(group.kind!=='bucket')return el('span','');
    const bucket=buckets.find(x=>x.id===group.id),wrap=el('div',undefined,'bucket-menu-wrap'),trigger=action('⋯',()=>{menu.hidden=!menu.hidden;},'bucket-menu-trigger');
    const menu=el('div',undefined,'bucket-menu');menu.hidden=true;
    menu.append(
      action('Umbenennen',()=>{menu.hidden=true;openBucketEditor(bucket);}),
      action('Nach links',async()=>{menu.hidden=true;const i=buckets.findIndex(x=>x.id===bucket.id);if(i<=0)return;const prev=buckets[i-1],a=bucket.sortOrder,b=prev.sortOrder;await Promise.all([saveBucket({...bucket,sortOrder:b}),saveBucket({...prev,sortOrder:a})]);await refresh();}),
      action('Nach rechts',async()=>{menu.hidden=true;const i=buckets.findIndex(x=>x.id===bucket.id);if(i<0||i>=buckets.length-1)return;const next=buckets[i+1],a=bucket.sortOrder,b=next.sortOrder;await Promise.all([saveBucket({...bucket,sortOrder:b}),saveBucket({...next,sortOrder:a})]);await refresh();}),
      action('Bucket archivieren',async()=>{menu.hidden=true;try{await S.archiveBucket(bucket.id);buckets=buckets.filter(x=>x.id!==bucket.id);renderTodos();}catch(error){feedback(error.message);}})
    );
    wrap.append(trigger,menu);return wrap;
  }

  async function dropTaskToGroup(item,group){
    if(group.kind==='bucket')return saveEntry({...item,bucketId:group.id,updatedAt:new Date().toISOString()},'Aufgabe verschoben.');
    if(group.kind==='state'){
      if(group.id==='done'&&item.state!=='done')return completeTask(item);
      return saveEntry({...item,state:group.id,updatedAt:new Date().toISOString()},'Status geändert.');
    }
    if(group.kind==='priority')return saveEntry({...item,priority:group.id,updatedAt:new Date().toISOString()},'Priorität geändert.');
    if(group.kind==='owner')return saveEntry({...item,owner:group.id==='__none'?'':group.id,updatedAt:new Date().toISOString()},'Zuweisung geändert.');
    if(group.kind==='label'){
      const labelsNow=[...(item.labels||[])];
      const next=group.id==='__none'?[]:(labelsNow.some(x=>x.name===group.id)?labelsNow:[...labelsNow,{id:crypto.randomUUID(),name:group.id,color:labelColors[labelsNow.length%labelColors.length]}]);
      return saveEntry({...item,labels:next,updatedAt:new Date().toISOString()},'Bezeichnung geändert.');
    }
    if(group.kind==='due'){
      let due=item.due;
      if(group.id==='none')due='';
      else if(group.id==='today')due=today();
      else if(group.id==='week'){const d=new Date();d.setDate(d.getDate()+7);due=M.todayLocal(d);}
      else if(group.id==='later'){const d=new Date();d.setDate(d.getDate()+14);due=M.todayLocal(d);}
      else if(group.id==='overdue'){const d=new Date();d.setDate(d.getDate()-1);due=M.todayLocal(d);}
      return saveEntry({...item,due,updatedAt:new Date().toISOString()},'Fälligkeit geändert.');
    }
  }

  function renderBoard(){
    const host=$('todo-board-view');host.replaceChildren();const tasks=todoFiltered(),groups=boardGroups();
    groups.forEach(group=>{
      const column=el('section',undefined,'planner-bucket');column.dataset.groupId=group.id;
      column.addEventListener('dragover',event=>{event.preventDefault();column.classList.add('drop-target');});
      column.addEventListener('dragleave',()=>column.classList.remove('drop-target'));
      column.addEventListener('drop',async event=>{event.preventDefault();column.classList.remove('drop-target');const id=event.dataTransfer.getData('text/plain'),item=entries.find(x=>x.id===id&&x.kind==='task');if(item&&!groupMatches(item,group))await dropTaskToGroup(item,group);});
      const groupTasks=tasks.filter(x=>groupMatches(x,group)).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||a.createdAt.localeCompare(b.createdAt));
      const header=el('div',undefined,'planner-bucket-head'),titleWrap=el('div',undefined,'planner-bucket-title');
      titleWrap.append(el('h3',group.label),el('span',String(groupTasks.length),'bucket-count'));header.append(titleWrap,bucketMenu(group));
      column.append(header,addTaskInline(group));
      const list=el('div',undefined,'planner-bucket-tasks');groupTasks.forEach(item=>list.append(taskCard(item)));if(!groupTasks.length)list.append(el('div','Keine Aufgaben','bucket-empty'));column.append(list);host.append(column);
    });
    if(($('todo-group-by')?.value||'bucket')==='bucket'){
      const addColumn=el('section',undefined,'planner-add-bucket');addColumn.append(action('＋ Neuen Bucket hinzufügen',()=>openBucketEditor(null),'add-bucket-button'));host.append(addColumn);
    }
  }

  function renderGrid(){
    const body=$('todo-grid-body');body.replaceChildren();
    const tasks=todoFiltered().sort((a,b)=>bucketName(a.bucketId).localeCompare(bucketName(b.bucketId))||(a.sortOrder||0)-(b.sortOrder||0));
    tasks.forEach(item=>{
      const tr=document.createElement('tr'),checkCell=document.createElement('td'),check=el('button',item.state==='done'?'✓':'','task-check');
      check.type='button';check.addEventListener('click',()=>item.state==='done'?saveEntry({...item,state:'open',updatedAt:new Date().toISOString()},''):completeTask(item));checkCell.append(check);
      const titleCell=document.createElement('td'),title=el('button',item.title,'grid-task-title');title.type='button';title.addEventListener('click',()=>openTaskDetail(item));titleCell.append(title);
      tr.append(checkCell,titleCell);
      [bucketName(item.bucketId),states[item.state],priorities[item.priority]||'Mittel',item.startDate?dateLabel(item.startDate):'',item.due?dateLabel(item.due):'',item.owner||''].forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td);});
      body.append(tr);
    });
    if(!tasks.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.className='grid-empty';td.textContent='Keine passenden Aufgaben.';tr.append(td);body.append(tr);}
  }

  function renderCalendar(){
    const title=$('calendar-title'),grid=$('calendar-grid');grid.replaceChildren();
    const year=calendarDate.getFullYear(),month=calendarDate.getMonth();
    title.textContent=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric'}).format(new Date(year,month,1));
    const first=new Date(year,month,1),days=new Date(year,month+1,0).getDate(),offset=(first.getDay()+6)%7;
    for(let i=0;i<offset;i++)grid.append(el('div','', 'calendar-cell outside'));
    const tasks=todoFiltered();
    for(let day=1;day<=days;day++){
      const d=new Date(year,month,day),key=M.todayLocal(d),cell=el('div',undefined,'calendar-cell'+(key===today()?' today':''));
      cell.append(el('div',String(day),'calendar-day'));
      tasks.filter(x=>x.due===key||(!x.due&&x.startDate===key)).slice(0,5).forEach(item=>{
        const t=el('button',item.title,'calendar-task');t.type='button';t.addEventListener('click',()=>openTaskDetail(item));cell.append(t);
      });
      grid.append(cell);
    }
  }

  function chartBars(host,data){
    host.replaceChildren();const max=Math.max(1,...data.map(x=>x.value));
    data.forEach(item=>{
      const row=el('div',undefined,'chart-row'),label=el('span',item.label),barWrap=el('div',undefined,'chart-bar-wrap'),bar=el('div',undefined,'chart-bar'),value=el('strong',String(item.value));
      bar.style.width=Math.round(item.value/max*100)+'%';barWrap.append(bar);row.append(label,barWrap,value);host.append(row);
    });
  }

  function renderCharts(){
    const tasks=todoFiltered();
    chartBars($('chart-status'),Object.entries(states).map(([id,label])=>({label,value:tasks.filter(x=>x.state===id).length})));
    chartBars($('chart-priority'),['urgent','important','medium','low'].map(id=>({label:priorities[id],value:tasks.filter(x=>x.priority===id).length})));
    chartBars($('chart-bucket'),buckets.map(b=>({label:b.name,value:tasks.filter(x=>x.bucketId===b.id).length})));
  }

  function renderTodos(){
    if(!$('todo-board-view'))return;
    renderTodoFilterOptions();
    for(const view of ['board','grid','calendar','charts']){
      const host=$(view==='board'?'todo-board-view':view==='grid'?'todo-grid-view':'todo-'+view+'-view');
      host.hidden=todoView!==view;
      $('todo-view-'+view)?.setAttribute('aria-pressed',String(todoView===view));
    }
    if(todoView==='board')renderBoard();
    if(todoView==='grid')renderGrid();
    if(todoView==='calendar')renderCalendar();
    if(todoView==='charts')renderCharts();
  }

  function nextOccurrenceDate(value,rule){
    const base=value?new Date(value+'T12:00:00'):new Date();
    if(rule==='daily')base.setDate(base.getDate()+1);
    else if(rule==='weekdays'){do{base.setDate(base.getDate()+1);}while([0,6].includes(base.getDay()));}
    else if(rule==='weekly')base.setDate(base.getDate()+7);
    else if(rule==='monthly')base.setMonth(base.getMonth()+1);
    else if(rule==='yearly')base.setFullYear(base.getFullYear()+1);
    return M.todayLocal(base);
  }

  async function spawnNextOccurrence(item){
    if(!item.recurrence||item.recurrence==='none')return null;
    const basis=item.due||item.startDate||today(),next=nextOccurrenceDate(basis,item.recurrence);
    const start=item.startDate?nextOccurrenceDate(item.startDate,item.recurrence):'';
    return createTaskFast(item.title,item.bucketId,{body:item.body,owner:item.owner,due:item.due?next:'',startDate:start,reference:item.reference,source:item.source,priority:item.priority,recurrence:item.recurrence,labels:item.labels,showOnCard:item.showOnCard,checklist:(item.checklist||[]).map(x=>({...x,id:crypto.randomUUID(),done:false}))});
  }

  async function completeTask(item){
    const wasDone=item.state==='done',saved=await saveEntry({...item,state:'done',updatedAt:new Date().toISOString()},'');
    if(!wasDone&&saved.recurrence&&saved.recurrence!=='none'){
      await spawnNextOccurrence(saved);
      feedback('Aufgabe abgeschlossen; nächste Wiederholung wurde erstellt.');
    }else feedback('Aufgabe abgeschlossen.');
    return saved;
  }

  function fillTaskSources(selected){
    draftSources=sources.map(x=>({...x}));const select=$('task-source');
    select.replaceChildren(new Option('Keine Projektquelle',''));
    if(selected)select.add(new Option(selected.title+' · gespeicherter Verweis','__snapshot'));
    draftSources.forEach((source,index)=>select.add(new Option(source.title,String(index))));
    select.value=selected?'__snapshot':'';
  }

  function fillTaskBuckets(selected){
    const select=$('task-bucket');select.replaceChildren();
    buckets.forEach(bucket=>select.add(new Option(bucket.name,bucket.id)));
    select.value=selected&&buckets.some(x=>x.id===selected)?selected:(buckets[0]?.id||'');
  }

  function parseLabels(text,old=[]){
    const oldMap=new Map(old.map(x=>[M.normalize(x.name),x]));
    return String(text||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,25).map((name,index)=>{
      const prev=oldMap.get(M.normalize(name));
      return prev||{id:crypto.randomUUID(),name,color:labelColors[index%labelColors.length]};
    });
  }

  function renderChecklistEditor(){
    const host=$('task-checklist');host.replaceChildren();
    taskChecklistDraft.forEach((item,index)=>{
      const row=el('div',undefined,'checklist-row'),check=document.createElement('input');check.type='checkbox';check.checked=item.done;
      check.addEventListener('change',()=>{taskChecklistDraft[index].done=check.checked;});
      const input=document.createElement('input');input.value=item.text;input.maxLength=500;input.placeholder='Checklistenpunkt';
      input.addEventListener('input',()=>{taskChecklistDraft[index].text=input.value;});
      const remove=action('×',()=>{taskChecklistDraft.splice(index,1);renderChecklistEditor();},'checklist-remove');
      row.append(check,input,remove);host.append(row);
    });
  }

  async function loadTaskSideData(id){
    if(!id||!entries.some(x=>x.id===id)){taskComments=[];taskFiles=[];renderTaskComments();renderTaskFiles();return;}
    [taskComments,taskFiles]=await Promise.all([S.loadTaskComments(id),S.loadTaskFiles(id)]);
    renderTaskComments();renderTaskFiles();
  }

  function renderTaskComments(){
    const host=$('task-comments');host.replaceChildren();
    if(!taskComments.length){host.append(el('div','Noch keine Unterhaltung.','comment-empty'));return;}
    taskComments.forEach(comment=>{
      const card=el('div',undefined,'task-comment'),meta=el('div',stampLabel(comment.createdAt),'comment-meta');
      card.append(meta,el('p',comment.content));host.append(card);
    });
    host.scrollTop=host.scrollHeight;
  }

  function renderTaskFiles(){
    const host=$('task-file-list');host.replaceChildren();$('task-file-count').textContent=taskFiles.length?String(taskFiles.length):'';
    if(!taskFiles.length){host.append(el('p','Noch keine Anlagen.','small'));return;}
    taskFiles.forEach(file=>{
      const row=el('div',undefined,'task-file-row'),name=el('button',file.filename,'task-file-open');name.type='button';
      name.addEventListener('click',async()=>{try{const url=await S.signedTaskFile(file);window.open(url,'_blank','noopener');}catch(error){feedback(error.message);}});
      row.append(name,el('span',file.external_url?'Link':(file.size_bytes?Math.round(file.size_bytes/1024)+' KB':'')));host.append(row);
    });
  }

  function setTaskTab(tab){
    document.querySelectorAll('[data-task-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.taskTab===tab)));
    $('task-tab-details').hidden=tab!=='details';$('task-tab-attachments').hidden=tab!=='attachments';
  }

  async function openTaskDetail(item=null,preset={}){
    const now=new Date().toISOString();
    taskEditing=item||M.entry({id:crypto.randomUUID(),kind:'task',state:preset.state||'open',title:'',body:'',alternatives:'',outcome:'',owner:'',due:preset.due||'',reference:'',source:null,bucketId:preset.bucketId||buckets[0]?.id||'',sortOrder:0,priority:preset.priority||'medium',startDate:'',recurrence:'none',labels:[],showOnCard:false,checklist:[],createdAt:now,updatedAt:now,archived:false});
    originalSource=taskEditing.source||null;taskChecklistDraft=(taskEditing.checklist||[]).map(x=>({...x}));
    $('task-title-input').value=taskEditing.title;$('task-owner').value=taskEditing.owner||'';$('task-state').value=taskEditing.state;
    $('task-priority').value=taskEditing.priority||'medium';$('task-start').value=taskEditing.startDate||'';$('task-due').value=taskEditing.due||'';
    $('task-recurrence').value=taskEditing.recurrence||'none';$('task-labels').value=(taskEditing.labels||[]).map(x=>x.name).join(', ');
    $('task-notes').value=taskEditing.body||'';$('task-show-card').checked=Boolean(taskEditing.showOnCard);$('task-reference').value=taskEditing.reference||'';
    $('task-meta-line').textContent=entries.some(x=>x.id===taskEditing.id)?('Erstellt '+stampLabel(taskEditing.createdAt)+' · zuletzt geändert '+stampLabel(taskEditing.updatedAt)):'Neue Aufgabe';
    $('task-complete-toggle').textContent=taskEditing.state==='done'?'✓':'';
    $('task-complete-toggle').classList.toggle('is-complete',taskEditing.state==='done');
    fillTaskBuckets(taskEditing.bucketId);fillTaskSources(taskEditing.source);renderChecklistEditor();setTaskTab('details');
    $('task-detail').showModal();
    await loadTaskSideData(taskEditing.id);
    $('task-title-input').focus();
  }

  async function taskFromForm(){
    const now=new Date().toISOString(),selected=$('task-source').value,was=entries.find(x=>x.id===taskEditing.id);
    const draft=M.entry({...taskEditing,title:$('task-title-input').value.trim(),owner:$('task-owner').value.trim(),state:$('task-state').value,priority:$('task-priority').value,startDate:$('task-start').value,due:$('task-due').value,recurrence:$('task-recurrence').value,bucketId:$('task-bucket').value,labels:parseLabels($('task-labels').value,taskEditing.labels||[]),checklist:taskChecklistDraft.filter(x=>x.text.trim()).map(x=>({...x,text:x.text.trim()})),body:$('task-notes').value.trim(),showOnCard:$('task-show-card').checked,reference:$('task-reference').value.trim(),source:selected==='__snapshot'?originalSource:selected===''?null:draftSources[Number(selected)],updatedAt:now});
    if(!draft.title)throw new Error('Aufgabe braucht einen Titel.');
    const saved=await saveEntry(draft,'Aufgabe gespeichert.');
    taskEditing=saved;
    if(was&&was.state!=='done'&&saved.state==='done'&&saved.recurrence!=='none'){
      await spawnNextOccurrence(saved);
      feedback('Aufgabe gespeichert; nächste Wiederholung wurde erstellt.');
    }
    return saved;
  }

  async function duplicateTask(){
    const original=await taskFromForm(),now=new Date().toISOString();
    const copy=M.entry({...original,id:crypto.randomUUID(),title:original.title+' – Kopie',state:'open',checklist:(original.checklist||[]).map(x=>({...x,id:crypto.randomUUID(),done:false})),createdAt:now,updatedAt:now});
    const saved=await saveEntry(copy,'Aufgabe dupliziert.');$('task-detail').close();openTaskDetail(saved);
  }

  function openBucketEditor(bucket=null){
    editingBucket=bucket;$('bucket-form').reset();$('bucket-editor-title').textContent=bucket?'Bucket umbenennen':'Neuen Bucket hinzufügen';$('bucket-name').value=bucket?.name||'';$('bucket-form-error').textContent='';$('bucket-editor').showModal();$('bucket-name').focus();
  }

  function renderMail(){
    const q=$('mail-search').value,shown=mails.filter(x=>!x.archived&&M.mailMatches(x,q)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    $('mail-count').textContent=shown.length+' E-Mail'+(shown.length===1?'':'s');const host=$('mail-list');host.replaceChildren();
    if(!shown.length){host.append(el('div','Noch keine passende E-Mail in der privaten Memory.','empty'));return;}
    shown.forEach(item=>{
      const card=el('article',undefined,'mail-card'),head=el('div',undefined,'mail-card-head');
      head.append(el('div',item.sender||'Absender nicht erfasst','mail-sender'),el('div',item.date?dateLabel(item.date):'ohne Datum','mail-date'));
      card.append(head,el('h3',item.subject),el('p',item.body||'Kein Text extrahiert.','mail-body'));
      const actions=el('div',undefined,'card-actions');
      actions.append(action('MINDS dazu fragen',()=>{setScreen('assistant');$('ask-input').value='Was steht in der E-Mail „'+item.subject+'“?';$('ask-input').focus();}),action('Neu indexieren',async()=>{try{await S.indexMailText(item);feedback('E-Mail neu indexiert.');}catch(error){feedback(error.message);}}),action('Archivieren',()=>saveMail({...item,archived:true,updatedAt:new Date().toISOString()})));
      card.append(actions);host.append(card);
    });
  }

  async function importMailFiles(fileList){
    const files=[...fileList].filter(Boolean);
    if(!files.length)return;
    const status=$('mail-import-status');let imported=0,skipped=0,failed=0;
    status.textContent='Importiere '+files.length+' E-Mail'+(files.length===1?'':'s')+' …';
    for(const file of files){
      try{
        const result=await S.ingestMailFile(file);
        if(result.duplicate){
          skipped++;
          if(!mails.some(x=>x.id===result.mail.id))mails.unshift(result.mail);
        }else{
          imported++;
          mails.unshift(result.mail);
        }
        renderMail();metrics();
      }catch(error){
        failed++;console.error('Mail import failed',file.name,error);feedback(file.name+': '+error.message);
      }
      status.textContent='Import: '+imported+' gespeichert · '+skipped+' bereits vorhanden · '+failed+' Fehler';
    }
    renderAll();
  }

  function setupMailDrop(){
    const zone=$('mail-drop'),input=$('mail-drop-input');
    ['dragenter','dragover'].forEach(type=>zone.addEventListener(type,event=>{event.preventDefault();zone.classList.add('drag-active');}));
    ['dragleave','drop'].forEach(type=>zone.addEventListener(type,event=>{event.preventDefault();zone.classList.remove('drag-active');}));
    zone.addEventListener('drop',event=>importMailFiles(event.dataTransfer.files));
    input.addEventListener('change',()=>{importMailFiles(input.files);input.value='';});
    zone.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();input.click();}});
  }

  function renderMemoryCard(item){
    const card=el('article',undefined,'entry'),head=el('div',undefined,'entry-head');head.append(el('span',labels[item.kind],'tag'),el('span',states[item.state]||item.state,'state'));if(item.archived)head.append(el('span','Archiviert'));card.append(head,el('h3',item.title));
    if(item.body)card.append(el('p',item.body));if(item.alternatives)card.append(el('p','Alternativen: '+item.alternatives));if(item.outcome)card.append(el('p','Auswirkungen: '+item.outcome));if(item.owner)card.append(el('p','Verantwortlich / beteiligt: '+item.owner,'meta'));if(item.due)card.append(el('p','Termin / Wiedervorlage: '+dateLabel(item.due),'meta'));if(item.source){const p=el('p','Quelle: ','meta');p.append(link(item.source));card.append(p);}if(item.reference)card.append(el('p','Fundstelle: '+item.reference,'meta'));
    const actions=el('div',undefined,'card-actions');actions.append(action('Bearbeiten',()=>editEntry(item)),action(item.archived?'Wiederherstellen':'Archivieren',()=>saveEntry({...item,archived:!item.archived,updatedAt:new Date().toISOString()},'')));card.append(actions);return card;
  }

  function renderSources(){
    const host=$('sources');host.replaceChildren();sources.forEach(source=>{const card=el('article',undefined,'source'),title=el('h3');title.append(link(source));card.append(title,el('p',source.meta||'Quellenverweis'),el('p','Erfasst: '+dateLabel(source.capturedAt)+(source.version?' · Referenz: '+source.version:'')));host.append(card);});
  }

  function renderMemory(){
    const filter=$('memory-filter').value,isSources=filter==='sources';$('entries').hidden=isSources;$('source-panel').hidden=!isSources;
    if(isSources){$('result-summary').textContent=sources.length+' Quellenverweise';renderSources();return;}
    const archived=$('show-archived').checked,query=$('search').value;let shown=entries.filter(x=>x.kind!=='task'&&x.archived===archived&&M.matches(x,query));
    if(filter!=='all')shown=shown.filter(x=>x.kind===filter);shown.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));$('result-summary').textContent=shown.length+' Eintr'+(shown.length===1?'ag':'äge');
    const host=$('entries');host.replaceChildren();if(!shown.length)host.append(el('div','Keine passenden Erinnerungen.','empty'));shown.forEach(item=>host.append(renderMemoryCard(item)));
  }

  function renderAll(){metrics();renderChat();renderAssistantSide();renderTodos();renderMail();renderMemory();}

  function fillSourceOptions(selected=originalSource){
    draftSources=sources.map(x=>({...x}));const select=$('entry-source');select.replaceChildren(new Option('Eigene Notiz · ohne Dokumentbeleg',''));
    if(selected)select.add(new Option(selected.title+' · gespeicherter Verweis','__snapshot'));draftSources.forEach((source,index)=>select.add(new Option(source.title,String(index))));select.value=selected?'__snapshot':'';
  }

  function editEntry(item=null){
    editing=item;originalSource=item?.source||null;$('entry-form').reset();$('editor-title').textContent=item?'Eintrag bearbeiten':'Erinnerung erfassen';$('entry-kind').value=item?.kind||'note';$('entry-state').value=item?.state==='done'?'done':'open';
    for(const field of ['title','body','alternatives','outcome','owner','due','reference'])$('entry-'+field).value=item?.[field]||'';
    fillSourceOptions();$('decision-fields').hidden=$('entry-kind').value!=='decision';$('form-error').textContent='';$('editor').showModal();$('entry-title').focus();
  }

  function openMailEditor(){$('mail-form').reset();$('mail-date').value=today();$('mail-form-error').textContent='';$('mail-editor').showModal();$('mail-sender').focus();}

  $('entry-kind').addEventListener('change',()=>{$('decision-fields').hidden=$('entry-kind').value!=='decision';});
  $('entry-form').addEventListener('submit',async event=>{
    event.preventDefault();
    try{
      const now=new Date().toISOString(),selected=$('entry-source').value,draft={id:editing?.id||crypto.randomUUID(),createdAt:editing?.createdAt||now,updatedAt:now,kind:$('entry-kind').value,state:$('entry-state').value,archived:editing?.archived||false,source:selected==='__snapshot'?originalSource:selected===''?null:draftSources[Number(selected)],bucketId:'',sortOrder:0,priority:'medium',startDate:'',recurrence:'none',labels:[],showOnCard:false,checklist:[]};
      for(const field of ['title','body','alternatives','outcome','owner','due','reference'])draft[field]=$('entry-'+field).value.trim();
      await saveEntry(M.entry(draft));$('editor').close();
    }catch(error){$('form-error').textContent=error.message;}
  });

  $('task-form').addEventListener('submit',async event=>{event.preventDefault();try{await taskFromForm();$('task-detail').close();}catch(error){feedback(error.message);}});
  $('task-complete-toggle').addEventListener('click',async()=>{if(!taskEditing)return;if(taskEditing.state==='done'){taskEditing=await saveEntry({...taskEditing,state:'open',updatedAt:new Date().toISOString()},'Aufgabe wieder geöffnet.');$('task-state').value='open';$('task-complete-toggle').textContent='';}else{const before=taskEditing.state;taskEditing=await taskFromForm();if(before!=='done'&&taskEditing.state!=='done')taskEditing=await completeTask(taskEditing);$('task-detail').close();}});
  $('task-copy').addEventListener('click',()=>duplicateTask().catch(error=>feedback(error.message)));
  $('task-archive').addEventListener('click',async()=>{if(!taskEditing)return;await saveEntry({...taskEditing,archived:true,updatedAt:new Date().toISOString()},'Aufgabe archiviert.');$('task-detail').close();});
  $('close-task-detail').addEventListener('click',()=>$('task-detail').close());
  document.querySelectorAll('[data-task-tab]').forEach(button=>button.addEventListener('click',()=>setTaskTab(button.dataset.taskTab)));
  $('add-checklist-item').addEventListener('click',()=>{taskChecklistDraft.push({id:crypto.randomUUID(),text:'',done:false});renderChecklistEditor();setTimeout(()=>document.querySelector('#task-checklist .checklist-row:last-child input[type=text]')?.focus(),0);});
  $('task-comment-send').addEventListener('click',async()=>{if(!taskEditing||!entries.some(x=>x.id===taskEditing.id)){feedback('Aufgabe zuerst speichern.');return;}const input=$('task-comment-input'),value=input.value.trim();if(!value)return;const saved=await S.addTaskComment(taskEditing.id,value);taskComments.push(saved);input.value='';renderTaskComments();});
  $('task-file-input').addEventListener('change',async()=>{if(!taskEditing||!entries.some(x=>x.id===taskEditing.id)){feedback('Aufgabe zuerst speichern.');$('task-file-input').value='';return;}for(const file of [...$('task-file-input').files])taskFiles.push(await S.uploadTaskFile(taskEditing.id,file));$('task-file-input').value='';renderTaskFiles();});
  $('task-add-link').addEventListener('click',async()=>{if(!taskEditing||!entries.some(x=>x.id===taskEditing.id)){feedback('Aufgabe zuerst speichern.');return;}const url=$('task-link-url').value.trim(),label=$('task-link-label').value.trim()||'Link';if(!url)return;taskFiles.push(await S.addTaskLink(taskEditing.id,url,label));$('task-link-url').value='';$('task-link-label').value='';renderTaskFiles();});

  $('bucket-form').addEventListener('submit',async event=>{event.preventDefault();try{const name=$('bucket-name').value.trim();if(!name)throw new Error('Bucket braucht einen Namen.');const max=buckets.reduce((m,x)=>Math.max(m,x.sortOrder||0),0);await saveBucket({id:editingBucket?.id,name,sortOrder:editingBucket?.sortOrder??(max+10),archived:false,createdAt:editingBucket?.createdAt});$('bucket-editor').close();editingBucket=null;}catch(error){$('bucket-form-error').textContent=error.message;}});

  $('mail-form').addEventListener('submit',async event=>{event.preventDefault();try{const now=new Date().toISOString(),value=M.mail({id:crypto.randomUUID(),sender:$('mail-sender').value.trim(),recipients:$('mail-recipients').value.trim(),subject:$('mail-subject').value.trim(),body:$('mail-body').value.trim(),date:$('mail-date').value,messageId:'',threadKey:'',createdAt:now,updatedAt:now,archived:false});await saveMail(value,[...$('mail-files').files]);$('mail-editor').close();}catch(error){$('mail-form-error').textContent=error.message;}});

  $('ask-form').addEventListener('submit',async event=>{event.preventDefault();const prompt=$('ask-input').value.trim();if(!prompt)return;$('ask-input').value='';try{await ask(prompt,true);}catch(error){feedback(error.message);}});
  document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>ask(button.dataset.prompt,true).catch(error=>feedback(error.message))));
  $('clear-chat').addEventListener('click',async()=>{try{await S.newConversation();chat=[];renderChat();feedback('Neue Arbeitskonversation gestartet.');}catch(error){feedback(error.message);}});
  document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>setScreen(button.dataset.screen)));
  document.querySelectorAll('[data-todo-view]').forEach(button=>button.addEventListener('click',()=>{todoView=button.dataset.todoView;renderTodos();}));
  $('new-todo').addEventListener('click',()=>openTaskDetail(null,{bucketId:buckets[0]?.id||''}));
  $('new-entry').addEventListener('click',()=>editEntry(null));$('new-mail').addEventListener('click',openMailEditor);
  $('todo-search').addEventListener('input',renderTodos);
  $('todo-status-filter').addEventListener('change',renderTodos);
  $('todo-priority-filter').addEventListener('change',renderTodos);
  $('todo-bucket-filter').addEventListener('change',renderTodos);
  $('todo-owner-filter').addEventListener('change',renderTodos);
  $('todo-label-filter').addEventListener('change',renderTodos);
  $('todo-due-filter').addEventListener('change',renderTodos);
  $('todo-group-by').addEventListener('change',renderTodos);
  $('todo-filter-toggle').addEventListener('click',()=>{$('todo-filter-popover').hidden=!$('todo-filter-popover').hidden;});
  $('todo-filter-reset').addEventListener('click',()=>{
    for(const id of ['todo-priority-filter','todo-bucket-filter','todo-owner-filter','todo-label-filter','todo-due-filter'])$(id).value='all';
    renderTodos();
  });
  $('calendar-prev').addEventListener('click',()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);renderCalendar();});
  $('calendar-next').addEventListener('click',()=>{calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);renderCalendar();});
  for(const id of ['close-editor','cancel-editor'])$(id).addEventListener('click',()=>$('editor').close());
  for(const id of ['close-mail-editor','cancel-mail-editor'])$(id).addEventListener('click',()=>$('mail-editor').close());
  for(const id of ['close-bucket-editor','cancel-bucket-editor'])$(id).addEventListener('click',()=>$('bucket-editor').close());
  $('mail-search').addEventListener('input',renderMail);$('search').addEventListener('input',renderMemory);$('memory-filter').addEventListener('change',renderMemory);$('show-archived').addEventListener('change',renderMemory);

  function download(text,filename){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('export').addEventListener('click',()=>download(JSON.stringify({schemaVersion:5,project:'bernried',exportedAt:new Date().toISOString(),entries,mails,buckets,chat},null,2),'minds-work-bernried-'+today()+'.json'));
  $('import').addEventListener('change',async event=>{const file=event.target.files[0];try{if(!file)return;const data=JSON.parse(await file.text());if(data?.project!=='bernried')throw new Error('Falsches Projekt.');for(const bucket of data.buckets||[])await saveBucket(bucket);for(const entry of data.entries||[])await saveEntry(M.entry(entry),'');for(const mail of data.mails||[])await saveMail(M.mail(mail));await refresh();feedback('Backup importiert.');}catch(error){feedback('Import abgebrochen: '+error.message);}finally{event.target.value='';}});

  function acceptContext(context){
    if(context.project!=='bernried'||!Array.isArray(context.sources)||context.sources.length>500)return;
    try{sources=context.sources.map(M.source);$('project-name').textContent=String(context.projectName||'Bernried').slice(0,200);$('source-note').textContent=String(context.note||'').slice(0,1000);hubContext=true;if(!$('editor').open)fillSourceOptions();renderAll();}catch(error){feedback('Quellen konnten nicht übernommen werden: '+error.message);}
  }
  function requestContext(){if(window.parent!==window)window.parent.postMessage({type:'minds:request-context'},location.origin);}
  window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==window.parent||event.data?.type!=='minds:context')return;acceptContext(event.data);});
  $('refresh-sources').addEventListener('click',requestContext);

  async function migrateLocalOnce(){
    if(localStorage.getItem('minds_work_bernried_supabase_migrated_v1')==='1')return;
    let localEntries=[],localMails=[];
    try{const raw=localStorage.getItem(M.KEY);if(raw)localEntries=M.parse(raw);}catch{}
    try{const raw=localStorage.getItem(M.MAIL_KEY);if(raw)localMails=M.parseMails(raw);}catch{}
    if(!localEntries.length&&!localMails.length){localStorage.setItem('minds_work_bernried_supabase_migrated_v1','1');return;}
    const result=await S.migrateLocal(localEntries,localMails);localStorage.setItem('minds_work_bernried_supabase_migrated_v1','1');feedback('Lokale Pilotdaten migriert: '+result.entries+' Memory, '+result.mails+' Mails.');
  }

  async function indexExistingMailOnce(){
    if(localStorage.getItem('minds_work_bernried_mail_indexed_v1')==='1')return;
    for(const mail of mails){if(mail.archived||!mail.body.trim())continue;await S.indexMailText(mail);}
    localStorage.setItem('minds_work_bernried_mail_indexed_v1','1');
  }

  async function boot(){
    try{
      setBusy(true);await S.init();await migrateLocalOnce();await refresh();await indexExistingMailOnce();setupMailDrop();requestContext();
      fetch('sources.json').then(r=>r.ok?r.json():null).then(context=>{if(context&&!hubContext)acceptContext(context);}).catch(()=>{});
      const label=document.querySelector('.pilot-label');label.replaceChildren(el('span',undefined,'dot'),document.createTextNode(' Pilot 0.5 · Work memory'));
    }catch(error){
      const box=el('div',undefined,'notice');box.append(el('strong','MINDS konnte nicht geöffnet werden.'),document.createElement('br'),document.createTextNode(error.message));document.querySelector('.workspace').replaceChildren(box);
    }finally{setBusy(false);}
  }

  boot();
})();
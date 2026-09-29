(() => {
'use strict';

const SUPABASE_URL='https://mmrteayudgywutghpdev.supabase.co';
const SUPABASE_KEY='sb_publishable_P4lOIuijwNF7oleGDoeAuQ_7OLJOaGV';
const BUCKET='project-hub';
const PROJECT_SLUG='bernried';
const PORTAL_URL='https://tbarchitekten.github.io/Bernried/';
const ROLE_EMAILS={
  tba:'tba.bernried@access.invalid',
  bauherren:'bauherren.bernried@access.invalid',
  fachplaner:'fachplaner.bernried@access.invalid'
};
const CATEGORY_UI={plaene:'Pläne',dokumente:'Dokumente'};
const DOCUMENT_KIND_LABELS={praesentation:'Präsentation',protokoll:'Protokoll',sonstiges:'Sonstiges'};
const TIMELINE_LABELS={planstand:'Planstand',versand:'Versand',besprechung:'Besprechung',eingang:'Eingang',entscheidung:'Entscheidung',other:'Sonstiges'};

const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});
const $=id=>document.getElementById(id);

let session=null, membership=null, project=null;
let stands=[], documents=[], images=[], timelineEvents=[], timelineLinks=[], timelineFiles=[];
let provisionedCredentials=[];
let selectedRole='tba';
const selectedStand={plaene:null};
const signedCache=new Map();

function adminMode(){return new URLSearchParams(location.search).get('admin')==='1'}
function safe(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function cleanName(name){return String(name||'file').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,180)}
function isEditor(){return membership?.role==='editor'}
function toast(message,error=false){
  const host=$('toast');host.textContent=message;host.classList.toggle('error',error);host.classList.remove('hidden');
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>host.classList.add('hidden'),4200);
}
function formatDate(value){
  if(!value)return '';
  return new Date(value+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function formatStand(stand){
  return [stand.label,stand.stand_date?formatDate(stand.stand_date):''].filter(Boolean).join(' · ');
}
async function signedUrl(path,downloadName=''){
  if(!path)return '';
  if(/^https?:\/\//.test(path))return path;
  const key=path+'|'+downloadName;
  const hit=signedCache.get(key);
  if(hit&&hit.expires>Date.now())return hit.url;
  const options=downloadName?{download:downloadName}:undefined;
  const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(path,3600,options);
  if(error)throw error;
  signedCache.set(key,{url:data.signedUrl,expires:Date.now()+50*60*1000});
  return data.signedUrl;
}
async function upload(file,folder){
  const path=`${PROJECT_SLUG}/${folder}/${crypto.randomUUID()}-${cleanName(file.name)}`;
  const {error}=await sb.storage.from(BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(error)throw error;
  return path;
}
async function removePath(path){
  if(!path)return;
  const {error}=await sb.storage.from(BUCKET).remove([path]);
  if(error)throw error;
}
function roleLabel(audience){
  return audience==='tba'?'Titus Bernhard Architekten':audience==='bauherren'?'Bauherren':'Fachplaner';
}

function showAuth(mode='roles'){
  $('authGate').classList.remove('hidden');
  $('appShell').classList.add('hidden');
  $('roleLogin').classList.toggle('hidden',mode!=='roles');
  $('bootstrapLogin').classList.toggle('hidden',mode!=='bootstrap');
  $('provisionPanel').classList.add('hidden');
  $('authMessage').textContent='';
}
function showApp(){
  $('authGate').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  document.body.classList.toggle('editor-mode',isEditor());
  $('roleBadge').textContent=membership?.display_name||roleLabel(membership?.audience);
  $('roleMode').textContent=isEditor()?'Bearbeiten':'Lesen / Download';
}
function setRole(role){
  selectedRole=role;
  document.querySelectorAll('[data-login-role]').forEach(b=>b.classList.toggle('active',b.dataset.loginRole===role));
  $('rolePassword').focus();
}
async function ownLegacyAdmin(userId){
  const {data,error}=await sb.from('project_admins').select('project_id,user_id').eq('user_id',userId).maybeSingle();
  if(error)throw error;
  return data;
}
async function ownMembership(userId){
  const {data,error}=await sb.from('project_members').select('*').eq('user_id',userId).maybeSingle();
  if(error)throw error;
  return data;
}
async function routeSession(nextSession){
  session=nextSession;
  membership=null;project=null;
  if(!session){showAuth(adminMode()?'bootstrap':'roles');return}

  const [member,legacy]=await Promise.all([ownMembership(session.user.id),ownLegacyAdmin(session.user.id)]);
  const sharedEmail=Object.values(ROLE_EMAILS).includes(String(session.user.email||'').toLowerCase());

  if(legacy&&!sharedEmail){
    showAuth('bootstrap');
    $('bootstrapLoginForm').classList.add('hidden');
    $('provisionPanel').classList.remove('hidden');
    $('bootstrapStatus').textContent='Bestehender Admin erkannt. Die drei gemeinsamen Projektzugänge können jetzt erstellt bzw. neu gesetzt werden.';
    return;
  }
  if(!member){
    await sb.auth.signOut();
    $('authMessage').textContent='Für dieses Konto gibt es keinen Zugriff auf Bernried.';
    showAuth('roles');
    return;
  }

  membership=member;
  const {data:p,error}=await sb.from('projects').select('*').eq('id',member.project_id).single();
  if(error)throw error;
  project=p;
  showApp();
  await loadAll();
  let hash=location.hash.replace('#','');if(hash==='grundrisse'||hash==='schnitte')hash='plaene';
  showView(hash&&$('view-'+hash)?hash:'landing');
}

function printCredentials(credentials){
  const rows=(credentials||[]).filter(c=>['bauherren','fachplaner'].includes(c.audience));
  if(!rows.length){toast('Noch keine Zugangsdaten zum Drucken vorhanden.',true);return}
  const popup=window.open('','_blank','width=900,height=780');
  if(!popup){toast('Druckfenster wurde blockiert.',true);return}
  try{popup.opener=null}catch{}
  const sheets=rows.map((credential,index)=>`
    <section class="sheet">
      <div class="brand">Titus Bernhard <strong>Architekten</strong></div>
      <div class="project">Bernried · Museum der Komischen Kunst</div>
      <h1>Projektzugang</h1>
      <dl>
        <div><dt>Website</dt><dd>${safe(PORTAL_URL)}</dd></div>
        <div><dt>Konto</dt><dd>${safe(credential.label)}</dd></div>
        <div><dt>Passwort</dt><dd class="password">${safe(credential.password)}</dd></div>
      </dl>
      <div class="steps">
        <p>1. Website öffnen</p>
        <p>2. „${safe(credential.label)}“ auswählen</p>
        <p>3. Passwort eingeben und „Anmelden“ wählen</p>
      </div>
      <p class="note">Der Zugang ist ausschließlich zum Lesen und Herunterladen der freigegebenen Projektunterlagen bestimmt.</p>
    </section>
  `).join('');
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bernried · Projektzugänge</title><style>
    @page{size:A4;margin:22mm}
    *{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#111}
    .sheet{min-height:250mm;display:flex;flex-direction:column;padding:4mm 0;page-break-after:always}
    .sheet:last-child{page-break-after:auto}
    .brand{font-size:18px;margin-bottom:34mm}.project{font-size:12px;color:#686868;margin-bottom:8mm}
    h1{font-size:30px;font-weight:400;margin:0 0 22mm}
    dl{margin:0;border-top:1px solid #111}
    dl>div{display:grid;grid-template-columns:34mm 1fr;gap:8mm;padding:7mm 0;border-bottom:1px solid #d9d9d4}
    dt{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#777}
    dd{margin:0;font-size:16px;word-break:break-word}.password{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;letter-spacing:.035em}
    .steps{margin-top:18mm;font-size:12px;line-height:1.7}.steps p{margin:0 0 2mm}
    .note{margin-top:auto;font-size:9px;line-height:1.5;color:#777}
    @media screen{body{background:#eee}.sheet{width:210mm;margin:12mm auto;background:#fff;padding:22mm;box-shadow:0 2mm 8mm #0002}}
  </style></head><body>${sheets}</body></html>`);
  popup.document.close();
  setTimeout(()=>{popup.focus();popup.print()},250);
}

async function provisionAccess(){
  $('bootstrapStatus').textContent='Zugänge werden erstellt …';
  $('provisionAccess').disabled=true;
  try{
    const {data,error}=await sb.functions.invoke('bernried-provision-access',{body:{}});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);

    provisionedCredentials=data.credentials||[];
    $('credentialsList').replaceChildren();
    for(const credential of provisionedCredentials){
      const row=document.createElement('div');row.className='credential';
      const left=document.createElement('div');
      left.innerHTML=`<strong>${safe(credential.label)}</strong><code>${safe(credential.password)}</code>`;
      const actions=document.createElement('div');actions.className='credential-row-actions';
      const copy=document.createElement('button');copy.type='button';copy.textContent='Kopieren';
      copy.onclick=async()=>{await navigator.clipboard.writeText(credential.password);copy.textContent='Kopiert'};
      const print=document.createElement('button');print.type='button';print.textContent='Drucken';
      print.onclick=()=>printCredentials([credential]);
      actions.append(copy,print);
      row.append(left,actions);$('credentialsList').append(row);
    }
    $('credentialsBox').classList.remove('hidden');
    $('bootstrapStatus').textContent='Zugänge erstellt. Die Passwörter werden nur jetzt im Klartext angezeigt. Supabase Auth speichert sie anschließend ausschließlich gehasht.';
  }catch(error){
    $('bootstrapStatus').textContent=error.message||'Einrichtung fehlgeschlagen.';
  }finally{$('provisionAccess').disabled=false}
}

async function loadAll(){
  signedCache.clear();
  const pid=project.id;
  const [standsRes,docsRes,imagesRes,eventsRes,linksRes,filesRes]=await Promise.all([
    sb.from('document_stands').select('*').eq('project_id',pid).order('sort_order').order('stand_date',{ascending:false}),
    sb.from('documents').select('*').eq('project_id',pid).eq('is_published',true).order('sort_order'),
    sb.from('images').select('*').eq('project_id',pid).eq('is_published',true).order('sort_order'),
    sb.from('timeline_events').select('*').eq('project_id',pid).order('event_date',{ascending:false}).order('sort_order'),
    sb.from('timeline_event_documents').select('*'),
    sb.from('timeline_files').select('*').eq('project_id',pid).order('sort_order')
  ]);
  for(const res of [standsRes,docsRes,imagesRes,eventsRes,linksRes,filesRes])if(res.error)throw res.error;
  stands=standsRes.data||[];documents=docsRes.data||[];images=imagesRes.data||[];timelineEvents=eventsRes.data||[];timelineLinks=linksRes.data||[];timelineFiles=filesRes.data||[];

  $('projectName').textContent=project.project_name;
  await renderLanding();
  renderStandSection('plaene');
  renderGeneralDocuments();
  await renderImages();
  await renderSchedule();
  renderContact();
  renderTimeline();
  $('modelFrame').src=project.d5_url||'about:blank';
  $('modelUrlInput').value=project.d5_url||'';
  $('projectNameInput').value=project.project_name||'';
}

async function renderLanding(){
  const img=$('landingImage');
  if(project.landing_path){
    try{img.src=await signedUrl(project.landing_path)}catch{img.removeAttribute('src')}
  }else img.removeAttribute('src');
}
function standList(category='plaene'){return stands.filter(s=>s.category===category)}
function currentStand(category='plaene'){
  const list=standList(category);
  const selected=selectedStand[category];
  if(selected&&list.some(s=>s.id===selected))return list.find(s=>s.id===selected);
  const current=list.find(s=>s.is_current)||list[0]||null;
  selectedStand[category]=current?.id||null;
  return current;
}
function renderStandSection(category='plaene'){
  const select=$('standSelect-plaene'),note=$('standNote-plaene'),grid=$('grid-plaene');
  const list=standList(category);
  select.replaceChildren();
  for(const stand of list)select.add(new Option(formatStand(stand),stand.id));
  const active=currentStand(category);
  if(active)select.value=active.id;
  note.textContent=active?.note||'';
  grid.replaceChildren();

  const rows=active?documents.filter(d=>d.category==='plaene'&&d.stand_id===active.id):[];
  if(!rows.length){grid.innerHTML='<div class="empty">Für diesen Stand sind noch keine Pläne hinterlegt.</div>';return}
  rows.sort((a,b)=>a.sort_order-b.sort_order||a.title.localeCompare(b.title));
  for(const doc of rows)grid.appendChild(documentCard(doc));
}
function documentCard(doc){
  const card=document.createElement('article');card.className='doc-card';
  const thumb=document.createElement('div');thumb.className='thumb-wrap';
  if(doc.thumbnail_path){
    const img=document.createElement('img');img.alt=doc.title;thumb.append(img);signedUrl(doc.thumbnail_path).then(url=>img.src=url).catch(()=>thumb.innerHTML='<span class="thumb-placeholder">PDF</span>');
  }else thumb.innerHTML='<span class="thumb-placeholder">PDF</span>';
  const info=document.createElement('div');info.className='doc-info';
  const left=document.createElement('div');left.innerHTML=`<h2>${safe(doc.title)}</h2><div class="doc-meta">${safe(doc.meta||'')}</div>`;
  const actions=document.createElement('div');actions.className='doc-actions';
  const open=document.createElement('button');open.textContent='Öffnen';open.onclick=()=>openDocument(doc);
  const dl=document.createElement('button');dl.textContent='Download';dl.onclick=()=>downloadStorage(doc.file_path,(doc.title||'Plan')+'.pdf');
  actions.append(open,dl);
  if(isEditor()){
    const edit=document.createElement('button');edit.textContent='Bearbeiten';edit.onclick=()=>openDocumentDialog(doc);
    const del=document.createElement('button');del.textContent='Löschen';del.onclick=()=>deleteDocument(doc);
    actions.append(edit,del);
  }
  info.append(left,actions);card.append(thumb,info);thumb.onclick=()=>openDocument(doc);return card;
}
async function openDocument(doc){
  const url=await signedUrl(doc.file_path);
  openViewer(doc.title,`<iframe src="${safe(url)}#view=FitH" title="${safe(doc.title)}"></iframe>`,url);
}
async function downloadStorage(path,filename){
  const url=await signedUrl(path,filename);window.open(url,'_blank','noopener');
}
function openViewer(title,content,url){
  $('viewerTitle').textContent=title;$('viewerBody').innerHTML=content;$('viewerModal').classList.add('open');$('viewerNewWindow').onclick=()=>window.open(url,'_blank','noopener');
}
function planTitleFromFilename(name){
  return name.replace(/\.pdf$/i,'').replace(/_VA\d+$/i,'').replace(/^[^\s]+\s*/,'').replace(/\s*_\s*/g,' / ').trim()||name.replace(/\.pdf$/i,'');
}
function planNumberFromFilename(name){
  return (name.match(/^(AN_[A-Z]{2}_\d+|GR_[A-Za-z]{2}_\d+|SN_[A-Z]{2}_\d+)/i)||[])[1]||'';
}
async function uploadPlanFiles(files){
  const active=currentStand('plaene');
  if(!active)throw new Error('Bitte zuerst einen Planstand anlegen.');
  const pdfs=[...files].filter(f=>/\.pdf$/i.test(f.name));
  if(!pdfs.length)return;
  let order=documents.filter(d=>d.category==='plaene'&&d.stand_id===active.id).length;
  for(const file of pdfs){
    const path=await upload(file,`documents/plaene/${cleanName(active.label+'-'+(active.stand_date||''))}`);
    const number=planNumberFromFilename(file.name);
    const index=active.label||'';
    const meta=[number,index?`Index ${index}`:'',active.stand_date?`Stand ${formatDate(active.stand_date)}`:''].filter(Boolean).join(' · ');
    const payload={project_id:project.id,category:'plaene',title:planTitleFromFilename(file.name),meta,file_path:path,thumbnail_path:null,stand_id:active.id,sort_order:order++,is_published:true,document_kind:'plan',document_date:active.stand_date||null};
    const {error}=await sb.from('documents').insert(payload);
    if(error){await removePath(path);throw error}
  }
  await loadAll();toast(`${pdfs.length} Pläne hochgeladen.`);
}
function renderGeneralDocuments(){
  const host=$('generalDocuments');host.replaceChildren();
  const rows=documents.filter(d=>d.category==='dokumente').sort((a,b)=>(b.document_date||'').localeCompare(a.document_date||'')||a.title.localeCompare(b.title));
  if(!rows.length){host.innerHTML='<div class="empty">Noch keine Dokumente hinterlegt.</div>';return}
  for(const doc of rows){
    const row=document.createElement('article');row.className='general-document';
    const kind=DOCUMENT_KIND_LABELS[doc.document_kind]||'Dokument';
    const meta=[doc.document_date?formatDate(doc.document_date):'',kind].filter(Boolean).join(' · ');
    const main=document.createElement('div');main.innerHTML=`<h2>${safe(doc.title)}</h2><div class="doc-meta">${safe(meta)}</div>`;
    const actions=document.createElement('div');actions.className='doc-actions';
    const open=document.createElement('button');open.textContent='Öffnen';open.onclick=async()=>window.open(await signedUrl(doc.file_path),'_blank','noopener');
    const dl=document.createElement('button');dl.textContent='Download';dl.onclick=()=>downloadStorage(doc.file_path,doc.title);
    actions.append(open,dl);
    if(isEditor()){
      const del=document.createElement('button');del.textContent='Löschen';del.onclick=()=>deleteDocument(doc);actions.append(del);
    }
    row.append(main,actions);host.append(row);
  }
}
async function saveGeneralDocuments(event){
  event.preventDefault();
  const files=[...$('generalDocumentFiles').files];
  if(!files.length)return;
  $('generalDocumentError').textContent='';
  try{
    let order=documents.filter(d=>d.category==='dokumente').length;
    for(const file of files){
      const path=await upload(file,'documents/dokumente');
      const payload={project_id:project.id,category:'dokumente',title:file.name,meta:'',file_path:path,thumbnail_path:null,stand_id:null,sort_order:order++,is_published:true,document_kind:$('generalDocumentKind').value,document_date:$('generalDocumentDate').value||null};
      const {error}=await sb.from('documents').insert(payload);
      if(error){await removePath(path);throw error}
    }
    $('generalDocumentDialog').close();$('generalDocumentFiles').value='';await loadAll();toast(`${files.length} Dokumente hochgeladen.`);
  }catch(error){$('generalDocumentError').textContent=error.message}
}

async function renderImages(){
  const host=$('imagesGrid');host.replaceChildren();
  if(!images.length){host.innerHTML='<div class="empty">Keine Images hinterlegt.</div>';return}
  for(const item of images){
    const card=document.createElement('article');card.className='image-card';
    const img=document.createElement('img');img.alt=item.title||'Image';
    const url=await signedUrl(item.file_path);img.src=url;img.onclick=()=>openViewer(item.title||'Image',`<img src="${safe(url)}" alt="">`,url);
    const caption=document.createElement('div');caption.className='caption';caption.textContent=item.title||'';
    card.append(img,caption);
    if(isEditor()){
      const row=document.createElement('div');row.className='timeline-admin';
      const del=document.createElement('button');del.textContent='Löschen';del.onclick=()=>deleteImage(item);row.append(del);card.append(row);
    }
    host.append(card);
  }
}
async function renderSchedule(){
  const schedule=documents.find(d=>d.category==='terminplan');
  const isPdf=Boolean(schedule&&/\.pdf(?:$|\?)/i.test(schedule.file_path||''));
  $('scheduleEmpty').classList.toggle('hidden',isPdf);
  $('scheduleFrame').classList.toggle('hidden',!isPdf);
  if(isPdf){
    $('scheduleFrame').src=(await signedUrl(schedule.file_path))+'#view=FitH';
  }else{
    $('scheduleFrame').removeAttribute('src');
    $('scheduleEmpty').textContent=schedule
      ? 'Der bisherige HTML-Terminplan wird im privaten Storage nicht korrekt eingebettet. Bitte den Terminplan als PDF ersetzen.'
      : 'Noch kein Terminplan hinterlegt.';
  }
}

function renderContact(){
  const c=project.contact||{},website=c.website||'',href=/^https?:/.test(website)?website:'https://'+website;
  $('contactData').innerHTML=`<div class="contact-block">${safe(c.office||'')}</div><div class="contact-block">${safe(c.street||'')}<br>${safe(c.building||'')}<br>${safe(c.postal||'')}</div><div class="contact-block">Fon ${safe(c.phone||'')}<br>Fax ${safe(c.fax||'')}</div><div class="contact-block"><a href="mailto:${safe(c.email||'')}">${safe(c.email||'')}</a><br><a href="${safe(href)}" target="_blank" rel="noopener">${safe(website)}</a></div>`;
}

function timelineDocs(eventId){
  const ids=new Set(timelineLinks.filter(x=>x.event_id===eventId).map(x=>x.document_id));
  return documents.filter(d=>ids.has(d.id));
}
function eventFiles(eventId){return timelineFiles.filter(f=>f.event_id===eventId)}
function renderTimeline(){
  const host=$('timelineList');host.replaceChildren();
  if(!timelineEvents.length){host.innerHTML='<div class="empty">Die Timeline ist bereit. Noch wurden keine Ereignisse eingetragen.</div>';return}
  for(const event of timelineEvents){
    const item=document.createElement('article');item.className='timeline-item';
    const date=document.createElement('div');date.className='timeline-date';date.textContent=formatDate(event.event_date);
    const dot=document.createElement('div');dot.className='timeline-dot';
    const card=document.createElement('div');card.className='timeline-card';
    card.innerHTML=`<div class="timeline-category">${safe(TIMELINE_LABELS[event.category]||event.category)}</div><h2>${safe(event.title)}</h2>${event.description?`<p>${safe(event.description)}</p>`:''}`;
    const files=document.createElement('div');files.className='timeline-files';
    for(const doc of timelineDocs(event.id)){
      const b=document.createElement('button');b.textContent=doc.title;b.onclick=()=>openDocument(doc);files.append(b);
    }
    for(const file of eventFiles(event.id)){
      const b=document.createElement('button');b.textContent=file.title||file.filename;b.onclick=()=>openTimelineFile(file);files.append(b);
    }
    if(files.children.length)card.append(files);
    if(isEditor()){
      const admin=document.createElement('div');admin.className='timeline-admin';
      const edit=document.createElement('button');edit.textContent='Bearbeiten';edit.onclick=()=>openTimelineDialog(event);
      const del=document.createElement('button');del.textContent='Löschen';del.onclick=()=>deleteTimelineEvent(event);
      admin.append(edit,del);card.append(admin);
    }
    item.append(date,dot,card);host.append(item);
  }
}
async function openTimelineFile(file){
  const url=await signedUrl(file.storage_path);
  if((file.mime_type||'').startsWith('image/'))openViewer(file.title||file.filename,`<img src="${safe(url)}" alt="">`,url);
  else openViewer(file.title||file.filename,`<iframe src="${safe(url)}" title="${safe(file.title||file.filename)}"></iframe>`,url);
}

function showView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='view-'+name));
  document.querySelectorAll('.site-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  history.replaceState(null,'','#'+(name==='landing'?'':name));window.scrollTo(0,0);
}
async function refresh(){await loadAll();toast('Aktualisiert.')}
async function run(task,message){
  try{await task();await loadAll();if(message)toast(message)}catch(error){console.error(error);toast(error.message||'Aktion fehlgeschlagen.',true)}
}

function fillStandDialog(stand=null,category='plaene'){
  $('standDialogTitle').textContent=stand?'Stand bearbeiten':'Stand hinzufügen';
  $('standId').value=stand?.id||'';$('standCategory').value=stand?.category||category;
  $('standLabel').value=stand?.label||'';$('standDate').value=stand?.stand_date||'';
  $('standNote').value=stand?.note||'';$('standCurrent').checked=Boolean(stand?.is_current);
  $('standError').textContent='';$('standDialog').showModal();
}
async function saveStand(event){
  event.preventDefault();
  const id=$('standId').value||crypto.randomUUID(),category=$('standCategory').value,current=$('standCurrent').checked;
  try{
    if(current)await sb.from('document_stands').update({is_current:false}).eq('project_id',project.id).eq('category',category);
    const payload={id,project_id:project.id,category,label:$('standLabel').value.trim(),stand_date:$('standDate').value||null,note:$('standNote').value.trim(),is_current:current,sort_order:stands.filter(s=>s.category===category).length,updated_at:new Date().toISOString()};
    const {error}=await sb.from('document_stands').upsert(payload);if(error)throw error;
    $('standDialog').close();selectedStand[category]=id;await loadAll();toast('Stand gespeichert.');
  }catch(error){$('standError').textContent=error.message}
}

function fillDocumentStandOptions(category,selected=''){
  const select=$('docStand');select.replaceChildren();
  for(const stand of standList(category))select.add(new Option(formatStand(stand),stand.id));
  select.value=selected||currentStand(category)?.id||'';
}
function openDocumentDialog(doc=null,category='plaene'){
  $('docDialogTitle').textContent=doc?'Dokument bearbeiten':'Dokument hinzufügen';
  $('docId').value=doc?.id||'';$('docCategory').value=doc?.category||category;
  $('docTitle').value=doc?.title||'';$('docMeta').value=doc?.meta||'';
  $('docPdf').value='';$('docThumb').value='';fillDocumentStandOptions(doc?.category||category,doc?.stand_id||'');
  $('docError').textContent='';$('documentDialog').showModal();
}
async function saveDocument(event){
  event.preventDefault();
  const existing=documents.find(d=>d.id===$('docId').value),pdf=$('docPdf').files[0],thumb=$('docThumb').files[0];
  try{
    let filePath=existing?.file_path||'',thumbPath=existing?.thumbnail_path||'';
    if(!existing&&!pdf)throw new Error('Bitte PDF auswählen.');
    if(pdf)filePath=await upload(pdf,'documents/'+$('docCategory').value);
    if(thumb)thumbPath=await upload(thumb,'documents/'+$('docCategory').value+'/thumbs');
    const active=stands.find(s=>s.id===$('docStand').value);const payload={project_id:project.id,category:'plaene',title:$('docTitle').value.trim()||pdf?.name.replace(/\.pdf$/i,'')||existing?.title,meta:$('docMeta').value.trim(),file_path:filePath,thumbnail_path:thumbPath||null,stand_id:$('docStand').value||null,sort_order:existing?.sort_order??documents.filter(d=>d.category==='plaene'&&d.stand_id===$('docStand').value).length,is_published:true,document_kind:'plan',document_date:active?.stand_date||null};
    let result;
    if(existing)result=await sb.from('documents').update(payload).eq('id',existing.id);else result=await sb.from('documents').insert(payload);
    if(result.error)throw result.error;
    if(existing&&pdf&&existing.file_path!==filePath)await removePath(existing.file_path);
    if(existing&&thumb&&existing.thumbnail_path&&existing.thumbnail_path!==thumbPath)await removePath(existing.thumbnail_path);
    $('documentDialog').close();await loadAll();toast('Dokument gespeichert.');
  }catch(error){$('docError').textContent=error.message}
}
async function deleteDocument(doc){
  if(!confirm(`„${doc.title}“ wirklich löschen?`))return;
  await run(async()=>{
    const {error}=await sb.from('documents').delete().eq('id',doc.id);if(error)throw error;
    await Promise.all([removePath(doc.file_path),removePath(doc.thumbnail_path)]);
  },'Dokument gelöscht.');
}

async function addImageFromInput(file){
  if(!file)return;
  await run(async()=>{
    const path=await upload(file,'images');
    const {error}=await sb.from('images').insert({project_id:project.id,title:file.name,file_path:path,sort_order:images.length,is_published:true});
    if(error){await removePath(path);throw error}
  },'Image gespeichert.');
}
async function deleteImage(item){
  if(!confirm(`„${item.title}“ wirklich löschen?`))return;
  await run(async()=>{const {error}=await sb.from('images').delete().eq('id',item.id);if(error)throw error;await removePath(item.file_path)},'Image gelöscht.');
}

function fillTimelineDocs(selectedIds=new Set()){
  const host=$('timelineDocuments');host.replaceChildren();
  const rows=documents.filter(d=>d.category!=='terminplan').sort((a,b)=>a.title.localeCompare(b.title));
  for(const doc of rows){
    const label=document.createElement('label');label.className='check-row';
    const input=document.createElement('input');input.type='checkbox';input.value=doc.id;input.checked=selectedIds.has(doc.id);
    label.append(input,document.createTextNode(doc.title+' · '+(stands.find(s=>s.id===doc.stand_id)?.label||'')));host.append(label);
  }
}
function openTimelineDialog(event=null){
  $('timelineDialogTitle').textContent=event?'Ereignis bearbeiten':'Timeline-Ereignis hinzufügen';
  $('timelineId').value=event?.id||'';$('timelineDate').value=event?.event_date||new Date().toISOString().slice(0,10);
  $('timelineCategory').value=event?.category||'versand';$('timelineTitle').value=event?.title||'';$('timelineDescription').value=event?.description||'';
  $('timelineFilesInput').value='';
  fillTimelineDocs(new Set(event?timelineLinks.filter(x=>x.event_id===event.id).map(x=>x.document_id):[]));
  $('timelineError').textContent='';$('timelineDialog').showModal();
}
async function saveTimelineEvent(event){
  event.preventDefault();
  const existing=timelineEvents.find(e=>e.id===$('timelineId').value),id=existing?.id||crypto.randomUUID();
  try{
    const payload={id,project_id:project.id,event_date:$('timelineDate').value,category:$('timelineCategory').value,title:$('timelineTitle').value.trim(),description:$('timelineDescription').value.trim(),sort_order:existing?.sort_order||0,updated_at:new Date().toISOString()};
    const {error}=await sb.from('timeline_events').upsert(payload);if(error)throw error;
    await sb.from('timeline_event_documents').delete().eq('event_id',id);
    const selected=[...$('timelineDocuments').querySelectorAll('input:checked')].map(x=>({event_id:id,document_id:x.value,sort_order:0}));
    if(selected.length){const res=await sb.from('timeline_event_documents').insert(selected);if(res.error)throw res.error}
    let order=eventFiles(id).length;
    for(const file of [...$('timelineFilesInput').files]){
      const path=await upload(file,'timeline/'+id);
      const res=await sb.from('timeline_files').insert({project_id:project.id,event_id:id,title:file.name,filename:file.name,storage_path:path,mime_type:file.type||'',size_bytes:file.size||0,sort_order:order++});
      if(res.error){await removePath(path);throw res.error}
    }
    $('timelineDialog').close();await loadAll();toast('Timeline aktualisiert.');
  }catch(error){$('timelineError').textContent=error.message}
}
async function deleteTimelineEvent(event){
  if(!confirm(`„${event.title}“ wirklich löschen?`))return;
  await run(async()=>{
    const files=eventFiles(event.id);
    if(files.length)await sb.storage.from(BUCKET).remove(files.map(f=>f.storage_path));
    const {error}=await sb.from('timeline_events').delete().eq('id',event.id);if(error)throw error;
  },'Timeline-Ereignis gelöscht.');
}

async function saveLanding(file){
  if(!file)return;
  await run(async()=>{
    const path=await upload(file,'landing'),old=project.landing_path;
    const {error}=await sb.from('projects').update({landing_path:path}).eq('id',project.id);if(error){await removePath(path);throw error}
    if(old)await removePath(old);
  },'Landing-Bild gespeichert.');
}
async function saveSchedule(file){
  if(!file)return;
  if(!/\.pdf$/i.test(file.name)){toast('Bitte den Terminplan als PDF hochladen.',true);return}
  await run(async()=>{
    const current=documents.find(d=>d.category==='terminplan'),path=await upload(file,'documents/terminplan');
    const payload={project_id:project.id,category:'terminplan',title:'Planungsterminplan LPH 3 · Vorabzug',meta:'PDF · Vorabzug',file_path:path,thumbnail_path:null,stand_id:null,sort_order:0,is_published:true,document_kind:'terminplan',document_date:null};
    const res=current?await sb.from('documents').update(payload).eq('id',current.id):await sb.from('documents').insert(payload);
    if(res.error){await removePath(path);throw res.error}
    if(current)await removePath(current.file_path);
  },'Terminplan gespeichert.');
}

function bind(){
  document.querySelectorAll('[data-login-role]').forEach(b=>b.onclick=()=>setRole(b.dataset.loginRole));
  $('roleLoginForm').onsubmit=async e=>{
    e.preventDefault();$('authMessage').textContent='';
    const {data,error}=await sb.auth.signInWithPassword({email:ROLE_EMAILS[selectedRole],password:$('rolePassword').value});
    if(error){$('authMessage').textContent='Login nicht möglich. Bitte Passwort prüfen.';return}
    await routeSession(data.session);
  };
  $('backToRoleLogin').onclick=()=>{history.replaceState(null,'',location.pathname);sb.auth.signOut();showAuth('roles')};
  $('bootstrapLoginForm').onsubmit=async e=>{
    e.preventDefault();$('bootstrapStatus').textContent='';
    const {data,error}=await sb.auth.signInWithPassword({email:$('bootstrapEmail').value.trim(),password:$('bootstrapPassword').value});
    if(error){$('bootstrapStatus').textContent=error.message;return}
    await routeSession(data.session);
  };
  $('provisionAccess').onclick=provisionAccess;
  $('printExternalCredentials').onclick=()=>printCredentials(provisionedCredentials);
  $('bootstrapDone').onclick=async()=>{await sb.auth.signOut();showAuth('roles');setRole('tba')};
  $('logout').onclick=()=>sb.auth.signOut();

  document.querySelectorAll('.site-nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));
  $('projectName').onclick=()=>showView('landing');
  $('viewerClose').onclick=()=>{$('viewerModal').classList.remove('open');$('viewerBody').replaceChildren()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('viewerModal').classList.contains('open'))$('viewerClose').click()});

  $('standSelect-plaene').onchange=e=>{selectedStand.plaene=e.target.value;renderStandSection('plaene')};
  $('addStand-plaene').onclick=()=>fillStandDialog(null,'plaene');
  $('editStand-plaene').onclick=()=>{const s=currentStand('plaene');if(s)fillStandDialog(s)};
  $('planFiles').onchange=async e=>{try{await uploadPlanFiles(e.target.files)}catch(error){toast(error.message||'Upload fehlgeschlagen.',true)}finally{e.target.value=''}};
  $('standForm').onsubmit=saveStand;$('closeStandDialog').onclick=()=>$('standDialog').close();

  $('documentForm').onsubmit=saveDocument;$('closeDocumentDialog').onclick=()=>$('documentDialog').close();
  $('addGeneralDocument').onclick=()=>{$('generalDocumentError').textContent='';$('generalDocumentDate').value=new Date().toISOString().slice(0,10);$('generalDocumentFiles').value='';$('generalDocumentDialog').showModal()};
  $('generalDocumentForm').onsubmit=saveGeneralDocuments;$('closeGeneralDocumentDialog').onclick=()=>$('generalDocumentDialog').close();

  $('addTimeline').onclick=()=>openTimelineDialog();$('timelineForm').onsubmit=saveTimelineEvent;$('closeTimelineDialog').onclick=()=>$('timelineDialog').close();

  $('landingFile').onchange=e=>{saveLanding(e.target.files[0]);e.target.value=''};
  $('imageFile').onchange=e=>{addImageFromInput(e.target.files[0]);e.target.value=''};
  $('scheduleFile').onchange=e=>{saveSchedule(e.target.files[0]);e.target.value=''};
  $('saveProjectName').onclick=()=>run(async()=>{const value=$('projectNameInput').value.trim();const {error}=await sb.from('projects').update({project_name:value}).eq('id',project.id);if(error)throw error},'Projektname gespeichert.');
  $('saveModelUrl').onclick=()=>run(async()=>{const d5_url=$('modelUrlInput').value.trim();const {error}=await sb.from('projects').update({d5_url}).eq('id',project.id);if(error)throw error},'3D-Link gespeichert.');
  $('editContact').onclick=()=>$('contactData').contentEditable='true';
  $('saveContact').onclick=()=>run(async()=>{
    $('contactData').contentEditable='false';
    const blocks=$('contactData').querySelectorAll('.contact-block'),address=(blocks[1]?.innerText||'').split('\n'),phones=(blocks[2]?.innerText||'').split('\n'),links=blocks[3]?.querySelectorAll('a')||[];
    const contact={office:(blocks[0]?.innerText||'').trim(),street:(address[0]||'').trim(),building:(address[1]||'').trim(),postal:(address[2]||'').trim(),phone:(phones[0]||'').replace(/^Fon\s*/,'').trim(),fax:(phones[1]||'').replace(/^Fax\s*/,'').trim(),email:(links[0]?.textContent||'').trim(),website:(links[1]?.textContent||'').trim()};
    const {error}=await sb.from('projects').update({contact}).eq('id',project.id);if(error)throw error;
  },'Kontaktdaten gespeichert.');
}

async function boot(){
  bind();setRole('tba');
  const {data,error}=await sb.auth.getSession();
  if(error){showAuth('roles');return}
  await routeSession(data.session);
  sb.auth.onAuthStateChange((_event,next)=>setTimeout(()=>routeSession(next).catch(err=>{console.error(err);showAuth('roles')}),0));
}

boot().catch(error=>{console.error(error);showAuth('roles');$('authMessage').textContent=error.message||'Start fehlgeschlagen.'});
})();
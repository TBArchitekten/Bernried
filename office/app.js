(()=>{
  'use strict';

  const SUPABASE_URL='https://mmrteayudgywutghpdev.supabase.co';
  const SUPABASE_KEY='sb_publishable_P4lOIuijwNF7oleGDoeAuQ_7OLJOaGV';
  const sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{storageKey:'tba-office-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

  const $=s=>document.querySelector(s);
  const authView=$('#authView');
  const appView=$('#appView');
  const loginForm=$('#loginForm');
  const createDialog=$('#createDialog');
  const createForm=$('#createForm');
  const recoveryForm=$('#recoveryForm');
  let recoveryMode=false;
  let creating=false;
  let member=null;
  let user=null;
  let templates=[];
  let instances=[];

  const iso=d=>d.toISOString().slice(0,10);
  const parseDate=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d))};
  const isWeekend=d=>{const wd=d.getUTCDay();return wd===0||wd===6};
  const nextWorkday=d=>{const x=new Date(d);while(isWeekend(x))x.setUTCDate(x.getUTCDate()+1);return x};
  function addWorkdays(start,offset){
    let d=nextWorkday(parseDate(start));
    let remaining=Math.max(0,Number(offset)||0);
    while(remaining>0){
      d.setUTCDate(d.getUTCDate()+1);
      if(!isWeekend(d))remaining--;
    }
    return iso(d);
  }
  function workdayOffset(base,target){
    const b=nextWorkday(parseDate(base));
    const t=parseDate(target);
    let d=new Date(b),count=0;
    while(d<t){
      d.setUTCDate(d.getUTCDate()+1);
      if(!isWeekend(d))count++;
    }
    return count;
  }
  function formatDate(s){
    if(!s)return '—';
    return parseDate(s).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
  }
  function esc(v){
    return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
  function today(){
    const n=new Date();
    return [n.getFullYear(),String(n.getMonth()+1).padStart(2,'0'),String(n.getDate()).padStart(2,'0')].join('-');
  }

  function switchView(name){
    document.querySelectorAll('.view').forEach(v=>v.hidden=true);
    document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
    const view=name==='plans'?$('#plansView'):$('#toolsView');
    view.hidden=false;
  }

  async function ownMembership(uid){
    const {data,error}=await sb.from('office_members')
      .select('user_id,role,display_name,is_active')
      .eq('user_id',uid)
      .eq('is_active',true)
      .maybeSingle();
    if(error)throw error;
    return data;
  }

  async function boot(session){
    if(!session){
      authView.hidden=false;
      appView.hidden=true;
      return;
    }
    user=session.user;
    member=await ownMembership(user.id);
    if(!member){
      await sb.auth.signOut();
      authView.hidden=false;
      appView.hidden=true;
      $('#loginMessage').textContent='Für dieses Konto ist kein Office-Zugang freigeschaltet.';
      return;
    }
    authView.hidden=true;
    appView.hidden=false;
    $('#memberName').textContent=member.display_name||user.email||'TBA';
    await loadData();
  }

  async function loadData(){
    const [tplRes,planRes]=await Promise.all([
      sb.from('office_terminplan_templates')
        .select('id,phase,title,description,version,status,state,updated_at')
        .eq('is_active',true)
        .order('phase'),
      sb.from('office_terminplan_instances')
        .select('id,project_number,project_name,phase,template_version,owner_id,state,updated_at')
        .eq('is_archived',false)
        .order('updated_at',{ascending:false})
    ]);
    if(tplRes.error)throw tplRes.error;
    if(planRes.error)throw planRes.error;
    templates=tplRes.data||[];
    instances=planRes.data||[];
    renderTemplates();
    renderPlans();
  }

  function renderTemplates(){
    const host=$('#templateGrid');
    host.innerHTML='';
    if(!templates.length){
      host.innerHTML='<div class="empty">Noch keine Muster-Terminpläne hinterlegt.</div>';
      return;
    }
    for(const tpl of templates){
      const card=document.createElement('article');
      card.className='template-card';
      card.innerHTML=`
        <div class="top">
          <div>
            <div class="badge">${esc(tpl.phase)} · Version ${esc(tpl.version)}</div>
            <h3>${esc(tpl.title)}</h3>
          </div>
          <span class="badge">${esc(tpl.status||'Muster')}</span>
        </div>
        <p>${esc(tpl.description||'')}</p>
        <div class="template-actions">
          <button type="button" data-preview>Vorschau</button>
          <button type="button" class="primary" data-create>Terminplan erstellen</button>
        </div>`;
      card.querySelector('[data-preview]').onclick=()=>location.href='./terminplan.html?template='+encodeURIComponent(tpl.id);
      card.querySelector('[data-create]').onclick=()=>openCreate(tpl.phase);
      host.append(card);
    }
  }

  function renderPlans(){
    const host=$('#planList');
    $('#planCount').textContent=String(instances.length);
    host.innerHTML='';
    if(!instances.length){
      host.innerHTML='<div class="empty">Noch keine Projektterminpläne. Erstelle den ersten aus einem Muster.</div>';
      return;
    }
    for(const p of instances){
      const row=document.createElement('div');
      row.className='plan-row';
      const stand=p.state?.project?.standDate||p.updated_at?.slice(0,10);
      row.innerHTML=`
        <div class="number">${esc(p.project_number||'—')}</div>
        <div class="name">${esc(p.project_name)}</div>
        <div class="phase">${esc(p.phase)}</div>
        <div class="date">Stand ${esc(formatDate(stand))}</div>
        <button type="button">Öffnen →</button>`;
      row.onclick=e=>{if(e.target.closest('button')||e.currentTarget===row) location.href='./terminplan.html?id='+encodeURIComponent(p.id)};
      host.append(row);
    }
  }

  function openCreate(phase='LPH3'){
    $('#phase').value=phase;
    $('#projectStart').value=today();
    $('#projectNumber').value='';
    $('#projectName').value='';
    $('#createMessage').textContent='';
    createDialog.showModal();
  }

  function cloneStateForProject(templateState,start,number,name,phase,version){
    const state=structuredClone(templateState);
    const base=state.project.start;
    const moveDate=value=>addWorkdays(start,workdayOffset(base,value));
    state.project={
      ...state.project,
      name:`${number} ${name} · ${phase.replace('LPH','LPH ')}`,
      projectNumber:number,
      projectName:name,
      phase,
      templateVersion:version,
      start,
      end:moveDate(state.project.end),
      standDate:today(),
      standLabel:'Projektstart'
    };
    state.tasks=(state.tasks||[]).map(task=>({
      ...task,
      start:moveDate(task.start),
      end:moveDate(task.end)
    }));
    return state;
  }

  loginForm.addEventListener('submit',async e=>{
    e.preventDefault();
    $('#loginMessage').textContent='';
    const {data,error}=await sb.auth.signInWithPassword({
      email:$('#email').value.trim(),
      password:$('#password').value
    });
    if(error){
      $('#loginMessage').textContent='Anmeldung fehlgeschlagen. Bitte das Passwort Ihres persönlichen TBA-Kontos prüfen (nicht das Bernried-Projektpasswort).';
      return;
    }
    try{await boot(data.session)}
    catch(err){
      console.error(err);
      $('#loginMessage').textContent='Office konnte nicht geladen werden.';
    }
  });

  $('#logoutBtn').onclick=async()=>{await sb.auth.signOut();location.reload()};
  $('#openTerminplanTool').onclick=()=>switchView('plans');
  $('#newPlanBtn').onclick=()=>openCreate('LPH3');
  $('#cancelCreate').onclick=()=>createDialog.close();
  document.querySelectorAll('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));

  createForm.addEventListener('submit',async e=>{
    e.preventDefault();
    $('#createMessage').textContent='';
    const phase=$('#phase').value;
    const tpl=templates.find(t=>t.phase===phase);
    if(!tpl){
      $('#createMessage').textContent='Für diese Leistungsphase ist kein aktives Muster verfügbar.';
      return;
    }
    const projectNumber=$('#projectNumber').value.trim();
    const projectName=$('#projectName').value.trim();
    const projectStart=$('#projectStart').value;
    if(!projectNumber||!projectName||!projectStart)return;

    if(isWeekend(parseDate(projectStart))){
      $('#createMessage').textContent='Bitte einen Werktag als Projektstart wählen.';
      return;
    }
    if(creating)return;
    creating=true;
    const submitBtn=createForm.querySelector('button[type="submit"]');
    submitBtn.disabled=true;
    try{
      const state=cloneStateForProject(tpl.state,projectStart,projectNumber,projectName,phase,tpl.version);
      const {data,error}=await sb.from('office_terminplan_instances').insert({
      template_id:tpl.id,
      template_version:tpl.version,
      project_number:projectNumber,
      project_name:projectName,
      phase,
      owner_id:user.id,
      state,
      source:'template'
    }).select('id').single();
      if(error)throw error;
      location.href='./terminplan.html?id='+encodeURIComponent(data.id);
    }catch(error){
      console.error(error);
      $('#createMessage').textContent='Terminplan konnte nicht erstellt werden.';
    }finally{
      creating=false;
      submitBtn.disabled=false;
    }
  });

  $('#resetPasswordBtn').addEventListener('click',async()=>{
    const email=$('#email').value.trim();
    if(!email||!$('#email').checkValidity()){
      $('#loginMessage').textContent='Bitte zuerst Ihre persönliche TBA-E-Mail-Adresse eingeben.';
      $('#email').focus();
      return;
    }
    const button=$('#resetPasswordBtn');
    button.disabled=true;
    $('#loginMessage').textContent='';
    try{
      const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
      if(error)throw error;
      $('#loginMessage').textContent='Wenn das Konto existiert, erhalten Sie eine E-Mail zum Zurücksetzen des Passworts. Bitte auch den Spam-Ordner prüfen.';
    }catch(error){
      console.error(error);
      $('#loginMessage').textContent='Passwort-E-Mail konnte nicht angefordert werden. Bitte die Office-Administration kontaktieren.';
    }finally{
      button.disabled=false;
    }
  });

  recoveryForm.addEventListener('submit',async event=>{
    event.preventDefault();
    const password=$('#newPassword').value;
    if(password!==$('#confirmPassword').value){
      $('#recoveryMessage').textContent='Die Passwörter stimmen nicht überein.';
      return;
    }
    const button=recoveryForm.querySelector('button[type="submit"]');
    button.disabled=true;
    $('#recoveryMessage').textContent='';
    const {error}=await sb.auth.updateUser({password});
    if(error){
      console.error(error);
      $('#recoveryMessage').textContent='Passwort konnte nicht gespeichert werden. Bitte den Link erneut öffnen.';
      button.disabled=false;
      return;
    }
    recoveryMode=false;
    await sb.auth.signOut();
    location.replace(location.origin+location.pathname);
  });

  sb.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      recoveryMode=true;
      authView.hidden=false;
      appView.hidden=true;
      loginForm.hidden=true;
      recoveryForm.hidden=false;
      return;
    }
    if(recoveryMode)return;
    setTimeout(()=>boot(session).catch(err=>{
    console.error(err);
    authView.hidden=false;appView.hidden=true;
  }),0);
  });

  sb.auth.getSession().then(({data})=>{
    if(!recoveryMode)boot(data.session).catch(console.error);
  }).catch(console.error);
})();
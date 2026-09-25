(() => {
  'use strict';

  const SUPABASE_URL = 'https://mmrteayudgywutghpdev.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_P4lOIuijwNF7oleGDoeAuQ_7OLJOaGV';
  const PROJECT_SLUG = 'bernried';
  const PRIVATE_BUCKET = 'minds-private';

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
  });

  let project = null;
  let user = null;
  let conversation = null;

  const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  const id = value => uuid(value) ? value : crypto.randomUUID();

  function fail(result, label) {
    if (result?.error) throw new Error(label + ': ' + result.error.message);
    return result?.data;
  }

  async function init() {
    const {data:{session}} = await client.auth.getSession();
    if (!session?.user) throw new Error('Keine aktive Anmeldung. MINDS bitte über den Project Hub öffnen.');
    user = session.user;

    const p = await client.from('projects').select('id,slug,project_name').eq('slug', PROJECT_SLUG).single();
    project = fail(p, 'Projekt konnte nicht geladen werden');

    const membership = await client.from('project_admins')
      .select('project_id,user_id')
      .eq('project_id', project.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership.error) throw new Error('Projektberechtigung konnte nicht geprüft werden: ' + membership.error.message);
    if (!membership.data) throw new Error('Dieses Konto hat keinen MINDS-Zugriff auf Bernried.');

    return {project, user};
  }

  function entryFromRow(r) {
    return {
      id:r.id, kind:r.kind, state:r.state, title:r.title, body:r.body || '',
      alternatives:r.alternatives || '', outcome:r.outcome || '', owner:r.owner || '',
      due:r.due || '', reference:r.reference || '', source:r.source || null,
      bucketId:r.bucket_id || '', sortOrder:r.sort_order || 0, priority:r.priority || 'medium',
      startDate:r.start_date || '', recurrence:r.recurrence || 'none',
      labels:Array.isArray(r.labels) ? r.labels : [], showOnCard:Boolean(r.show_on_card),
      checklist:Array.isArray(r.checklist) ? r.checklist : [],
      createdAt:r.created_at, updatedAt:r.updated_at, archived:Boolean(r.archived), version:r.version || 1
    };
  }

  function entryToRow(e) {
    return {
      id:id(e.id), project_id:project.id, kind:e.kind, state:e.state, title:e.title,
      body:e.body || '', alternatives:e.alternatives || '', outcome:e.outcome || '',
      owner:e.owner || '', due:e.due || null, reference:e.reference || '',
      source:e.source || null, archived:Boolean(e.archived),
      bucket_id:e.bucketId || null, sort_order:Number.isInteger(e.sortOrder) ? e.sortOrder : 0,
      priority:e.priority || 'medium', checklist:Array.isArray(e.checklist) ? e.checklist : [],
      start_date:e.startDate || null, recurrence:e.recurrence || 'none',
      labels:Array.isArray(e.labels) ? e.labels : [], show_on_card:Boolean(e.showOnCard),
      created_at:e.createdAt || new Date().toISOString(),
      updated_at:new Date().toISOString()
    };
  }

  function mailFromRow(r) {
    return {
      id:r.id, sender:r.sender || '', recipients:r.recipients || '', subject:r.subject,
      body:r.body || '', date:r.mail_date || '', messageId:r.message_id || '',
      threadKey:r.thread_key || '', createdAt:r.created_at, updatedAt:r.updated_at,
      archived:Boolean(r.archived)
    };
  }

  function mailToRow(m) {
    return {
      id:id(m.id), project_id:project.id, sender:m.sender || '', recipients:m.recipients || '',
      subject:m.subject, body:m.body || '', mail_date:m.date || null,
      message_id:m.messageId || '', thread_key:m.threadKey || '',
      archived:Boolean(m.archived), created_at:m.createdAt || new Date().toISOString(),
      updated_at:new Date().toISOString()
    };
  }

  async function loadEntries() {
    const r = await client.from('minds_entries').select('*').eq('project_id', project.id).order('updated_at', {ascending:false});
    return fail(r, 'Memory konnte nicht geladen werden').map(entryFromRow);
  }

  async function loadMails() {
    const r = await client.from('minds_mails').select('*').eq('project_id', project.id).order('mail_date', {ascending:false, nullsFirst:false});
    return fail(r, 'Mail konnte nicht geladen werden').map(mailFromRow);
  }

  function bucketFromRow(r) {
    return {
      id:r.id, name:r.name, sortOrder:r.sort_order || 0, archived:Boolean(r.archived),
      createdAt:r.created_at, updatedAt:r.updated_at
    };
  }

  async function loadBuckets() {
    const r = await client.from('minds_buckets').select('*').eq('project_id', project.id).eq('archived', false)
      .order('sort_order', {ascending:true}).order('created_at', {ascending:true});
    return fail(r, 'Buckets konnten nicht geladen werden').map(bucketFromRow);
  }

  async function saveBucket(bucket) {
    const row = {
      id:id(bucket.id), project_id:project.id, name:String(bucket.name || '').trim(),
      sort_order:Number.isInteger(bucket.sortOrder) ? bucket.sortOrder : 0,
      archived:Boolean(bucket.archived), updated_at:new Date().toISOString()
    };
    if (!row.name) throw new Error('Bucket braucht einen Namen.');
    const r = await client.from('minds_buckets').upsert(row).select('*').single();
    const saved = bucketFromRow(fail(r, 'Bucket konnte nicht gespeichert werden'));
    event('entry', saved.id, bucket.id ? 'bucket_updated' : 'bucket_created', {name:saved.name});
    return saved;
  }

  async function archiveBucket(bucketId) {
    const tasks = await client.from('minds_entries').select('id').eq('project_id', project.id)
      .eq('kind','task').eq('bucket_id', bucketId).eq('archived', false).limit(1);
    if (tasks.error) throw new Error('Bucket konnte nicht geprüft werden: ' + tasks.error.message);
    if (tasks.data?.length) throw new Error('Bucket enthält noch Aufgaben. Verschiebe sie zuerst.');
    const r = await client.from('minds_buckets').update({archived:true,updated_at:new Date().toISOString()})
      .eq('project_id',project.id).eq('id',bucketId);
    if (r.error) throw new Error('Bucket konnte nicht archiviert werden: ' + r.error.message);
    event('entry', bucketId, 'bucket_archived', {});
  }

  async function saveEntry(entry) {
    const existed = Boolean(entry?.id && uuid(entry.id));
    const row = entryToRow(entry);
    const r = await client.from('minds_entries').upsert(row).select('*').single();
    const saved = entryFromRow(fail(r, 'Memory konnte nicht gespeichert werden'));
    event('entry', saved.id, existed ? 'updated' : 'created', {kind:saved.kind,state:saved.state});
    return saved;
  }

  async function saveMail(mail) {
    const existed = Boolean(mail?.id && uuid(mail.id));
    const row = mailToRow(mail);
    const r = await client.from('minds_mails').upsert(row).select('*').single();
    const saved = mailFromRow(fail(r, 'E-Mail konnte nicht gespeichert werden'));
    event('mail', saved.id, existed ? 'updated' : 'created', {subject:saved.subject});
    await indexMailText(saved);
    return saved;
  }

  async function event(entityType, entityId, eventType, payload={}) {
    const r = await client.from('minds_events').insert({
      project_id:project.id, actor_user_id:user.id, entity_type:entityType,
      entity_id:String(entityId), event_type:eventType, payload
    });
    if (r.error) console.warn('MINDS event not recorded:', r.error.message);
  }

  async function ensureConversation() {
    if (conversation) return conversation;
    const latest = await client.from('minds_conversations')
      .select('*')
      .eq('project_id', project.id)
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('updated_at', {ascending:false})
      .limit(1)
      .maybeSingle();
    if (latest.error) throw new Error('Gespräch konnte nicht geladen werden: ' + latest.error.message);
    if (latest.data) {
      conversation = latest.data;
      return conversation;
    }
    const created = await client.from('minds_conversations').insert({
      project_id:project.id, user_id:user.id, title:'Working conversation', mode:'memory'
    }).select('*').single();
    conversation = fail(created, 'Gespräch konnte nicht erstellt werden');
    return conversation;
  }

  async function loadMessages() {
    const c = await ensureConversation();
    const r = await client.from('minds_messages')
      .select('*')
      .eq('project_id', project.id)
      .eq('conversation_id', c.id)
      .order('created_at', {ascending:true});
    return fail(r, 'Gesprächsverlauf konnte nicht geladen werden').map(x => ({
      id:x.id, role:x.role, text:x.content, extras:x.metadata || null, createdAt:x.created_at
    }));
  }

  async function appendMessage(role, text, metadata={}) {
    const c = await ensureConversation();
    const r = await client.from('minds_messages').insert({
      project_id:project.id, conversation_id:c.id, user_id:user.id,
      role, content:text, metadata:metadata || {}
    }).select('*').single();
    const row = fail(r, 'Nachricht konnte nicht gespeichert werden');
    await client.from('minds_conversations').update({updated_at:new Date().toISOString()}).eq('id', c.id);
    return {id:row.id, role:row.role, text:row.content, extras:row.metadata || null, createdAt:row.created_at};
  }

  async function newConversation() {
    if (conversation) {
      const a = await client.from('minds_conversations').update({archived:true,updated_at:new Date().toISOString()}).eq('id',conversation.id);
      if (a.error) throw new Error('Altes Gespräch konnte nicht archiviert werden: ' + a.error.message);
    }
    conversation = null;
    return ensureConversation();
  }

  async function migrateLocal(entries, mails) {
    const remoteEntries = await loadEntries();
    const remoteMails = await loadMails();
    const entryIds = new Set(remoteEntries.map(x => x.id));
    const mailIds = new Set(remoteMails.map(x => x.id));
    let entryCount = 0, mailCount = 0;

    for (const e of entries || []) {
      const row = entryToRow({...e,id:id(e.id)});
      if (entryIds.has(row.id)) continue;
      const r = await client.from('minds_entries').insert(row);
      if (r.error) throw new Error('Lokale Memory-Migration fehlgeschlagen: ' + r.error.message);
      entryCount++;
    }
    for (const m of mails || []) {
      const row = mailToRow({...m,id:id(m.id)});
      if (mailIds.has(row.id)) continue;
      const r = await client.from('minds_mails').insert(row);
      if (r.error) throw new Error('Lokale Mail-Migration fehlgeschlagen: ' + r.error.message);
      mailCount++;
    }
    await event('source', project.id, 'local_migration', {entries:entryCount,mails:mailCount});
    return {entries:entryCount,mails:mailCount};
  }

  async function sha256Text(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,'0')).join('');
  }

  function chunkText(text, max = 1600) {
    const clean = String(text || '').replace(/\r\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    if (!clean) return [];
    const parts = clean.split(/\n\n+/).map(x => x.trim()).filter(Boolean);
    const chunks = [];
    let current = '';
    for (const part of parts) {
      if ((current + '\n\n' + part).length <= max) {
        current = current ? current + '\n\n' + part : part;
      } else {
        if (current) chunks.push(current);
        if (part.length <= max) current = part;
        else {
          for (let i=0;i<part.length;i+=max) chunks.push(part.slice(i,i+max));
          current = '';
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  async function indexMailText(mail) {
    const body = String(mail.body || '').trim();
    if (!body) return null;
    const checksum = await sha256Text(body);
    const sourceRow = {
      project_id:project.id, created_by:user.id, source_type:'email',
      origin_type:'mail', origin_id:mail.id, title:mail.subject,
      mime_type:'text/plain', checksum, status:'ready',
      metadata:{sender:mail.sender || '', recipients:mail.recipients || '', date:mail.date || ''},
      captured_at:new Date().toISOString(), updated_at:new Date().toISOString()
    };
    const sr = await client.from('minds_sources').upsert(sourceRow,{onConflict:'project_id,origin_type,origin_id'}).select('*').single();
    const source = fail(sr, 'E-Mail konnte nicht indexiert werden');
    const del = await client.from('minds_chunks').delete().eq('project_id',project.id).eq('source_id',source.id);
    if (del.error) throw new Error('Alter E-Mail-Index konnte nicht ersetzt werden: ' + del.error.message);
    const chunks = chunkText(body).map((content,chunk_index)=>({
      project_id:project.id, source_id:source.id, chunk_index, content,
      locator:{kind:'email',mailId:mail.id,subject:mail.subject,sender:mail.sender || '',date:mail.date || ''},
      content_hash:''
    }));
    if (chunks.length) {
      const ins = await client.from('minds_chunks').insert(chunks);
      if (ins.error) throw new Error('E-Mail-Chunks konnten nicht gespeichert werden: ' + ins.error.message);
    }
    await event('source', source.id, 'indexed', {sourceType:'email',chunks:chunks.length});
    return source;
  }

  async function searchChunks(query, limit=8) {
    const q = String(query || '').trim();
    if (!q) return [];
    const r = await client.from('minds_chunks')
      .select('id,content,locator,chunk_index,source_id,minds_sources!inner(title,source_type,origin_type,origin_id,captured_at)')
      .eq('project_id',project.id)
      .textSearch('content', q, {config:'simple', type:'plain'})
      .limit(limit);
    const data = fail(r, 'Projektindex konnte nicht durchsucht werden');
    return data.map(row => ({
      id:row.id, content:row.content, locator:row.locator || {}, chunkIndex:row.chunk_index,
      sourceId:row.source_id, sourceTitle:row.minds_sources?.title || 'Quelle',
      sourceType:row.minds_sources?.source_type || 'other', capturedAt:row.minds_sources?.captured_at || ''
    }));
  }

  async function loadTaskComments(entryId) {
    const r = await client.from('minds_task_comments').select('*')
      .eq('project_id', project.id).eq('entry_id', entryId)
      .order('created_at', {ascending:true});
    return fail(r, 'Aufgabenchat konnte nicht geladen werden').map(row=>({
      id:row.id, entryId:row.entry_id, userId:row.user_id, content:row.content, createdAt:row.created_at
    }));
  }

  async function addTaskComment(entryId, content) {
    const text=String(content||'').trim();
    if(!text) throw new Error('Kommentar ist leer.');
    const r=await client.from('minds_task_comments').insert({
      project_id:project.id, entry_id:entryId, user_id:user.id, content:text
    }).select('*').single();
    const row=fail(r,'Kommentar konnte nicht gespeichert werden');
    await event('entry', entryId, 'comment_added', {commentId:row.id});
    return {id:row.id,entryId:row.entry_id,userId:row.user_id,content:row.content,createdAt:row.created_at};
  }

  async function loadTaskFiles(entryId) {
    const r=await client.from('minds_task_files').select('*')
      .eq('project_id',project.id).eq('entry_id',entryId).order('created_at',{ascending:true});
    return fail(r,'Aufgabenanhänge konnten nicht geladen werden');
  }

  async function uploadTaskFile(entryId,file) {
    if(!entryId||!file) throw new Error('Aufgabe und Datei erforderlich.');
    const safe=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,180);
    const path=`${PROJECT_SLUG}/tasks/${entryId}/${crypto.randomUUID()}-${safe}`;
    const upload=await client.storage.from(PRIVATE_BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
    if(upload.error) throw new Error('Anhang konnte nicht hochgeladen werden: '+upload.error.message);
    const r=await client.from('minds_task_files').insert({
      project_id:project.id,entry_id:entryId,uploaded_by:user.id,storage_path:path,
      filename:file.name,mime_type:file.type||'',size_bytes:file.size||0,external_url:''
    }).select('*').single();
    if(r.error){
      await client.storage.from(PRIVATE_BUCKET).remove([path]);
      throw new Error('Anhang konnte nicht registriert werden: '+r.error.message);
    }
    await event('entry',entryId,'file_added',{fileId:r.data.id,filename:file.name});
    return r.data;
  }

  async function addTaskLink(entryId,url,label='Link') {
    const parsed=new URL(url);
    if(!['http:','https:'].includes(parsed.protocol)) throw new Error('Nur HTTP/HTTPS-Links sind erlaubt.');
    const r=await client.from('minds_task_files').insert({
      project_id:project.id,entry_id:entryId,uploaded_by:user.id,storage_path:'',
      filename:String(label||parsed.hostname).slice(0,500),mime_type:'text/uri-list',size_bytes:0,external_url:parsed.href
    }).select('*').single();
    const row=fail(r,'Link konnte nicht gespeichert werden');
    await event('entry',entryId,'link_added',{fileId:row.id,url:parsed.href});
    return row;
  }

  async function signedTaskFile(fileRow) {
    if(fileRow.external_url) return fileRow.external_url;
    const r=await client.storage.from(PRIVATE_BUCKET).createSignedUrl(fileRow.storage_path,300);
    if(r.error) throw new Error('Anhang konnte nicht geöffnet werden: '+r.error.message);
    return r.data.signedUrl;
  }

  async function uploadRawMailFile(mailId,file) {
    if(!mailId||!file) throw new Error('Mail und Datei erforderlich.');
    const safe=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,180);
    const path=`${PROJECT_SLUG}/mail/${mailId}/raw-${crypto.randomUUID()}-${safe}`;
    const upload=await client.storage.from(PRIVATE_BUCKET).upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
    if(upload.error) throw new Error('Originalmail konnte nicht hochgeladen werden: '+upload.error.message);
    const row=await client.from('minds_mail_files').insert({
      project_id:project.id,mail_id:mailId,uploaded_by:user.id,storage_path:path,
      filename:file.name,mime_type:file.type||'application/octet-stream',size_bytes:file.size||0
    }).select('*').single();
    if(row.error){
      await client.storage.from(PRIVATE_BUCKET).remove([path]);
      throw new Error('Originalmail konnte nicht registriert werden: '+row.error.message);
    }
    return row.data;
  }

  async function uploadMailFile(mailId, file) {
    if (!mailId || !file) throw new Error('Mail und Datei erforderlich.');
    const safe = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,180);
    const path = `${PROJECT_SLUG}/mail/${mailId}/${crypto.randomUUID()}-${safe}`;
    const upload = await client.storage.from(PRIVATE_BUCKET).upload(path, file, {contentType:file.type || 'application/octet-stream', upsert:false});
    if (upload.error) throw new Error('Anhang konnte nicht hochgeladen werden: ' + upload.error.message);
    const row = await client.from('minds_mail_files').insert({
      project_id:project.id, mail_id:mailId, uploaded_by:user.id,
      storage_path:path, filename:file.name, mime_type:file.type || '', size_bytes:file.size || 0
    }).select('*').single();
    if (row.error) {
      await client.storage.from(PRIVATE_BUCKET).remove([path]);
      throw new Error('Anhang konnte nicht registriert werden: ' + row.error.message);
    }
    return row.data;
  }

  window.MindsStore = {
    client, init, loadEntries, loadMails, loadBuckets, saveBucket, archiveBucket, saveEntry, saveMail,
    loadMessages, appendMessage, newConversation, migrateLocal,
    loadTaskComments, addTaskComment, loadTaskFiles, uploadTaskFile, addTaskLink, signedTaskFile,
    uploadRawMailFile, uploadMailFile, indexMailText, searchChunks,
    get project(){return project;}, get user(){return user;}
  };
})();
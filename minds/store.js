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
      createdAt:r.created_at, updatedAt:r.updated_at, archived:Boolean(r.archived), version:r.version || 1
    };
  }

  function entryToRow(e) {
    return {
      id:id(e.id), project_id:project.id, kind:e.kind, state:e.state, title:e.title,
      body:e.body || '', alternatives:e.alternatives || '', outcome:e.outcome || '',
      owner:e.owner || '', due:e.due || null, reference:e.reference || '',
      source:e.source || null, archived:Boolean(e.archived),
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

  async function saveEntry(entry) {
    const existed = Boolean(entry?.id && uuid(entry.id));
    const row = entryToRow(entry);
    const r = await client.from('minds_entries').upsert(row).select('*').single();
    const saved = entryFromRow(fail(r, 'Memory konnte nicht gespeichert werden'));
    await event('entry', saved.id, existed ? 'updated' : 'created', {kind:saved.kind,state:saved.state});
    return saved;
  }

  async function saveMail(mail) {
    const existed = Boolean(mail?.id && uuid(mail.id));
    const row = mailToRow(mail);
    const r = await client.from('minds_mails').upsert(row).select('*').single();
    const saved = mailFromRow(fail(r, 'E-Mail konnte nicht gespeichert werden'));
    await event('mail', saved.id, existed ? 'updated' : 'created', {subject:saved.subject});
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
    client, init, loadEntries, loadMails, saveEntry, saveMail,
    loadMessages, appendMessage, newConversation, migrateLocal, uploadMailFile,
    get project(){return project;}, get user(){return user;}
  };
})();
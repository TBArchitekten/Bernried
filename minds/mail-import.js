import PostalMime from 'https://cdn.jsdelivr.net/npm/postal-mime@3.0.0/src/postal-mime.js';
import MsgReader from 'https://esm.sh/@kenjiuno/msgreader@1.28.0?bundle';

function stripHtml(value='') {
  if (!value) return '';
  const doc = new DOMParser().parseFromString(String(value), 'text/html');
  return (doc.body?.innerText || doc.body?.textContent || '').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function addr(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(addr).filter(Boolean).join('; ');
  if (value.group) return value.group.map(addr).filter(Boolean).join('; ');
  const name = String(value.name || '').trim();
  const email = String(value.address || value.email || value.smtpAddress || '').trim();
  if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} <${email}>`;
  return email || name;
}

function ymd(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function sanitizeName(value, fallback='attachment.bin') {
  const name = String(value || fallback).replace(/[\\/:*?"<>|]+/g,'-').trim();
  return name || fallback;
}

async function parseEml(file) {
  const raw = await file.arrayBuffer();
  const parsed = await PostalMime.parse(raw, {rfc822Attachments:true});
  const attachments = (parsed.attachments || []).map((item,index)=>{
    const bytes = item.content instanceof Uint8Array ? item.content : new Uint8Array(item.content || []);
    return new File([bytes], sanitizeName(item.filename || item.fileName, `attachment-${index+1}`), {
      type:item.mimeType || item.contentType || 'application/octet-stream'
    });
  });
  const recipients = [...(parsed.to || []), ...(parsed.cc || [])].map(addr).filter(Boolean).join('; ');
  return {
    kind:'eml',
    mail:{
      sender:addr(parsed.from),
      recipients,
      subject:String(parsed.subject || file.name.replace(/\.eml$/i,'')).slice(0,300),
      body:String(parsed.text || stripHtml(parsed.html || '') || '').slice(0,100000),
      date:ymd(parsed.date),
      messageId:String(parsed.messageId || '').slice(0,1000),
      threadKey:String(parsed.inReplyTo || '').slice(0,1000)
    },
    attachments
  };
}

async function parseMsg(file) {
  const raw = await file.arrayBuffer();
  const reader = new MsgReader(raw);
  const info = reader.getFileData();
  if (info?.error) throw new Error(info.error);
  const senderEmail = info.senderSmtpAddress || info.senderEmail || info.creatorSMTPAddress || '';
  const sender = info.senderName && senderEmail && String(info.senderName).toLowerCase() !== String(senderEmail).toLowerCase()
    ? `${info.senderName} <${senderEmail}>`
    : String(senderEmail || info.senderName || '');
  const recipients = (info.recipients || []).map(item=>{
    const email = item.smtpAddress || item.email || '';
    const name = item.name || '';
    return name && email && String(name).toLowerCase() !== String(email).toLowerCase() ? `${name} <${email}>` : String(email || name);
  }).filter(Boolean).join('; ');
  const attachments = [];
  for (const item of info.attachments || []) {
    try {
      const data = reader.getAttachment(item);
      if (!data?.content) continue;
      attachments.push(new File([data.content], sanitizeName(data.fileName || item.fileName || item.name), {
        type:item.attachMimeTag || 'application/octet-stream'
      }));
    } catch (error) {
      console.warn('MSG attachment skipped', error);
    }
  }
  return {
    kind:'msg',
    mail:{
      sender,
      recipients,
      subject:String(info.subject || info.normalizedSubject || file.name.replace(/\.msg$/i,'')).slice(0,300),
      body:String(info.body || stripHtml(info.bodyHtml || '') || info.preview || '').slice(0,100000),
      date:ymd(info.messageDeliveryTime || info.clientSubmitTime || info.creationTime),
      messageId:String(info.messageId || '').slice(0,1000),
      threadKey:String(info.conversationTopic || '').slice(0,1000)
    },
    attachments
  };
}

async function parseFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.eml') || file.type === 'message/rfc822') return parseEml(file);
  if (name.endsWith('.msg') || file.type === 'application/vnd.ms-outlook') return parseMsg(file);
  throw new Error('Nur .eml und Outlook .msg werden unterstützt.');
}

window.MindsMailImport = {parseFile};

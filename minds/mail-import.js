import PostalMime from 'https://cdn.jsdelivr.net/npm/postal-mime@3.0.0/src/postal-mime.js';
import { MsgReader } from 'https://esm.sh/@kenjiuno/msgreader-web-ng@0.2.0-alpha1?bundle';

function stripHtml(value='') {
  if (!value) return '';
  const doc = new DOMParser().parseFromString(String(value), 'text/html');
  return (doc.body?.innerText || doc.body?.textContent || '')
    .replace(/\u00a0/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

function address(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(address).filter(Boolean).join('; ');
  if (value.group) return value.group.map(address).filter(Boolean).join('; ');
  const name=String(value.name||'').trim();
  const email=String(value.address||value.email||value.smtpAddress||'').trim();
  if(name&&email&&name.toLowerCase()!==email.toLowerCase()) return `${name} <${email}>`;
  return email||name;
}

function ymd(value) {
  if (!value) return '';
  const d=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function safeName(value,fallback='attachment.bin') {
  const name=String(value||fallback).replace(/[\\/:*?"<>|]+/g,'-').trim();
  return name||fallback;
}

function headerValue(headers,name) {
  const rx=new RegExp('^'+name+':\\s*(.+)$','im');
  return String(headers||'').match(rx)?.[1]?.trim()||'';
}

async function parseEml(file) {
  const parsed=await PostalMime.parse(await file.arrayBuffer(),{rfc822Attachments:true});
  const attachments=(parsed.attachments||[]).map((item,index)=>{
    const bytes=item.content instanceof Uint8Array?item.content:new Uint8Array(item.content||[]);
    return new File([bytes],safeName(item.filename||item.fileName,`attachment-${index+1}`),{
      type:item.mimeType||item.contentType||'application/octet-stream'
    });
  });
  return {
    kind:'eml',
    mail:{
      sender:address(parsed.from),
      recipients:[...(parsed.to||[]),...(parsed.cc||[])].map(address).filter(Boolean).join('; '),
      subject:String(parsed.subject||file.name.replace(/\.eml$/i,'')).slice(0,300),
      body:String(parsed.text||stripHtml(parsed.html||'')||'').slice(0,100000),
      date:ymd(parsed.date),
      messageId:String(parsed.messageId||'').slice(0,1000),
      threadKey:String(parsed.inReplyTo||'').slice(0,1000)
    },
    attachments
  };
}

async function parseMsg(file) {
  const reader=new MsgReader(await file.arrayBuffer());
  const info=reader.getFileData();
  if(info?.error) throw new Error(String(info.error));

  const headers=String(info.headers||'');
  const senderEmail=info.senderSmtpAddress||info.senderEmail||info.creatorSMTPAddress||headerValue(headers,'From');
  const sender=info.senderName&&senderEmail&&String(info.senderName).toLowerCase()!==String(senderEmail).toLowerCase()
    ? `${info.senderName} <${senderEmail}>`
    : String(senderEmail||info.senderName||'');

  const recipients=(info.recipients||[]).map(item=>{
    const email=item.smtpAddress||item.email||'';
    const name=item.name||'';
    return name&&email&&String(name).toLowerCase()!==String(email).toLowerCase()
      ? `${name} <${email}>`
      : String(email||name);
  }).filter(Boolean).join('; ') || headerValue(headers,'To');

  const attachments=[];
  for(const item of info.attachments||[]){
    try{
      const data=reader.getAttachment(item);
      if(!data?.content) continue;
      attachments.push(new File([data.content],safeName(data.fileName||item.fileName||item.name),{
        type:item.attachMimeTag||'application/octet-stream'
      }));
    }catch(error){console.warn('MSG attachment skipped',error);}
  }

  return {
    kind:'msg',
    mail:{
      sender,
      recipients,
      subject:String(info.subject||info.normalizedSubject||file.name.replace(/\.msg$/i,'')).slice(0,300),
      body:String(info.body||stripHtml(info.bodyHtml||'')||info.preview||'').slice(0,100000),
      date:ymd(info.messageDeliveryTime||info.clientSubmitTime||info.creationTime||headerValue(headers,'Date')),
      messageId:String(info.messageId||headerValue(headers,'Message-ID')||'').slice(0,1000),
      threadKey:String(info.conversationTopic||headerValue(headers,'Thread-Index')||'').slice(0,1000)
    },
    attachments
  };
}

async function parseFile(file) {
  const name=String(file?.name||'').toLowerCase();
  if(name.endsWith('.eml')||file.type==='message/rfc822') return parseEml(file);
  if(name.endsWith('.msg')||file.type==='application/vnd.ms-outlook') return parseMsg(file);
  throw new Error('Nur .eml und Outlook .msg werden unterstützt.');
}

window.MindsMailImport={parseFile};

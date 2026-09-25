import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import PostalMime from "npm:postal-mime@3.0.0";
import MsgReader from "npm:@kenjiuno/msgreader@1.28.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROJECT_SLUG = "bernried";
const BUCKET = "minds-private";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function addr(value: any): string {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(addr).filter(Boolean).join("; ");
  if (value.group) return (value.group as any[]).map(addr).filter(Boolean).join("; ");
  const name = String(value.name ?? "").trim();
  const email = String(value.address ?? value.email ?? value.smtpAddress ?? "").trim();
  return name && email && name.toLowerCase() !== email.toLowerCase() ? `${name} <${email}>` : (email || name);
}

function ymd(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function safeName(value: string, fallback = "attachment.bin") {
  const result = String(value || fallback).replace(/[\\/:*?"<>|]+/g, "-").trim();
  return (result || fallback).slice(0, 180);
}

function chunkText(text: string, max = 1600) {
  const clean = String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [] as string[];
  const parts = clean.split(/\n\n+/).map(x => x.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const part of parts) {
    if ((current + "\n\n" + part).length <= max) current = current ? current + "\n\n" + part : part;
    else {
      if (current) chunks.push(current);
      if (part.length <= max) current = part;
      else {
        for (let i=0;i<part.length;i+=max) chunks.push(part.slice(i,i+max));
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
}

async function sha256Buffer(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2,"0")).join("");
}

function parseMsg(buffer: ArrayBuffer, fallbackName: string) {
  const reader = new MsgReader(buffer);
  const info: any = reader.getFileData();
  if (info?.error) throw new Error(String(info.error));
  const senderEmail = info.senderSmtpAddress || info.senderEmail || info.creatorSMTPAddress || "";
  const sender = info.senderName && senderEmail && String(info.senderName).toLowerCase() !== String(senderEmail).toLowerCase()
    ? `${info.senderName} <${senderEmail}>`
    : String(senderEmail || info.senderName || "");
  const recipients = (info.recipients || []).map((item:any) => {
    const email = item.smtpAddress || item.email || "";
    const name = item.name || "";
    return name && email && String(name).toLowerCase() !== String(email).toLowerCase() ? `${name} <${email}>` : String(email || name);
  }).filter(Boolean).join("; ");
  const attachments: { name:string; type:string; bytes:Uint8Array }[] = [];
  for (const item of info.attachments || []) {
    try {
      const data:any = reader.getAttachment(item);
      if (!data?.content) continue;
      attachments.push({
        name: safeName(data.fileName || item.fileName || item.name),
        type: item.attachMimeTag || "application/octet-stream",
        bytes: data.content instanceof Uint8Array ? data.content : new Uint8Array(data.content),
      });
    } catch (_) {}
  }
  return {
    sender,
    recipients,
    subject: String(info.subject || info.normalizedSubject || fallbackName.replace(/\.msg$/i,"")).slice(0,300),
    body: String(info.body || cleanText(info.bodyHtml || "") || info.preview || "").slice(0,100000),
    date: ymd(info.messageDeliveryTime || info.clientSubmitTime || info.creationTime),
    messageId: String(info.messageId || "").slice(0,1000),
    threadKey: String(info.conversationTopic || "").slice(0,1000),
    attachments,
  };
}

async function parseEml(buffer: ArrayBuffer, fallbackName: string) {
  const parsed:any = await PostalMime.parse(buffer, { rfc822Attachments: true });
  const attachments = (parsed.attachments || []).map((item:any,index:number) => ({
    name: safeName(item.filename || item.fileName || `attachment-${index+1}`),
    type: item.mimeType || item.contentType || "application/octet-stream",
    bytes: item.content instanceof Uint8Array ? item.content : new Uint8Array(item.content || []),
  }));
  const recipients = [...(parsed.to || []), ...(parsed.cc || [])].map(addr).filter(Boolean).join("; ");
  return {
    sender: addr(parsed.from),
    recipients,
    subject: String(parsed.subject || fallbackName.replace(/\.eml$/i,"")).slice(0,300),
    body: String(parsed.text || cleanText(parsed.html || "") || "").slice(0,100000),
    date: ymd(parsed.date),
    messageId: String(parsed.messageId || "").slice(0,1000),
    threadKey: String(parsed.inReplyTo || "").slice(0,1000),
    attachments,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const storagePath = String(body.storagePath || "");
    const originalName = String(body.originalName || "").slice(0,500);
    if (!storagePath.startsWith(PROJECT_SLUG + "/") || !originalName) return json({ error: "Invalid import path" }, 400);

    const { data: project, error: projectError } = await supabase.from("projects").select("id,slug").eq("slug", PROJECT_SLUG).single();
    if (projectError || !project) return json({ error: "Project unavailable" }, 403);

    const { data: membership } = await supabase.from("project_admins")
      .select("project_id").eq("project_id", project.id).eq("user_id", userData.user.id).maybeSingle();
    if (!membership) return json({ error: "Forbidden" }, 403);

    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(storagePath);
    if (downloadError || !blob) throw new Error("Raw mail download failed: " + (downloadError?.message || "unknown"));
    const buffer = await blob.arrayBuffer();
    const lower = originalName.toLowerCase();

    const parsed = lower.endsWith(".msg")
      ? parseMsg(buffer, originalName)
      : lower.endsWith(".eml")
        ? await parseEml(buffer, originalName)
        : (() => { throw new Error("Only .eml and .msg are supported"); })();

    const rawHash = await sha256Buffer(buffer);
    if (!parsed.messageId) parsed.messageId = "urn:minds:sha256:" + rawHash;

    const { data: existing } = await supabase.from("minds_mails")
      .select("*").eq("project_id", project.id).eq("message_id", parsed.messageId).maybeSingle();
    if (existing) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return json({ mail: existing, duplicate: true, attachments: 0, chunks: 0 });
    }

    const mailId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { data: mail, error: mailError } = await supabase.from("minds_mails").insert({
      id: mailId,
      project_id: project.id,
      created_by: userData.user.id,
      sender: parsed.sender,
      recipients: parsed.recipients,
      subject: parsed.subject || originalName,
      body: parsed.body,
      mail_date: parsed.date || null,
      message_id: parsed.messageId,
      thread_key: parsed.threadKey,
      archived: false,
      created_at: now,
      updated_at: now,
    }).select("*").single();
    if (mailError) throw mailError;

    const rawFileRow = await supabase.from("minds_mail_files").insert({
      project_id: project.id,
      mail_id: mailId,
      uploaded_by: userData.user.id,
      storage_path: storagePath,
      filename: originalName,
      mime_type: lower.endsWith(".msg") ? "application/vnd.ms-outlook" : "message/rfc822",
      size_bytes: buffer.byteLength,
    });
    if (rawFileRow.error) throw rawFileRow.error;

    let attachmentCount = 0;
    for (const att of parsed.attachments) {
      const path = `${PROJECT_SLUG}/mail/${mailId}/${crypto.randomUUID()}-${safeName(att.name)}`;
      const upload = await supabase.storage.from(BUCKET).upload(path, att.bytes, { contentType: att.type, upsert: false });
      if (upload.error) continue;
      const reg = await supabase.from("minds_mail_files").insert({
        project_id: project.id,
        mail_id: mailId,
        uploaded_by: userData.user.id,
        storage_path: path,
        filename: att.name,
        mime_type: att.type,
        size_bytes: att.bytes.byteLength,
      });
      if (!reg.error) attachmentCount++;
    }

    const checksum = await sha256(parsed.body);
    const { data: source, error: sourceError } = await supabase.from("minds_sources").upsert({
      project_id: project.id,
      created_by: userData.user.id,
      source_type: "email",
      origin_type: "mail",
      origin_id: mailId,
      title: parsed.subject || originalName,
      mime_type: "text/plain",
      storage_path: storagePath,
      checksum,
      status: "ready",
      metadata: { sender: parsed.sender, recipients: parsed.recipients, date: parsed.date, rawFilename: originalName, rawHash },
      captured_at: now,
      updated_at: now,
    }, { onConflict: "project_id,origin_type,origin_id" }).select("*").single();
    if (sourceError) throw sourceError;

    const chunks = chunkText(parsed.body).map((content, chunk_index) => ({
      project_id: project.id,
      source_id: source.id,
      chunk_index,
      content,
      locator: { kind: "email", mailId, subject: parsed.subject, sender: parsed.sender, date: parsed.date, rawFilename: originalName },
      content_hash: "",
    }));
    if (chunks.length) {
      const { error: chunkError } = await supabase.from("minds_chunks").insert(chunks);
      if (chunkError) throw chunkError;
    }

    await supabase.from("minds_events").insert({
      project_id: project.id,
      actor_user_id: userData.user.id,
      entity_type: "mail",
      entity_id: mailId,
      event_type: "imported",
      payload: { filename: originalName, attachments: attachmentCount, chunks: chunks.length, rawHash },
    });

    return json({ mail, duplicate: false, attachments: attachmentCount, chunks: chunks.length });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

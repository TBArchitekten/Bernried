import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_SLUG = "bernried";
const ACCOUNTS = [
  { audience: "tba", role: "editor", display_name: "Titus Bernhard Architekten", email: "tba.bernried@access.invalid" },
  { audience: "bauherren", role: "viewer", display_name: "Bauherren", email: "bauherren.bernried@access.invalid" },
  { audience: "fachplaner", role: "viewer", display_name: "Fachplaner", email: "fachplaner.bernried@access.invalid" },
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status=200) {
  return new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json"}});
}

function password() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return [...bytes].map((b)=>alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:cors});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);

  try {
    const authHeader=req.headers.get("Authorization");
    if(!authHeader) return json({error:"Unauthorized"},401);

    const url=Deno.env.get("SUPABASE_URL") ?? "";
    const anon=Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const caller=createClient(url,anon,{global:{headers:{Authorization:authHeader}}});
    const admin=createClient(url,service);

    const token=authHeader.replace(/^Bearer\s+/i,"");
    const {data:userData,error:userError}=await caller.auth.getUser(token);
    if(userError||!userData.user) return json({error:"Unauthorized"},401);
    const callerId=userData.user.id;

    const {data:project,error:projectError}=await admin.from("projects").select("id,slug").eq("slug",PROJECT_SLUG).single();
    if(projectError||!project) return json({error:"Project not found"},404);

    const [{data:editor},{data:legacyAdmin}] = await Promise.all([
      admin.from("project_members").select("user_id").eq("project_id",project.id).eq("user_id",callerId).eq("role","editor").maybeSingle(),
      admin.from("project_admins").select("user_id").eq("project_id",project.id).eq("user_id",callerId).maybeSingle(),
    ]);

    if(!editor && !legacyAdmin) return json({error:"Forbidden"},403);

    const {data:list,error:listError}=await admin.auth.admin.listUsers({page:1,perPage:1000});
    if(listError) throw listError;
    const byEmail=new Map((list.users||[]).map(u=>[String(u.email||"").toLowerCase(),u]));

    const credentials:any[]=[];
    const targetUsers:any[]=[];

    for(const account of ACCOUNTS) {
      const nextPassword=password();
      let authUser=byEmail.get(account.email.toLowerCase());
      if(authUser) {
        const {data,error}=await admin.auth.admin.updateUserById(authUser.id,{
          password:nextPassword,
          email_confirm:true,
          user_metadata:{...(authUser.user_metadata||{}),shared_project:PROJECT_SLUG,audience:account.audience,display_name:account.display_name}
        });
        if(error) throw error;
        authUser=data.user;
      } else {
        const {data,error}=await admin.auth.admin.createUser({
          email:account.email,
          password:nextPassword,
          email_confirm:true,
          user_metadata:{shared_project:PROJECT_SLUG,audience:account.audience,display_name:account.display_name}
        });
        if(error) throw error;
        authUser=data.user;
      }
      targetUsers.push({account,user:authUser,password:nextPassword});
    }

    // Replace bootstrap/shared memberships atomically at the data level.
    const {error:deleteError}=await admin.from("project_members").delete().eq("project_id",project.id);
    if(deleteError) throw deleteError;

    const rows=targetUsers.map(({account,user})=>({
      project_id:project.id,
      user_id:user.id,
      role:account.role,
      audience:account.audience,
      display_name:account.display_name
    }));
    const {error:memberError}=await admin.from("project_members").insert(rows);
    if(memberError) throw memberError;

    for(const {account,password:plain} of targetUsers) {
      credentials.push({
        audience:account.audience,
        label:account.display_name,
        password:plain
      });
    }

    return json({ok:true,project:PROJECT_SLUG,credentials});
  } catch(error) {
    console.error(error);
    return json({error:error instanceof Error?error.message:String(error)},400);
  }
});

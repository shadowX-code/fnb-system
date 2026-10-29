import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ref = "ujkzdaaadnvcfayuldmh";
if (readFileSync("supabase/.temp/project-ref", "utf8").trim() !== ref) throw new Error("Verified Staging Supabase link required.");
const destination = resolve(process.argv[2] || "qa-artifacts/mesti-machine/credential.json");
const sqlPath = resolve(process.argv[3] || "qa-artifacts/mesti-machine/provision.sql");
const token = `fxm_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
const endpoint = `https://${ref}.supabase.co/functions/v1/factory-mesti-mcp`;
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
mkdirSync(dirname(sqlPath), { recursive: true, mode: 0o700 });
writeFileSync(destination, JSON.stringify({ endpoint, authorization: `Bearer ${token}`, expires_at: expiresAt }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
writeFileSync(sqlPath, `-- Explicit Staging provisioning; no employee identity or business records are changed.
do $provision$
declare v_role uuid; v_identity uuid;
begin
  if exists(select 1 from public.roles where name='QA Executive MeSTI Inspection')
    or exists(select 1 from feedx_integrations.machine_identities where name='QA Executive MeSTI Staging') then
    raise exception 'QA Executive already provisioned; use a reviewed rotation instead of replacing its identity or grants.';
  end if;
  insert into public.roles(name,description,is_active,is_system_role,outlet_access_type)
  values('QA Executive MeSTI Inspection','Dedicated external machine: redacted MeSTI inspection only.',true,false,'none') returning id into v_role;
  insert into public.role_permissions(role_id,permission_id)
  select v_role,id from public.permissions where code='factory_mesti_inspection.view';
  if not found then raise exception 'Inspection permission unavailable.'; end if;
  insert into feedx_integrations.machine_identities(name,role_id,enabled)
  values('QA Executive MeSTI Staging',v_role,true) returning id into v_identity;
  insert into feedx_integrations.machine_credentials(identity_id,token_hash,expires_at)
  values(v_identity,'${tokenHash}','${expiresAt}');
end $provision$;
select m.id identity_id,m.name,r.name role,c.id credential_id,c.expires_at
from feedx_integrations.machine_identities m join public.roles r on r.id=m.role_id
join feedx_integrations.machine_credentials c on c.identity_id=m.id
where m.name='QA Executive MeSTI Staging';
`, { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ credential_file: destination, provisioning_sql: sqlPath, endpoint, expires_at: expiresAt }));

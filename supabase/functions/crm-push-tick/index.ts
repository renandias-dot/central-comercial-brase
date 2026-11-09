// Relógio dos avisos no celular: chamado a cada minuto pelo pg_cron (veja supabase/migrations/20261018000001_crm_push_cron.sql).
// Manda o aviso de print vencido, de lead que entrou fora do expediente e de lead esperando além do limite.
// Chamada: POST/GET https://<projeto>.supabase.co/functions/v1/crm-push-tick?token=<CRM_TICK_SECRET>
import { json } from '../_shared/crm.ts';
import { runTick } from '../_shared/push.ts';

const SECRET = Deno.env.get('CRM_TICK_SECRET') ?? '';

Deno.serve(async req => {
  const token = new URL(req.url).searchParams.get('token') ?? req.headers.get('x-tick-secret') ?? '';
  if (!SECRET || token !== SECRET) return json({ error: 'unauthorized' }, 401);
  try { return json({ ok: true, ...(await runTick()) }); }
  catch (e) { return json({ ok: false, error: String((e as Error).message ?? e) }, 500); }
});

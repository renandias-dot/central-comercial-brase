-- App Funis (funis/index.html e funis/f/index.html) — tabelas usadas pela função funis-api.
-- Rode uma vez no SQL Editor do Supabase (ou com `supabase db push` dentro da pasta funis/). Pode rodar de novo sem problema.
-- As tabelas ficam fechadas para a chave pública (RLS ligado e sem políticas): só a função lê e grava.

-- Funis. draft = rascunho do editor; published = versão no ar (a página pública lê só esta).
-- webhook = {enabled, url, token, method, contentType, trigger, component, mapping[]} — o token nunca sai para a página pública.
create table if not exists fn_funnels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  title text not null default 'Novo funil',
  draft jsonb not null default '{}'::jsonb,
  published jsonb,
  published_at timestamptz,
  webhook jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default date_trunc('milliseconds', now())
);

-- Cada visita ao funil (o "lead" da aba Leads). id = código de 6 letras gerado no navegador do visitante.
-- answers = {id da camada: {step, name, type, title, value, label, score}}; clicks = {id da camada: {name, label, at}}.
create table if not exists fn_sessions (
  funnel_id uuid not null references fn_funnels (id) on delete cascade,
  id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tracking jsonb not null default '{}'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  clicks jsonb not null default '{}'::jsonb,
  steps text[] not null default '{}',
  last_step text,
  interacted boolean not null default false,
  completed boolean not null default false,
  webhook jsonb,
  primary key (funnel_id, id)
);
create index if not exists fn_sessions_recent on fn_sessions (funnel_id, created_at desc);
-- params = todos os parâmetros da URL do funil (vão no webhook, como no InLead). Para bancos criados antes desta coluna:
alter table fn_sessions add column if not exists params jsonb not null default '{}'::jsonb;

-- Leitura dos leads: linha do tempo das etapas, telefone/e-mail normalizados, etapa do CRM e eventos já mandados à Meta.
alter table fn_sessions add column if not exists timeline jsonb not null default '[]'::jsonb;
alter table fn_sessions add column if not exists phone text;
alter table fn_sessions add column if not exists email text;
alter table fn_sessions add column if not exists crm jsonb;
alter table fn_sessions add column if not exists sent jsonb not null default '{}'::jsonb;
create index if not exists fn_sessions_phone on fn_sessions (funnel_id, phone) where phone is not null;
create index if not exists fn_sessions_email on fn_sessions (funnel_id, email) where email is not null;
create index if not exists fn_sessions_abandon on fn_sessions (funnel_id, updated_at) where phone is not null and webhook is null;
-- secrets = tokens da Meta e a chave dos webhooks que chegam (nunca vão para o editor nem para a página).
alter table fn_funnels add column if not exists secrets jsonb not null default '{}'::jsonb;
alter table fn_funnels add column if not exists swept_at timestamptz;

-- Vendas avisadas pelo checkout (Kirvano, Hotmart, Kiwify…), ligadas ao visitante quando dá.
create table if not exists fn_sales (
  id bigserial primary key,
  funnel_id uuid not null references fn_funnels (id) on delete cascade,
  session_id text,
  sale_id text,
  event text,
  status text not null,
  value numeric not null default 0,
  currency text not null default 'BRL',
  product text,
  email text,
  phone text,
  utm jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (funnel_id, sale_id, status)
);
create index if not exists fn_sales_recent on fn_sales (funnel_id, created_at desc);

-- Gasto por anúncio e dia (planilha do Gerenciador de Anúncios ou API da Meta). k = ID do anúncio (ou do conjunto/campanha, ou o nome).
create table if not exists fn_spend (
  funnel_id uuid not null references fn_funnels (id) on delete cascade,
  day date not null,
  k text not null,
  campaign_id text, campaign_name text, adset_id text, adset_name text, ad_id text, ad_name text,
  spend numeric not null default 0,
  source text,
  primary key (funnel_id, day, k)
);

alter table fn_funnels enable row level security;
alter table fn_sessions enable row level security;
alter table fn_sales enable row level security;
alter table fn_spend enable row level security;

-- Arquivos enviados pelo editor (imagens, áudios, vídeos), públicos para a página do funil.
insert into storage.buckets (id, name, public, file_size_limit)
values ('funis', 'funis', true, 15728640)
on conflict (id) do nothing;

-- Números da aba Leads num período: acessos, leads (interagiram), qualificados (como no InLead: respostas e cliques
-- passam de 70% do número de etapas, ou completou), completos, alcance de cada etapa, contagem das respostas de cada pergunta e o resumo por dia.
create or replace function fn_stats(p_funnel uuid, p_since timestamptz, p_total integer)
returns jsonb language sql stable set search_path = public as $$
  with s as (
    select *, (select count(*) from jsonb_object_keys(answers)) + (select count(*) from jsonb_object_keys(clicks)) as n_answers
      from fn_sessions where funnel_id = p_funnel and created_at >= p_since
  ),
  k as (
    select count(*) as visits,
           count(*) filter (where interacted) as leads,
           count(*) filter (where completed) as complete,
           count(*) filter (where completed or n_answers > 0.7 * greatest(p_total, 1)) as qualified
      from s
  ),
  st as (
    select coalesce(jsonb_object_agg(step, n), '{}'::jsonb) as j
      from (select step, count(distinct s.id) as n from s, unnest(s.steps) as step group by step) x
  ),
  an as (
    select coalesce(jsonb_object_agg(layer, vals), '{}'::jsonb) as j
      from (
        select layer, jsonb_object_agg(v, n) as vals
          from (
            select a.key as layer, v, count(*) as n
              from s, jsonb_each(s.answers) as a,
                   jsonb_array_elements_text(case when jsonb_typeof(a.value -> 'value') = 'array' then a.value -> 'value'
                                                  else jsonb_build_array(a.value -> 'value') end) as v
             where a.value ->> 'type' = 'options' and v is not null
             group by 1, 2
          ) y
         group by layer
      ) z
  ),
  fl as (
    select coalesce(jsonb_object_agg(layer, n), '{}'::jsonb) as j
      from (select a.key as layer, count(*) as n from s, jsonb_each(s.answers) as a
             where coalesce(a.value ->> 'type', '') <> 'options' group by 1) w
  ),
  dl as (
    select coalesce(jsonb_agg(jsonb_build_object('day', day, 'visits', visits, 'leads', leads, 'complete', complete) order by day), '[]'::jsonb) as j
      from (
        select to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as day,
               count(*) as visits, count(*) filter (where interacted) as leads, count(*) filter (where completed) as complete
          from s group by 1
      ) d
  )
  select jsonb_build_object('visits', k.visits, 'leads', k.leads, 'complete', k.complete, 'qualified', k.qualified,
                            'steps', st.j, 'answers', an.j, 'fields', fl.j, 'daily', dl.j)
    from k, st, an, fl, dl
$$;
-- Só a função funis-api (conexão direta ao banco) usa fn_stats; a API pública do Supabase não chama.
revoke execute on function fn_stats(uuid, timestamptz, integer) from public, anon, authenticated;

-- Configurações do servidor. "access" guarda o código de acesso do editor como sal + hash (SHA-256), nunca o código.
create table if not exists fn_config (
  k text primary key,
  v jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table fn_config enable row level security;

-- Tentativas erradas do código de acesso do editor, por IP: 10 erros em 15 min bloqueiam aquele IP por 15 min;
-- 100 erros somados na última hora (de vários IPs) bloqueiam todo mundo até a soma baixar. Acertar zera o IP.
create table if not exists fn_auth_fails (
  ip text primary key,
  fails integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
alter table fn_auth_fails enable row level security;

-- Gasto da conta de anúncios por anúncio e por dia (Graph API, Central Comercial ou a rotina com o MCP da Meta).
-- Não tem funil: na leitura, o gasto de um anúncio num dia vai para o funil mais recente que recebeu visita dele até aquele dia.
create table if not exists fn_ad_spend (
  day date not null,
  ad_id text not null,
  ad_name text not null default '',
  adset_id text not null default '',
  adset_name text not null default '',
  campaign_id text not null default '',
  campaign_name text not null default '',
  spend numeric(12,2) not null default 0,
  impressions integer not null default 0,
  clicks integer not null default 0,
  link_clicks integer not null default 0,
  lpv integer not null default 0,
  meta_leads integer not null default 0,
  source text not null default '',
  updated_at timestamptz not null default now(),
  primary key (day, ad_id)
);
alter table fn_ad_spend enable row level security;
-- Chave das operações de máquina (cron e rotina diária da Meta), gerada no banco e nunca escrita no repositório.
insert into fn_config (k, v) values ('cron', jsonb_build_object('key', encode(extensions.gen_random_bytes(24), 'hex'))) on conflict (k) do nothing;

-- Leads da Central Comercial para a visão da conta inteira (sem nome nem contato), atualizados a cada leitura da Central.
create table if not exists fn_crm_leads (
  id text primary key,
  created_at timestamptz,
  source text not null default '',
  utm_source text not null default '',
  campaign_id text not null default '',
  campaign_name text not null default '',
  ad_id text not null default '',
  ad_name text not null default '',
  stage text not null default '',
  booked_at timestamptz,
  met_at timestamptz,
  closed_at timestamptz,
  value numeric(12,2),
  code text not null default '',
  owner text not null default '',
  synced_at timestamptz not null default now()
);
create index if not exists fn_crm_leads_created on fn_crm_leads (created_at);
alter table fn_crm_leads enable row level security;

-- Visitas tiradas dos relatórios (robôs e testes), guardadas aqui caso precise voltar alguma. Só o servidor lê.
create table if not exists fn_sessions_removidas (like fn_sessions including all);
alter table fn_sessions_removidas add column if not exists removida_em timestamptz default now(), add column if not exists motivo text;
alter table fn_sessions_removidas enable row level security;

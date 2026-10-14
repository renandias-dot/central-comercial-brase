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

alter table fn_funnels enable row level security;
alter table fn_sessions enable row level security;

-- Arquivos enviados pelo editor (imagens, áudios, vídeos), públicos para a página do funil.
insert into storage.buckets (id, name, public, file_size_limit)
values ('funis', 'funis', true, 15728640)
on conflict (id) do nothing;

-- Números da aba Leads num período: acessos, leads (interagiram), qualificados (como no InLead: respostas e cliques
-- passam de 70% do número de etapas, ou completou), completos, alcance de cada etapa, contagem das respostas de cada pergunta e o resumo por dia.
create or replace function fn_stats(p_funnel uuid, p_since timestamptz, p_total integer)
returns jsonb language sql stable as $$
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

# Servidor da Central Comercial (Supabase)

Código das Edge Functions que rodam no projeto Supabase **"ZapFood Atual"** (`wndgqvkeguampmtmkmhq`), trazido para o GitHub em 09/11/2026 exatamente como estava publicado (crm-api versão 17, crm-lead-webhook 14, crm-whatsapp-webhook 10, crm-push-tick 3).

> Apesar do nome, esse projeto é o servidor da Central em uso (ele também guarda o app ZapFood, cujas migrações ficam nele). Não apague.

## Funções

| Função | O que faz | Chamada |
| --- | --- | --- |
| `crm-api` | Porta de entrada da Central: confere o código de acesso da equipe e lê/grava os documentos do CRM (`load`, `changes`, `set`, `delete`), mais agenda do Google (`calendar`), avisos no celular (`push`), API de Conversões (`capi`), investimento da Meta (`meta`) e a lista do ClickUp (`clickup`). Ao gravar um lead, dispara os eventos do CRM para a Meta. | `POST /functions/v1/crm-api` com `x-crm-key` |
| `crm-lead-webhook` | Recebe leads dos formulários (funil, landing pages, Meta) e cria o card em Lead Novo, com a cadência, o responsável por rodízio e as UTMs. | `POST /functions/v1/crm-lead-webhook` com `Authorization: Bearer` ou `?token=` |
| `crm-whatsapp-webhook` | Webhook da API oficial do WhatsApp direto da Meta: grava as mensagens, liga ao lead pelo telefone, mede o SLA e aplica as regras da aba WhatsApp. **Não está ligado**: o número do SDR (BraseBot) manda os eventos para o NicoChat, e quem leva as conversas para a Central é a ponte `cron.wa` da `funis-api` (veja `funis/README.md`). | `GET/POST /functions/v1/crm-whatsapp-webhook` |
| `crm-push-tick` | Relógio dos avisos no celular (print vencido, lead fora do expediente, lead esperando). Chamado a cada minuto pelo pg_cron (`crm-push-tick`). | `/functions/v1/crm-push-tick?token=` |

`_shared/` tem o que as funções dividem: documentos do CRM (`crm.ts`), API de Conversões (`capi.ts`, `capi_core.ts`), avisos (`push.ts`, `webpush.ts`) e leitura da agenda (`ics.ts`).

## Segredos (Edge Functions › Secrets)

Os valores nunca vão para o código. Nomes usados: `CRM_ACCESS_KEY`, `CRM_LEAD_WEBHOOK_SECRET`, `CRM_TICK_SECRET`, `CRM_VAPID_PUBLIC_KEY`, `CRM_VAPID_PRIVATE_KEY`, `CRM_VAPID_SUBJECT`, `CRM_WA_VERIFY_TOKEN`, `CRM_WA_APP_SECRET`, `GOOGLE_CALENDAR_ICS_URL`, `META_ACCESS_TOKEN`, `META_CAPI_TOKEN`, `META_CAPI_DATASET`, `META_CAPI_VERSION`, `CLICKUP_TOKEN` (e os `SUPABASE_*` que o Supabase já fornece).

## Banco (tabelas do CRM)

Criadas fora das migrações deste projeto. Estado em 09/11/2026:

| Tabela | Colunas |
| --- | --- |
| `crm_docs` | `col`, `id`, `data` (jsonb), `deleted`, `updated_at`: todos os documentos da Central (leads, config, vendedores, tarefas, rotinas, docs, `wa_stats`…) |
| `crm_capi_events` | `event_id`, `lead_id`, `event_name`, `event_time`, `payload`, `test`, `status`, `attempts`, `response`, `last_error`, `created_at`, `sent_at` |
| `crm_push_subs` | `endpoint`, `p256dh`, `auth`, `seller_id`, `ua`, `created_at`, `updated_at`, `last_ok_at`, `fail_count`, `last_error` |
| `crm_push_sent` | `key`, `sent_at` |
| `crm_wa_messages` | `id`, `direction`, `lead_key`, `lead_phone`, `business_phone`, `phone_number_id`, `kind`, `body`, `ts`, `lead_id`, `raw` (usada pelo webhook da Meta, hoje vazia) |
| `crm_wa_sla` | `id`, `lead_key`, `lead_phone`, `business_phone`, `lead_id`, `asked_at`, `replied_at` (idem) |
| `crm_webhook_log` | `id`, `received_at`, `source`, `payload`, `result` |

Agendamento no pg_cron: `crm-push-tick`, a cada minuto.

## Publicar

De dentro da raiz do repositório, com a CLI do Supabase logada na conta dona do projeto:

```bash
supabase functions deploy crm-api --project-ref wndgqvkeguampmtmkmhq --no-verify-jwt
```

Troque `crm-api` pela função alterada. Todas rodam sem verificação de JWT (cada uma confere o próprio código ou token).

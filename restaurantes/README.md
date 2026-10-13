# Restaurantes · Brase

App separado da Central Comercial para pesquisar restaurantes do iFood e montar o ranking por número de avaliações de uma região. As funções foram mapeadas da tela **Restaurantes** do Power Data.

- **Página:** `restaurantes/index.html` (publicada pelo GitHub Pages junto com a Central Comercial, no endereço dela + `/restaurantes/`).
- **Servidor:** função `restaurantes-api` do Supabase (`supabase/functions/restaurantes-api`).
- **Banco:** tabelas `rs_*` (`supabase/migrations`).

## O que o app faz

| Tela | Funções |
|---|---|
| **Restaurantes** | Busca por nome, CNPJ ou link/ID do iFood. A ficha da loja traz três blocos: **iFood** (avaliações, categoria, faixa de preço, rede, endereço, telefone), **Google** (nota, avaliações, preço, site, telefone, Maps) e **CNPJ** (situação, razão social, porte, abertura, atividade, telefones, sócios). |
| Ficha › ranking | Posição na categoria e geral num raio de 1 a 10 km, pelo número de avaliações no iFood. Tabela com avaliações de 3 meses atrás, variação, nota do Google, distância, link do iFood e WhatsApp com “Olá, {nome}”. Ordenável, com CSV. |
| Ficha › como melhorar | Pedidos estimados, participação a cada 15 pedidos da categoria e o que falta para subir 1 posição, entrar no top 10 e ser o 1º da região. |
| Ficha › mapa e gráficos | Mapa das lojas do raio (mesma categoria em destaque), calor de pedidos e faixa de preço. Distribuição das 10 principais categorias (% de lojas × % de avaliações) e evolução dos últimos 6 meses (a loja × a média da categoria na região). |
| **Região no Google** | Ranking dos restaurantes de um endereço pelas avaliações do Google Maps, inclusive os que não estão no iFood. |
| **Favoritos** | Lista da equipe com evolução das avaliações e CSV. |
| **Incluir lojas** | Cola links de lojas do iFood (até 30 por vez) para entrarem na base. |

### As contas (as mesmas do Power Data)

- **Pedidos estimados** = avaliações no iFood × 2.
- **Participação** = 15 × pedidos da loja ÷ pedidos da categoria no raio (“1 a cada 15 pedidos”).
- **Crescimento em 90 dias** = avaliações hoje ÷ avaliações da leitura de 90 dias atrás − 1.
- **Meta para passar uma loja** = (avaliações dela − as suas + 1) × 2 pedidos.

### De onde vêm os dados

- **iFood:** o endereço público de cada loja (`marketplace.ifood.com.br/v1/merchants/{id}/extra`) traz nome, endereço com coordenadas, categoria, faixa de preço, rede, telefone, CNPJ e número de avaliações. **Não traz a nota em estrelas.** A listagem de lojas por região do iFood é protegida contra robôs (Akamai e Cloudflare), e o app não tenta contornar essa proteção. Por isso, as lojas entram na base pela tela Incluir lojas ou colando o link da loja na busca da tela Restaurantes. O Power Data faz o mesmo: a inclusão deles é por uma extensão do Chrome que o cliente usa no próprio navegador.
- **Google:** Places API (New), pela chave guardada no servidor. A ficha procura a loja pelo nome perto do endereço do iFood e só aceita um lugar a até 400 m com nome parecido.
- **CNPJ:** BrasilAPI (dados abertos da Receita Federal), gratuita.
- **Histórico:** o coletor agendado relê cada loja uma vez por dia e guarda o número de avaliações. “3 meses atrás” e a evolução mensal aparecem conforme o histórico se forma (90 dias para a primeira comparação).

> O uso dos dados do iFood por coleta automática não é autorizado pelos termos de uso do iFood. A decisão de usar foi da Brase.

## Como colocar no ar

Use o projeto Supabase da Central Comercial (`wndgqvkeguampmtmkmhq`) ou outro.

### 1. Banco

No Supabase › **SQL Editor**, cole e rode o conteúdo de `supabase/migrations/20261013000000_restaurantes.sql`. Pode rodar de novo sem problema.

### 2. Segredos

Escolha um código de acesso para a equipe (pode ser o mesmo da Central Comercial) e uma chave longa para o agendamento:

```bash
supabase secrets set --project-ref wndgqvkeguampmtmkmhq \
  RESTAURANTES_ACCESS_CODE="código-da-equipe" \
  RESTAURANTES_CRON_KEY="uma-chave-longa-e-aleatória"
```

### 3. Função

Dentro da pasta `restaurantes/`:

```bash
supabase functions deploy restaurantes-api --project-ref wndgqvkeguampmtmkmhq --no-verify-jwt
```

O `--no-verify-jwt` é necessário porque o app entra com o código da equipe, como a Central Comercial. Pelo painel também funciona: Edge Functions › Deploy a new function › editor, com os arquivos `index.ts` e `logic.ts`, e “Enforce JWT verification” desligado.

### 4. Coleta diária

Em Database › Extensions, ative **pg_cron** e **pg_net**. Depois rode no SQL Editor, trocando a chave:

```sql
select cron.schedule(
  'restaurantes-coleta',
  '*/30 * * * *',
  $$ select net.http_post(
       url := 'https://wndgqvkeguampmtmkmhq.supabase.co/functions/v1/restaurantes-api',
       headers := jsonb_build_object('content-type', 'application/json', 'x-rs-cron', 'A_MESMA_RESTAURANTES_CRON_KEY'),
       body := jsonb_build_object('op', 'collect', 'limit', 40),
       timeout_milliseconds := 120000
     ) $$
);
```

Cada rodada relê até 40 lojas, com pausa entre elas: são até 1.920 lojas por dia. Com a base maior que isso, aumente a frequência ou o `limit`.

### 5. Chave do Google (opcional)

Sem a chave, o app esconde tudo o que é do Google: o bloco da ficha, a coluna de nota, a tela Região no Google e as colunas do Google nos CSVs. Tudo aparece sozinho quando a chave for configurada.

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto e ative o faturamento.
2. Em **APIs e serviços › Biblioteca**, ative a **Places API (New)**.
3. Em **Credenciais › Criar credenciais › Chave de API**, crie a chave. Em “Restrições de API”, limite a chave à **Places API (New)**. Não use restrição por site: a chave é usada pelo servidor, não pelo navegador.
4. Guarde no servidor:

```bash
supabase secrets set --project-ref wndgqvkeguampmtmkmhq GOOGLE_PLACES_API_KEY="AIza…"
```

**Custo:** nota e avaliações caem na faixa “Text Search Enterprise”, com 1.000 consultas grátis por mês e depois US$ 35 por mil (tabela do Google em outubro de 2026). A ficha consulta o Google 1 vez por loja e guarda o resultado por 30 dias. “Buscar de novo no Google” na tela Região faz até 30 consultas. “Ir para o endereço” faz 1. Sem a chave o app funciona, só sem o bloco do Google.

### 6. Endereço do app

Se `restaurantes/index.html` for publicado em outro lugar, ajuste a linha `window.RS_HOST` no topo do arquivo com o endereço da função.

## Testes

```bash
deno test restaurantes/supabase/functions/restaurantes-api/logic.test.ts
```

Cobrem a leitura das respostas do iFood, do Google e da BrasilAPI, a identificação do ID da loja em links e a escolha do lugar do Google que corresponde à loja.

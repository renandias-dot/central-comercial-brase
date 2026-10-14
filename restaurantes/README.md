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
| **Incluir lojas** | Cola links de lojas do iFood (até 30 por vez) para entrarem na base, ou baixa a extensão do Chrome. |

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

## Extensão do Chrome

A pasta `extensao/` tem a extensão **Brase · Restaurantes** (Manifest V3), o equivalente da extensão Menu Guru que o Power Data usa para incluir lojas. Com a página de uma loja aberta no iFood, o usuário clica no ícone da Brase e em **Incluir na Brase**. A extensão manda o código da loja (merchant_id, tirado do endereço da página) para a mesma função `restaurantes-api` e mostra a posição da loja na categoria e no geral (raio de 5 km), as avaliações e os pedidos estimados, com um botão para a ficha completa no app.

- **Permissões:** só `activeTab` (lê o endereço da aba quando o ícone é clicado) e `storage` (guarda o código de acesso, se um dia o app exigir). Ela não lê nem altera o conteúdo das páginas do iFood.
- **Instalar:** baixe `extensao-brase.zip` na tela Incluir lojas do app, descompacte, abra `chrome://extensions`, ligue o Modo do desenvolvedor e use **Carregar sem compactação**.
- **Publicar na Chrome Web Store como não listada:** passo a passo, textos, respostas de privacidade e imagens prontos em [`extensao-loja/PUBLICAR.md`](extensao-loja/PUBLICAR.md). A política de privacidade fica em `privacidade.html`.
- **Depois de mudar a extensão:** suba o `version` do `manifest.json` e gere o zip de novo, dentro de `restaurantes/`:

```bash
python3 -c "import zipfile,os;z=zipfile.ZipFile('extensao-brase.zip','w',zipfile.ZIP_DEFLATED);[z.write(os.path.join(r,f),os.path.relpath(os.path.join(r,f),'extensao')) for r,_,fs in os.walk('extensao') for f in sorted(fs)]"
```

## Onde está no ar

- **App:** https://renandias-dot.github.io/central-comercial-brase/restaurantes/
- **Supabase:** projeto `brase-restaurantes` (`kxabfippeekyxpcgjytx`, São Paulo), separado do projeto da Central Comercial.
  - Banco: as duas migrações de `supabase/migrations` já foram aplicadas.
  - Função `restaurantes-api` publicada sem verificação de JWT (o acesso é controlado pela própria função; veja abaixo).
  - Coleta agendada no pg_cron (`restaurantes-coleta`, a cada 30 minutos, até 40 lojas por rodada: 1.920 lojas por dia). Com a base maior que isso, aumente a frequência ou o `limit` em `20261013000100_restaurantes_coleta.sql`.
  - A chave que o agendamento usa é gerada no próprio banco (tabela `rs_settings`) e não sai dele.

### Acesso

O app está **aberto**: quem tiver o endereço entra direto, sem código. Para exigir um código da equipe, crie o segredo **`RESTAURANTES_ACCESS_CODE`** no painel do Supabase (projeto brase-restaurantes › Edge Functions › Secrets): o app passa a pedir o código sozinho. A coleta agendada nunca fica aberta: só roda com a chave guardada em `rs_settings` (ou com o código, quando ele existir).

### Para refazer em outro projeto

1. Rode `supabase/migrations/20261013000000_restaurantes.sql` no SQL Editor. Pode rodar de novo sem problema.
2. Troque o endereço da função em `supabase/migrations/20261013000100_restaurantes_coleta.sql` e rode também.
3. Dentro da pasta `restaurantes/`: `supabase functions deploy restaurantes-api --project-ref SEU_PROJETO --no-verify-jwt`.
4. Se quiser exigir código de acesso, crie o segredo `RESTAURANTES_ACCESS_CODE`.
5. Ajuste a linha `window.RS_HOST` no topo de `index.html` com o endereço da função.

### Chave do Google (opcional)

Sem a chave, o app esconde tudo o que é do Google: o bloco da ficha, a coluna de nota, a tela Região no Google e as colunas do Google nos CSVs. Tudo aparece sozinho quando a chave for configurada.

1. Em [console.cloud.google.com](https://console.cloud.google.com), crie um projeto e ative o faturamento.
2. Em **APIs e serviços › Biblioteca**, ative a **Places API (New)**.
3. Em **Credenciais › Criar credenciais › Chave de API**, crie a chave. Em “Restrições de API”, limite a chave à **Places API (New)**. Não use restrição por site: a chave é usada pelo servidor, não pelo navegador.
4. Guarde como segredo `GOOGLE_PLACES_API_KEY` da função (Edge Functions › Secrets).

**Custo:** nota e avaliações caem na faixa “Text Search Enterprise”, com 1.000 consultas grátis por mês e depois US$ 35 por mil (tabela do Google em outubro de 2026). A ficha consulta o Google 1 vez por loja e guarda o resultado por 30 dias. “Buscar de novo no Google” na tela Região faz até 30 consultas. “Ir para o endereço” faz 1.

## Testes

```bash
deno test restaurantes/supabase/functions/restaurantes-api/logic.test.ts
```

Cobrem a leitura das respostas do iFood, do Google e da BrasilAPI, a identificação do ID da loja em links e a escolha do lugar do Google que corresponde à loja.

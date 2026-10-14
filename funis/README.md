# Funis · Brase

App separado da Central Comercial para criar quiz e funis interativos, no lugar do InLead. As funções foram mapeadas do editor do InLead (Construtor, Fluxo, Design, Leads e Configurações) e conferidas no código que o InLead entrega ao navegador, com o [REA](https://github.com/morluto/rea) (veja `docs/engenharia-reversa-inlead.md`). O funil **BRASE 2** já vem copiado, igual ao que está lá.

- **Editor:** `funis/index.html` (publicado pelo GitHub Pages junto com a Central Comercial, no endereço dela + `/funis/`).
- **Página do funil:** `funis/f/index.html?f=<endereço>` — o BRASE 2 fica em `…/funis/f/?f=brase-2`.
- **Motor dos funis:** `funis/runtime.js`, usado pelas duas páginas.
- **Servidor:** função `funis-api` no projeto Supabase `brase-funis`, separado da Central (`supabase/functions/funis-api`).
- **Banco:** tabelas `fn_*` (`supabase/migrations`).

## O que o app faz

| Tela | Funções |
|---|---|
| **Funis** (lista) | Novo funil (quiz com captura, em branco ou cópia do BRASE 2), importar (arquivo deste app ou JSON do InLead), duplicar, exportar JSON, excluir. Cada cartão mostra acessos, leads e completos. |
| **Construtor** | Etapas (criar a partir dos 10 modelos do InLead, renomear, duplicar, reordenar arrastando, excluir, script da etapa), paleta com os 34 componentes do InLead, celular com arrastar e soltar, desfazer/refazer, visão celular e computador, “Testar daqui”. Painel de cada componente com Conteúdo, Aparência, Exibição (regras) e Avançado (ID/Name, evento do Pixel, script). |
| **Fluxo** | Mapa das etapas com as ligações de cada opção e botão. Arrastar a bolinha até outra etapa muda o destino; arrastar a etapa muda a posição; auto-organizar; zoom. |
| **Design** | Combinações prontas, alinhamento, largura, dimensão, espaçamento, cantos, cor destaque, barra de progresso, logo, fundo (cor, imagem, gradiente, efeito, vídeo), fonte, cor e tamanho de títulos e textos. |
| **Leads** | Respostas (tabela por etapa e componente, com UTMs, aparelho e IP, detalhe de cada lead e reenvio ao webhook), Resultados (contagem de cada resposta), Performance (alcance de cada etapa e acessos/leads/completos por dia), 24 horas/7 dias/30 dias/tudo, exportar CSV e resetar dados. |
| **Configurações** | Geral (título e endereço), Domínio, Pixel/Scripts (Pixel da Meta, Google Analytics, Tag Manager com `StepView`/`FormSubmit`, verificação do Google, head e body), SEO & Favicon, Webhooks e Filtro de tráfego. |
| **Testar / Compartilhar / Publicar** | Teste do funil dentro do editor mostrando variáveis e pontuação; link público e botões de redes sociais; publicar troca a versão que está no ar (o editor salva o rascunho sozinho). |

### Componentes

Os mesmos do catálogo do InLead, com os mesmos nomes de campos (um funil exportado de lá abre aqui sem conversão):

- **Formulário:** campo (texto, e-mail, telefone com máscara, número, texto longo), botão, data, altura e peso (régua).
- **Quiz:** opções, múltipla escolha, escolha única, sim/não e **vídeo resposta** (vídeo em cima, opções embaixo). Opções com imagem ou emoji.
- **Mídia e conteúdo:** texto, imagem, vídeo (YouTube, Vimeo ou .mp4), áudio estilo WhatsApp.
- **Atenção:** alerta, **notificação** (pop-up de prova social com @1, @2, @3), timer (caixas, cartões, faixa, destaque ou texto; por tempo ou até uma data), loading, nível.
- **Argumentação:** argumentos, carrossel, depoimentos, FAQ, preço, antes/depois, checklist.
- **Gráficos:** métricas (barra ou círculo) e gráficos de linha, barras ou pizza.
- **Personalização:** HTML/Script e espaço.

### Lógica do funil (igual à do InLead)

- **Destino por opção:** cada opção leva para uma etapa, para a próxima ou para um link. Na escolha única o funil avança ao escolher, a não ser que a opção esteja marcada para esperar o botão.
- **Variáveis:** cada componente tem um ID/Name. `{{nome}}` ou `@nome` no texto e nas regras, `{{score.nome}}` com os pontos, `{{score}}` com o total e `calc(…)` para contas — o “Score da sua loja” do diagnóstico é `calc(({{score.tempo}}+{{score.adicional}}+{{score.promo}}+{{score.entrega}})/10)`.
- **Regras de exibição:** grupos de condições (E dentro do grupo, OU entre grupos), como os textos do diagnóstico que mudam conforme a frase e a culpa escolhidas.
- **Webhook:** sai quando o visitante avança depois de clicar no componente escolhido (no BRASE 2, o botão `VT19S2` “ENVIAR APLICAÇÃO!”), uma vez por visitante, antes de ir para o WhatsApp.
- **Pixel da Meta:** `PageView` ao abrir, como no InLead. Eventos extras por botão ou opção na aba Avançado.

### Fidelidade ao InLead

O que o REA mostrou no código do InLead e o app passou a fazer igual (detalhes e evidências em `docs/engenharia-reversa-inlead.md`):

| Assunto | Como funciona (igual ao InLead) |
|---|---|
| Variável `{{nome}}` | É o **valor** da opção escolhida (o texto, se a opção não tiver valor); na múltipla escolha, os valores unidos por `\|`. O texto da opção fica em `{{label.nome}}` (extra deste app). |
| Outras variáveis | `@nome` (um `@` colado em letra não troca, então e-mails ficam intactos), `score.nome`, `responses.nome` (todas as opções, `*` nas não marcadas), botão clicado = `clicked`, `tracking.<parâmetro da URL>`, `tracking.screen`. |
| Contas | `calc(…)` com resultado inteiro aparece inteiro; com decimais, duas casas (`74.50`). |
| Regras | Operadores `==`, `!=`, `>`, `>=`, `<`, `<=`, contém, “aparece N vezes em” e “representa N% de” (para múltipla escolha). Números com vírgula viram número. |
| Opções | Escolha única avança na hora, mesmo com botão na etapa, a não ser com “Esperar o botão para avançar”. Múltipla escolha avança pelo botão. |
| Links externos | Levam **todos os parâmetros da URL** do funil (UTMs, fbclid) e ganham `https://` se faltar. |
| Botão | Modelos de link: WhatsApp, Telegram, Messenger, Instagram, Calendly, Cal.com, TidyCal, Google Agenda, Google Meet, Zoom, Whereby, Shopify, Yampi, Cartpanda, VTEX, WooCommerce, Hotmart, Kirvano e Kiwify (checkout com nome, e-mail e telefone do lead). Telefone vira `55` + DDD + número. |
| Timer | Cores e modelos do InLead; por tempo, recomeça cada vez que a etapa abre. |
| Etapas | `?step=<id da etapa>` abre o funil direto nela; script por etapa; camadas arquivadas não aparecem. |
| Visitante | O código do visitante vale 14 dias: quem volta nesse prazo continua o mesmo lead. |
| Leads | Qualificado = respostas e cliques passam de 70% do número de etapas (ou completou). Completo = saiu por um link ou avançou na última etapa. |
| Tag Manager | `StepView` a cada etapa e `FormSubmit` na saída por link, com `funnelName`, `funnelID`, `stepName`, `stepID`, `stepIndex`, `userCode`, `params` e `content` (as variáveis). |
| Webhook | Corpo `{...variáveis, ...parâmetros da URL, code}`; token em `Authorization: Bearer` e `Api-Token`; gatilho aceita vários componentes separados por vírgula. Os campos do CRM (`nome`, `empresa`…), `funil`, `data` e `pagina` são extras deste app. |

## Leitura dos leads, anúncios e integrações

Opções para personalizar o funil e ler melhor os leads e a performance. Cada uma liga no editor; as que mudam a página valem depois de **Publicar**.

| Opção | Onde fica | O que faz |
|---|---|---|
| **Condição de anúncio** | Componente › Exibição › “Condição de anúncio” | Mostra um texto só para quem veio de um criativo (`@tracking.utm_content` contém “Escondeu”). Serve para trocar o título da Capa conforme o anúncio. |
| **Raio-X do iFood** | Paleta › Personalização › Raio-X iFood | A pessoa cola o link da loja e vê avaliações, pedidos estimados (avaliações × 2) e a posição entre as lojas da mesma categoria no raio, com os dados do app de Restaurantes. Variáveis `{{nome.avaliacoes}}`, `.pedidos`, `.posicao`, `.total`, `.falta`, `.proxima`. A posição só aparece com 5+ lojas da categoria na base da região; cada loja analisada entra na base. A coleta de dados do iFood não é autorizada pelos termos dele (veja o README do app de Restaurantes). |
| **Consentimento (LGPD)** | Campo › Conteúdo | Texto pequeno embaixo do campo (ex.: “Ao informar seu WhatsApp, você aceita receber…”). |
| **Celular validado** | automático | DDD que existe e celular com 9 na frente; o WhatsApp é guardado enquanto a pessoa digita. |
| **Regra de perfil** | Configurações › Leads e dados | Quem é “lead no perfil” (ex.: faturamento ≥ R$ 10 mil). Vai no webhook (`lead_no_perfil`), dispara o evento `LeadQualificado` no Pixel e no Tag Manager e aparece nos relatórios. |
| **Nota do lead (0–100)** | Configurações › Leads e dados | Soma de pontos por regra (faturamento, canal, dor, marketing, WhatsApp válido…). Vai no webhook (`nota_lead`, `lead_quente`). O botão “Usar o modelo Brase” preenche tudo para o BRASE 2. |
| **Abandono** | Configurações › Leads e dados | Quem deixou o WhatsApp e não enviou vai para o webhook depois de X minutos, com `abandonou: true` e `etapa_abandono`. Se voltar e enviar, vai de novo, completo. |
| **Repetidos** | Configurações › Leads e dados | O mesmo telefone não vai de novo ao CRM por N dias. |
| **Anúncios** | Leads › Anúncios | Por campanha, conjunto, anúncio, posicionamento ou origem: visitas, taxa de início, leads no perfil, nota média, envios, abandonos, reuniões, vendas, receita, gasto, custo por envio, por lead no perfil, por reunião e por venda, ROAS e o dia a dia de cada criativo (cansaço). Usa o modelo de link da Meta `Nome|ID` (campanha = `utm_campaign`, conjunto = `utm_medium`, anúncio = `utm_content`, posicionamento = `utm_term`). |
| **Caminhos** | Leads › Caminhos | Quantos viram cada etapa, quantos pararam ali, tempo mediano até avançar, quantos voltaram e os caminhos mais comuns. |
| **Colunas de leitura** | Leads › Respostas | Nota, perfil, WhatsApp (válido/repetido), envio (enviado, abandono, repetido, importado), etapa no CRM e venda. |
| **API de Conversões** | Configurações › Pixel/Scripts | O servidor manda à Meta os eventos de botão/opção, `LeadQualificado` e `Purchase`, com telefone, e-mail e nome em SHA-256, IP, navegador, fbc e fbp, e o mesmo `event_id` do Pixel (sem contar em dobro). Precisa do token do Gerenciador de Eventos. |
| **Gasto dos anúncios** | Configurações › Pixel/Scripts | Planilha do Gerenciador de Anúncios (Dia, Identificação/Nome do anúncio, Valor usado) ou busca automática com conta e token `ads_read`. |
| **Vendas do checkout** | Configurações › Integrações | Endereço para o webhook de vendas da Kirvano (ou Hotmart/Kiwify). A venda volta ligada ao lead pela marca `sck=fn-<código>` que o funil põe no link do checkout, ou pelo telefone/e-mail. Reembolsos descontam. |
| **Etapas do CRM** | Configurações › Integrações | Endereço para receber `{codigo ou telefone, etapa, valor}` ou planilha com essas colunas. Reuniões e vendas aparecem por anúncio. |
| **Leads antigos do InLead** | Leads › Importar do InLead (ou Integrações) | Planilha do “Exportar leads” ou JSON da API do painel do InLead. Entram com nota, perfil e WhatsApp validado, marcados como importados (não vão de novo ao CRM). |

Os tokens (API de Conversões, gasto da Meta) e a chave dos endereços de vendas/CRM ficam só no servidor, na coluna `secrets`; o editor e a página nunca recebem.

### BRASE 2 · otimizado

`data/brase-2-otimizado.json` (gerado por `tools/brase-2-otimizado.js`) é uma cópia do BRASE 2 publicado com as opções acima aplicadas, para comparar sem mexer no original:

- Formulário em 3 passos: WhatsApp primeiro (com consentimento), depois nome, depois loja com o Raio-X opcional.
- Resultado parcial na hora (“Seu diagnóstico”): o que já apareceu nas respostas (dor, fotos, cardápio, canal), os números do iFood quando a pessoa cola o link e a resposta à objeção de quem já pagou agência. O botão leva ao mesmo WhatsApp do envio.
- Regra de perfil (faturamento ≥ R$ 10 mil), nota do lead com o modelo Brase, abandono depois de 15 min e repetidos por 30 dias.
- O webhook continua no clique do `VT19S2` (agora no passo da loja), com os mesmos campos do CRM.

## O BRASE 2 copiado

`data/brase-2.json` tem o funil exatamente como estava no InLead em 13/10/2026:

- **Rascunho** com as 21 etapas (inclui PP 01 a PP 10, que no InLead ainda não estavam publicadas) e **versão publicada** com as 11 etapas que estão no ar.
- Textos, opções, valores, pontos, destinos (Faturamento abaixo de 5 mil e iFood/99 vão para o Zapfood), regras do diagnóstico, timer de 5 min, vídeo, áudio da Michele, preço, FAQ, links do WhatsApp e do checkout da Kirvano.
- Aparência (roxo `#a21caf`, laranja `#f59e0b`, fundo `#171717`, Inter), Pixel `1696577860982247`.
- O logo e o áudio foram baixados para `funis/media/`, para não depender do InLead.
- Webhook para o `crm-lead-webhook` da Central, no clique do `VT19S2`, já com os campos que o CRM entende (`nome`, `empresa`, `telefone`, `faturamento`, `dor`, `estrutura`). **O token não está no arquivo** (o repositório é público): ele é colado em Configurações › Webhooks e fica só no servidor.

Os leads e números antigos (acessos, respostas) continuam no InLead; use “Exportar leads” lá se quiser guardar.

> Publicar o rascunho coloca no ar também as etapas PP 01–PP 10 (elas ficam fora do caminho, porque nenhum botão leva até elas, mas entram na conta da barra de progresso). Se quiser manter o funil no ar com 11 etapas, mova as PP para um funil próprio antes de publicar (Duplicar o funil e excluir as etapas que não são dele).

## Servidor (já está no ar)

O servidor fica num projeto Supabase só dele, **`brase-funis`** (`covwdaygoorabowiuyfr`), separado da Central Comercial e do `brase-restaurantes`: nada aqui mexe nos dados ou nas funções da Central.

- **Banco:** tabelas `fn_funnels` e `fn_sessions`, função `fn_stats` e bucket público `funis` (imagens e áudios enviados pelo editor), criados por `supabase/migrations/20261014000000_funis.sql`. Pode rodar de novo sem problema.
- **Função:** `funis-api`, em `https://covwdaygoorabowiuyfr.supabase.co/functions/v1/funis-api`, com “Enforce JWT verification” desligado (a página do funil é aberta por qualquer visitante).
- **Páginas:** a linha `window.FN_HOST` de `funis/index.html` e `funis/f/index.html` já aponta para esse endereço.
- **BRASE 2:** já está no banco, publicado, com o webhook do CRM configurado (falta só o token, veja abaixo).

### Editor sem código de acesso

O editor abre direto, sem pedir código. Atenção: quem souber o endereço do servidor (ele aparece no código da página do funil) consegue usar as funções do editor, inclusive ler os leads e trocar o webhook. Para passar a exigir um código, crie no Supabase (projeto `brase-funis` › Edge Functions › Secrets) o segredo `FUNIS_ACCESS_CODE` com o código da equipe; o editor passa a pedir esse código na hora, sem precisar mudar nada no app.

### Token do CRM

Abra o BRASE 2 no editor › Configurações › Webhooks, cole a chave do webhook da Central no campo **TOKEN** e clique em **Salvar webhook**. **Testar envio** manda um lead de exemplo para conferir. Enquanto o token não estiver lá, o CRM recusa o envio (nenhum lead de teste entra) e o lead fica marcado com o erro na aba Leads, de onde dá para reenviar.

### Trocar os links dos anúncios

Troque `https://inlead.digital/brase-2` por `https://renandias-dot.github.io/central-comercial-brase/funis/f/?f=brase-2` nos anúncios, mantendo os parâmetros (`&utm_source=…&utm_campaign=…`). Para domínio próprio, veja Configurações › Domínio.

### Modo local

Com `window.FN_HOST` vazio, o app funciona sem servidor: o editor guarda tudo no navegador e a página do funil abre pelo arquivo `funis/data/<endereço>.json`, mas não grava leads nem manda para o CRM.

### Atualizar o servidor

Depois de mudar `supabase/functions/funis-api`, publique de novo de dentro da pasta `funis/`:

```bash
supabase functions deploy funis-api --project-ref covwdaygoorabowiuyfr --no-verify-jwt
```

A função tem três arquivos: `index.ts` (rotas), `logic.ts` (regras de negócio) e `rules.ts` (o mesmo motor de variáveis e regras do `runtime.js`). O Raio-X usa o app de Restaurantes (`brase-restaurantes`); para apontar para outro, use o segredo `RESTAURANTES_API` (e `RESTAURANTES_ACCESS_CODE` se ele pedir código).

O projeto está no plano grátis do Supabase, que pausa projetos sem uso por uma semana; com o funil recebendo visitas ele continua ativo.

## Testes

```bash
node --test funis/tests/*.test.js
deno test --allow-read funis/supabase/functions/funis-api/logic.test.ts
```

Cobrem o motor (contas, variáveis com `{{}}` e `@`, celular válido, Raio-X, regras com todos os operadores do InLead, links com os parâmetros da URL, modelos de link do botão, máscara de telefone, importação do InLead), a navegação e o score do BRASE 2 iguais aos do InLead, a junção das respostas no servidor, o gatilho e o corpo do webhook no formato do InLead e do CRM, a conta de qualificados, a guarda do token e a leitura dos leads no servidor (regras iguais às do funil, nota, perfil, abandono, vendas da Kirvano, etapas do CRM, relatório por anúncio, caminhos, eventos da API de Conversões e importação do InLead).

## O que ficou de fora

- **Editar com IA** e os **Momentos** (animações e partículas por etapa) do InLead.
- Domínio próprio por funil (o app usa o domínio do GitHub Pages; dá para apontar um domínio para o site todo).
- Os dados históricos de acessos e leads do InLead.

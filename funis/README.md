# Funis · Brase

App separado da Central Comercial para criar quiz e funis interativos, no lugar do InLead. As funções foram mapeadas do editor do InLead (Construtor, Fluxo, Design, Leads e Configurações) e o funil **BRASE 2** já vem copiado, igual ao que está lá.

- **Editor:** `funis/index.html` (publicado pelo GitHub Pages junto com a Central Comercial, no endereço dela + `/funis/`).
- **Página do funil:** `funis/f/index.html?f=<endereço>` — o BRASE 2 fica em `…/funis/f/?f=brase-2`.
- **Motor dos funis:** `funis/runtime.js`, usado pelas duas páginas.
- **Servidor:** função `funis-api` do Supabase (`supabase/functions/funis-api`).
- **Banco:** tabelas `fn_*` (`supabase/migrations`).

## O que o app faz

| Tela | Funções |
|---|---|
| **Funis** (lista) | Novo funil (quiz com captura, em branco ou cópia do BRASE 2), importar (arquivo deste app ou JSON do InLead), duplicar, exportar JSON, excluir. Cada cartão mostra acessos, leads e completos. |
| **Construtor** | Etapas (criar a partir de modelos, renomear, duplicar, reordenar arrastando, excluir), paleta com 33 componentes, celular com arrastar e soltar, desfazer/refazer, visão celular e computador, “Testar daqui”. Painel de cada componente com Conteúdo, Aparência, Exibição (regras) e Avançado (ID/Name, evento do Pixel, script). |
| **Fluxo** | Mapa das etapas com as ligações de cada opção e botão. Arrastar a bolinha até outra etapa muda o destino; arrastar a etapa muda a posição; auto-organizar; zoom. |
| **Design** | Combinações prontas, alinhamento, largura, dimensão, espaçamento, cantos, cor destaque, barra de progresso, logo, fundo (cor, imagem, gradiente, efeito, vídeo), fonte, cor e tamanho de títulos e textos. |
| **Leads** | Respostas (tabela por etapa e componente, com UTMs, aparelho e IP, detalhe de cada lead e reenvio ao webhook), Resultados (contagem de cada resposta), Performance (alcance de cada etapa e acessos/leads/completos por dia), 24 horas/7 dias/30 dias/tudo, exportar CSV e resetar dados. |
| **Configurações** | Geral (título e endereço), Domínio, Pixel/Scripts (Pixel da Meta, Google Analytics, Tag Manager, verificação do Google, head e body), SEO & Favicon, Webhooks e Filtro de tráfego. |
| **Testar / Compartilhar / Publicar** | Teste do funil dentro do editor mostrando variáveis e pontuação; link público e botões de redes sociais; publicar troca a versão que está no ar (o editor salva o rascunho sozinho). |

### Componentes

Formulário: campo, e-mail, telefone (com máscara), botão, número, texto longo, data, altura e peso (régua). Quiz: opções, múltipla escolha, escolha única com descrição, sim/não, opções com imagem. Mídia e conteúdo: texto, imagem, vídeo (YouTube, Vimeo ou .mp4), áudio estilo WhatsApp, alerta, timer, loading, nível. Argumentação: argumentos, depoimentos, FAQ, preço, checklist, antes/depois, carrossel. Gráficos: gráfico de barras e métricas. Personalização: espaço e HTML/Script.

### Lógica do funil (igual à do InLead)

- **Destino por opção:** cada opção leva para uma etapa, para a próxima ou para um link. Sem botão na etapa, escolher a opção já avança.
- **Variáveis:** cada componente tem um ID/Name. `@nome` nas regras, `{{nome}}` no texto, `{{score.nome}}` com os pontos da opção escolhida, `{{score}}` com o total e `calc(…)` para contas — o “Score da sua loja” do diagnóstico é `calc(({{score.tempo}}+{{score.adicional}}+{{score.promo}}+{{score.entrega}})/10)`.
- **Regras de exibição:** grupos de condições (E dentro do grupo, OU entre grupos), como os textos do diagnóstico que mudam conforme a frase e a culpa escolhidas.
- **Webhook:** sai quando o visitante clica no componente escolhido (no BRASE 2, o botão `VT19S2` “ENVIAR APLICAÇÃO!”), uma vez por visitante, antes de ir para o WhatsApp.
- **Pixel da Meta:** `PageView` ao abrir, como no InLead. Eventos extras por botão ou opção na aba Avançado.

## O BRASE 2 copiado

`data/brase-2.json` tem o funil exatamente como estava no InLead em 13/10/2026:

- **Rascunho** com as 21 etapas (inclui PP 01 a PP 10, que no InLead ainda não estavam publicadas) e **versão publicada** com as 11 etapas que estão no ar.
- Textos, opções, valores, pontos, destinos (Faturamento abaixo de 5 mil e iFood/99 vão para o Zapfood), regras do diagnóstico, timer de 5 min, vídeo, áudio da Michele, preço, FAQ, links do WhatsApp e do checkout da Kirvano.
- Aparência (roxo `#a21caf`, laranja `#f59e0b`, fundo `#171717`, Inter), Pixel `1696577860982247`.
- O logo e o áudio foram baixados para `funis/media/`, para não depender do InLead.
- Webhook para o `crm-lead-webhook` da Central, no clique do `VT19S2`, já com os campos que o CRM entende (`nome`, `empresa`, `telefone`, `faturamento`, `dor`, `estrutura`). **O token não está no arquivo** (o repositório é público): ele é colado em Configurações › Webhooks e fica só no servidor.

Os leads e números antigos (acessos, respostas) continuam no InLead; use “Exportar leads” lá se quiser guardar.

> Publicar o rascunho coloca no ar também as etapas PP 01–PP 10 (elas ficam fora do caminho, porque nenhum botão leva até elas, mas entram na conta da barra de progresso). Se quiser manter o funil no ar com 11 etapas, mova as PP para um funil próprio antes de publicar (Duplicar o funil e excluir as etapas que não são dele).

## Como colocar no ar

Sem o servidor, o app já funciona em **modo local**: o editor guarda tudo no navegador e a página do funil abre pelo arquivo `funis/data/<endereço>.json` (o BRASE 2 já abre assim), mas não grava leads nem manda para o CRM. Para isso, configure o servidor:

Use o projeto Supabase da Central Comercial (`wndgqvkeguampmtmkmhq`) ou outro.

### 1. Banco

No Supabase › **SQL Editor**, cole e rode o conteúdo de `supabase/migrations/20261014000000_funis.sql`. Pode rodar de novo sem problema. Ele cria as tabelas `fn_funnels` e `fn_sessions`, a função `fn_stats` e o bucket público `funis` (imagens e áudios enviados pelo editor).

### 2. Segredo

Escolha um código de acesso para a equipe (pode ser o mesmo da Central Comercial):

```bash
supabase secrets set --project-ref wndgqvkeguampmtmkmhq FUNIS_ACCESS_CODE="código-da-equipe"
```

### 3. Função

Dentro da pasta `funis/`:

```bash
supabase functions deploy funis-api --project-ref wndgqvkeguampmtmkmhq --no-verify-jwt
```

O `--no-verify-jwt` é necessário porque a página do funil é aberta por qualquer visitante e o editor entra com o código da equipe. Pelo painel também funciona: Edge Functions › Deploy a new function › editor, com os arquivos `index.ts` e `logic.ts`, e “Enforce JWT verification” desligado.

### 4. Endereço do servidor nas páginas

Em `funis/index.html` e `funis/f/index.html`, preencha a linha `window.FN_HOST` com o endereço da função:

```html
<script>window.FN_HOST = {"api": "https://wndgqvkeguampmtmkmhq.supabase.co/functions/v1/funis-api"};</script>
```

### 5. Trazer o BRASE 2 e o token do CRM

Abra o editor, entre com o código e clique em **Trazer o BRASE 2**. Ele abre em Configurações › Webhooks: cole o token do CRM no campo **TOKEN** (ou cole em API URL o endereço completo com `?token=…`, como estava no InLead) e clique em **Salvar webhook**. **Testar envio** manda um lead de exemplo para conferir.

### 6. Trocar os links dos anúncios

Troque `https://inlead.digital/brase-2` por `https://renandias-dot.github.io/central-comercial-brase/funis/f/?f=brase-2` nos anúncios, mantendo os parâmetros (`&utm_source=…&utm_campaign=…`). Para domínio próprio, veja Configurações › Domínio.

## Testes

```bash
node --test funis/tests/*.test.js
deno test --allow-read funis/supabase/functions/funis-api/logic.test.ts
```

Cobrem o motor (contas, variáveis, regras, navegação, máscara de telefone, importação do InLead), a navegação e o score do BRASE 2 iguais aos do InLead, a junção das respostas no servidor, o gatilho e o corpo do webhook no formato do CRM e a guarda do token.

## O que ficou de fora

- **Editar com IA** e **Vídeo Resposta** do InLead.
- Domínio próprio por funil (o app usa o domínio do GitHub Pages; dá para apontar um domínio para o site todo).
- Os dados históricos de acessos e leads do InLead.

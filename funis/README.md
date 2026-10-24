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
| **Ponta a ponta** | Leads › Ponta a ponta | Do anúncio à venda num lugar só: impressões, cliques no link e visitas na página (Meta) → visitas, inícios, WhatsApp e envios (funil) → chegaram na Central, agendaram, reunião feita e fecharam (Central Comercial), com a taxa de cada passagem e o custo por etapa (CPL, custo por agendamento, por reunião, CAC, ROAS). Mostra também onde os leads do período estão na Central e o dia a dia. Três visões: este funil só com anúncios da Meta (padrão), este funil com todo o tráfego e **Conta inteira** (todo o gasto da Meta, visitas de todos os funis e os leads da Meta na Central pela data de entrada lá, como na aba Tráfego da Central). Quando o funil começou a receber anúncios no meio do período, um aviso mostra quanto a conta inteira investiu. Veja “Ponta a ponta” abaixo. |
| **Anúncios** | Leads › Anúncios | Por campanha, conjunto, anúncio, posicionamento ou origem: gasto, impressões, cliques, CTR, CPC, visitas, taxa de início, leads no perfil, nota média, envios, abandonos, agendamentos e reuniões feitas (Central), vendas, receita, custo por envio, por lead no perfil, por agendamento, por reunião feita e por venda, ROAS e o dia a dia de cada criativo (cansaço). Usa o modelo de link da Meta `Nome|ID` (campanha = `utm_campaign`, conjunto = `utm_medium`, anúncio = `utm_content`, posicionamento = `utm_term`). |
| **Caminhos** | Leads › Caminhos | Quantos viram cada etapa, quantos pararam ali, tempo mediano até avançar, quantos voltaram e os caminhos mais comuns. |
| **Colunas de leitura** | Leads › Respostas | Nota, perfil, WhatsApp (válido/repetido), envio (enviado, abandono, repetido, importado), etapa no CRM e venda. |
| **API de Conversões** | Configurações › Pixel/Scripts | O servidor manda à Meta os eventos de botão/opção, `LeadQualificado` e `Purchase`, com telefone, e-mail e nome em SHA-256, IP, navegador, fbc e fbp, e o mesmo `event_id` do Pixel (sem contar em dobro). Precisa do token do Gerenciador de Eventos. |
| **Gasto dos anúncios** | automático (e Configurações › Pixel/Scripts) | Vem sozinho da Central Comercial e da rotina diária com a Meta; com conta e token `ads_read`, o servidor busca direto a cada 30 min. A planilha do Gerenciador (Dia, Identificação/Nome do anúncio, Valor usado) continua valendo. |
| **Central Comercial** | Configurações › Integrações | Com o código de acesso da Central, o servidor lê os leads de lá a cada 30 min e liga cada um à visita: etapa, agendamento, reunião feita e venda aparecem em Ponta a ponta, Anúncios e na ficha do lead (com link para abrir o lead na Central). |
| **Vendas do checkout** | Configurações › Integrações | Endereço para o webhook de vendas da Kirvano (ou Hotmart/Kiwify). A venda volta ligada ao lead pela marca `sck=fn-<código>` que o funil põe no link do checkout, ou pelo telefone/e-mail. Reembolsos descontam. |
| **Etapas do CRM** | Configurações › Integrações | Endereço para receber `{codigo ou telefone, etapa, valor}` ou planilha com essas colunas. Reuniões e vendas aparecem por anúncio. |
| **Teste A/B** | Configurações › Leads e dados › Testes A/B | Cada visitante cai numa variante fixa (sorteada pelo código dele). O componente aparece só numa variante com a condição `@teste.capa` é igual a `v1`. A variante vai no webhook (`teste_capa`) e a aba Leads › Anúncios › Teste compara visitas, inícios, perfil e envios de cada uma. `?teste_capa=v1` no link força a variante. Sem variante (página antiga), aparece a que usa “diferente de”. |
| **Etiquetas para o SDR** | Configurações › Leads e dados › Etiquetas | Regras que dão etiquetas ao lead (ex.: “DI, prioridade alta”, “Já pagou agência”, “Dor: lucro baixo”). Vão no webhook em `etiquetas` e aparecem na aba Leads. |
| **LeadQualificado só no envio** | Configurações › Pixel/Scripts › Só quando… | O evento espera, além da regra de perfil, uma condição (ex.: `@VT19S2` = `clicked`). Assim a Meta aprende com o lead no perfil que deixou o WhatsApp, não com quem só respondeu o faturamento. |
| **Leads antigos do InLead** | Leads › Importar do InLead (ou Integrações) | Planilha do “Exportar leads” ou JSON da API do painel do InLead. Entram com nota, perfil e WhatsApp validado, marcados como importados (não vão de novo ao CRM). |

Os tokens (API de Conversões, gasto da Meta) e a chave dos endereços de vendas/CRM ficam só no servidor, na coluna `secrets`; o editor e a página nunca recebem.

### Ponta a ponta (Meta → funil → Central Comercial)

- **Gasto da Meta** fica na tabela `fn_ad_spend`, da conta inteira, por anúncio e por dia: gasto, impressões, cliques (todos e no link), visitas na página e leads do Pixel. Entra por quatro caminhos, e cada número fica com o maior valor visto (o dia de hoje chega incompleto e só cresce): (1) a Central Comercial, que guarda o investimento que ela mesma busca na Meta, lida a cada 30 min; (2) a rotina “Gasto da Meta: Funis e Central” (claude.ai › Rotinas, todo dia às 7h47 e pelo botão da Central), que usa o conector da Meta, lê os últimos 7 dias e grava pela operação `cron.spend`; (3) o token `ads_read` em Configurações › Pixel/Scripts, que faz o servidor buscar os últimos 3 dias a cada 30 min; (4) a planilha do Gerenciador (fica em `fn_spend`, só daquele funil). A rotina precisa do conector da Meta na lista de conectores dela (já está).
- **Qual funil leva o gasto**: o de um anúncio num dia vai para o funil mais recente que já recebia visita daquele anúncio. Se a primeira visita no funil novo chegou depois do meio-dia, o dia da troca fica com o funil antigo. Ex.: os anúncios 3.0 e 4.0 passaram para o otimizado na noite de 16/10, então o gasto deles conta no otimizado a partir de 17/10 e, antes disso, no BRASE 2 (InLead).
- **Central Comercial**: com o código de acesso dela guardado em Configurações › Integrações (fica em `fn_config`, nunca volta para o editor), o servidor lê os leads da Central a cada 30 min (pg_cron `funis-sync` → operação `cron.sync`) e liga cada um à visita no funil pelo código do visitante (`inleadCode`, o `code` do webhook) ou, sem ele, pelo WhatsApp. Guarda em `fn_sessions.crm` a etapa, quando agendou (`bookedAt`), quando a reunião aconteceu (`meetingDoneAt`), se fechou, o valor, o responsável e o motivo de perda. “Agendou” conta mesmo que o lead tenha virado perdido depois; “reunião feita” idem.
- **Conta inteira**: a cada leitura, a Central também é copiada para `fn_crm_leads` (só origem, anúncio, etapa, datas, valor, responsável e o código do visitante; sem nome, telefone ou e-mail). Quem sai da Central sai daqui na leitura seguinte. Custo por lead da conta = gasto de todos os anúncios ÷ leads da Meta que entraram na Central no período.
- **Tráfego da Central pela rotina**: o que a rotina manda em `cron.spend` também vai para o documento `meta/spend` da Central (aba Tráfego): os dias entre o primeiro e o último da remessa são trocados inteiros e o resto fica como está (`crmSpendDoc` em `logic.ts`). O resultado da última gravação fica em `fn_config` (k = `crm_spend`).
- **Botão “Atualizar investimento” da Central** (opcional; sem ele o investimento entra todo dia às 7h47 pela rotina): sem o token da Meta no servidor da Central, o botão só aparece depois de ligado e chama a operação `crm.refresh` daqui (cabeçalho `x-crm-key` com o código de acesso da Central, o mesmo de `fn_config` k = `crm`), que dispara a rotina pelo gatilho de API dela e responde na hora; a rotina leva 1 a 2 minutos e a Central atualiza sozinha. Para ligar (uma vez): na rotina, *Editar* › *Gatilho* › **+** › **API**, copie o *Fire URL*, gere o token e cole os dois em Central › Configurações › Meta (operação `crm.refresh.config`; ficam em `fn_config` k = `crm_refresh` e nunca voltam para a página). Um pedido a cada 5 min no máximo; cada disparo é uma sessão do Claude e conta no uso da assinatura.
- **Chave das operações de máquina** (`cron.sync`, `cron.spend`): gerada no banco (`fn_config`, k = `cron`), nunca no repositório; vai no cabeçalho `x-fn-cron`. Para trocar: `update fn_config set v = jsonb_build_object('key', encode(extensions.gen_random_bytes(24), 'hex')) where k = 'cron';` e atualize a chave no texto da rotina diária.
- Agendamento a cada 30 min (já criado no projeto `brase-funis`):

```sql
select cron.schedule('funis-sync', '*/30 * * * *', $job$
  select net.http_post(url := 'https://covwdaygoorabowiuyfr.supabase.co/functions/v1/funis-api', body := '{"op":"cron.sync"}'::jsonb,
    headers := jsonb_build_object('content-type', 'application/json', 'x-fn-cron', (select v->>'key' from public.fn_config where k = 'cron')), timeout_milliseconds := 60000)
$job$);
```

### BRASE 2 · otimizado

`data/brase-2-otimizado.json` é a cópia do que está publicado (15/10/2026, já com as edições feitas no editor). `tools/brase-2-otimizado.js` gera a versão de 13/10/2026 a partir do documento “Funil Inlead Brase — Análise e Testes de Conversão”; rodar o gerador sobrescreve essas edições. O BRASE 2 original não muda.

- **Capa em teste A/B:** a capa antiga (“o iFood escondeu sua loja?”, só com “menos de 2 minutos” no lugar de “45 segundos”) contra a V1, “Sua loja vende menos no iFood do que deveria?”, com botão âmbar “Ver onde minha loja trava” e a linha “a partir de R$ 10 mil”. Metade dos visitantes vê cada uma. Ficou desligado em 15/10 e voltou em 16/10/2026, porque com a V1 sozinha poucos passavam da capa.
- **Faturamento:** a pergunta fica como está. A etapa 6 foi corrigida: de R$ 5 a 10 mil, quem vende pelo iFood/99 vai para o formulário (passando pela pergunta de marketing) e quem vende no balcão ou no cardápio próprio vai para o ramo de baixo.
- **Formulário V7:** “Pelas suas respostas, já dá pra ver onde sua loja perde pedido” com uma linha ❌ por resposta (dor, fotos, cardápio e marketing; ✅ quando fotos e cardápio estão bons), o próximo passo explicado, 3 campos (primeiro nome, loja no iFood, WhatsApp com DDD) e o botão “Quero ver o resto da minha loja”, que abre o WhatsApp do Lipe com o texto “Oi, Lipe! Sou {nome}, da {loja}. Acabei de fazer o teste da Brase.”
- **Formulário V5** (só no gerador; saiu do publicado em 14/10): quem marca “Já paguei agência” vê “Você já pagou por isso e não viu resultado”, as linhas ❌ e o botão “Quero ver o número da minha loja”. No publicado, todo mundo vai para o V7.
- **Ramo abaixo de R$ 5 mil, no arco do Hunt Cash:** ponte honesta → tipo de loja → frase que já pensou → de quem é a culpa → tempo de entrega, adicional, promoção e entrega grátis (com a pior opção na voz do dono) → carregando → diagnóstico com o Score calculado, o que tira pedido e a causa única → cena de futuro → demonstração do Scanner com exemplo do tipo de loja → quando quer começar → oferta.
- **Checkout honesto do ZapFood:** sem cronômetro, sem “Tempo limitado!”, sem “DE R$ 297” e sem a barra fixa de 14%. Mostra o Score da pessoa, o vídeo, o depoimento da Michele, R$ 97 à vista ou 12x de R$ 9,94, pagamento único e garantia de 7 dias.
- **Leitura:** regra de perfil (faturamento ≥ R$ 10 mil), nota do lead, abandono depois de 15 min, repetidos por 30 dias, etiquetas (DI/Plano IA pela faixa, “Já pagou agência” e a dor) e `LeadQualificado` só quando o lead no perfil clica no botão do formulário.

Está publicado no servidor: `https://app.brasemarketing.com.br/funis/f/?f=brase-2-otimizado`, para onde vão os anúncios. Para ver uma capa: `&teste_capa=atual` ou `&teste_capa=v1`.

Ficou de fora do funil (fora da página): a planilha diária do Lipe e o modelo M4 no NicoChat ligado ao webhook. A foto do Lipe, os casos com autorização e o número real de horários (V7 da capa, V6 do formulário) dependem de material seu.

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
- **Cópia no CDN:** função `funis-cdn` (também sem JWT) grava cada funil publicado em `funis/publicados/<endereço>.json` no Storage público. Veja “Velocidade” abaixo.
- **Páginas:** a linha `window.FN_HOST` de `funis/index.html` e `funis/f/index.html` já aponta para esse endereço.
- **BRASE 2:** já está no banco, publicado, com o webhook do CRM configurado (falta só o token, veja abaixo).

### Velocidade

- **Primeira tela sem servidor:** a página do funil busca a cópia publicada no CDN do Storage (`…/storage/v1/object/public/funis/publicados/<endereço>.json`, comprimida, ~13 KB) já no `<head>`, ao mesmo tempo que baixa o `runtime.js` (com `defer`, então o carregando aparece na hora). Não passa pela `funis-api` nem pelo banco, então não sofre com o servidor “frio” (que chegava a 9 s na primeira visita depois de um tempo parado). Sem a cópia, cai na `funis-api` como antes e pede para gravar a cópia.
- **Cópia sempre atual:** o editor atualiza a cópia ao publicar, tirar do ar, excluir e trocar o endereço. A página também confere em segundo plano (2,5 s depois de abrir) se a cópia ainda é a versão publicada, e a `funis-cdn` regrava se não for. O CDN guarda a cópia por até 30 s, então uma publicação aparece em até meio minuto. Depois de mudar um funil direto no banco, chame `POST …/functions/v1/funis-cdn` com `{"slugs": ["endereço"]}`.
- **Troca de etapa:** o cabeçalho (logo, voltar e barra) fica na tela; só o conteúdo troca, entrando em 0,28 s (de baixo ao avançar, de cima ao voltar). A espera depois de tocar numa opção caiu de 280 para 200 ms. As imagens das etapas seguintes são baixadas enquanto a pessoa lê a atual. Quem pede menos movimento no celular não vê as animações.
- **Visita só quando a pessoa vê a tela:** a Meta às vezes carrega a página escondida antes do clique. Até a página ficar visível, nada é registrado e o Pixel não dispara; quando aparece (ou a pessoa toca em algo), a visita conta a partir dali. Assim a taxa de quem passa da capa não fica puxada para baixo por quem nunca viu a página.
- **Barra de progresso:** desliza até o novo ponto e conta pelo caminho: etapas feitas ÷ (feitas + as que faltam no caminho mais curto até o fim). No caminho principal do otimizado ela vai de 14% na capa a 100% no formulário (antes ia até 35%, porque contava as 23 etapas, inclusive as do outro ramo). No editor continua pela posição na lista.

### Código de acesso do editor

O editor e todas as funções da equipe (leads, webhook, integrações, apagar) pedem o código de acesso; a página pública do funil continua aberta. O servidor guarda só um hash do código (tabela `fn_config`), nunca o código. Para trocar: Configurações › Geral › Código de acesso do editor (vale para toda a equipe; quem estiver com o antigo precisa entrar de novo). Se preferir guardar no Supabase, crie o segredo `FUNIS_ACCESS_CODE` (projeto `brase-funis` › Edge Functions › Secrets): ele passa a valer no lugar do código do editor.

Apagar os leads de um funil ou excluir um funil exige, no servidor, o endereço do funil como confirmação. Código errado espera um pouco antes de responder, para atrasar quem tenta adivinhar.

Bloqueio por tentativas (tabela `fn_auth_fails`): 10 códigos errados do mesmo IP em 15 minutos travam esse IP por 15 minutos, mesmo com o código certo. Se a soma de erros de todos os IPs passar de 100 na última hora, o editor trava para todo mundo até a contagem baixar (protege contra quem troca de IP). Acertar o código zera a contagem do IP. A página pública do funil nunca é afetada. Para destravar na hora: `update fn_auth_fails set fails = 0, locked_until = null, window_start = now() - interval '2 hours';` no SQL do Supabase.

### Domínio próprio (Cloudflare Pages)

O domínio `brasemarketing.com.br` já está na Cloudflare (o e-mail continua no Google Workspace). O repositório tem o que a Cloudflare Pages precisa:

- `functions/_middleware.js`: em `diagnostico.brasemarketing.com.br` só o funil público existe, com endereço limpo (`/brase-2-otimizado?utm_source=…`); qualquer outro caminho dá “não encontrado”. Em `app.brasemarketing.com.br` ficam a Central e os editores.
- `_headers`: HTTPS obrigatório, bloqueio de quem tentar abrir as páginas dentro de outro site, `noindex` e as demais proteções de navegador.

Passos na Cloudflare: Workers & Pages › Create › Pages › Connect to Git › repositório `central-comercial-brase`, branch `main`, sem comando de build, pasta de saída `/`. Desligue as “preview deployments”. Em Custom domains, adicione `diagnostico.brasemarketing.com.br` e `app.brasemarketing.com.br`. Em Zero Trust › Access, crie uma aplicação para `app.brasemarketing.com.br` (e para o endereço `….pages.dev` do projeto) liberando só os e-mails da equipe. Depois, em `funis/index.html`, `FN_HOST.public` = `https://diagnostico.brasemarketing.com.br/{slug}` faz o editor mostrar os links novos. Com os anúncios já no domínio novo, dá para desligar o GitHub Pages e deixar o repositório privado.

### Token do CRM

Abra o BRASE 2 no editor › Configurações › Webhooks, cole a chave do webhook da Central no campo **TOKEN** e clique em **Salvar webhook**. **Testar envio** manda um lead de exemplo para conferir. Enquanto o token não estiver lá, o CRM recusa o envio (nenhum lead de teste entra) e o lead fica marcado com o erro na aba Leads, de onde dá para reenviar.

### Links dos anúncios

Desde 15/10/2026 os anúncios levam para `https://app.brasemarketing.com.br/funis/f/?f=brase-2-otimizado`, com os parâmetros de URL da Meta (`utm_source=FB&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_medium={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}&utm_term={{placement}}`).

### Modo local

Com `window.FN_HOST` vazio, o app funciona sem servidor: o editor guarda tudo no navegador e a página do funil abre pelo arquivo `funis/data/<endereço>.json`, mas não grava leads nem manda para o CRM.

### Atualizar o servidor

Depois de mudar `supabase/functions/funis-api` ou `supabase/functions/funis-cdn`, publique de novo de dentro da pasta `funis/`:

```bash
supabase functions deploy funis-api --project-ref covwdaygoorabowiuyfr --no-verify-jwt
supabase functions deploy funis-cdn --project-ref covwdaygoorabowiuyfr --no-verify-jwt
```

A função tem três arquivos: `index.ts` (rotas), `logic.ts` (regras de negócio) e `rules.ts` (o mesmo motor de variáveis e regras do `runtime.js`). O Raio-X usa o app de Restaurantes (`brase-restaurantes`); para apontar para outro, use o segredo `RESTAURANTES_API` (e `RESTAURANTES_ACCESS_CODE` se ele pedir código).

O projeto está no plano grátis do Supabase, que pausa projetos sem uso por uma semana; com o funil recebendo visitas ele continua ativo.

## Testes

```bash
node --test funis/tests/*.test.js
deno test --allow-read funis/supabase/functions/funis-api/logic.test.ts
```

Cobrem o motor (contas, variáveis com `{{}}` e `@`, celular válido, Raio-X, regras com todos os operadores do InLead, links com os parâmetros da URL, modelos de link do botão, máscara de telefone, importação do InLead), a navegação e o score do BRASE 2 iguais aos do InLead, a junção das respostas no servidor, o gatilho e o corpo do webhook no formato do InLead e do CRM, a conta de qualificados, a guarda do token e a leitura dos leads no servidor (regras iguais às do funil, nota, perfil, abandono, vendas da Kirvano, etapas do CRM, relatório por anúncio, caminhos, eventos da API de Conversões, importação do InLead, etiquetas e relatório por variante do teste A/B) e o sorteio do teste A/B (variante fixa por visitante, forçada pelo link).

## O que ficou de fora

- **Editar com IA** e os **Momentos** (animações e partículas por etapa) do InLead.
- Domínio próprio por funil (o app usa o domínio do GitHub Pages; dá para apontar um domínio para o site todo).
- Os dados históricos de acessos e leads do InLead.

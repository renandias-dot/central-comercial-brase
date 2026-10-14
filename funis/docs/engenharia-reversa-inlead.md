# Engenharia reversa do InLead com o REA

Feita em 14/10/2026 com o [REA](https://github.com/morluto/rea) 6.4.0 (`rea-agents`) sobre o editor do funil BRASE 2 aberto num Chromium com CDP, logado na conta da Brase. O REA não executa o código capturado: tudo abaixo é **observação estática** do código que o InLead entrega ao navegador, salvo quando marcado como inferência. O que acontece no servidor do InLead (envio do webhook, contas da aba Leads) não aparece no código do navegador e continua desconhecido.

## Como foi feito

| Passo | Comando do REA | Evidência |
|---|---|---|
| Achar a página do editor | `list-browser-targets` | `ev_af6f16577c9cb96ef8ce9235bfb7bfe37e2d452b759991901b8a76bc2851cf57` |
| Capturar e analisar o pacote | `analyze-web-bundle --fetch-source-maps` | `ev_697c020f86e46a69c49a35ebe8e175e5c1185493b36750cc1442412d54633e78` — 118 scripts, Next.js + React + webpack, sem source maps publicados |
| Guardar os scripts | `inspect-web-page --include-script-sources` + `export-web-scripts` | `ev_8aaec8fcec4a0b0934385bbf3547b1e5cdbe772a1063b0132c03e6f11a088afe` (116 scripts, 3,4 MB) |
| Reconstruir a aplicação | `analyze-javascript-application` | `ev_08ff32d51a90928a713879fcdc46645651c74119ca4e1433b9c4cbded27da61a` — 896 módulos, 7.381 achados, cobertura parcial (pacotes grandes passaram do orçamento de memória; os fatos de cada arquivo foram mantidos) |
| Recuperar código legível (Wakaru 1.14.0) | `recover-javascript-sources` | catálogo de componentes `ev_107de797…` (pacote 10232), motor do funil `ev_2648a197…` (70165), botão e modelos de link `ev_72e974ed…` (57531), página do editor `ev_551d677d…`, configurações `ev_d3c2a7da…` |

## O que o código mostra

### Catálogo de componentes (pacote 10232)

Formulário: `field` (texto, `email`, `phone` com máscara, `number`, `textarea`), `button`, `date`, `height`, `weight`. Quiz: `options` em cinco variações — Opções, Múltipla escolha (`multiple: true`), Escolha única, Sim/Não e **Vídeo resposta** (`introType: "video"`, com o código do vídeo em `introduction`). Mídia e conteúdo: `text`, `image`, `video`, `audio`. Atenção: `alert`, **`notification`** (pop-up de prova social com `@1`, `@2`, `@3` trocados a cada aviso), `timer`, `loading`, `metric`. Argumentação: `arguments`, `carousel`, `quotes` (depoimentos), `faq`, `price`, `compare` (antes/depois), `checklist`. Gráficos: `graphics` (métricas em barra), `charts` (linha, barra ou pizza com conjuntos de dados). Personalização: `group` (marcado como teste), `script`, `clear`. Modelos de etapa: Página inicial, Quiz em lista, Formulário, Captura simples, Quiz em colunas, Múltipla escolha, Escala de like, Gráfico, Progresso e Pré-checkout.

### Variáveis e contas (módulo 60527)

- O texto aceita `{{nome}}` e também `@nome`. Um `@` colado em letra, ponto ou outro `@` não é trocado (e-mails ficam intactos). Variável que não existe vira vazio.
- Números com vírgula ou ponto são normalizados (`1.234,56` → `1234.56`).
- `calc(…)` só aceita números e `+ - * / ( )`. Resultado inteiro aparece inteiro; com casas decimais, aparece com duas (`74.50`).

### O que fica guardado em cada resposta (pacote 70165)

- **Opções:** `nome` = valor da opção escolhida (o texto, se não houver valor); na múltipla escolha, os valores unidos por `|`. `score.nome` = soma dos pontos. `responses.nome` = todas as opções na ordem, com o valor das marcadas e `*` nas outras.
- **Campo:** `nome` = o que a pessoa digitou. **Botão:** `nome` = `clicked`.
- **Parâmetros do link:** `tracking.<parâmetro>` para cada parâmetro da URL, mais `tracking.screen` e `tracking.platform`.

### Regras de exibição (módulo 60527)

Grupos de condições: todas dentro do grupo (E), qualquer grupo (OU), sem regras aparece sempre. Os dois lados passam pela troca de variáveis e viram número quando dá. Operadores: `==`, `!=`, `>`, `>=`, `<`, `<=`, `includes` (contém), `count==`, `count>=`, `count<` (quantas vezes um valor aparece numa resposta de múltipla escolha) e `percent==`, `percent>`, `percent<` (que porcentagem das respostas ele representa), com o número em `number`.

### Navegação e envio (pacote 70165)

- **Opção:** na escolha única o funil avança na hora — mesmo que a etapa tenha botão —, a não ser que a opção esteja com `awaitSubmit`. O destino precisa ser uma etapa; qualquer outra coisa vira “próxima”.
- **Botão:** o destino aceita variáveis. Link externo recebe **todos os parâmetros da URL atual** (UTMs, fbclid) misturados aos do link e ganha `https://` se faltar; “abrir em nova aba” usa `window.open`.
- **Modelos de link do botão:** WhatsApp (número e mensagem), Telegram, Messenger, Instagram Direct, Calendly, Cal.com, TidyCal, Google Agenda, Google Meet, Zoom, Whereby, Shopify, Yampi, Cartpanda, VTEX, WooCommerce, Hotmart, Kirvano e Kiwify (checkout com nome, e-mail e telefone preenchidos). Telefone vira formato internacional (`55` + DDD + número).
- **Progresso:** (posição da etapa + 1) ÷ total de etapas.
- `?step=<id da etapa>` abre o funil direto numa etapa. Cada etapa pode ter um script próprio. Camadas arquivadas (`archived`) não aparecem.
- **Tag Manager:** cada etapa vista manda `StepView` para o `dataLayer`; a saída para um link externo manda `FormSubmit` com a URL. Os dois levam nome e id do funil, nome, id e número da etapa, código do visitante, parâmetros da URL e as respostas.

### Leads e webhook (pacote 70165)

- O código do visitante fica num cookie por **14 dias**: quem volta nesse prazo continua o mesmo lead, e o acesso conta uma vez.
- A cada avanço o navegador manda ao InLead: código, etapa, rastreamento (parâmetros da URL, tela, janela, plataforma) e as respostas da etapa. Marca `started` na primeira vez, `qualified` quando as respostas passam de **70% do número de etapas** e `complete` quando a pessoa sai por um link externo ou avança na última etapa.
- **Corpo do webhook:** `{...variáveis, ...parâmetros da URL, code}`. O token vai em `Authorization: Bearer` e em `Api-Token`. Com o gatilho “clique em componente”, só sai quando o último componente clicado está na lista (aceita vários nomes separados por vírgula). No BRASE 2 o endereço e o token aparecem como `protected`: o envio é feito pelo servidor do InLead (inferência; o código do servidor não foi visto).

### Detalhes lidos módulo a módulo

- **Timer (módulo 4309):** padrão `layout: "countdown"`, `style: "black"`, `padding: 10`. Cores por estilo (`getTimerDefaultColors`): vermelho `#fb2c36`, azul `#2b7fff`, verde `#09de5e`, amarelo `#ffb900` e cinza `#d1d5dc`, com fundo, texto e borda em tons da mesma cor; qualquer outro estilo é preto. Por tempo, a contagem recomeça a cada vez que o componente aparece; por data, usa a hora do servidor (cabeçalho `date`).
- **Notificação (módulo 2074):** posição `default` (no lugar do componente) ou fixa na tela em 9 posições (`top`, `center`, `bottom` × `left`, `middle`, `right`), com largura máxima de 20 rem (24 rem em telas grandes).
- **Modelos de link (módulo 44012) e telefone (38874):** os campos e a montagem de cada link (ex.: Kirvano `pay.kirvano.com/<código>?customer.email=…&customer.name=…&customer.phone=…`). O telefone aceita `+` ou `00` com código do país; 10 ou 11 dígitos é Brasil.
- **Tag Manager (pacote 70165):** no `content`, variáveis com ponto viram objetos (`score.tempo` → `content.score.tempo`) e o `score` total vai em `content.score_total`.
- **Leads (pacote 70165):** `qualified` quando o número de respostas guardadas passa de 70% do número de etapas, e também ao completar; `started`, `qualified` e `complete` ficam marcados por 14 dias para não contar de novo.

### Outros recursos vistos

“Momentos” (animações e partículas por etapa, que podem segurar a navegação até terminar), alinhamento vertical e largura do conteúdo no design, botão “ir ao topo”, cores de botão (`theme`, `danger`, `info`, `success`, `warning`, `dark`, `light`, `transparent` e personalizada), timer com cinco modelos (`text`, `countdown`, `cards`, `banner`, `hero`) e contagem até uma data.

## O que mudou no app por causa disso

Veja a seção “Fidelidade ao InLead” do `funis/README.md`.

## Limites

- Sem source maps: nomes de variáveis e funções são os minificados; os nomes de componentes e campos vêm de textos literais do código.
- A análise de aplicação ficou com cobertura parcial nos pacotes maiores; as conclusões acima vêm dos módulos recuperados e lidos um a um.
- Comportamento do servidor do InLead (envio do webhook, contagem de acessos e de respostas) é inferido do que o navegador manda, não observado.

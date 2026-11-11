# Base de análise 360 do comercial

Renan · 31/10/2026

Este material é a referência para o Claude Code cruzar o CRM, o funil de captação e as conversas do SDR, e apontar onde a venda vaza e o que corrigir.

> As seções **Como usar**, **O funil e as etapas do CRM** e **Campos que todo card precisa ter** são o documento do Renan, sem mudança. As seções **Na Central comercial** e **O que ainda falta** foram tiradas do código da Central (`index.html`), para a análise ler os dados sem adivinhar.

## Como usar

A análise cruza cinco fontes e segue sempre a mesma ordem, para que uma rodada possa ser comparada com a anterior.

| Fonte | O que traz | Onde está |
| --- | --- | --- |
| Meta Ads (via Meta) | Gasto, leads do pixel, CPL por campanha, conjunto e criativo | Conta act_470784463402872 |
| Funis · Brase | Respostas do quiz: faturamento declarado, dor, UTM de origem | Central comercial da Brase |
| NicoChat | Todas as conversas do SDR com os leads | Workspace 111113, canal BraseBot (f302947) |
| CRM | Etapa, campo Toque, due date, faixa de faturamento, motivo de saída | ClickUp, lista CRM 901324302434, ou a central comercial, conforme o que estiver em uso |
| Calls | Transcrições das reuniões de venda | Gravações do Google Meet |

1. Defina o período e marque o que precisa ser descontado: folgas, feriados e dias em que o NicoChat falhou.
2. Reconcilie o volume em cada passagem: anúncio, quiz, WhatsApp e CRM.
3. Calcule as métricas e compare com as metas.
4. Leia as conversas com o checklist. Amostra mínima: todas as que chegaram a reunião e pelo menos 10 que pararam.
5. Cruze o CRM com as conversas: etapa, toque e due date batem com o que aconteceu?
6. Escreva o relatório no formato da última seção.

## O funil e as etapas do CRM

O lead passa por quatro sistemas antes da reunião, e a análise mede a perda em cada passagem: anúncio na Meta, quiz no Funis · Brase, mensagem "Quero receber meu diagnóstico!" no BraseBot e card no CRM. Depois vêm a reunião e a venda.

| Etapa | Significado | Próxima ação |
| --- | --- | --- |
| Lead Novo | Chegou, o link foi pedido, aguardando o link | Primeira resposta em até 5 min; cadência LN |
| Diagnóstico Pendente | Link recebido, pergunta da dor ainda não enviada | SDR responde em até 10 min |
| Qualificando | Dor ou faturamento perguntados, aguardando resposta | Cadência QL |
| Agendando | Qualificado e convidado, sem horário | Cadência AG |
| Reunião Marcada | Data e hora confirmadas | Esquenta, confirmação 1h antes, link na hora |
| No-show | Não entrou na reunião | Cadência NS |
| Reunião Feita | Call feita, sem fechamento | Renan manda a proposta no mesmo dia; cadência RF |
| Ganho | Venda fechada | Passagem para o operacional |
| Perdido | Viu a oferta e não avançou | Motivo em uma linha |
| Desqualificado | Fora do perfil, recebeu a mensagem de saída | Retorno em 3 meses |
| Frio | Esgotou a cadência antes da reunião | Reativação mensal |

## Campos que todo card precisa ter

- Origem: campanha e conjunto, pela UTM
- Faixa de faturamento declarada no quiz
- Faturamento confirmado na conversa, iFood e salão separados
- Tempo de loja
- A dor, nas palavras do lead
- Quem decide junto (sócio ou cônjuge)
- Toque atual (Automático, 1 a 6) e due date do próximo toque
- Motivo de saída, ao ir para Frio, Perdido ou Desqualificado
- Toque que gerou resposta

## Na Central comercial

A Central tem nomes de etapa, campos e metas próprios. Esta seção diz onde está cada coisa do documento e o que ela ainda não guarda. Os dados ficam no `crm-api` (Supabase, endereço em `window.BRASE_HOST` no topo do `index.html`). Enquanto o time usa os dois, a Central lê da lista do ClickUp só a etapa e o responsável (botão de sincronizar, `syncClickup`).

### Etapas

| Etapa no documento | Na Central (`id`) | Status do ClickUp que a Central lê | Cadência na Central |
| --- | --- | --- | --- |
| Lead Novo | Lead Novo (`novo`) | lead novo | LN-1 a LN-6 |
| Diagnóstico Pendente | Link recebido (`link`) | nenhum | Não tem. A Central dá 60 min para mandar o print (das 9h às 19h, em dia útil) |
| Qualificando | Print Enviado (`print`) e Qualificando (`qualificando`) | print enviado, primeiro contato, qualificando, em contato | QL-1 a QL-5: print do Power Data, áudio do SDR terminando nas perguntas, e retomadas (o Print Enviado usa a mesma e pula o QL-1) |
| Agendando | Agendando (`agendando`) | agendando | AG-1 a AG-6 |
| Reunião Marcada | Reunião Marcada (`marcada`) | reunião marcada | RM-1 ao marcar, RM-2 pedir o áudio ao Renan, RM-3 áudio do Renan (manhã do dia; véspera às 17h se a reunião for de manhã), RM-4 1 h antes, RM-5 na hora, RM-6 10 min depois |
| No-show | No-show (`noshow`) | nenhum | NS-1 a NS-5 |
| Reunião Feita | Reunião Feita (`feita`) | reunião feita | RF-1 a RF-5 (o Renan envia) |
| Ganho | Fechado (`fechado`) | fechado | |
| Perdido | Perdido (`perdido`) | perdido | |
| Desqualificado | Desqualificado (`desqualificado`) | desqualificado | DQ-1 a DQ-4 (saída escolhida pelo motivo) e DQ-5 a cada 90 dias |
| Frio | Frio (`frio`) e Morno (`morno`) | frio, morno | FR-1 a FR-4, um por mês (o Morno usa a mesma) |

As cadências estão em `DEFAULT_CADENCES` no `index.html`. O que foi editado em Configurações fica salvo na Central e vale no lugar delas.

### Campos do card

| Campo do documento | Na Central |
| --- | --- |
| Origem | `utm` (campanha, conjunto e criativo) e `source` (canal) |
| Faixa de faturamento declarada | `revenue`, um número. O quiz pergunta o faturamento da loja como um todo, não só o do iFood |
| Faturamento confirmado, iFood e salão separados | Não existe |
| Tempo de loja | Não existe. O quiz não pergunta |
| A dor, nas palavras do lead | `painSaid` (Dor que ele contou, no card). `pain` traz a opção escolhida no quiz |
| Quem decide junto | Não existe. O RM-1 pergunta, mas a resposta fica só na conversa |
| Toque atual e due date | `touches`: cada toque tem `code` (LN-1, QL-2…), `due`, `done` e `doneAt`. O próximo é o primeiro não feito, pela data (`nextTouch`). Ao mudar de etapa, a Central recria os toques da etapa nova |
| Motivo de saída | `lostReason`. A Central pede ao mover para Perdido ou Desqualificado; para Frio não pede |
| Toque que gerou resposta | Não fica gravado. `repliedAt` guarda só a hora da última resposta; dá para deduzir pelo último toque feito antes dela, e só dessa última |

Outros campos úteis: `stageAt` e `history` (etapas com data), `bookedAt`, `meetingAt`, `meetingDoneAt`, `closedAt`, `value` (valor da venda), `team` (estrutura, do quiz), `ownerId` e `sdrId`, `clickupId`.

Diagnóstico da loja, no card: `finding` (o achado na loja, que preenche o [achado da loja] do print, do convite e dos lembretes), `rival` (o concorrente que mais vende), `painSaid` (a dor nas palavras do lead, que vai para o áudio do Renan), `ptKw`, `ptIsca`, `ptMenu`, `ptPhoto` e `ptRev` (palavra-chave, produto isca, cardápio, fotos e avaliações, marcados como `erro` ou `forte`, que montam o áudio do QL-2) e `meetLink` (link da sala; sem ele vale o link fixo de Configurações › Agenda). O Áudio do SDR depois do print, o Banco de dores da loja, o Motivo para comparecer à reunião e o Áudio de confirmação do Renan estão em Processos.

### Como a Central conta o funil

- **Agendou:** chegou a Reunião Marcada ou além (`bookedAt`). No-show conta como agendado.
- **Reunião feita:** `meetingDoneAt`. **Venda:** `closedAt`.
- **Taxa de agendamento** = agendados ÷ leads. **Comparecimento** = reuniões feitas ÷ agendados cuja reunião já passou. **Fechamento** = vendas ÷ reuniões feitas.
- A Central não avalia uma métrica com poucos dados: menos de 10 leads (agendamento, desqualificados), 5 reuniões já passadas (comparecimento) ou 5 reuniões feitas (fechamento).

### Metas em uso na Central

Até o documento trazer as metas, a comparação do passo 3 usa as da Central (`ideal` em `DEFAULT_CONFIG`). Estes são os valores padrão; se estiverem outros em Configurações, valem os de lá.

| Métrica | Meta |
| --- | --- |
| CTR do anúncio | ≥ 2% |
| Custo por lead | ≤ R$ 40 |
| Leads desqualificados | ≤ 35% |
| Taxa de agendamento | ≥ 15% |
| Comparecimento | ≥ 75% |
| Fechamento (venda ÷ reunião feita) | ≥ 30% |
| Conversão lead → venda | ≥ 3,4% (15% × 75% × 30%) |
| Custo por agendamento | ≤ R$ 266,67 |
| Custo por reunião feita | ≤ R$ 355,56 |
| Custo por venda | ≤ R$ 1.185,19 |
| Cadência em dia | ≥ 90% |
| Tempo até o 1º toque | ≤ 15 min |
| Respostas em até 5 min no WhatsApp | ≥ 80% |

## O que ainda falta

Não vieram na versão de 31/10/2026, e a análise não deve inventar:

- **O checklist de leitura das conversas** (passo 4).
- **O formato do relatório** (passo 6 cita a última seção).
- **As metas** (passo 3). Até virem, valem as da Central, acima.

Onde o documento e a Central não batem. O relatório aponta o que encontrar, sem tratar a Central como erro nem o documento como desatualizado:

- **Diagnóstico Pendente:** o documento pede resposta do SDR em 10 min; a Central dá 60 min para o print e chama a etapa de Link recebido.
- **Primeira resposta ao Lead Novo:** o documento pede 5 min; a meta da Central para o 1º toque é 15 min. Os 5 min aparecem no aviso de lead novo, que fica vermelho depois de 5 min, e na meta de respostas no WhatsApp.
- **Etapas:** a Central tem Print Enviado e Morno, que o documento não tem, e chama Ganho de Fechado. O No-show e o Link recebido não existem como status lido do ClickUp.
- **Campos:** faturamento confirmado (iFood e salão), tempo de loja, quem decide junto e toque que gerou resposta não existem na Central.
- **Motivo de saída:** a Central não pede ao mover para Frio.

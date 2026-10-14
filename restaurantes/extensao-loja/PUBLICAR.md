# Publicar a extensão na Chrome Web Store (não listada)

Tudo o que o painel da Chrome Web Store pede, pronto para copiar. Leva uns 15 minutos; depois a revisão do Google costuma levar de algumas horas a poucos dias.

**Arquivos**

| Campo do painel | Arquivo |
|---|---|
| Pacote | [`../extensao-brase.zip`](../extensao-brase.zip) |
| Ícone da loja (128×128) | [`../extensao/icons/icon128.png`](../extensao/icons/icon128.png) |
| Capturas de tela (1280×800) | [`captura-1-incluir.png`](captura-1-incluir.png), [`captura-2-ranking.png`](captura-2-ranking.png) |
| Bloco promocional pequeno (440×280) | [`bloco-promocional-440x280.png`](bloco-promocional-440x280.png) |
| Política de privacidade | https://renandias-dot.github.io/central-comercial-brase/restaurantes/privacidade.html |

As capturas usam uma loja fictícia ("Pizzaria Exemplo").

## 1. Conta de desenvolvedor (uma vez só)

1. Entre em https://chrome.google.com/webstore/devconsole com a conta Google que vai ser dona da extensão (de preferência uma conta da Brase, não pessoal).
2. Aceite o contrato e pague a taxa única de US$ 5.
3. Em **Conta**, preencha o e-mail de contato e confirme o e-mail que o Google mandar (sem isso não dá para publicar). Na declaração de comerciante (trader), informe os dados conforme a situação da Brase.

## 2. Novo item

Clique em **Novo item** e envie o `extensao-brase.zip`.

## 3. Aba "Página na loja" (Store listing)

- **Idioma:** Português (Brasil)
- **Nome:** vem do pacote (Brase · Restaurantes)
- **Resumo:** vem do pacote. Se o painel pedir, use:

> Inclua a loja aberta no iFood na base da Brase com um clique e veja a posição dela no ranking de avaliações da região.

- **Descrição:**

```
Com a extensão Brase · Restaurantes, a equipe da Brase inclui lojas do iFood na base de restaurantes com um clique, direto da página da loja.

Como funciona
1. Abra a página da loja no iFood.
2. Clique no ícone da Brase e em "Incluir na Brase".
3. A loja entra na base, passa a ser acompanhada toda semana e aparece no ranking da região.

O que aparece na hora
• Posição da loja na categoria e no geral, pelo número de avaliações no iFood, num raio de 5 km
• Avaliações e crescimento nos últimos 3 meses
• Pedidos estimados
• Botão para a ficha completa no app de Restaurantes da Brase: CNPJ, mapa, concorrentes e metas para subir no ranking

Privacidade
A extensão só lê o endereço da aba quando você clica no ícone e só envia o código da loja quando você clica em "Incluir na Brase". Ela não lê nem altera o conteúdo das páginas.

Ferramenta de uso interno da Brase. Não é afiliada ao iFood.
```

- **Categoria:** Ferramentas (Tools)
- **Ícone:** `icon128.png`
- **Capturas de tela:** as duas `captura-*.png`
- **Bloco promocional pequeno:** `bloco-promocional-440x280.png`
- **Site oficial / suporte (opcional):** https://renandias-dot.github.io/central-comercial-brase/restaurantes/

## 4. Aba "Práticas de privacidade" (Privacy)

- **Finalidade única:**

> Incluir a loja do iFood aberta na aba atual na base de restaurantes da Brase e mostrar a posição dela no ranking por avaliações da região.

- **Justificativa de `activeTab`:**

> Ler o endereço da aba ativa somente quando o usuário clica no ícone da extensão, para identificar o código da loja do iFood que será incluída.

- **Justificativa de `storage`:**

> Guardar no navegador o código de acesso da equipe, quando o servidor da Brase exigir um.

- **Código remoto:** "Não, não estou usando código remoto".
- **Uso de dados:** não marque nenhuma categoria (a extensão não coleta dados de quem usa; ela envia só o código público da loja) e marque as três declarações de conformidade.
- **URL da política de privacidade:** https://renandias-dot.github.io/central-comercial-brase/restaurantes/privacidade.html

## 5. Aba "Distribuição"

- **Pagamento:** Gratuito
- **Visibilidade:** **Não listado** (só quem tiver o link encontra e instala)
- **Regiões:** Brasil (ou todas)

## 6. Enviar

Clique em **Enviar para revisão**. Quando aprovar, o painel mostra o link da extensão na loja: mande para a equipe. Para atualizar depois, suba o `version` em `extensao/manifest.json`, gere o zip de novo (comando no README) e envie em **Pacote › Enviar nova versão**.

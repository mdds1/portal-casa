# Portal da Casa — guia do agente

## Território

Este repositório é do **Claude Code**. O **Codex** não escreve aqui — ele trabalha
em `~/projetos/floripaot-site`. Ler é livre; editar, só se o Matheus pedir
explicitamente nesta sessão.

A razão não é hierarquia: é que este projeto tem uma suíte de 175 testes e um
padrão de verificação por mutação. Dois agentes com critérios diferentes de teste
na mesma base degradam isso rápido.

## O padrão de verificação

Todo comportamento novo ganha teste, e **todo teste novo é verificado por mutação**:
quebre a implementação de propósito e confirme que o teste certo falha. Um teste que
passa com a implementação quebrada não está testando nada — já aconteceu aqui, com
um `assert.doesNotMatch` que não tinha como falhar.

    npx tsx --test test/*.test.ts

## Stack

Node 20, TypeScript, Express 5, SQLite (better-sqlite3). HTML renderizado no
servidor, **zero JavaScript no cliente** — interatividade sai de `<details>` e de
`:target`. Folha de estilo única em `src/html/base.ts`.

## Produção

Roda no **CT 103** do Proxmox: `/opt/portal` (código) e `/var/lib/portal/portal.db`
(banco). Deploy é build, tarball, `pct push`, `systemctl restart portal`.

**`semear()` só faz upsert e nunca apaga.** Remover uma linha da semente não limpa o
banco de produção: a linha tem que sair à mão também. Foi assim que o CT 101,
destruído no Proxmox, continuou aparecendo na tela com três botões de ação.

Antes de rodar qualquer coisa que altere produção, mostre ao Matheus o que será
feito. Ele autorizou o portal a desligar o Proxmox — é medida de segurança dele,
para o caso de estar fora de casa e ter esquecido a máquina ligada.

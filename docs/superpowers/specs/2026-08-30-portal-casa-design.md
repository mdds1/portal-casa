# Portal da Casa — documento de desenho

Data: 2026-08-30
Estado: desenho aprovado em conversa, aguardando revisão escrita
Documento irmão: `2026-08-30-infra-proxmox-design.md` (o servidor em si)

## 1. Problema

Hoje os serviços da casa estão espalhados: o Proxmox tem a sua interface, o Home
Assistant tem a dele, o Jellyfin a dele, e os servidores de jogo não têm nenhuma.
Para saber o que está ligado, quem está conectado e como a infraestrutura está
montada é preciso abrir três ou quatro telas diferentes — e algumas delas não
podem ser entregues a outra pessoa da casa, porque dão acesso a tudo.

O portal resolve duas coisas: uma visão única do que existe e do que está
acontecendo, e um recorte seguro dessa visão para quem não é administrador.

## 2. O que o portal é (e o que não é)

O portal **é** uma camada fina sobre serviços que já existem. Ele lê a API do
Proxmox, a API do Home Assistant e faz verificações diretas de portas, mostra
tudo em um lugar só e executa um conjunto fechado de ações.

O portal **não é** um substituto do Home Assistant. O HA continua sendo o motor
da automação da casa: os modos, os gatilhos, as TVs, a previsão. O portal não
reimplementa nada disso — ele consulta e aciona.

O portal **não é** um terminal. Não existe caixa de texto que execute comando
arbitrário, nem no navegador nem na API. Toda ação é um item de uma lista
fechada, escrita no código do wrapper.

## 3. Arquitetura

```
navegador  ->  portal (LXC novo, ~512 MB, onboot=1)
                 |
                 +-- API do Proxmox        (token PVEAuditor, somente leitura)
                 +-- API do Home Assistant (token de acesso longo)
                 +-- checagens diretas     (TCP nas portas dos serviços)
                 +-- inventário SQLite     (arquivo local)
                 |
                 +-- wrapper de ações      (SSH -> /usr/local/sbin/portal-acao)
```

### 3.1 Leitura

Um token de API do Proxmox com papel `PVEAuditor` — o mesmo padrão que já
funciona com `ha-monitor@pve!reader`. O papel não permite nenhuma escrita, então
mesmo que o token vaze o dano possível é ver o estado do cluster.

O Home Assistant é lido por token de acesso de longa duração pela API REST.

Serviços cuja saúde não aparece em nenhuma das duas APIs (o servidor de Tibia, o
de Dofus, o site) são verificados por conexão TCP direta na porta.

### 3.2 Escrita

Nenhuma ação passa por API de escrita do Proxmox. O portal conecta por SSH a um
único programa, `/usr/local/sbin/portal-acao`, que aceita um verbo e um alvo e
recusa qualquer coisa fora da lista. É o mesmo desenho de `ha-pve-power`, que já
está em produção e já provou que funciona.

A lista inicial de ações: ligar VM/CT, desligar VM/CT, reiniciar serviço
conhecido. Nada de apagar, nada de alterar configuração, nada de disco ou rede.

### 3.3 Cache

As APIs são consultadas a cada 15 segundos por um laço de fundo, e o resultado
fica em memória. As telas leem o cache. Isso evita que cinco abas abertas
signifiquem cinco vezes mais carga no Proxmox, e faz a tela abrir instantânea no
celular.

Se uma consulta falha, o cache guarda o último valor bom junto com a hora em que
foi obtido, e a tela mostra o dado marcado como desatualizado em vez de sumir.

## 4. Inventário

O inventário é um banco SQLite local, e é o coração do projeto. Ele guarda o que
as APIs não sabem: para que serve cada VM e cada container, quem é o dono, o que
pode ser desligado sem quebrar nada, qual porta é de quê, o que depende de quê.

O inventário alimenta duas saídas:

1. **O painel** — os cartões são montados a partir dele, não de listas fixas no
   código. Um serviço novo é uma linha nova no banco.
2. **A documentação** — arquivos gerados em `/docs` descrevendo a infraestrutura,
   sempre a partir da mesma fonte, para não existir documentação que envelhece
   separada da realidade.

Tabelas: `maquinas` (VMs e CTs), `servicos`, `dependencias`, `usuarios`,
`papeis`, `permissoes`, `acoes_log`.

## 5. Autenticação e papéis

Sem Authentik. Uma camada a mais de servidor, de configuração e de coisa para
quebrar, para dois usuários. O portal tem login próprio, sessão em cookie, e os
papéis ficam no inventário.

Dois papéis:

- **admin** — vê e faz tudo.
- **casa** — vê e faz apenas o que é da rotina da casa.

Cada serviço e cada ação carrega o papel mínimo exigido. A regra vale no
servidor: o backend confere o papel em toda requisição, independente do que a
interface mostrou. Esconder o botão é conveniência, não segurança.

Toda ação executada vai para `acoes_log` com usuário, hora, verbo e alvo.

## 6. Telas

- **Início** — serviços ativos, quem está conectado, temperatura e uso da
  máquina, previsão do tempo.
- **Infraestrutura** *(admin)* — VMs, containers, discos, o mapa de como está
  montado.
- **Games** *(admin)* — FloripaOT e Dofus: estado, jogadores online, backups.
- **Mídia** — Jellyfin e as TVs.
- **Casa** — modos da casa, PC, previsão.
- **Administração** *(admin)* — usuários, papéis, edição do inventário.

A Marcella vê **Casa** e **Mídia**, e nada mais. A tela dela é pensada primeiro
para celular: os cartões dela precisam funcionar bem em uma coluna estreita,
sem depender de passar o mouse em nada.

"Desenvolvimento" foi cortada: não há necessidade hoje.

## 7. Tecnologia

Node com TypeScript, SQLite, e HTML renderizado no servidor. Sem Next.js.

O motivo é o orçamento de memória. A casa trabalha com 16 GB e nada roda tudo ao
mesmo tempo; um processo Node simples cabe nos 512 MB do container com folga,
enquanto um Next.js traz build, runtime e uma cadeia de dependências para
entregar páginas que são, no fim, meia dúzia de tabelas e alguns botões. HTML no
servidor também abre instantâneo no celular dela, que é o caso de uso mais
sensível a latência do projeto.

JavaScript no cliente entra só onde é necessário — atualizar um cartão sem
recarregar a página — e não como framework.

## 8. Restrições

- Nada de reinstalar, apagar ou remover o que existe.
- Nada de alterar rede, firewall, discos ou storages fora do escrito aqui.
- Nenhuma porta nova exposta para a internet.
- A senha de root nunca entra no portal.
- Credenciais nunca no código e nunca no git: nem senhas, nem tokens, nem
  chaves de API, nem `.env`, nem certificados privados.
- O painel do Proxmox não fica aberto para a internet.

## 9. Primeira fatia

O que entra na primeira entrega:

- Login com os dois papéis.
- Tela **Início**.
- Tela **Infraestrutura**, somente leitura.
- O inventário SQLite, populado com o que existe hoje.

O que fica de fora dela: **nenhuma ação de escrita**. O wrapper de ações é
desenhado agora e implementado na fatia seguinte, depois que a leitura estiver
provada em uso.

Em paralelo, sem depender do portal, corre a limpeza já diagnosticada:

- `modo_chegar_casa` liga Jellyfin e Docker sozinho ao chegar em casa, gastando
  4 GB sem ninguém pedir — passar os dois para sob demanda.
- Remover as entidades órfãs `switch.ct_ct103`, `switch.ct_pelican` e
  `script.preparar_midia`.
- Acrescentar `ct:104` à lista permitida do `ha-pve-power` e criar o switch.
- Padronizar o autostart das VMs e containers.

## 10. Erros e testes

Cada integração externa (Proxmox, HA, checagem TCP) fica atrás de uma função
própria que devolve ou o dado ou uma falha explícita. Uma API fora do ar degrada
o cartão daquela seção, nunca a página inteira.

O que é testado: as regras de papel (um usuário `casa` recebe negativa em toda
rota de admin), as consultas do inventário, e o parser das respostas de cada API
com respostas gravadas. O que não é testado automaticamente: a aparência.

## 11. Depois

Fora do escopo deste documento, mas na fila: subir o servidor de Tibia para a
internet com segurança, e a Alexa própria via Cloudflare Tunnel — que é o que
permite cancelar o Nabu Casa. O Nabu Casa fica ativo até a Alexa própria estar
funcionando.

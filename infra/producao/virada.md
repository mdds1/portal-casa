# A virada — FloripaOT sai da bancada

Data: 30/08/2026

## O FloripaOT nao ficou fora do ar um segundo

A VM 110 serviu ate a 301 aceitar login de jogador de verdade. So depois o
`canary.service` da bancada foi parado e desabilitado — nao removido.

## O que mudou de lugar

|                        | Antes                       | Depois                          |
|------------------------|-----------------------------|---------------------------------|
| Servidor de jogo       | VM 110 (junto com a bancada)| VM 301 (sozinho)                |
| Site (MyAAC)           | VM 110, Apache porta 80     | VM 301, Apache porta 80         |
| Banco                  | VM 110                      | VM 301                          |
| RAM de producao        | 8 GB compartilhados         | 4 GB dedicados                  |
| Backup de aplicacao    | cron da 110                 | cron da 301                     |
| vzdump                 | a 110 estava FORA do job    | a 301 entrou no job             |
| Endereco anunciado     | 100.91.91.40                | 100.118.32.106                  |

## O site teve que ir junto — descoberta durante a execucao

O plano tratava so do servidor de jogo. Mas o cliente usa **login por HTTP**:

    ["http://100.91.91.40/login.php"] = { httpLogin = true, protocol = 1511 }

Ou seja, o cliente fala com o SITE, e e o site que devolve a lista de mundos.
E o MyAAC le `$config['server_path'] = '/opt/canary-1511-clean/'` para tirar
dali as credenciais do banco e o endereco do mundo.

Deixar o site na bancada faria a bancada virar peca obrigatoria: desligada ela,
ninguem loga. E exigiria abrir o MariaDB da producao para a rede, desfazendo o
endurecimento feito no mesmo dia. Por isso o site foi junto.

O site E o caminho do login — faz parte do servico, diferente de um compilador.
Manter compilador fora da producao continua sendo a regra.

## O cliente

`E:\FloripaOT\Client\otclient\init.lua` no PC do Matheus foi apontado para
100.118.32.106. Copia do original em `init.lua.bak-antes-da-301`.

**O cliente do amigo ainda aponta para o endereco antigo** e precisa da mesma
edicao — trocar 100.91.91.40 por 100.118.32.106 nas linhas 6 a 10 e 59.

## O site antigo precisou ser silenciado

`a2dissite 000-default` NAO bastou: sem vhost na porta 80, o Apache cai no
DocumentRoot embutido e serve a mesma pasta — e o `login.php` antigo continuava
respondendo contra o banco velho. Alguem criando conta ali mexeria num banco que
nao e mais o de verdade.

A correcao foi comentar o `Listen 80` em `/etc/apache2/ports.conf` da bancada.
A gincana nao foi afetada: ela tem o proprio `Listen 8080` dentro de
`gincana.conf`.

## Se precisar voltar atras

Na bancada: `sudo systemctl enable --now canary.service`, descomentar o
`Listen 80` e `a2ensite 000-default`. O config.lua de la ainda traz o `ip`
antigo, entao ela volta a servir sozinha. **Pare a 301 antes**, ou os dois
mundos divergem.

## Verificado apos a virada, em 30/08/2026

Bancada (VM 110):  Listen 80 comentado, so a 8080 escutando, porta 80 devolve
000, login.php antigo inalcancavel, gincana em 302, canary parado e desabilitado.

Producao (VM 301): site 200, login.php chega ao banco, 7171 aberta, canary ativo.

Uma fonte da verdade so.

## Erro cometido na execucao: conferir codigo HTTP nao e conferir o site

Depois de copiar o MyAAC, `curl -o /dev/null -w "%{http_code}"` devolveu 200 e
eu dei por bom. Nao estava: o 200 era a **pagina padrao do Debian**.

Causa: o Apache foi instalado ANTES de o site ser copiado, e o pacote cria
`/var/www/html/index.html`. O rsync foi feito sem `--delete`, entao esse arquivo
sobreviveu — e o `DirectoryIndex` do Debian lista `index.html` ANTES de
`index.php`. O site inteiro estava la, mas a raiz servia a pagina do Debian.

Quem viu foi o Matheus, abrindo no navegador.

Duas licoes:

1. **Conferir conteudo, nao codigo.** Para uma pagina, `curl | grep -o "<title>"`
   custa o mesmo e teria pego na hora. Um 200 so diz que ALGO respondeu.
2. **Instalar o servidor web DEPOIS de copiar o site**, ou usar `--delete` no
   rsync — senao restos do pacote se misturam ao conteudo.

Verificado depois da correcao, por conteudo:

    /                          200  Latest News - FloripaOT
    /?subtopic=characters      200  Characters - FloripaOT
    /?subtopic=highscores      200  Highscores - FloripaOT
    /?subtopic=accountmanagement 200  Login - FloripaOT
    /api/status.php            200
    /images/items/100.png      200  (1078 bytes) — 32.872 PNGs no lugar

Zero erros ou avisos de PHP em todas.

## Segunda armadilha do site: o `site_url`

Depois de o index.html do Debian sair do caminho, o site abriu — mas sem estilo
e sem imagem nenhuma, so texto.

A causa: `config.local.php` traz

    $config['site_url'] = 'http://100.91.91.40';

e o MyAAC monta URL ABSOLUTA a partir disso para links e imagens. Todos
apontavam para a bancada, que acabara de sair do ar. O CSS do template usa
caminho relativo e carregava, mas sem as imagens de borda o tema Tibia desmonta
e a pagina fica com cara de HTML cru.

Corrigido para http://100.118.32.106 (copia anterior em
config.local.php.antes-da-301) e o cache do MyAAC limpo.

**Quando o dinizismo.com.br entrar no ar, esta linha muda de novo** — e ai passa
a ser um nome de verdade em vez de um IP da Tailscale. O `url` do config.lua do
servidor (hoje "http://floripaot.com/", dominio que nao e do Matheus) tambem.

Licao: procurar por endereco antigo em TODA a configuracao apos migrar, nao so
no config.lua do jogo. `grep -rn "<ip antigo>"` na raiz do site teria achado na
hora.

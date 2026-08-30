# floripaot.dinizismo.com.br — o lado publico

Feito em 30/08/2026, logo depois de o Home Assistant sair do tunel.

## A divisao de aguas

O CT 103 serve os dois mundos, por caminhos deliberadamente diferentes:

    privado   ha.dinizismo.com.br        -> nginx -> A para IP de Tailscale
    publico   floripaot.dinizismo.com.br -> tunel -> CNAME proxied (laranja)

O site do FloripaOT **deve** ser alcancavel por qualquer um, entao volta a usar
o tunel Cloudflare — que continua sendo a unica forma de publicar em 80/443 com
[[vivo-bloqueia-portas-80-443]]. O bloco do Home Assistant ficou comentado no
`config.yml`, nao apagado, para o rollback continuar de um passo.

TLS aqui e da Cloudflare, na borda. Nao ha certbot neste caminho.

## O que quase passou batido

Depois de o dominio responder 200, a pagina ainda apontava **49 recursos** para
`http://100.118.32.106`, o IP de Tailscale gravado no `site_url` do MyAAC. Um
visitante de fora receberia HTML cru, sem CSS — e em HTTPS seria pior, porque
recurso `http://` numa pagina `https://` e bloqueado como conteudo misto.

E o mesmo defeito que ja tinha acontecido na migracao para a VM 301, e o codigo
de status nao denuncia nenhum dos dois. **Conferir o conteudo, sempre:**

    curl -s https://<dominio>/ | grep -o 'src="[^"]*"' | grep -o 'http[s]*://[^/"]*' | sort | uniq -c

A correcao esta em `/var/www/html/config.local.php` na VM 301:

    $config['site_url'] = 'https://floripaot.dinizismo.com.br';

E limpar `system/cache/` depois, senao o valor antigo sobrevive.

## O que AINDA nao e publico: o jogo

O site esta na internet; **o servidor de jogo nao**. O `config.lua` da VM 301
anuncia `ip = "100.118.32.106"`, um endereco de Tailscale. Ou seja: um jogador
de fora abre o site, cria conta, o `/login` responde — e o cliente nao conecta.

Isso e por desenho ate agora, e destravar exige decisao:

- redirecionar **7171 e 7172** na Vivo Box (portas que a operadora nao bloqueia)
- um registro **cinza** apontando para o IP publico da casa, alimentado por
  DNS dinamico (ver `infra/host/dns-dinamico.md`) porque o IP muda
- trocar o `ip` do `config.lua` e reiniciar o Canary
- aceitar que o IP da casa fica exposto, e que o servidor passa a receber
  varredura da internet

O tunel Cloudflare **nao** resolve isto: o protocolo do Tibia nao e HTTP.

## Estado verificado em 30/08/2026

    https://floripaot.dinizismo.com.br/        -> 200, <title>Latest News - FloripaOT</title>
    51 recursos, todos no dominio, CSS 200 text/css
    POST /login {"type":"cacheinfo"}           -> 200, JSON valido
    tempo total ~0,10 s

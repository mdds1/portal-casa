# Tunel Cloudflare — acesso remoto sem abrir porta

Feito em 30/08/2026.

## O problema

A Vivo bloqueia as portas 80 e 443 de ENTRADA (medido de fora; 450, 5555 e
8081 passam). Sem elas nao ha como publicar site nem HTTPS por redirecionamento
de porta.

O tunel resolve porque a conexao sai DE DENTRO para o Cloudflare. Nenhuma porta
e aberta na Vivo Box.

## Onde ele mora, e por que

**CT 103 (`portal`)**, 512 MB, nao-privilegiado, `onboot 1`, 192.168.15.14.

O tunel precisa estar sempre ligado. A bancada (VM 110), o FloripaOT (VM 301) e
o starloco (CT 104) sao todos sob demanda. O host Proxmox seria uma opcao, mas e
software no hipervisor.

Este container e o mesmo que o spec do portal ja pedia (~512 MB, onboot 1). Ele
precisava existir de qualquer jeito; hospedar o tunel hoje e o portal depois
evita criar duas maquinas.

## Configuracao

    /etc/cloudflared/config.yml     regras de entrada
    /etc/cloudflared/<id>.json      credencial do tunel, modo 600
    ~/.cloudflared/cert.pem         certificado da zona
    systemctl enable cloudflared    servico, sobe sozinho

Tunel `casa`, id fb72febb-d0f4-4efd-9f74-1e078aec1ea4.

    ingress:
      - hostname: ha.dinizismo.com.br
        service: http://192.168.15.8:80
      - service: http_status:404      # sem esta ultima regra o tunel nao sobe

Acrescentar servico novo = mais um bloco `hostname` + `cloudflared tunnel route
dns casa <nome>`. Nao precisa de tunel novo.

## A armadilha que custou mais tempo

O Home Assistant respondia **400** a tudo que vinha do tunel, com o log dizendo
"your HTTP integration is not set-up for reverse proxies".

A correcao obvia — por `http: use_x_forwarded_for/trusted_proxies` no
configuration.yaml — **NAO funciona nesta versao (2026.8.3)**. O HA migrou a
configuracao de HTTP para o armazenamento interno:

    /config/.storage/http   ->   "yaml_migration_done": true

Com essa marca, o bloco `http:` do YAML e **ignorado por completo**. O sintoma
engana: o arquivo esta certo, `ha core check` aprova, o container ate ve o
bloco, o HA reinicia — e nada muda.

Como foi descoberto: o HA escutava na porta 80, mas o bloco YAML nao declarava
`server_port`. Se o YAML valesse, ele teria ido para a 8123 (o padrao). Nao foi
— logo o YAML nao valia.

**A correcao certa** e gravar em `.storage/http`, dentro de `data.stable`:

    "use_x_forwarded_for": true,
    "trusted_proxies": ["192.168.15.14/32"]

Os dois sao um par obrigatorio no esquema (`vol.Inclusive(..., "proxy")`), e o
proxy vai em formato de rede. Copia do original em
`.storage/http.bak-cloudflared-20260830`.

Depois disso o bloco `http:` foi REMOVIDO do configuration.yaml, para nao
enganar quem ler depois — sobrou um comentario apontando para ca.

## Verificado

    https://ha.dinizismo.com.br  ->  200, <title>Home Assistant
    TLS valido (Google Trust Services, ate 28/11/2026, renovado pelo Cloudflare)
    0,18 s de resposta
    cloudflared enabled + CT 103 onboot 1  ->  volta sozinho apos queda de luz
    acesso local http://192.168.15.8/ segue funcionando

## Pendencias

- **Ligar 2FA no Home Assistant.** A tela de login agora e alcancavel da
  internet inteira. Perfil -> Seguranca -> Autenticacao multifator.
- **Nabu Casa**: o acesso remoto ja nao depende dele, mas a ALEXA sim. Cancelar
  so depois de configurar a Alexa propria por este tunel.

# O backup fora do alcance do compartilhamento

## O risco que existia

O CT 100 montava o disco inteiro (`mp0: /mnt/drive,mp=/dados`) e exporta essa
arvore por SMB. O destino de backup `/mnt/drive/dump` ficava dentro dela.

`/mnt/drive` pertencia ao root do container (uid 101000 no host) com modo 775.
Em Unix, apagar um diretorio depende de permissao no PAI, nao nele. Logo o root
do CT 100 — e qualquer coisa que chegasse nele pela rede — conseguia apagar o
unico backup da casa. O cenario concreto: ransomware num PC da casa com o
compartilhamento mapeado.

## A correcao

O ponto de montagem passou a ser `/mnt/drive/compartilhado`, e as pastas da
familia (`matheus`, `marcella`, `familia`) foram movidas para dentro dela.

Dentro do container os caminhos continuam `/dados/matheus`, `/dados/marcella`,
`/dados/familia` — identicos. **O smb.conf nao mudou e nenhum cliente da casa
precisou ser reconfigurado.**

`/mnt/drive/dump` ficou fora do que o container enxerga. Provado: dentro do CT
100, `ls /dados/dump` falha com "No such file or directory".

## Regra daqui em diante

Nenhum container monta `/mnt/drive` inteiro. Quem precisa de arquivo da familia
monta `/mnt/drive/compartilhado`. O `dump/` fica fora do alcance de qualquer
coisa que fale com a rede.

Config anterior guardada em /root/arquivo/100.conf.antes-de-estreitar-mp0.

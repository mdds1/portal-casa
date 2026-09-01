# Backup do parque

Destino: storage `drive` (`/mnt/drive`, disco `sdc`, 458 GB).

Por que o sdc e nao o sdd:
- Nenhum disco de maquina mora no sdc — backup e origem em discos diferentes.
- O sdd guarda midia e tem o Jellyfin escrevendo nele; backup nao divide
  disco com carga de trabalho.
- O sdc tambem serve os arquivos da familia por SMB (CT 100). Ele nao e
  exclusivo de backup, mas tem 450 GB livres.

Conteudo do storage restrito a `backup`: ISO e template nao voltam a
se acumular ali.

Retencao: 3 diarios + 2 semanais + 1 mensal — seis pontos cobrindo ~1 mes.

Atencao ao destino: `/mnt/media/dump` e onde ficavam os dumps antigos — hoje
esta vazio, nao e mais usado. O destino atual do job e `/mnt/drive/dump`,
um diretorio diferente, em outro disco (`sdc`, storage `drive`).

Estimativa de tamanho (parcial — feita com apenas 2 das 6 maquinas do job
ja copiadas, as outras 4 ainda nao rodaram): em `/mnt/drive/dump`, o
primeiro dump da VM 111 deu 2,25 GB e o do CT 102 deu 2,19 GB, ambos
comprimidos em zstd. Os discos sao esparsos, entao esses numeros sao bem
menores que o espaco alocado nas VMs/CTs. Chutando uma media parecida para
as outras quatro maquinas do job (100, 101, 104, 120), um ciclo diario
completo das seis deve ficar na casa de 12-15 GB, e a retencao completa
(3 diarios + 2 semanais + 1 mensal) na casa de dezenas de GB — bem abaixo
dos 450 GB livres no storage. O numero real so fica confirmado quando o
job tiver rodado sozinho (via schedule, sem intervencao manual) e cobrido
as seis maquinas ao menos uma vez.

A VM 110 (bancada) fica fora do trabalho automatico: ambiente recriavel,
cujo conteudo que importa ja esta no git. Copia manual antes de mudanca
arriscada.

## O que o backup NAO cobre

O `vzdump` copia disco e configuracao da VM/CT, mas **nao copia bind
mounts** (`mp0` e afins apontando para fora do storage da maquina). Na
pratica isso deixa de fora:

- CT 100: `mp0` = `/mnt/drive` (arquivos da familia).
- CT 101 e CT 102: `mp0` = `/mnt/media` (biblioteca de midia).

Ou seja, o job `casa-diario` protege os sistemas operacionais das seis
maquinas, **nao** os dados da familia nem a midia — esses dados vivem só
nos discos de origem, sem copia de backup nenhuma hoje.

## Risco conhecido: destino de backup dentro da arvore exportada por SMB

O destino `/mnt/drive/dump` fica **dentro** da mesma arvore que o CT 100
exporta por SMB (`mp0: /mnt/drive,mp=/dados`). `/mnt/drive` pertence ao
root do container (uid 101000 no host, mapeado), modo `775` — e apagar um
diretorio exige escrita no **pai**, que o container tem. Ou seja: o root
do CT 100, e qualquer coisa que chegue a ele com privilegio pela rede,
consegue apagar `/mnt/drive/dump` e destruir o unico backup existente. O
cenario concreto e ransomware num PC da casa com o compartilhamento SMB
montado, criptografando ou apagando tambem o backup.

**CORRIGIDO em 30/08/2026.** O ponto de montagem do CT 100 passou a ser
`/mnt/drive/compartilhado`, e o `dump/` ficou fora do que o container enxerga.
Conferido em 01/09/2026: `mp0: /mnt/drive/compartilhado,mp=/dados`.
Ver `infra/backup/destino-protegido.md`.

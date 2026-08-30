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

Retencao: 3 diarios + 2 semanais + 1 mensal — seis pontos cobrindo ~1 mes,
cerca de 220 GB. Dimensionado com dado medido, nao estimado: os vzdumps de
julho em /mnt/media/dump deram VM 110 = 9,9 GB e CT 100 = 10,4 GB
comprimidos. Armazenamento de diretorio nao deduplica.

A VM 110 (bancada) fica fora do trabalho automatico: ~15 GB por copia de
ambiente recriavel, cujo conteudo que importa ja esta no git. Copia manual
antes de mudanca arriscada.

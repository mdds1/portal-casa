# Espaco recuperado no /mnt/media

- Disco orfao da VM 110 (`media:110/vm-110-disk-0.raw`, ~35 GB):
  estava apenas como `unused0`, removido com `qm set 110 --delete unused0`.
  Copia da config anterior em /root/110.conf.antes-de-remover-unused0 no host.
- vzdumps de 16/07/2026 da VM 110 e do CT 100 (~20 GB): substituidos pelo
  trabalho `casa-diario`, que e recente e teve restauracao provada.

O storage `media` continua aceitando `rootdir,images,iso,backup,vztmpl`.
Restringi-lo ao papel de biblioteca de midia depende de confirmar que nada
mais grava ali — fica para o plano seguinte.

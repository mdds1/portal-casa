# Restauracao testada

Data do teste: 2026-08-30

O que foi provado: o dump da VM 111 (Home Assistant) restaura sob outro ID
e da boot. E o unico ativo do parque sem nenhuma outra copia, por isso e ele
que se testa.

Procedimento, para repetir:
1. vzdump 111 --storage drive --mode snapshot --compress zstd
2. qmrestore <dump> 199 --storage local-lvm --unique 1
3. qm set 199 --net0 <net0>,link_down=1     <-- obrigatorio
4. qm start 199, esperar ~90s, qm status 199
5. qm stop 199 && qm destroy 199 --purge 1

Por que link_down=1: dois Home Assistant na mesma rede disputam entidades e
integracoes com o que esta em producao. A copia de teste nunca fala na rede.

Repetir a cada mudanca grande de infraestrutura.

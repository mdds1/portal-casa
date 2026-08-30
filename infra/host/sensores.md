# Temperatura do host

lm-sensors instalado no host `pve` (Proxmox VE 9.2.4, AMD Ryzen 5 1600). Leitura por `sensors -j`, em JSON.

O Ryzen 5 1600 expoe `k10temp`; o campo que interessa e `Tctl`.

Exemplo real de saida (`sensors -j`) neste host:

```json
{
  "k10temp-pci-00c3": {
    "Adapter": "PCI adapter",
    "Tctl": {
      "temp1_input": 54.000000
    }
  }
}
```

O portal le esta saida: chave do chip = `k10temp-pci-00c3` (o sufixo pci-XXXX pode
variar entre hosts), sensor = `Tctl`, campo do valor = `Tctl.temp1_input` (Celsius).

Se `sensors -j` nao trouxer a chave `k10temp` (ex.: placa antiga sem sensor exposto),
o cartao de temperatura deve dizer "sem sensor" — nunca mostrar campo vazio ou zero.

Outros chips presentes neste host (`gigabyte_wmi-virtual-0`, `acpitz-acpi-0`) nao sao
o CPU e nao devem ser usados como fonte da temperatura do processador.

Modulos de kernel: `k10temp` e `gigabyte_wmi` foram autocarregados pelo proprio
`sensors-detect --auto` (nenhum modulo foi forcado manualmente); `/etc/modules`
nao foi alterado (segue so com `vfio`, `vfio_iommu_type1`, `vfio_pci`).

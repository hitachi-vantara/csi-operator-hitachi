# Catalog notes — source mapping for wizard constraints

Constraints and parameters in `src/catalog/` are curated from the official guides and sample YAMLs in [csi-operator-hitachi](https://github.com/hitachi-vantara/csi-operator-hitachi).

## Documents

| Doc | ID | File in repo |
|-----|-----|--------------|
| Storage Plug-in for Containers Installation and User Guide | MK-92ADPTR142-31 | `docs/Storage Plug-in for Containers Installation and User Guide.pdf` |
| Replication Plug-in for Containers Installation and User Guide | MK-92ADPTR155-10 | `docs/Replication Plug-in for Containers Installation and User Guide.pdf` |
| Storage Plug-in for Prometheus Installation and User Guide | MK-92ADPTR156-08 | `docs/Storage Plug-in for Prometheus Installation and User Guide.pdf` |

## Key constraint sources (HSPC / CSI Driver)

| Topic | Guide section (approx.) |
|-------|-------------------------|
| Supported orchestrators / versions | Prerequisites |
| FC / iSCSI / NVMe-FC / NVMe-TCP | Server pre-installation |
| Bare metal vs VM protocol limits | Server requirements (VM: iSCSI + NVMe/TCP only) |
| Stretched PVC: FC / iSCSI only | Requirements for using Stretched PVC |
| SDS Block: FC / iSCSI / NVMe/TCP | Storage requirements for VSP One SDS Block / StorageClass legend |
| Multipath (DM + Native NVMe) | Device Mapper Multipath / Native NVMe Multipath |
| OpenShift OperatorHub install | Installation on OpenShift |
| Kubernetes operator YAML install | Installation on Kubernetes |
| Secret parameters | Secret settings |
| StorageClass (VSP / SDS Block) | StorageClass settings |
| Stretched PVC / GAD | Creating a Stretched PVC |
| VolumeSnapshotClass | VolumeSnapshotClass settings |
| alternativeCloneMode | Secret settings notes |
| VSP One B20 efficiency default | StorageClass legend (6) |
| IQN lowercase | iSCSI pre-install note |
| Firewall domains | Firewall whitelisting requirements |

## Replication

| Topic | Guide section |
|-------|---------------|
| UR / TrueCopy | Configuring Replication |
| Journals / remote path | Configuring the storage system |
| DR Operator | Installing DR operator |
| Remote kubeconfig | Configuring Replication Plug-in |
| Two Secrets per site | Replication operator: `hspc-replication-operator-remote-kubeconfig` (data key `remote-kubeconfig`); DR Operator: `remote-kubeconfig` (data key = other site cluster name; Simple mode `primary` / `secondary`) |
| Remote kubeconfig source | Required before Continue/Export: paste both kubeconfigs in the wizard (`remoteKubeconfigSource: wizard`) or confirm install-time creation (`KUBECONFIG_P`/`S` / helper). Choice persists; kubeconfig bytes do not. Older saves with neither are blocked. |
| DRPolicy clusterName | Must match the data key in that site's `remote-kubeconfig` Secret |
| OpenShift DR operator fsGroup | Installing DR operator — set `fsGroup` from namespace `openshift.io/sa.scc.supplemental-groups` (start of range) on both sites |

## Performance Metrics

| Topic | Guide section |
|-------|---------------|
| Exporter env vars | Configuring using environment variables |
| Secret storages list | Configuration file |
| OpenShift SCC | Sample `scc-for-openshift.yaml` |
| Test Prometheus/Grafana | Deploying to a test environment |

## Sample YAML locations (latest)

- `hspc/<ver>/sample/` — StorageClass, Secret, PVC, Pod, Console plugin, multipath MachineConfig
- `hspc/<ver>/operator/` — Operator namespace, operator, HSPC CR
- `hrpc/<ver>/yaml/` — Replication operator, Replication CR, storage secrets
- `hrpc/<ver>/dr-operator/` — DR Operator install
- `hspp/<ver>/yaml/` — Exporter, SCC, secret sample

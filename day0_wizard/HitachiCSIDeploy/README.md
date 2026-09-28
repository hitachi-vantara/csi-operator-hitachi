# Hitachi CSI Deployment Wizard

A browser configurator for deploying the **Hitachi CSI** stack on OpenShift, Kubernetes, or RKE2.

Answer a short series of questions about your platform, storage systems, and optional add-ons. The wizard produces a ZIP of manifests and an `install.sh` you run against your cluster — it never connects to the cluster from the page.

**Live site:** [cmccuistion-hv.github.io/HitachiCSIDeploy](https://cmccuistion-hv.github.io/HitachiCSIDeploy/)

## What this is for

Installing Hitachi storage for containers usually means stitching together operator samples, namespaces, Secrets, StorageClasses, multipath MachineConfigs, and (for multi-site) remote kubeconfig packaging. This wizard walks that path once and emits the right bundle for your choices.

| You provide | The wizard generates |
|-------------|----------------------|
| Platform and connection type (FC / iSCSI / NVMe) | Operator / driver install path for that platform |
| Array REST credentials, serial, pool IDs | Secret and StorageClass YAML |
| Optional Replication / Metrics / Console Plugin | Matching manifests and install steps |
| Cluster-admin access when you apply | Ready-to-run `install.sh` + ZIP |

## Components

| Name | What it does |
|------|----------------|
| CSI Driver | Core volume provisioning for Hitachi storage |
| Replication | Cross-cluster UR / TrueCopy (includes the DR Operator) |
| Performance Metrics | Prometheus exporter / Grafana |
| OpenShift Console Plugin | OpenShift UI dashboard |

## What you get

- Platform-aware defaults (OpenShift vs Kubernetes-style namespaces and OperatorHub vs YAML)
- Prerequisites called out for multipath, iSCSI, NVMe, firewall, and licenses where they apply
- StorageClass options constrained to documented rules (stretched/GAD, SDS Block, efficiency)
- Latest component versions pulled from [csi-operator-hitachi](https://github.com/hitachi-vantara/csi-operator-hitachi)
- Live YAML preview, ZIP download, `install.sh`, and save/resume of non-secret config
- Sample PVC and Pod to smoke-test provisioning after install

## What you will need

- Cluster-admin access when you run the generated scripts
- Array REST credentials, serial number, and pool IDs
- For Replication: journal IDs and a way to place each site’s remote kubeconfig Secret (helper script or wizard Secret YAML)

Kubeconfigs and credentials are never stored in the browser export.

## Official documentation

- [CSI Driver](https://docs.hitachivantara.com/r/en-us/mk-92adptr142/latest) (MK-92ADPTR142)
- [Replication](https://docs.hitachivantara.com/r/en-us/mk-92adptr155/latest) (MK-92ADPTR155)
- [Performance Metrics](https://docs.hitachivantara.com/r/en-us/mk-92adptr156/latest) (MK-92ADPTR156)
- [Compatibility matrix](https://compatibility.hitachivantara.com/products/hspc)

Constraint notes used by the catalog: [catalog-notes.md](catalog-notes.md).

## License

Manifests and product names are Hitachi Vantara’s. This wizard is a helper UI around the public operator samples.

# Hitachi Vantara CSI Operator

Kubernetes and OpenShift operator, manifests, and tooling for deploying the **Hitachi Vantara Container Storage Interface (CSI)** family of plug-ins.

This repository provides the deployment artifacts for the following plug-ins:

| Plug-in | Abbreviation | Directory | Purpose |
|---|---|---|---|
| Hitachi Storage Plug-in for Containers (Hitachi Vantara CSI) | **HSPC** | [`hspc/`](./hspc) | CSI driver and operator for dynamic provisioning of persistent volumes on Hitachi storage |
| Hitachi Replication Plug-in for Containers | **HRPC** | [`hrpc/`](./hrpc) | Replication support for persistent volumes provisioned on Hitachi storage |
| Hitachi Storage Plug-in for Prometheus | **HSPP** | [`hspp/`](./hspp) | Exposes Hitachi storage metrics to Prometheus |

---

## Table of Contents

- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Online installation](#online-installation)
  - [Offline (air-gapped) installation](#offline-air-gapped-installation)
- [Verifying the Installation](#verifying-the-installation)
- [Log Collection](#log-collection)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Support](#support)
- [License](#license)

---

## Repository Structure

```
csi-operator-hitachi/
├── .github/workflows/          # CI workflows
├── digital_signature/          # Digital signature artifacts for release verification
├── hspc/                       # Storage Plug-in for Containers (CSI) manifests, versioned
├── hrpc/                       # Replication Plug-in for Containers manifests
├── hspp/                       # Storage Plug-in for Prometheus manifests
├── log_collector/
│   └── hspc/
│       └── Hitachi-CSI-Log-Bundle/   # Log collection utility for HSPC
├── hvcsi-offline-bundle.sh     # Script for building/pushing air-gapped install bundles
├── Offline-bundle-README.md    # Detailed air-gapped installation guide
└── README.md
```

---

## Prerequisites

- A supported Kubernetes or OpenShift cluster (the manifests are provided per Kubernetes minor version, e.g. 1.32, 1.33, 1.34).
- `kubectl` (Kubernetes) or `oc` (OpenShift) with cluster-admin access.
- Network connectivity from cluster nodes to the Hitachi storage system(s).
- Access to the container images used by the plug-ins:
  - `registry.hitachivantara.com`
  - `registry.k8s.io` (CSI sidecar images)
  - For HSPP additionally: `quay.io` and `docker.io`

For storage-side requirements (supported storage models, credentials, host group/port configuration, etc.), refer to the product guides listed under [Documentation](#documentation).

---

## Installation

### Online installation

1. Clone the repository:

   ```bash
   git clone https://github.com/hitachi-vantara/csi-operator-hitachi.git
   cd csi-operator-hitachi
   ```

2. Change to the directory for the plug-in and version you want to install (for example, `hspc/<version>/`).

3. **Kubernetes** – install the operator, then create an HSPC instance:

   ```bash
   cd <hspc_version>/operator/
   kubectl create -f hspc-operator-namespace.yaml
   kubectl create -f hspc-operator.yaml
   kubectl get pods -n hspc-operator-system

   kubectl apply -f hspc_v1_hspc.yaml
   ```

   **OpenShift** – the operator can be installed from **OperatorHub**, or from the CLI using the operator and sample YAMLs.

4. Create the storage secret, `StorageClass`, and (optionally) `VolumeSnapshotClass` as described in the *Storage Plug-in for Containers Installation and User Guide*.

> **Note:** Exact manifest file names can vary by release. Check the contents of the version directory you are installing from.

### Offline (air-gapped) installation

For clusters without Internet access, use the `hvcsi-offline-bundle.sh` script. It works in three phases:

1. **Create the bundle** on a Linux host with Internet access, Docker or Podman, and Git:

   ```bash
   # HSPC bundle for a specific version, all supported Kubernetes versions
   ./hvcsi-offline-bundle.sh -c -v v3.18.2

   # HSPC bundle for a specific Kubernetes version
   ./hvcsi-offline-bundle.sh -c -v v3.18.2 -k 1.34

   # Bundles for the latest version of all three plug-ins
   ./hvcsi-offline-bundle.sh -c -t all

   # HRPC or HSPP
   ./hvcsi-offline-bundle.sh -c -t hrpc -v v3.17.4
   ./hvcsi-offline-bundle.sh -c -t hspp -v v3.17.4
   ```

   Output: `hvcsi-<plugin>-<version>-bundle.tar.gz`

2. **Push images to a private registry.** Transfer and extract the bundle on a host that can reach your registry, then run:

   ```bash
   tar -xvf hvcsi-hspc-v3.18.2-bundle.tar.gz
   cd hvcsi-hspc-v3.18.2-bundle

   ./hvcsi-offline-bundle.sh -p -r <registry>/<repository>

   # For self-signed or HTTP registries
   HSPC_INSECURE_REG=1 ./hvcsi-offline-bundle.sh -p -r <registry>/<repository>
   ```

   The script tags and pushes the images, generates `*-offline.yaml` manifests that reference your registry, and verifies image digests.

3. **Install** on the cluster using the generated offline manifests. On OpenShift, create an `ImageDigestMirrorSet` and `ImageTagMirrorSet` first so the cluster pulls from your mirror.

See **[Offline-bundle-README.md](./Offline-bundle-README.md)** for the full step-by-step procedure, including OpenShift IDMS/ITMS examples.

---

## Verifying the Installation

```bash
kubectl get hspc -n kube-system
# NAME   READY   AGE
# hspc   true    19h

kubectl get pods -n kube-system
# hspc-csi-controller-...   6/6   Running
# hspc-csi-node-...         2/2   Running   (one per worker node)
```

The HSPC resource should report `READY: true`, the controller pod should be fully ready, and one node pod should be running on each worker node.

---

## Log Collection

A log collection utility for HSPC is available in
[`log_collector/hspc/Hitachi-CSI-Log-Bundle`](./log_collector/hspc/Hitachi-CSI-Log-Bundle). Use it to gather diagnostic logs when opening a support case.

---

## Documentation

Product documentation is available at [docs.hitachivantara.com](https://docs.hitachivantara.com):

- Storage Plug-in for Containers Installation and User Guide
- Replication Plug-in for Containers Configuration Guide
- Storage Plug-in for Prometheus Quick Reference Guide

---

## Contributing

Issues and pull requests are welcome. Please open an issue to discuss significant changes before submitting a pull request.

---

## Support

- For product issues, contact Hitachi Vantara support through your normal support channel.
- For problems with the contents of this repository, please [open an issue](https://github.com/hitachi-vantara/csi-operator-hitachi/issues).

---

## License

_Add license information here (e.g., link to a `LICENSE` file) — none was found in the repository root._
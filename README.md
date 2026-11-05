# Hitachi Vantara CSI Operator

The **Hitachi Vantara CSI Operator** repository provides deployment resources, operators, manifests, and utilities for deploying Hitachi Vantara storage plug-ins in Kubernetes and Red Hat OpenShift environments.

The repository supports the following products:

| Product | Abbreviation | Description |
|---|---|---|
| Hitachi Storage Plug-in for Containers | HSPC | Provides persistent storage integration with Hitachi Vantara storage systems through the Container Storage Interface (CSI). |
| Hitachi Replication Plug-in for Containers | HRPC | Provides replication capabilities for Kubernetes workloads using Hitachi Vantara storage. |
| Hitachi Storage Plug-in for Prometheus | HSPP | Provides storage monitoring and metrics integration with Prometheus. |

The repository also includes a CSI deployment wizard, offline installation utilities, digital signature verification resources, and log collection tools.

## Table of Contents

- [Overview](#overview)
- [Supported Products](#supported-products)
- [Repository Structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Installation](#installation)
  - [Online Installation](#online-installation)
  - [Offline Installation](#offline-air-gapped-installation)
- [CSI Deploy Wizard](#csi-deploy-wizard)
- [Verifying the Installation](#verifying-the-installation)
- [Log Collection](#log-collection)
- [Digital Signature Verification](#digital-signature-verification)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Support](#support)

## Overview

Hitachi Vantara CSI Operator provides the resources required to deploy and manage Hitachi Vantara storage integrations in Kubernetes and OpenShift environments.

Key capabilities include:

- Deployment resources for HSPC, HRPC, and HSPP.
- Operator and Custom Resource deployment manifests.
- CSI deployment wizard.
- Online and offline installation support.
- Private container registry support for air-gapped environments.
- Digital signature verification resources.
- Diagnostic log collection utilities.

## Supported Products

### HSPC – Hitachi Storage Plug-in for Containers

HSPC integrates Hitachi Vantara storage systems with Kubernetes through the Container Storage Interface (CSI).

It enables Kubernetes workloads to consume persistent storage through Kubernetes PersistentVolumes and PersistentVolumeClaims.

### HRPC – Hitachi Replication Plug-in for Containers

HRPC provides replication integration for Kubernetes workloads using Hitachi Vantara storage replication capabilities.

### HSPP – Hitachi Storage Plug-in for Prometheus

HSPP provides storage monitoring and metrics integration with Prometheus, enabling storage-related metrics to be collected and monitored.

## Repository Structure

```text
csi-operator-hitachi/
├── .github/
│   └── workflows/              # GitHub Actions workflows
├── csi-deploy-wizard/          # CSI deployment wizard
├── digital_signature/          # Digital signature verification resources
├── hspc/                       # Hitachi Storage Plug-in for Containers
├── hrpc/                       # Hitachi Replication Plug-in for Containers
├── hspp/                       # Hitachi Storage Plug-in for Prometheus
├── log_collector/
│   └── hspc/                   # HSPC log collection utilities
├── hvcsi-offline-bundle.sh     # Offline bundle creation and deployment utility
├── Offline-bundle-README.md    # Offline installation guide
└── README.md
```

## Prerequisites

The prerequisites depend on the selected plug-in and deployment environment.

Generally, the following are required:

- Kubernetes or Red Hat OpenShift cluster.
- `kubectl` or `oc` command-line utility.
- Appropriate cluster permissions to deploy operators, CRDs, RBAC resources, and workloads.
- Network connectivity between Kubernetes nodes and Hitachi Vantara storage systems.
- Access to the required container image registries.
- Storage system configuration and connectivity appropriate for the selected plug-in.

For offline deployments, additional requirements include:

- Linux host with access to the Internet for bundle creation.
- Docker or Podman.
- Git.
- Access to a private container registry.
- Container image transfer capability to the target environment.

Refer to the respective product documentation for detailed requirements.

## Getting Started

Clone the repository:

```bash
git clone https://github.com/hitachi-vantara/csi-operator-hitachi.git
```

Navigate to the repository:

```bash
cd csi-operator-hitachi
```

Explore the available components:

```bash
ls -l
```

The repository contains separate directories for each plug-in, deployment wizard, and supporting utilities.

## Installation

Installation procedures depend on the selected plug-in, product version, and target Kubernetes/OpenShift environment.

### Online Installation

1. Clone the repository.

   ```bash
   git clone https://github.com/hitachi-vantara/csi-operator-hitachi.git
   cd csi-operator-hitachi
   ```

2. Navigate to the required plug-in and version directory.

   For example, for HSPC:

   ```bash
   cd hspc/<version>/operator/
   ```

3. Install the HSPC operator.

   ```bash
   kubectl create -f hspc-operator-namespace.yaml
   kubectl create -f hspc-operator.yaml
   ```

4. Verify the operator deployment.

   ```bash
   kubectl get pods -n hspc-operator-system
   ```

5. Deploy the HSPC Custom Resource.

   ```bash
   kubectl apply -f hspc_v1_hspc.yaml
   ```

6. Configure the required storage credentials, StorageClass, and other resources according to the HSPC Installation and User Guide.

**Note:** The above commands are illustrative of the HSPC installation workflow. Manifest names and procedures may vary between product releases. Always refer to the installation documentation for the selected version.

For HRPC and HSPP, navigate to their respective directories and follow the corresponding product installation instructions.

### Offline (Air-Gapped) Installation

The repository provides `hvcsi-offline-bundle.sh` to support deployments in environments without direct Internet connectivity.

The offline installation workflow consists of three phases:

1. Create the offline bundle.
2. Push container images to a private registry.
3. Deploy the plug-in using the generated offline manifests.

#### Phase 1: Create the Offline Bundle

Run the following commands on a Linux host with Internet access, Git, and Docker or Podman.

**Create an HSPC bundle:**

```bash
./hvcsi-offline-bundle.sh -c -v v3.18.2
```

**Create an HSPC bundle for a specific Kubernetes version:**

```bash
./hvcsi-offline-bundle.sh -c -v v3.18.2 -k 1.34
```

**Create bundles for all three plug-ins:**

```bash
./hvcsi-offline-bundle.sh -c -t all
```

**Create an HRPC bundle:**

```bash
./hvcsi-offline-bundle.sh -c -t hrpc -v v3.17.4
```

**Create an HSPP bundle:**

```bash
./hvcsi-offline-bundle.sh -c -t hspp -v v3.17.4
```

The generated archive follows this naming convention:

```text
hvcsi-<plugin>-<version>-bundle.tar.gz
```

#### Phase 2: Push Images to a Private Registry

Transfer the generated bundle to a host that has access to the target private container registry.

Extract the bundle:

```bash
tar -xvf hvcsi-hspc-v3.18.2-bundle.tar.gz
```

Navigate to the extracted directory:

```bash
cd hvcsi-hspc-v3.18.2-bundle
```

Push the images to the private registry:

```bash
./hvcsi-offline-bundle.sh -p -r <registry>/<repository>
```

For self-signed or HTTP registries:

```bash
HSPC_INSECURE_REG=1 ./hvcsi-offline-bundle.sh -p -r <registry>/<repository>
```

The utility handles the following operations:

- Loads the container images from the offline bundle.
- Tags and pushes images to the specified private registry.
- Updates image references in the generated installation manifests.
- Generates deployment resources referencing the private registry.
- Verifies image digests between the source and destination registries.

#### Phase 3: Deploy on Kubernetes/OpenShift

Transfer the generated deployment resources to the target cluster environment.

For OpenShift environments, configure the required image mirroring resources:

- ImageDigestMirrorSet (IDMS).
- ImageTagMirrorSet (ITMS).

Ensure that the target cluster nodes can access the private registry.

Apply the generated installation manifests and follow the respective product installation procedure.

For complete offline installation instructions, examples, and registry configuration details, refer to [Offline-bundle-README.md](./Offline-bundle-README.md).

## CSI Deploy Wizard

The `csi-deploy-wizard/` directory contains the CSI deployment wizard.

It is intended to provide a guided deployment experience for Hitachi Vantara CSI plug-ins.

Refer to the directory for the wizard's implementation, setup instructions, supported deployment options, and usage documentation.

## Verifying the Installation

After installation, verify that the operator and CSI components are running successfully.

**Check operator pods:**

```bash
kubectl get pods -A
```

**Check HSPC Custom Resource:**

```bash
kubectl get hspc -n kube-system
```

**Check CSI controller and node pods:**

```bash
kubectl get pods -n kube-system
```

**Check StorageClasses:**

```bash
kubectl get storageclass
```

**Check PersistentVolumeClaims:**

```bash
kubectl get pvc -A
```

For OpenShift environments, use the corresponding `oc` commands.

## Log Collection

The repository provides HSPC log collection utilities under:

```text
log_collector/hspc/Hitachi-CSI-Log-Bundle/
```

These utilities help collect diagnostic information required for troubleshooting and technical support cases.

Refer to the documentation provided within the log collector directory for usage instructions.

## Digital Signature Verification

Digital signature verification resources are available under:

```text
digital_signature/
```

Refer to the directory documentation for the applicable verification procedure.

## Troubleshooting

The following commands can help identify common Kubernetes and OpenShift deployment issues.

**Check pod status:**

```bash
kubectl get pods -A
```

**Inspect pod details:**

```bash
kubectl describe pod <pod-name> -n <namespace>
```

**Check container logs:**

```bash
kubectl logs <pod-name> -n <namespace>
```

**Check recent cluster events:**

```bash
kubectl get events -A --sort-by='.lastTimestamp'
```

**Check deployments:**

```bash
kubectl get deployments -A
```

**Check Custom Resource Definitions:**

```bash
kubectl get crds
```

For CSI-related issues, verify:

- CSI controller and node pod status.
- Storage system connectivity.
- Storage credentials and configuration.
- StorageClass and PersistentVolumeClaim configuration.
- Container image availability.
- CSI sidecar and driver logs.

For additional diagnostic information, use the log collection utilities provided in this repository.

## Documentation

For detailed product installation and configuration instructions, refer to the official Hitachi Vantara documentation.

- [Hitachi Vantara Documentation](https://docs.hitachivantara.com/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Red Hat OpenShift Documentation](https://docs.openshift.com/)
- [Hitachi Vantara CSI Operator Repository](https://github.com/hitachi-vantara/csi-operator-hitachi)

## Contributing

Contributions to the repository are welcome.

For significant changes:

1. Open an issue to discuss the proposed changes.
2. Create a feature or bug-fix branch.
3. Implement and test the changes.
4. Submit a pull request for review.

Ensure that changes follow the repository's existing conventions and do not introduce incompatible deployment resources.

## Support

For product-related questions, installation assistance, or technical issues, contact Hitachi Vantara support through the appropriate support channels.

For repository-related issues, raise an issue in the [GitHub repository](https://github.com/hitachi-vantara/csi-operator-hitachi/issues).

---

**Repository:** [hitachi-vantara/csi-operator-hitachi](https://github.com/hitachi-vantara/csi-operator-hitachi)

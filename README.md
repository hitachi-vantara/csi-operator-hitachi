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
- [List of Plugins ](#list-of-plugins)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Offline Installation](#offline-air-gapped-installation)
- [CSI Deploy Wizard](#csi-deploy-wizard)
- [Log Collection](#log-collection)
- [Digital Signature Verification](#digital-signature-verification)
- [Documentation](#documentation)
- [Support](#support)

## Overview

Hitachi Vantara CSI Operator provides the resources required to deploy and manage Hitachi Vantara storage integrations in Kubernetes and OpenShift environments.

The repository content has the following .

- Deployment resources for HSPC, HRPC, and HSPP.
- Operator and Custom Resource deployment manifests.
- CSI deployment wizard.
- Online and offline installation support.
- Private container registry support for air-gapped environments.
- Digital signature verification resources.
- Diagnostic log collection utilities.

## List of Plugins

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
Please refer to the latest installation guide in docs.hitachivantara.com 

### Offline (Air-Gapped) Installation
The Offline installation directory has the deployment resources needed to install in an Air-Gapped environment .
Please refer to the latest installation guide in docs.hitachivantara.com 

## CSI Deploy Wizard

The `csi-deploy-wizard/` directory contains the CSI deployment wizard. The Live site can be accessed here https://hitachi-vantara.github.io/csi-deploy-wizard

It is intended to provide a guided deployment experience for Hitachi Vantara CSI plug-ins.

Refer to the directory to find the README for usage documentation . https://github.com/hitachi-vantara/csi-operator-hitachi/blob/main/csi-deploy-wizard/README.md


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

## Documentation

For detailed product installation and configuration instructions, refer to the official Hitachi Vantara documentation.

- [Hitachi Vantara Documentation](https://docs.hitachivantara.com/)


## Support

For product-related questions, installation assistance, or technical issues, contact Hitachi Vantara support through the appropriate support channels.

For repository-related issues, raise an issue in the [GitHub repository](https://github.com/hitachi-vantara/csi-operator-hitachi/issues).

---

**Repository:** [hitachi-vantara/csi-operator-hitachi](https://github.com/hitachi-vantara/csi-operator-hitachi)

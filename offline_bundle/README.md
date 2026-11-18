# Hitachi Vantara CSI – Offline Installation Guide

| Item | Value |
|---|---|
| Script version | v3.19.0 |
| Document scope | Offline installation of Hitachi Vantara CSI plug-ins by using `hvcsi-offline-bundle.sh` |
| Plug-ins covered | HSPC (Storage Plug-in for Containers), HRPC (Replication Plug-in for Containers), HSPP (Storage Plug-in for Prometheus) |

---

## Table of contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [Script usage](#3-script-usage)
4. [Generate offline bundle and manifests](#4-generate-offline-bundle-and-manifests)
5. [Installing Hitachi Vantara CSI plug-ins](#5-installing-hitachi-vantara-csi-plug-ins)

---

## 1. Overview

In an airgap environment, target cluster nodes cannot reach public registries such as `ghcr.io`, `registry.hitachivantara.com`, `registry.k8s.io`, or `registry.redhat.io`. Every container image and manifest must be copied in advance into a registry that the cluster can reach (the **mirror registry**).

```mermaid
flowchart LR
  P1["Step 1<br/>Create the offline bundle"] --> P2["Step 2<br/>Transfer and extract the offline bundle"]
  P2 --> P3["Step 3<br/>Push images to the mirror registry"]
  P3 --> P4["Step 4<br/>Configure the cluster<br/>(OpenShift only)"]
  P4 --> P5["Step 5<br/>Apply deployment manifests on the target cluster"]
```

The script `hvcsi-offline-bundle.sh` helps automate the process to install Hitachi Vantara CSI plug-ins by retrieving the relevant images and manifests into airgap environments.

For storage-side preparation, supported versions, multipath, StorageClass, and Secret configuration, follow the official [Hitachi Storage Plug-in for Containers documentation](https://docs.hitachivantara.com). Check the supported Kubernetes/OpenShift versions in the release notes and the [Hitachi Vantara Product Compatibility Guide](https://compatibility.hitachivantara.com) before you start.

---

## 2. Requirements

### 2.1 Host requirements

The bundle is created on a host that has access to the Internet (the endpoints in [2.2](#22-network-endpoints)). It is assumed that this host does not have access to the mirror registry. The bundle is then transferred to another host that has access to the mirror registry, and the images are pushed to the registry from there.

| Requirement | Description |
|---|---|
| OS and tools | Linux variant with minimum `bash` 4 and with utility tools - `tar`, `gzip`, `sed`, `awk`, `find`, `sha256sum`. |
| `git` | Required on the Host with Internet to clone this repository. |
| `skopeo` | Version 1.14.5 or later on both hosts. Required for `--preserve-digests`. Check with `skopeo --version`. |
| `podman` | Optional on both hosts. Used only if the script needs to prompt you to log in to `registry.redhat.io`. Docker is **not** used by the script. |
| Disk space | Sufficient space to download the plug-in images plus the archive bundle creation, transfer or extraction. |
| Network | Host to have outbound access using HTTPS (TCP 443) to the endpoints (as in [2.2](#22-network-endpoints)) or to the mirror registry, as appropriate. |
| Credentials | Host must be able to authenticate to the source registries to pull the images or to the mirror registry to push the images, as appropriate. |

### 2.2 Network endpoints

Endpoints that the Host with Internet must reach depend on the plug-in and version. The script pulls whatever the manifests reference, so check the manifests if you use a different version:

| Endpoint | HSPC | HRPC | HSPP | Notes |
|---|:-:|:-:|:-:|---|
| `github.com` | ✔ | ✔ | ✔ | Clone this repository |
| `ghcr.io` | ✔ | | | Hitachi images; no authentication required (v3.19.0 and later) |
| `registry.hitachivantara.com` | ✔ | ✔ | ✔ | Hitachi images; no authentication required (HSPC up to v3.18.x) |
| `registry.k8s.io` | ✔ | | | CSI sidecar images |
| `registry.redhat.io` | ✔ | | | Hitachi CSI Console UI dependent image from Red Hat; requires Red Hat registry login |
| `quay.io` | | | ✔ | Prometheus, Pushgateway |
| `docker.io` (`registry-1.docker.io`, `auth.docker.io`, `production.cloudflare.docker.com`) | | | ✔ | Grafana |

### 2.3 Mirror registry

- Any registry that supports the Docker Registry HTTP API V2 and OCI image indexes (for example Red Hat Quay, the *mirror registry for Red Hat OpenShift*, Harbor, Nexus, Artifactory), which is usually a private or internal repository of the user and is accessible by all the nodes of the target cluster.
- The target repository path (for example `mirror.example.com/hitachi`) must exist or the registry must auto-create repositories on push.
- To mirror image signatures, the registry must accept sigstore attachment tags (`sha256-<digest>.sig`).
- Expose the mirror registry on port 443 and use a registry path without a port (for example `mirror.example.com/hitachi`, not `mirror.example.com:8443/hitachi`).

### 2.4 Target cluster

- A Kubernetes or OpenShift version supported by the plug-in version you are installing.
- `kubectl` or `oc` with cluster-admin rights.
- The cluster is in an airgap environment, and all cluster nodes can reach the mirror registry.
- OpenShift only, OperatorHub method: an `oc-mirror` mirrored catalog that includes the Hitachi operator ([Section 5.3.1](#531-install-on-openshift-using-software-catalog)).

---

## 3. Script usage

The script allows you to perform the following actions:

| Action | Flag | Where it runs | What it does |
|---|---|---|---|
| Create bundle | `-c` | Host with Internet | Reads the plug-in manifests in this repository, collects every referenced image, copies each one into a local directory with `skopeo` (digests preserved), adds the plug-in manifests, and packs everything into `hvcsi-<plugin>-<version>-bundle.tar.gz`. |
| Push | `-p` | Host in Airgap environment | Pushes every image from the extracted bundle to `<registry>/<repository>` (digests preserved), writes `*-offline.yaml` copies of the manifests that point to the mirror, writes the offline HSPC custom resource (HSPC only), and compares each pushed digest with the bundle. |
| Update manifests | `-u` | Host in Airgap environment | Regenerates the `*-offline.yaml` manifests for a different registry path without pushing images. |
| Offline CR for one K8s version | `-n` | Host in Airgap environment | Intended to regenerate the offline HSPC CR for a specific Kubernetes version. |

What the script does **not** do:

- It does not mirror the OpenShift OperatorHub catalog.
- It does not configure the cluster (pull secret, IDMS/ITMS, signature policy) or install the plug-ins. User manually applies the generated manifests.

```text
# Usage: [ENVIRONMENT_VARIABLE=value] hvcsi-offline-bundle.sh [action flags] [options] | -h | --version
hvcsi-offline-bundle.sh -c [-t hspc|hrpc|hspp] -v <plugin_version> [-k <k8s_version>]
hvcsi-offline-bundle.sh -c -t all
hvcsi-offline-bundle.sh -p -r <registry>/<repository> [-t <plugin>]
hvcsi-offline-bundle.sh -u -r <registry>/<repository> [-t <plugin>]
hvcsi-offline-bundle.sh -n -k <k8s_version>
hvcsi-offline-bundle.sh -h | --version
```

### 3.1 Options

| Option | Required for | Description |
|---|---|---|
| `-t <plugin>` | Optional | `hspc` (default), `hrpc`, `hspp`, or `all`. `all` creates one bundle per plug-in using the latest version folder of each; it cannot be combined with `-v`. |
| `-v <version>` | `-c` (except `-t all`) | Plug-in version folder name, for example `v3.19.0`. Must exist under `hspc/`, `hrpc/`, or `hspp/`. |
| `-k <k8s_version>` | `-n`; optional with `-c` | Kubernetes `major.minor`, for example `1.34`. HSPC only; ignored (with a warning) for other plug-ins. Limits the bundle to the sidecars for that version. |
| `-r <path>` | `-p`, `-u` | Mirror registry and repository, for example `mirror.example.com/hitachi`. |
| `-h` | – | Print usage. |
| `--version` | – | Print the script version. |

### 3.2 Environment variables

| Variable | Used by | Effect |
|---|---|---|
| `HSPC_INSECURE_REG=1` | `-p` | Disables TLS verification for the push and for digest verification. Use only for test registries; prefer trusting the registry CA. |
| `REGISTRY_AUTH_FILE=<file>` | All `skopeo` calls | Standard containers auth file location. Set this if your credentials are not in the default `${XDG_RUNTIME_DIR}/containers/auth.json`, so that push **and** verification use the same credentials. |

---

## 4. Generate offline bundle and manifests

Perform the following steps to generate an offline bundle and manifests for the Hitachi Vantara CSI plug-in installation.

> [!IMPORTANT]
> - The script stops (exit code 1) on any failed image copy or push, except images from `registry.redhat.io`, which can be skipped after three failed login attempts ([4.2](#42-authenticate-to-source-registries)).
> - A log file, `hvcsi-offline-bundle_<YYYYMMDD_HHMMSS>.log`, is generated at every run in the current working directory and includes the full `skopeo` output. Keep it as an audit record or use it for troubleshooting.

### Step 1 – Create the offline bundle

#### 4.1 Clone the Hitachi Vantara CSI repository

Run the following commands to clone the public Hitachi Vantara CSI repository from GitHub, make the script executable, and verify the script version.

```bash
# Clone the public Hitachi Vantara CSI repository from GitHub
git clone https://github.com/hitachi-vantara/csi-operator-hitachi.git

# Go to the folder that contains the offline bundle script
cd csi-operator-hitachi/offline_bundle

# Make the script executable (it is not stored as executable in Git)
chmod +x hvcsi-offline-bundle.sh

# Verify the script version
./hvcsi-offline-bundle.sh --version
```

#### 4.2 Authenticate to source registries

Log in separately to the source registries with `podman login` or `skopeo login` to retrieve the images. The pull-secrets (`auth.json`) file can be used so that the script can use it to authenticate to the source registries.

Run the logins as the same user that runs the script so that `skopeo` finds the credentials.

#### 4.3 (Optional) Preserve image signatures

Hitachi Vantara signs its HSPC images with sigstore. The public key is in [`digital_signature/HV_PK.pem`](../digital_signature/HV_PK.pem). If the target OpenShift cluster enforces signature verification with a `ClusterImagePolicy`, the signatures must also be in the mirror.

Before running the script, add `use-sigstore-attachments` for the source registries (on both the hosts) in `/etc/containers/registries.d/default.yaml` (or any `*.yaml` file in that directory). A given scope can appear in only one file in the directory.

```yaml
docker:
  ghcr.io/hitachi-vantara/hitachicsi-oci-oss:
    use-sigstore-attachments: true
  registry.hitachivantara.com:
    use-sigstore-attachments: true
  registry.k8s.io:
    use-sigstore-attachments: true
```

With this configuration, `skopeo` copies the signatures with the images.

#### 4.4 Generate the offline bundle

Copy the script file from [4.1](#41-clone-the-hitachi-vantara-csi-repository) to the cloned repository and execute the commands as per the objective below.

```bash
# Copy the script to the cloned repository root
cp hvcsi-offline-bundle.sh ..

# Go to the repository root
cd ..
```

| Objective | Command |
|---|---|
| HSPC, all supported Kubernetes versions (**recommended**) | `./hvcsi-offline-bundle.sh -c -v v3.19.0` |
| Same, with an explicit plug-in | `./hvcsi-offline-bundle.sh -c -t hspc -v v3.19.0` |
| HSPC for one Kubernetes version only | `./hvcsi-offline-bundle.sh -c -v v3.19.0 -k 1.35` |
| HRPC | `./hvcsi-offline-bundle.sh -c -t hrpc -v v3.18.3` |
| HSPP | `./hvcsi-offline-bundle.sh -c -t hspp -v v3.18.3` |
| Latest version of all three plug-ins (one bundle each) | `./hvcsi-offline-bundle.sh -c -t all` |

> [!NOTE]
> **Bundles created with `-k`** contain only the sidecars for that Kubernetes version and **do not include the OpenShift console plug-in images**. The bundle still contains the manifests for every Kubernetes version.

Example output:

```text
$ ./hvcsi-offline-bundle.sh -c -v v3.19.0
2026-10-22 17:54:55 - Determining required images for hspc v3.19.0...
2026-10-22 17:54:55 - Found 19 unique image(s) for hspc v3.19.0.
2026-10-22 17:54:55 - --- Copying hspc images into bundle (digest-preserving) ---
2026-10-22 17:54:55 -   Copying ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hspc-config-operator:v3.19.0 -> ghcr.io_hitachi-vantara_hitachicsi-oci-oss_hspc-config-operator_v3.19.0
Getting image source signatures
Checking if image destination supports signatures
Copying blob
...
Storing signatures
2026-10-22 17:54:57 -   Copying ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hspc-csi-driver:v3.19.0 -> ghcr.io_hitachi-vantara_hitachicsi-oci-oss_hspc-csi-driver_v3.19.0
Getting image source signatures
...
2026-10-22 17:56:12 -   Copying registry.redhat.io/openshift4/ose-tools-rhel8@sha256:f8d9816fd9450410c91c350cce71e6a9ca7d5d75ab438d5dd3d28ba7771f0422 -> registry.redhat.io_openshift4_ose-tools-rhel8_sha256_f8d9816fd9450410c91c350cce71e6a9ca7d5d75ab438d5dd3d28ba7771f0422
...
Copying config sha256:b690191a426f3075d12392309c8149e50b9c9e4fa93f0aed4fc6131c193c94a1
Writing manifest to image destination
Storing signatures
2026-10-22 17:56:27 - Copying installation files from <path>/csi-operator-hitachi/hspc/v3.19.0...
2026-10-22 17:56:27 - Building final archive: hvcsi-hspc-v3.19.0-bundle.tar.gz
2026-10-22 17:59:00 - --- Bundle created successfully: hvcsi-hspc-v3.19.0-bundle.tar.gz ---
```

The script creates `hvcsi-<plugin>-<version>-bundle.tar.gz`, where `<plugin>` is `hspc`, `hrpc`, or `hspp`. The archive contains a top-level `hvcsi-<plugin>-<version>-bundle/` directory with the following structure, one level down: a `<plugin>-images/` directory that holds one directory per container image (with original digests) and the `image-map.csv` image inventory, and a `<version>/` directory that is a copy of the plug-in manifests for that version from the repository. The uncompressed working directory on the Host with Internet is removed after the archive is built.

### Step 2 – Transfer and extract the offline bundle

In this step, ensure that the generated offline bundle along with the script is transferred to the host that can push images to the mirror registry, using your organisation's approved transfer process.

#### 4.5 Extract the bundle and place the script

Extract the bundle, go to the extracted folder, then place the script there and make it executable.

```bash
# Navigate to the folder containing the offline bundle and extract it
cd /path/to/{folder-containing-hvcsi-<plugin>-<version>-bundle.tar.gz}
tar -xvf hvcsi-hspc-v3.19.0-bundle.tar.gz

# Go to the extracted bundle folder
cd hvcsi-hspc-v3.19.0-bundle

# Place the script in the extracted folder and make it executable
cp /path/to/hvcsi-offline-bundle.sh .
chmod +x hvcsi-offline-bundle.sh
```

### Step 3 – Push images to the mirror registry

#### 4.6 Authenticate to the mirror registry

Log in separately to the mirror registry with `podman login` or `skopeo login` to push the images. The pull-secrets (`auth.json`) file can be modified so that the script can use it to authenticate to the mirror registry.

Run the logins as the same user that runs the script so that `skopeo` finds the credentials.

#### 4.7 (Optional) Preserve image signatures

Similar to [4.3](#43-optional-preserve-image-signatures), add `use-sigstore-attachments` for the mirror registry (on the Host with push access to the mirror registry) in `/etc/containers/registries.d/default.yaml`.

```yaml
docker:
  mirror.example.com:            # replace with mirror registry
    use-sigstore-attachments: true
```

#### 4.8 Generate offline manifests for plug-ins

Use the following command to tag and push the container images to the mirror repository. This will also create manifest files with the new image paths from the mirror registry.

```bash
./hvcsi-offline-bundle.sh -p -r mirror.example.com/hitachi
# Lab registry with self-signed certificate or HTTP only:
HSPC_INSECURE_REG=1 ./hvcsi-offline-bundle.sh -p -r mirror.example.com/hitachi
```

Example output:

```text
$ ./hvcsi-offline-bundle.sh -p -r mirror.example.com/hitachi
2026-10-22 18:18:20 - Detected plugin 'hspc' (images folder: hspc-images)
2026-10-22 18:18:20 - --- Pushing images to 'mirror.example.com/hitachi' (digest-preserving) ---
2026-10-22 18:18:20 -   Pushing ghcr.io_hitachi-vantara_hitachicsi-oci-oss_hspc-config-operator_v3.19.0 -> mirror.example.com/hitachi/hspc-config-operator:v3.19.0
Getting image source signatures
Checking if image destination supports signatures
Copying blob
...
Writing manifest to image destination
Storing signatures
2026-10-22 18:18:21 -   Pushing ghcr.io_hitachi-vantara_hitachicsi-oci-oss_hspc-csi-driver_v3.19.0 -> mirror.example.com/hitachi/hspc-csi-driver:v3.19.0
Getting image source signatures
...
2026-10-22 18:19:38 - --- All images pushed successfully to 'mirror.example.com/hitachi' ---
...
2026-10-22 18:19:38 - --- Manifest files updated successfully ---
2026-10-22 18:19:38 - Creating offline CRD file: hspc_v1_hspc_offline.yaml
2026-10-22 18:19:38 - Using images from: hspc-k8s1.35-offline.yaml
2026-10-22 18:19:38 - Offline CRD file created with updated image references
2026-10-22 18:19:38 - --- Proceed to installation step ---
2026-10-22 18:19:38 - --- Verifying digests (bundle dir vs pushed mirror) ---
2026-10-22 18:19:38 -     using: skopeo inspect --tls-verify=true <no authfile>
...
2026-10-22 18:19:41 - --- Verification summary: 19/19 OK, 0 failed ---
```

#### 4.9 Validate the generated manifests

Validate the push and the generated manifests:

- **Digest verification:** check the log file and console output for the message `Verification summary: x/x OK, 0 failed`.
- **Every referenced image exists in the mirror:** verify the images pushed to the mirror registry against the image references in the generated manifests.
- **The HSPC CR matches the sidecar images for the cluster's Kubernetes version:** verify the images in `hspc_v1_hspc_offline.yaml` against `hspc-k8s<ver>-offline.yaml` for that version.

The push action of the offline bundle script generates the following additional manifests, which are included in the `<version>/` directory.

**HSPC**

| File | Purpose |
|---|---|
| `<version>/operator/hspc-operator-offline.yaml` | Operator deployment (operator install method) |
| `<version>/operator/hspc_v1_hspc_offline.yaml` | HSPC custom resource with explicit mirror images. Images are taken from the latest `hspc-k8s<ver>-offline.yaml` |
| `<version>/sample/config/hspc-k8s<ver>-offline.yaml` | Driver manifests for installation without the operator, one per Kubernetes version |
| `<version>/sample/openshift/consoleplugin-ocp-ui-offline.yaml` | OpenShift console plug-in (v3.19.0 layout only) |

**HSPP**

| File | Purpose |
|---|---|
| `<version>/yaml/exporter-offline.yaml` | Storage Plug-in for Prometheus exporter deployment with mirror images |
| `<version>/yaml/grafana-prometheus-sample-offline.yaml` | Sample Grafana and Prometheus deployment with mirror images |

**HRPC**

| File | Purpose |
|---|---|
| `<version>/yaml/hspc-replication-operator-offline.yaml` | Replication Plug-in operator deployment with mirror images |
| `<version>/dr-operator/yaml/cert-manager-offline.yaml` | cert-manager deployment required by the DR Operator, with mirror images |
| `<version>/dr-operator/yaml/dr-operator-install-offline.yaml` | DR Operator deployment with mirror images |

---

## 5. Installing Hitachi Vantara CSI plug-ins

### Step 4 – Configure the cluster (OpenShift only)

Ensure that the `<version>/` directory exists on the OpenShift (RHOCP) or Kubernetes (K8s) cluster (on a control plane/master node) for the installation. The directory contains the manifests that can be applied in the airgap cluster environment to install the plug-ins. The manifests suffixed with `*-offline.yaml` reference the mirror registry directly, so the cluster only requires authentication credentials for the mirror registry or repository.

HSPC is a prerequisite on the cluster if you need to install HRPC or HSPP.

To install HSPC from the Software Catalog (previously OperatorHub), or to verify image signatures on an OpenShift cluster, perform the following steps on the cluster. These steps are not required for a K8s cluster.

> [!IMPORTANT]
> The upstream image source for HSPC 3.19.x changed from `registry.hitachivantara.com` to `ghcr.io`. Upgrading in an airgap RHOCP environment requires mapping the new repository in the ImageDigestMirrorSet (IDMS), ImageTagMirrorSet (ITMS) and ClusterImagePolicy. Any creation, modification, or deletion of an IDMS, ITMS or ClusterImagePolicy may trigger a full cordon, drain, and rolling reboot of nodes in the affected MachineConfigPool (MCP) through the Machine Config Operator. Perform the upgrade during a maintenance window.

#### 5.1 (Optional) Create or update ImageDigestMirrorSet and ImageTagMirrorSet

Create or modify these resources when you plan to install HSPC from the Software Catalog (previously OperatorHub) on the OpenShift cluster. The `source` entries must list the original image path, and the `mirrors` entries must list the new image path on the private/local registry. Remove the entries that do not apply to your plug-in and version.

Create or update the manifest. The following is an example:

```yaml
# hvcsi-idms.yaml – images referenced by digest
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: hvcsi-offline-digest
spec:
  imageDigestMirrors:
  - source: ghcr.io/hitachi-vantara/hitachicsi-oci-oss          # Plug-ins v3.19.0 and later
    mirrors: [mirror.example.com/hitachi]
  - source: registry.hitachivantara.com/hitachicsi-oci-oss      # Plug-ins up to v3.18.x
    mirrors: [mirror.example.com/hitachi]
  - source: registry.k8s.io/sig-storage
    mirrors: [mirror.example.com/hitachi]
  - source: registry.redhat.io/openshift4                       # Hitachi CSI Console UI plug-in
    mirrors: [mirror.example.com/hitachi]
---
# hvcsi-itms.yaml – images referenced by tag
apiVersion: config.openshift.io/v1
kind: ImageTagMirrorSet
metadata:
  name: hvcsi-offline-tag
spec:
  imageTagMirrors:
  - source: ghcr.io/hitachi-vantara/hitachicsi-oci-oss
    mirrors: [mirror.example.com/hitachi]
  - source: registry.hitachivantara.com/hitachicsi-oci-oss
    mirrors: [mirror.example.com/hitachi]
  - source: quay.io/prometheus                                  # Plug-in: HSPP
    mirrors: [mirror.example.com/hitachi]
  - source: docker.io/grafana                                   # Plug-in: HSPP
    mirrors: [mirror.example.com/hitachi]
```

Apply the manifest:

```bash
oc apply -f hvcsi-idms.yaml -f hvcsi-itms.yaml
```

Ensure that the Machine Config Operator (MCO) completes the rollout. Applying an ImageDigestMirrorSet or ImageTagMirrorSet usually causes the MCO to trigger a full cordon, drain, and rolling reboot of nodes, depending on the rendered MachineConfig change and the OpenShift version. Schedule these changes in a maintenance window and do not reboot nodes manually. Confirm the result:

```bash
oc get mcp -w        # wait until UPDATED=True, UPDATING=False for all pools
```

#### 5.2 (Optional) Create or update image signature verification

Create or modify these resources when you plan to verify image signatures on the OpenShift cluster. [`hspc/<version>/sample/openshift/clusterimagepolicy-sample.yaml`](../hspc/v3.19.0/sample/openshift/clusterimagepolicy-sample.yaml) configures OpenShift to verify HSPC images with the Hitachi Vantara public key. Applying a `ClusterImagePolicy` causes a rolling MachineConfigPool update, which can trigger a full cordon, drain, and rolling reboot of nodes depending on the rendered MachineConfig change and the OpenShift version. The signatures must have been copied into the mirror registry or repository ([4.3](#43-optional-preserve-image-signatures) and [4.7](#47-optional-preserve-image-signatures)); otherwise the cluster nodes reject the images.

Create or update the manifest. The following is an example:

```yaml
apiVersion: config.openshift.io/v1
kind: ClusterImagePolicy
metadata:
  name: hitachi-cip
spec:
  scopes:
  # Add the source repositories for the Hitachi Vantara CSI plug-ins
  # Plug-ins v3.19.0 and later
    - ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hspc-operator
    - ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hspc-config-operator
    - ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hspc-csi-driver
    - ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hspc-csi-telemetry-service
    - ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hv-ocp-ui
    - ghcr.io/hitachi-vantara/hitachicsi-oci-oss/hv-ocp-bff
  # Plug-ins up to v3.18.x
  #  - registry.hitachivantara.com/hitachicsi-oci-oss/hspc-operator
  #  - registry.hitachivantara.com/hitachicsi-oci-oss/hspc-csi-driver
  #  - registry.hitachivantara.com/hitachicsi-oci-oss/hspc-csi-telemetry-service
  # Mirror repository (needed for the CLI method of installation)
    - mirror.example.com/hitachi
  policy:
    rootOfTrust:
      policyType: PublicKey
      publicKey:
        keyData: "<BASE64_ENCODED_PUBLIC_KEY>"     # output of: base64 -w0 HV_PK.pem
    signedIdentity:
      matchPolicy: MatchRepository
```

### Step 5 – Apply deployment manifests on the target cluster

Install HSPC first, then HSPP or HRPC if required.

The commands below use `kubectl`; on OpenShift you can use `oc` with the same arguments.

#### 5.3 Install HSPC

Choose **one** installation method:

| Method | Platform | Uses |
|---|---|---|
| [5.3.1 Software Catalog](#531-install-on-openshift-using-software-catalog) | OpenShift | Mirrored certified-operator catalog (`oc-mirror`) + IDMS/ITMS + ClusterImagePolicy (optional) + `hspc-operator.yaml` + `hspc_v1_hspc.yaml` |
| [5.3.2 Manual CLI](#532-install-on-openshift-or-kubernetes-via-cli) | OpenShift or Kubernetes | `hspc-operator-offline.yaml` + `hspc_v1_hspc_offline.yaml` |
| [5.3.3 Without Operator (CLI)](#533-install-on-openshift-or-kubernetes-via-cli-without-operator) | OpenShift or Kubernetes | `hspc-k8s<ver>-offline.yaml` |

##### 5.3.1 Install on OpenShift using Software Catalog

OperatorHub in an airgap environment cluster lists only operators from catalogs that have been mirrored. `hvcsi-offline-bundle.sh` does **not** mirror catalogs. Use Red Hat's `oc-mirror` plug-in (v2).

Ensure that the OpenShift cluster is configured ([Step 4](#step-4--configure-the-cluster-openshift-only)) and execute the following commands:

```bash
cd v3.19.0/operator          # v3.18.2: v3.18.2/yaml/operator

# 1. Namespace for the operator
kubectl create -f hspc-operator-namespace.yaml

# 2. Operator (images resolved through IDMS/ITMS)
kubectl create -f hspc-operator.yaml
kubectl get pods -n hspc-operator-system      # wait until the operator pod is Running

# 3. HSPC instance (images resolved through IDMS/ITMS)
kubectl apply -f hspc_v1_hspc.yaml

# 4. Verify the HSPC pods
kubectl get pods -n kube-system | grep hspc   # wait until the hspc pods are Running
```

##### 5.3.2 Install on OpenShift or Kubernetes (via CLI)

Run from the extracted bundle directory:

```bash
cd v3.19.0/operator          # v3.18.2: v3.18.2/yaml/operator

# 1. Namespace for the operator
kubectl create -f hspc-operator-namespace.yaml

# 2. Operator (offline images)
kubectl create -f hspc-operator-offline.yaml
kubectl get pods -n hspc-operator-system      # wait until the operator pod is Running

# 3. HSPC instance (offline images)
kubectl apply -f hspc_v1_hspc_offline.yaml

# 4. Verify the HSPC pods
kubectl get pods -n kube-system | grep hspc   # wait until the hspc pods are Running
```

##### 5.3.3 Install on OpenShift or Kubernetes (via CLI) without Operator

Use the manifest that matches the cluster's Kubernetes version (`kubectl version` or, on OpenShift, the Kubernetes version of your OCP release):

```bash
cd v3.19.0/sample/config     # older versions: <version>/sample or <version>/yaml/sample
kubectl apply -f spcnode.yaml
kubectl apply -f hspc-k8s1.34-offline.yaml
kubectl get pods -n kube-system | grep hspc
```

##### 5.3.4 (Optional) Install Hitachi CSI Console UI

```bash
kubectl apply -f v3.19.0/sample/openshift/consoleplugin-ocp-ui-offline.yaml
```

#### 5.4 Install HSPP

HSPC must already be installed. Configure the namespace and secret as described in the *Storage Plug-in for Prometheus Quick Reference Guide*, then apply the offline manifests from the extracted HSPP bundle in place of the originals (see [4.9](#49-validate-the-generated-manifests)):

```bash
cd <version>/yaml
kubectl apply -f namespace.yaml
kubectl apply -f scc-for-openshift.yaml                     # OpenShift only
kubectl apply -f secret-sample.yaml                         # after editing for your storage system
kubectl apply -f exporter-offline.yaml
kubectl apply -f grafana-prometheus-sample-offline.yaml     # optional sample
```

#### 5.5 Install HRPC

HSPC must already be installed. Prepare the storage secrets and remote kubeconfig as described in the *Replication Plug-in for Containers Configuration Guide*, then apply the offline manifests from the extracted HRPC bundle in place of the originals (see [4.9](#49-validate-the-generated-manifests)):

```bash
cd <version>
kubectl create -f yaml/hspc-replication-operator-namespace.yaml
kubectl create -f yaml/hspc-replication-operator-offline.yaml
kubectl apply -f dr-operator/yaml/cert-manager-offline.yaml            # DR Operator only
kubectl apply -f dr-operator/yaml/dr-operator-install-offline.yaml     # DR Operator only
```

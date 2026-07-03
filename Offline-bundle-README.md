# **Hitachi Vantara CSI - Offline Installation**


# Introduction

This guide outlines the comprehensive procedure for conducting an air-gapped installation of Hitachi Vantara CSI. In air-gapped environments, it is essential to ensure that all required container images and manifests are prepared and accessible offline.

This script can be used for air-gapped installations of the following plugins:
- Hitachi Vantara Container Storage Interface (CSI), also known as HSPC
- Hitachi Replication Plug-in for Containers (HRPC)
- Hitachi Storage Plug-in for Prometheus (HSPP)

The overall process involves the following steps:

- Git clone the Hitachi Vantara CSI from the public repository
- Run the script to download images and create a single bundle
  - The script support dowloading images for specific or all plugins at once
- Extract the bundle, run the script to push to the new registry and update manifest files to be ready for installation
- Install HV CSI using images from the private/local registry

# Prerequisites

* **Linux system**: with internet access, docker or podman, and Git
  * Make sure port 443 is open and this system has access to the following :
    For HSPC/HRPC:
    * github.com
    * registry.hitachivantara.com
    * registry.k8s.io

    For HSPP, access to the following is also required:
    * quay.io
    * docker.io

* **Offline Cluster**: Private Registry (e.g., registry.internal.corp), no Internet access

# Phase 1: Create HV CSI’s offline bundle

## 1. Clone HV CSI from public repository

From the Linux system, follow these steps to clone the public Hitachi Vantara CSI repository:

```
git clone https://github.com/hitachi-vantara/csi-operator-hitachi
```

Navigate to the cloned repository and copy the script “hvcsi-offline-bundle.sh” there:

```
cd csi-operator-hitachi
```

## 2. Create the HV CSI offline bundle

From folder “csi-operator-hitachi “, run the following cmd to create the offline bundle. Include the version of HV CSI (e.g., V3.18.2) and Kubernetes version if needed (e.g., 1.34). If no k8s version is provided, the script will download all the sidecars available for all the k8s versions supported on the specific HV CSI.

Here are a couple of examples:

```
#Create a bundle for HV CSI v3.18.2 and all associated K8s versions

./hvcsi-offline-bundle.sh -c -v v3.18.2             (plugin defaults to hspc)
or
./hvcsi-offline-bundle.sh -c -t hspc -v v3.18.2

#Create a bundle for a specific K8s version (e.g., 1.34)

./hvcsi-offline-bundle.sh -c -v v3.18.2 -k 1.34

#Create bundles for the LATEST version of all three plugins (one bundle each)
./hvcsi-offline-bundle.sh -c -t all

# Create a bundle for HRPC or HSPP
./hvcsi-offline-bundle.sh -c -t hrpc -v v3.17.4
./hvcsi-offline-bundle.sh -c -t hspp -v v3.17.4

```

This cmd will create a single compressed file called “hvcsi-<plugin>-<hvcsi-version>-bundle.tar.gz”. This file contains all the images and all required HV CSI’s files for the requested version. Here is one example: **hvcsi-hspc-v3.18.2-bundle.tar.gz**

The output of the create cmd looks like this:

```
./hvcsi-offline-bundle.sh -c -v v3.18.2
```
```
[root@csi-operator-hitachi]# ./hvcsi-offline-bundle.sh -c -v v3.18.2

2026-06-05 09:12:13 - Determining required images for HSPC v3.18.2 on K8s ...
2026-06-05 09:12:13 - Found 9 unique images.
2026-06-05 09:12:13 - --- Copying images into bundle (digest-preserving) ---
2026-06-05 09:12:13 -   Copying registry.hitachivantara.com/hitachicsi-oci-oss/hspc-csi-driver:v3.18.2 -> registry.hitachivantara.com_hitachicsi-oci-oss_hspc-csi-driver_v3.18.2
...
2026-06-05 09:12:21 -   Copying registry.hitachivantara.com/hitachicsi-oci-oss/hspc-operator:v1.18.2 -> registry.hitachivantara.com_hitachicsi-oci-oss_hspc-operator_v1.18.2
2026-06-05 09:12:24 -   Copying registry.k8s.io/sig-storage/csi-attacher@sha256:5aaefc24f315b182233c8b6146077f8c32e274d864cb03c632206e78bd0302da -> registry.k8s.io_sig-storage_csi-attacher_sha256_5aaefc24f315b182233c8b6146077f8c32e274d864cb03c632206e78bd0302da
...
2026-06-05 09:12:59 - Copying installation files from /home/jperez/ocpjpai/csi-operator-offline-3.18.2-test/csi-operator-hitachi/hspc/v3.18.2...
2026-06-05 09:12:59 - Building final archive: hvcsi-hspc-v3.18.2-bundle.tar.gz
2026-06-05 09:14:02 - --- Bundle created successfully: hvcsi-hspc-v3.18.2-bundle.tar.gz ---

[root@csi-operator-hitachi]#

```

# Phase 2: Push images to private/local registry

## 1. Extract the offline bundle

First, transfer the created hspc bundle to the system that has access to the private/local registry and extract it. Use the following command to extract the bundle and navigate to the extracted folder:

```
tar -xvf hvcsi-hspc-v3.18.2-bundle.tar.gz
cd hvcsi-hspc-v3.18.2-bundle
```

Make sure to copy the script to this new system, assuming it is different from the system where the bundle was created, preference copy to the folder where the bundle was extracted.

## 2. Push images to the private/local registry

Use the following command to tag and push the container images to the private/local repository. Use the following cmd:

```
./hvcsi-offline-bundle.sh -p -r <registry>/<repository>
```

This command not only tags and pushes the images to the new repository, but it will also create a manifest file with the new image paths from the new registry. These files can be used to proceed to the final phase, which is the installation of HSPC using images from the private/local registry.

Here is one example. The output the previous cmd will look like this:

```
./hvcsi-offline-bundle.sh -p -r k8s-registry.scelab.local/hspc-offline

or (if the registry is self-signed or HTTP)

HSPC_INSECURE_REG=1 ./hvcsi-offline-bundle.sh -p -r k8s-registry.scelab.local/hspc-offline

```
```
[root@hvcsi-v3.18.2-bundle]# ./hvcsi-offline-bundle.sh -p -r k8s-registry.scelab.local/hspc-offline

2026-06-05 09:20:29 - --- Pushing images to 'k8s-registry.scelab.local/hspc-offline' (digest-preserving) ---
2026-06-05 09:20:29 -   Pushing registry.hitachivantara.com_hitachicsi-oci-oss_hspc-csi-driver_v3.18.2 -> k8s-registry.scelab.local/hspc-offline/hspc-csi-driver:v3.18.2
2026-06-05 09:20:32 -   Pushing registry.hitachivantara.com_hitachicsi-oci-oss_hspc-csi-telemetry-service_sha256_8ad63ea03d89dee48a1b8fe33698b69491438692c5a995f8e73c57e37af7652c -> k8s-registry.scelab.local/hspc-offline/hspc-csi-telemetry-service:bndl-8ad63ea03d89dee48a1b8fe33698b69491438692c5a995f8e73c57e37af
2026-06-05 09:20:33 -   Pushing registry.hitachivantara.com_hitachicsi-oci-oss_hspc-operator_v1.18.2 -> k8s-registry.scelab.local/hspc-offline/hspc-operator:v1.18.2
2026-06-05 09:20:34 -   Pushing registry.k8s.io_sig-storage_csi-attacher_sha256_5aaefc24f315b182233c8b6146077f8c32e274d864cb03c632206e78bd0302da -> k8s-registry.scelab.local/hspc-offline/csi-attacher:bndl-5aaefc24f315b182233c8b6146077f8c32e274d864cb03c632206e78bd0
2026-06-05 09:20:35 -   Pushing registry.k8s.io_sig-storage_csi-node-driver-registrar_sha256_5244abbe87e01b35adeb8bb13882a74785df0c0619f8325c9e950395c3f72a97 -> k8s-registry.scelab.local/hspc-offline/csi-node-driver-registrar:bndl-5244abbe87e01b35adeb8bb13882a74785df0c0619f8325c9e950395c3f
...
2026-06-05 09:20:37 - --- All images pushed successfully to 'k8s-registry.scelab.local/hspc-offline' ---
2026-06-05 09:20:37 - --- Updating manifest files with new registry ---
2026-06-05 09:20:37 - Creating offline operator manifest: hspc-operator-offline.yaml
2026-06-05 09:20:37 - Creating offline sample manifest: hspc-k8s1.32-offline.yaml
2026-06-05 09:20:37 - Creating offline sample manifest: hspc-k8s1.33-offline.yaml
2026-06-05 09:20:37 - Creating offline sample manifest: hspc-k8s1.34-offline.yaml
2026-06-05 09:20:37 - --- Manifest files updated successfully ---
2026-06-05 09:20:37 - Creating offline CRD file: hspc_v1_hspc_offline.yaml
2026-06-05 09:20:37 - Using images from: hspc-k8s1.34-offline.yaml
2026-06-05 09:20:37 - Offline CRD file created with updated image references

2026-06-05 09:20:37 - --- Proceed to installation step ---

2026-06-05 09:20:37 - --- Verifying digests (bundle dir vs pushed mirror) ---
2026-06-05 09:20:37 -     using: skopeo inspect --tls-verify=true <no authfile>
2026-06-05 09:20:38 -   OK    registry.hitachivantara.com/hitachicsi-oci-oss/hspc-csi-driver:v3.18.2 == k8s-registry.scelab.local/hspc-offline/hspc-csi-driver:v3.18.2 @ sha256:4442ecda0823ad855f2ae792ea39964b2c690cebe899645e0e3f887430bf84d0
2026-06-05 09:20:38 -   OK    registry.hitachivantara.com/hitachicsi-oci-oss/hspc-csi-telemetry-service@sha256:8ad63ea03d89dee48a1b8fe33698b69491438692c5a995f8e73c57e37af7652c == k8s-registry.scelab.local/hspc-offline/hspc-csi-telemetry-service:bndl-8ad63ea03d89dee48a1b8fe33698b69491438692c5a995f8e73c57e37af @ sha256:8ad63ea03d89dee48a1b8fe33698b69491438692c5a995f8e73c57e37af7652c
2026-06-05 09:20:38 -   OK    registry.hitachivantara.com/hitachicsi-oci-oss/hspc-operator:v1.18.2 == k8s-registry.scelab.local/hspc-offline/hspc-operator:v1.18.2 @ sha256:2b8c44e9e2ab78a60115071d4970dec55fefa4b3d8161b57a482a52eaaefbdea
...
2026-06-05 09:20:39 -   OK    registry.k8s.io/sig-storage/livenessprobe@sha256:57dba2ee519e49afacf899af7e265d977b02ec4c1f60c9b636ab0e575612dbfd == k8s-registry.scelab.local/hspc-offline/livenessprobe:bndl-57dba2ee519e49afacf899af7e265d977b02ec4c1f60c9b636ab0e57561 @ sha256:57dba2ee519e49afacf899af7e265d977b02ec4c1f60c9b636ab0e575612dbfd

2026-06-05 09:20:39 - --- Verification summary: 9/9 OK, 0 failed ---

[root@hvcsi-v3.18.2-bundle]#
```

# Phase 3: Installation of HV CSI on Kubernetes cluster

## Offline Installation procedure

This offline procedure works for either OpenShift or Kubernetes. To install Storage Plug-in for Containers, you can either follow standard procedure documented on the [**Storage Plug-in for Containers Installation and User Guide**](https://docs.hitachivantara.com), just skip the git clone step since this installation uses the updated manifest files that have updated to use the private/local registry.

The installation procedure is as follows:


## 1. For OpenShift clusters, HV CSI can be installed either from OperatorHub or directly from CLI (operator YAML or standalone sample YAMLs):

### 1.1 OpenShift - OperatorHub installation:
#### a. Before starting the installation, make sure to create the following two resources:

- ImageDigestMirrorSet / IDMS — for images referenced by digest
- ImageTagMirrorSet / ITMS — for images referenced by tag

**Note:** The IDMS and ITMS are required for OpenShift only. Change the mirrors to point to the new registry where the images were pushed in the previous step. The source should be the original image path, and the mirror should be the new image path on the private/local registry.

Here is one example of an IDMS (Image Digest Mirror Set) with the new registry:

```
cat <<'EOF' > hspc-offline-mirror.yaml
apiVersion: config.openshift.io/v1
kind: ImageDigestMirrorSet
metadata:
  name: hspc-offline-mirror
spec:
  imageDigestMirrors:
  - source: registry.hitachivantara.com/hitachicsi-oci-oss
    mirrors:
    - k8s-registry.scelab.local/hspc-offline
  - source: registry.k8s.io/sig-storage
    mirrors:
    - k8s-registry.scelab.local/hspc-offline
EOF

```

Here is one example of an ITMS (Image Tag Mirror Set) with the new registry:

```
cat <<'EOF' > hspc-offline-tag-mirror.yaml
apiVersion: config.openshift.io/v1
kind: ImageTagMirrorSet
metadata:
  name: hspc-offline-tag-mirror
spec:
  imageTagMirrors:
  - source: registry.hitachivantara.com/hitachicsi-oci-oss
    mirrors:
    - k8s-registry.scelab.local/hspc-offline
  - source: registry.k8s.io/sig-storage
    mirrors:
    - k8s-registry.scelab.local/hspc-offline
EOF

```


#### b. Apply both the IDMS and ITMS to the cluster:

```
oc apply -f hspc-offline-mirror.yaml
oc apply -f hspc-offline-tag-mirror.yaml
```

#### c. After applying the IDMS and ITMS, wait for Machine Config Operator (MCO) to complete the updates.

Applying an ImageDigestMirrorSet/ImageTagMirrorSet usually results in the Machine Config Operator rolling out updated node registry config, and that can cause node drains/reboots depending on the rendered MachineConfig change and OpenShift version/behavior.

For practical purposes: do not manually reboot anything. Let the MCO handle it and monitor the MCPs.

```
oc get mcp
```


#### d. Proceed with the installation of HV CSI from OperatorHub, follow standard process documented on the [**Storage Plug-in for Containers Installation and User Guide**](https://docs.hitachivantara.com).



### 1.2 OpenShift - CLI installation:

**Note:** Skip this if following the OperatorHub installation, since the OperatorHub installation can be used to install the Operator and then use the created CRD file to install HV CSI. This CLI installation is an alternative to the OperatorHub installation, but it is not required to do both.


## 2. For K8s clusters, install HV CSI from CLI (operator YAML or standalone sample YAMLs):

### 2.1. Create the namespace for the Operator, confirm that the namespace was created successfully for the Operator:

On the same folder, navigate to the operator folder

```
cd <hspc_version>/operator/

# kubectl create -f hspc-operator-namespace.yaml
```

### 2.2. Create the Operator using the manifest file hspc-operator-offline.yaml and confirm the Operator is running:

```
# kubectl create -f hspc-operator-offline.yaml

# kubectl get pods -n hspc-operator-system
```

### 2.3. Create a Storage Plug-in for Containers instance and confirm that READY is true. Use the manifest file called “hspc\_v1\_hspc\_offline.yaml” and confirm is running.

```
# kubectl apply -f hspc_v1_hspc_offline.yaml
```

Verify successful installation with the following commands:

```
# kubectl get hspc -n kube-system
NAME   READY   AGE
hspc   true    19h

# kubectl get pods -n kube-system
NAME                                 READY   STATUS    RESTARTS   AGE
hspc-csi-controller-54588756-9cjrk   6/6     Running   0          19h
hspc-csi-node-2h847                  2/2     Running   0          19h
hspc-csi-node-fnh99                  2/2     Running   0          19h
hspc-csi-node-gzrxb                  2/2     Running   0          19h

```

## (optional) Installation without operator:
### Create the required resources using the manifest file hspc-k8s<version>-offline.yaml, use the k8s version that corresponds to the target cluster kubernetes version, and confirm that all the pods are running:

```
# cd <hspc_version>/operator/
# kubectl apply -f spcnode.yaml
# kubectl apply -f hspc-k8s1.33-offline.yaml

# get pods -n kube-system
NAME                                   READY   STATUS    RESTARTS   AGE
hspc-csi-controller-6757bcfc47-bt9zp   6/6     Running   0          11h
hspc-csi-node-rg7bx                    2/2     Running   0          11h
hspc-csi-node-rg9jf                    2/2     Running   0          11h
hspc-csi-node-x55hz                    2/2     Running   0          11h

```


## Note: if images for HRPC and/or HSPP were downloaded, follow same process to push those images to the private registry. Then procceed with standard installation procedure depending if it is HRPC or HSPP plugin.


For more details see :
- [**Storage Plug-in for Containers Installation and User Guide**](https://docs.hitachivantara.com)**.**
- [**Replication Plug-in for Containers Configuration Guide**](https://docs.hitachivantara.com)**.**
- [**Storage Plug-in for Prometheus Quick Reference Guide**](https://docs.hitachivantara.com)**.**
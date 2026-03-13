# Hitachi CSI Log Bundle Collector

A comprehensive log collection tool for Hitachi CSI drivers running in Kubernetes or OpenShift environments. This tool automatically discovers your HSPC installation, collects logs from all our CSI's pods and containers, gathers cluster context, and packages everything into a convenient bundle for troubleshooting and support.

## Features

- 🔍 **Auto-Discovery**: Automatically detects HSPC namespace and resources
- 🎯 **Platform-Aware**: Detects OpenShift, Kubernetes, k3s, Rancher, and RKE2 clusters
- 📦 **Complete Collection**: Gathers logs from all containers in each pod
- 🏗️ **Full Context**: Captures cluster version, node info, manifests, events, and resource descriptions
- 🔄 **Multi-Cluster Support**: Collect logs from both primary and secondary clusters for DR-Operator environments
- 🛡️ **DR-Operator Integration**: Automatically detects and collects DR-Operator logs and Custom Resources
- 🗜️ **Auto-Compression**: Creates zip archives automatically (optional)
- 🛡️ **Robust**: Handles timeouts, errors gracefully, and provides fallback mechanisms
- 💻 **Cross-Platform**: Both Bash and PowerShell versions available
- 🔬 **Must-Gather Integration**: Optionally run `oc adm must-gather` for Migration Toolkit for Containers (MTC) and/or Migration Toolkit for Virtualization (MTV)
- 📊 **Advanced Log Viewer**: HTML-based viewer with filtering, search, DR Policies management, and multi-cluster comparison

## Requirements

### Bash Script (`get_hitachicsilogs.sh`)

- Linux or macOS
- Bash 4.0+
- `kubectl` or `oc` binary (can be local or in PATH)
- Valid kubeconfig with access to the cluster
- Optional: `zip` or `python3` for compression

### PowerShell Script (`get_hitachicsilogs.ps1`)

- Windows, Linux, or macOS
- PowerShell 5.1+ or PowerShell Core 7+
- `kubectl.exe`/`kubectl` or `oc.exe`/`oc` binary
- Valid kubeconfig with access to the cluster

## Installation

1. Download the appropriate script for your platform:
   ```bash
   # Clone the repository
   git clone https://github.com/hitachi-vantara/csi-operator-hitachi.git
   cd csi-operator-hitachi/log_collector/hspc/Hitachi-CSI-Log-Bundle
   ```

2. Make the bash script executable (Linux/macOS):
   ```bash
   chmod +x get_hitachicsilogs.sh
   ```

3. (Optional) Place `kubectl` or `oc` binary in the same directory, or ensure it's in your PATH



### Bash Script Examples

## Usage

**Basic usage** (uses default kubeconfig):
```bash
./get_hitachicsilogs.sh
```

**With specific kubeconfig**:
```bash
./get_hitachicsilogs.sh --kubeconfig /path/to/kubeconfig
```

**Force OpenShift oc binary**:
```bash
./get_hitachicsilogs.sh --oc
```

**Specify namespace** (if auto-detection fails):
```bash
./get_hitachicsilogs.sh -n hspc-system
```

**Custom output directory**:
```bash
./get_hitachicsilogs.sh -d /tmp/my-logs
```

**Skip compression**:
```bash
./get_hitachicsilogs.sh --no-compress
```

**Multi-cluster collection** (DR-Operator environments):
```bash
./get_hitachicsilogs.sh --kubeconfig-primary /path/to/primary-kubeconfig --kubeconfig-secondary /path/to/secondary-kubeconfig
```

**Run MTC must-gather** (Migration Toolkit for Containers; OpenShift + oc required):
```bash
./get_hitachicsilogs.sh --mtc
```

**Run MTV must-gather** (Migration Toolkit for Virtualization; OpenShift + oc required):
```bash
./get_hitachicsilogs.sh --mtv
```

**Run both must-gathers together**:
```bash
./get_hitachicsilogs.sh --mtc --mtv
```

**View help**:
```bash
./get_hitachicsilogs.sh -h
# or
./get_hitachicsilogs.sh --help
```

**Combined options**:
```bash
./get_hitachicsilogs.sh --kubeconfig ./kubeconfig --oc -n hspc-system
```
##### Note: If error such as below is seen
```
[root@ocp-jumpvm ~]#./get_hitachicsilogs.sh
/usr/bin/env: ‘bash\r’: No such file or directory
/usr/bin/env: use -[v]S to pass options in shebang lines

```
Fix with 
```
sed -i 's/\r$//' get_hitachicsilogs.sh

```

### PowerShell Script Examples

**Basic usage**:
```powershell
.\get_hitachicsilogs.ps1
```

**With specific kubeconfig**:
```powershell
.\get_hitachicsilogs.ps1 -Kubeconfig C:\path\to\kubeconfig
```

**Force OpenShift oc binary**:
```powershell
.\get_hitachicsilogs.ps1 -Oc
```

**Specify namespace**:
```powershell
.\get_hitachicsilogs.ps1 -Namespace hspc-system
```

**Custom output directory**:
```powershell
.\get_hitachicsilogs.ps1 -Dir C:\temp\my-logs
```

**Skip compression**:
```powershell
.\get_hitachicsilogs.ps1 -NoCompress
```

**Multi-cluster collection** (DR-Operator environments):
```powershell
.\get_hitachicsilogs.ps1 -KubeconfigPrimary C:\path\to\primary-kubeconfig -KubeconfigSecondary C:\path\to\secondary-kubeconfig
```

**Run MTC must-gather** (Migration Toolkit for Containers; OpenShift + oc required):
```powershell
.\get_hitachicsilogs.ps1 -Mtc
```

**Run MTV must-gather** (Migration Toolkit for Virtualization; OpenShift + oc required):
```powershell
.\get_hitachicsilogs.ps1 -Mtv
```

**Run both must-gathers together**:
```powershell
.\get_hitachicsilogs.ps1 -Mtc -Mtv
```

**View help**:
```powershell
.\get_hitachicsilogs.ps1 -h
# or
.\get_hitachicsilogs.ps1 -Help
# or
Get-Help .\get_hitachicsilogs.ps1
```

**Combined options**:
```powershell
.\get_hitachicsilogs.ps1 -Kubeconfig .\kubeconfig -Oc -Namespace hspc-system -Dir .\logs
```

## Command-Line Options

### Bash Script

| Option | Description | Default |
|--------|-------------|---------|
| `--kubeconfig <file>` | Path to kubeconfig file | Uses `$KUBECONFIG` or default |
| `--oc` | Force use of OpenShift `oc` binary | Auto-detect |
| `-n, --namespace <ns>` | Target namespace | Auto-discover from HSPC CR |
| `-d, --dir <path>` | Output directory | `./hspc-csi-logs-YYYYMMDD-HHMMSS` |
| `--kubeconfig-primary <file>` | Path to primary cluster kubeconfig (for multi-cluster) | - |
| `--kubeconfig-secondary <file>` | Path to secondary cluster kubeconfig (for multi-cluster) | - |
| `--no-compress` | Skip zip creation | Creates zip |
| `--mtc` | Run `oc adm must-gather` for Migration Toolkit for Containers (OpenShift + oc required) | Disabled |
| `--mtv` | Run `oc adm must-gather` for Migration Toolkit for Virtualization (OpenShift + oc required) | Disabled |
| `-h, --help` | Show concise help message | - |

### PowerShell Script

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-Kubeconfig <file>` | Path to kubeconfig file | Uses default kubeconfig |
| `-Oc` | Force use of OpenShift `oc` binary | Auto-detect |
| `-Namespace <ns>` | Target namespace | Auto-discover from HSPC CR |
| `-Dir <path>` | Output directory | `.\hspc-csi-logs-YYYYMMDD-HHMMSS` |
| `-KubeconfigPrimary <file>` | Path to primary cluster kubeconfig (for multi-cluster) | - |
| `-KubeconfigSecondary <file>` | Path to secondary cluster kubeconfig (for multi-cluster) | - |
| `-NoCompress` | Skip zip creation | Creates zip |
| `-Mtc` | Run `oc adm must-gather` for Migration Toolkit for Containers (OpenShift + oc required) | Disabled |
| `-Mtv` | Run `oc adm must-gather` for Migration Toolkit for Virtualization (OpenShift + oc required) | Disabled |
| `-Help, -h` | Show concise help message | - |

## Output

The script creates a directory (and optionally a zip file) containing:

### Log Files
- `<pod-name>_<container-name>.log` - Logs from each container in each pod
- Logs are limited to 200MB per container to prevent excessive collection times

## Log Viewer

Download `Hitachi-CSI-log-Bundle-Viewer.html` from this repository and open it locally in any modern browser.

**Note**: The viewer supports both ZIP files and folders. Drag and drop ZIP files directly, or use the browse buttons to select either ZIP files or folders.

### Viewer Features

- **Multi-Cluster Support**: View and filter logs, health data, and configuration by cluster when using multi-cluster bundles
- **DR Policies Management**: Dedicated tab for viewing and managing DR Policies (automatically appears when DR-Operator CRDs are detected)
  - Side-by-side comparison of matching DR Policies across clusters
  - View associated replications with formatted and YAML views
  - Comprehensive display of all DRPolicy spec and status fields
  - **Enhanced Replication Display**: Full visibility into all Replication resource fields including:
    - Spec fields: `replicationType`, `desiredPairState`, `replicationAttribute`, `storageClassName`
    - Status fields: `volumeStatus`, `deviceGroupName`, `copyGroupName`, `copyPairName`, and all replication pair details
    - Color-coded status indicators and visual highlighting for easy identification
  - Intelligent alerts for replication issues (e.g., replications missing on one cluster)
  - Quick log filtering by DRPolicy name
- **Advanced Filtering**: Filter logs by level, category, time range, and search terms
- **Health & Diagnostics**: Pod health overview, node health, and error categorization
- **Configuration Analysis**: View storage classes, port usage, and cluster resources with diff highlighting for multi-cluster comparisons
- **Platform Detection**: Accurate identification and display of OpenShift, Kubernetes, k3s, Rancher, and RKE2 clusters

### Cluster Context File (`cluster-context.txt`)
Contains comprehensive cluster and application information:

1. **Cluster Version**: Kubernetes/OpenShift version details
2. **Platform Detection**: Identifies if running on Kubernetes or OpenShift
3. **Node Information**: OS, kernel, architecture, container runtime for all nodes
4. **HSPC Custom Resource**: Full YAML of HSPC CR configuration
5. **Deployments**: All deployment manifests in the namespace
6. **DaemonSets**: All DaemonSet manifests in the namespace
7. **ReplicaSets**: All ReplicaSet manifests in the namespace
8. **Pod Ownership Chain**: Shows which Deployments/DaemonSets own which pods
9. **Pod Descriptions**: Detailed `kubectl describe` output for each pod
10. **Recent Events**: Last 100 events in the namespace
11. **DR-Operator Resources** (when detected): LocalVolume, RemoteVolume, Replication, and DRPolicy Custom Resources

### Must-Gather Output (optional)
When `--mtc` or `--mtv` (Bash) / `-Mtc` or `-Mtv` (PowerShell) are specified:
- `must-gather-mtc/` - Output from `oc adm must-gather` for Migration Toolkit for Containers
- `must-gather-mtv/` - Output from `oc adm must-gather` for Migration Toolkit for Virtualization

> **Note**: Must-gather requires OpenShift and the `oc` binary. If either is not detected, the step is skipped with a warning and collection continues normally. Must-gather can take up to 30 minutes per run.

### Error Tracking
- `errors.log` - Any errors encountered during collection
- `failed-pods.txt` - List of pods/containers that failed to collect

## How It Works

1. **Binary Detection**: Looks for `kubectl` or `oc` in current directory, then PATH
2. **Platform Detection**: Checks for OpenShift-specific API resources
3. **CRD Verification**: Confirms `hspcs.csi.hitachi.com` CRD exists
4. **Namespace Discovery**: Finds namespace containing HSPC custom resources
5. **Pod Discovery**: Identifies all pods using the `hspc-csi-sa` service account
6. **Log Collection**: Collects logs from all containers in each discovered pod
7. **Context Gathering**: Captures cluster state, manifests, and event history
8. **Compression**: Packages everything into a zip file

## Troubleshooting

### "kubectl not found"
- Ensure `kubectl` is in your PATH or place the binary in the script directory
- On Windows, ensure `kubectl.exe` is available

### "CRD hspcs.csi.hitachi.com not found"
- Verify you're connected to the correct cluster
- Check that HSPC CSI driver is installed: `kubectl get crd`
- Verify your kubeconfig has proper authentication

### "No HSPC pods found"
- Check that pods are running: `kubectl get pods -A | grep hspc`
- Verify the service account name matches: `hspc-csi-sa`
- Try specifying the namespace manually with `-n` or `-Namespace`

### Collection is slow
- Check network connectivity to the cluster
- Some pods may have very large logs (limited to 200MB per container)
- You can cancel the collection at any time with Ctrl+C - the script will gracefully stop and clean up

### Cancellation
- Press **Ctrl+C** at any time to cancel the collection
- The script will stop processing new pods/containers and terminate any running kubectl/oc commands
- Partial results will be saved in the output directory
- Works on both Bash and PowerShell scripts

### Must-gather is skipped
- Ensure you are connected to an OpenShift cluster (not plain Kubernetes)
- Ensure the `oc` binary is available in your PATH or script directory
- Must-gather uses `oc adm must-gather` which is not available via `kubectl`

### Permission denied errors
- Ensure your kubeconfig has appropriate RBAC permissions
- You need at least read access to pods, logs, events, and CRDs in the target namespace
- Try running with cluster-admin privileges if available

## Support

For questions, or contributions:
- For Hitachi CSI driver support, contact your Hitachi Vantara representative

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.


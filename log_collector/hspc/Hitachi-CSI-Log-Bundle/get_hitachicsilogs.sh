#!/usr/bin/env bash
# =============================================================================
# Hitachi HSPC CSI Driver Log Bundle Collector v1.6.4
# - --kubeconfig is completely optional (uses default or $KUBECONFIG if present)
# - Full OpenShift auto-detect + smart fallback to ./oc
# - All manifests with status (deployments, daemonsets, replicasets)
# - Collects logs from ALL containers in each pod
# - Pod ownership chain
# - Events, describes, version, HSPC CR
# - Python zip fallback (always works)
# - Optional MTC/MTV must-gather (--mtc / --mtv; OpenShift + oc required)
# =============================================================================

set -euo pipefail

# Script version
SCRIPT_VERSION="1.6.4-sh"

# Cancellation handling
CANCELLED=false
CHILD_PIDS=()

# Signal handler for graceful cancellation
cleanup_and_exit() {
    local signal_name="$1"
    CANCELLED=true
    log ""
    log "Cancellation requested (${signal_name}) - cleaning up..."
    
    # Kill any tracked child PIDs
    if [[ ${#CHILD_PIDS[@]} -gt 0 ]]; then
        for pid in "${CHILD_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -TERM "$pid" 2>/dev/null || true
            fi
        done
        sleep 1
        for pid in "${CHILD_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill -KILL "$pid" 2>/dev/null || true
            fi
        done
    fi
    
    # Kill any remaining child processes (kubectl/oc, timeout, etc.) spawned by this script
    # This catches processes that weren't tracked in CHILD_PIDS
    pkill -P $$ -TERM 2>/dev/null || true
    sleep 1
    pkill -P $$ -KILL 2>/dev/null || true
    
    log "Script cancelled. Partial results may be in: $OUTPUT_DIR"
    exit 130  # Standard exit code for SIGINT
}

# Trap signals for cancellation
trap 'cleanup_and_exit "SIGINT"' INT
trap 'cleanup_and_exit "SIGTERM"' TERM

# Helper functions
log() { echo "[$(date +'%H:%M:%S')] $*"; }
die() { echo "ERROR: $*"; exit 1; }

# Prefer local binaries if present, otherwise fall back to system PATH
KUBECTL_CMD=$(command -v ./kubectl 2>/dev/null || command -v kubectl || echo "")
OC_CMD=$(command -v ./oc 2>/dev/null || command -v oc || echo "")

# Ensure at least one command is available (prefer kubectl, fall back to oc)
if [[ -n "$KUBECTL_CMD" ]]; then
    CMD="$KUBECTL_CMD"
elif [[ -n "$OC_CMD" ]]; then
    CMD="$OC_CMD"
    log "kubectl not found, using oc command"
else
    die "Neither kubectl nor oc found. Please install kubectl/oc or configure PATH with location, or place it in the current directory."
fi

KUBECONFIG_PRIMARY=""
KUBECONFIG_SECONDARY=""
KUBECONFIG_ARG=""  # For backward compatibility
NAMESPACE=""
OUTPUT_DIR="./hspc-csi-logs-$(date +%Y%m%d-%H%M%S)"
COMPRESS=true
TIMEOUT_SEC=300
MUST_GATHER_TIMEOUT_SEC=1800
COLLECT_MTC=false
COLLECT_MTV=false

CRD_NAME="hspcs.csi.hitachi.com"
KIND="HSPC"
TELEMETRY_CR="cluster-telemetry"
SERVICE_ACCOUNT="hspc-csi-sa"
REPLICATION_NAMESPACE="hspc-replication-operator-system"

# KUBE function that uses current KUBECONFIG_ARG
KUBE() {
    if [[ -n "$KUBECONFIG_ARG" ]]; then
        "$CMD" $KUBECONFIG_ARG "$@"
    else
        "$CMD" "$@"
    fi
}

# KUBE function with explicit kubeconfig
KUBE_WITH_CONFIG() {
    local kubeconfig="$1"
    shift
    if [[ -n "$kubeconfig" ]]; then
        "$CMD" --kubeconfig="$kubeconfig" "$@"
    else
        "$CMD" "$@"
    fi
}

detect_openshift() {
    # Check if any of these API groups return actual resources (more than just header line)
    # kubectl api-resources returns a header line even when no resources exist, so check for >1 line
    local line_count
    line_count=$(KUBE api-resources --api-group=route.openshift.io 2>/dev/null | wc -l)
    [[ $line_count -gt 1 ]] && return 0
    
    line_count=$(KUBE api-resources --api-group=security.openshift.io 2>/dev/null | wc -l)
    [[ $line_count -gt 1 ]] && return 0
    
    line_count=$(KUBE api-resources --api-group=console.openshift.io 2>/dev/null | wc -l)
    [[ $line_count -gt 1 ]] && return 0
    
    return 1
}

detect_dr_operator() {
    # Check for CRDs in group hspc.hitachi.com
    # Required: LocalVolume, RemoteVolume, Replication
    # Optional: DRPolicy
    local required_crds=("localvolumes.hspc.hitachi.com" "remotevolumes.hspc.hitachi.com" "replications.hspc.hitachi.com")
    local optional_crds=("drpolicies.hspc.hitachi.com")
    local found_required=0
    
    for crd in "${required_crds[@]}"; do
        if KUBE get crd "$crd" >/dev/null 2>&1; then
            ((found_required++))
        fi
    done
    
    # All required CRDs must be present
    if [[ $found_required -eq ${#required_crds[@]} ]]; then
        # Check optional DRPolicy (log but don't require)
        if KUBE get crd "${optional_crds[0]}" >/dev/null 2>&1; then
            log "DR-Operator detected (with DRPolicy)"
        else
            log "DR-Operator detected (DRPolicy not found)"
        fi
        return 0
    fi
    
    return 1
}

get_pods() {
    local kubeconfig="$1"
    local namespace="$2"
    KUBE_WITH_CONFIG "$kubeconfig" get pods -n "$namespace" \
        -o jsonpath='{range .items[?(@.spec.serviceAccountName=="'"$SERVICE_ACCOUNT"'")]}{.metadata.name}{"\n"}{end}'
}

get_operator_pods() {
    local kubeconfig="$1"
    local namespace="$2"
    KUBE_WITH_CONFIG "$kubeconfig" get pods -n "$namespace" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null | grep -E "hspc-operator-controller-manager"
}

get_all_pods() {
    local kubeconfig="$1"
    local namespace="$2"
    KUBE_WITH_CONFIG "$kubeconfig" get pods -n "$namespace" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}'
}

collect_pod_logs() {
    local kubeconfig="$1"
    local pod="$2"
    local namespace="$3"
    local output_dir="$4"
    
    # Check for cancellation
    if [[ "$CANCELLED" == "true" ]]; then
        return 1
    fi
    
    log "Collecting logs from pod $pod ..."
    
    # Get all containers in the pod
    local containers
    containers=$(timeout "$TIMEOUT_SEC" "$CMD" --kubeconfig="$kubeconfig" get pod "$pod" -n "$namespace" \
        -o jsonpath='{.spec.containers[*].name}' 2>>"$output_dir/errors.log" || echo "")
    
    # Check for cancellation after getting containers
    if [[ "$CANCELLED" == "true" ]]; then
        return 1
    fi
    
    if [[ -z "$containers" ]]; then
        echo "$pod (no containers found)" >> "$output_dir/failed-pods.txt"
        log "FAILED $pod - no containers found"
        return
    fi
    
    # Collect logs from each container
    for container in $containers; do
        # Check for cancellation in loop
        if [[ "$CANCELLED" == "true" ]]; then
            return 1
        fi
        
        local file="$output_dir/${pod}_${container}.log"
        if timeout "$TIMEOUT_SEC" "$CMD" --kubeconfig="$kubeconfig" logs "$pod" -n "$namespace" -c "$container" \
            --limit-bytes=200000000 > "$file" 2>>"$output_dir/errors.log"; then
            log "  ✓ Saved $pod/$container"
        else
            # Check if failure was due to cancellation
            if [[ "$CANCELLED" == "true" ]]; then
                return 1
            fi
            echo "$pod/$container" >> "$output_dir/failed-pods.txt"
            log "  ✗ FAILED $pod/$container - see errors.log"
        fi
    done
}

collect_custom_resources() {
    local kubeconfig="$1"
    # Write to stdout so it gets captured by the subshell's redirection
    
    # Collect LocalVolumes
    echo -e "\n=== LocalVolumes ==="
    if KUBE_WITH_CONFIG "$kubeconfig" get localvolume --all-namespaces -o yaml 2>/dev/null; then
        : # Success - output goes to stdout
    else
        echo "No LocalVolumes found"
    fi
    
    # Collect RemoteVolumes
    echo -e "\n=== RemoteVolumes ==="
    if KUBE_WITH_CONFIG "$kubeconfig" get remotevolume --all-namespaces -o yaml 2>/dev/null; then
        : # Success
    else
        echo "No RemoteVolumes found"
    fi
    
    # Collect Replications
    echo -e "\n=== Replications ==="
    if KUBE_WITH_CONFIG "$kubeconfig" get replication --all-namespaces -o yaml 2>/dev/null; then
        : # Success
    else
        echo "No Replications found"
    fi
    
    # Collect DRPolicies (optional)
    echo -e "\n=== DRPolicies ==="
    if KUBE_WITH_CONFIG "$kubeconfig" get drpolicy --all-namespaces -o yaml 2>/dev/null; then
        : # Success
    else
        echo "No DRPolicies found"
    fi
    
    # Collect ReplicationGroups
    echo -e "\n=== ReplicationGroups ==="
    if KUBE_WITH_CONFIG "$kubeconfig" get replicationgroup --all-namespaces -o yaml 2>/dev/null; then
        : # Success
    else
        echo "No ReplicationGroups found"
    fi
}

collect_must_gather() {
    local kubeconfig="$1"
    local cluster_output_dir="$2"
    local tool="$3"    # "mtc" or "mtv"
    local image="$4"

    # Require oc (must-gather is an oc adm command, not available in kubectl)
    if [[ -z "$OC_CMD" ]]; then
        log "Skipping $tool must-gather: oc command not available"
        return 0
    fi

    # Require OpenShift (re-use the route.openshift.io API group check)
    local line_count
    line_count=$(KUBE_WITH_CONFIG "$kubeconfig" api-resources --api-group=route.openshift.io 2>/dev/null | wc -l)
    if [[ $line_count -le 1 ]]; then
        log "Skipping $tool must-gather: OpenShift not detected on this cluster"
        return 0
    fi

    local dest_dir="$cluster_output_dir/must-gather-${tool}"
    mkdir -p "$dest_dir"

    log "Running $tool must-gather (this may take up to 30 minutes)..."

    local oc_kubeconfig_arg=()
    if [[ -n "$kubeconfig" ]]; then
        oc_kubeconfig_arg=("--kubeconfig=$kubeconfig")
    fi

    if timeout "$MUST_GATHER_TIMEOUT_SEC" "$OC_CMD" "${oc_kubeconfig_arg[@]}" adm must-gather \
        --image="$image" \
        --dest-dir="$dest_dir" \
        2>>"$cluster_output_dir/errors.log"; then
        log "  ✓ $tool must-gather saved to: $dest_dir"
    else
        if [[ "$CANCELLED" == "true" ]]; then
            return 1
        fi
        log "  ✗ $tool must-gather failed - see errors.log"
    fi
}

collect_from_cluster() {
    local kubeconfig="$1"
    local cluster_name="$2"
    local cluster_output_dir="$OUTPUT_DIR/$cluster_name"
    local temp_kubeconfig_arg=""
    
    # Check for cancellation at start
    if [[ "$CANCELLED" == "true" ]]; then
        return 1
    fi
    
    if [[ -n "$kubeconfig" ]]; then
        temp_kubeconfig_arg="--kubeconfig=$kubeconfig"
    fi
    
    log "=== Collecting from $cluster_name cluster ==="
    
    mkdir -p "$cluster_output_dir"
    
    # Temporarily set KUBECONFIG_ARG for this cluster
    local saved_kubeconfig_arg="$KUBECONFIG_ARG"
    KUBECONFIG_ARG="$temp_kubeconfig_arg"
    
    # Detect OpenShift and switch command if needed
    local cluster_cmd="$CMD"
    if [[ "$cluster_cmd" == "$KUBECTL_CMD" ]]; then
        # Test OpenShift with this cluster's kubeconfig
        local line_count
        line_count=$(KUBE_WITH_CONFIG "$kubeconfig" api-resources --api-group=route.openshift.io 2>/dev/null | wc -l)
        if [[ $line_count -gt 1 ]] && [[ -n "$OC_CMD" ]]; then
            cluster_cmd="$OC_CMD"
            log "OpenShift detected on $cluster_name → using oc"
        fi
    fi
    
    # Check for HSPC CRD
    if ! KUBE_WITH_CONFIG "$kubeconfig" get crd "$CRD_NAME" >/dev/null 2>&1; then
        if [[ "$cluster_cmd" == "$KUBECTL_CMD" ]] && [[ -n "$OC_CMD" ]]; then
            cluster_cmd="$OC_CMD"
            log "CRD not visible with kubectl on $cluster_name → forcing oc"
        fi
    fi
    
    # Initialize PODS array (may be empty if no pods found)
    local PODS=()
    local cluster_namespace=""
    
    # Check for HSPC CRD and discover namespace
    if KUBE_WITH_CONFIG "$kubeconfig" get crd "$CRD_NAME" >/dev/null 2>&1; then
        # Discover namespace
        cluster_namespace="$NAMESPACE"
        if [[ -z "$cluster_namespace" ]]; then
            cluster_namespace=$(KUBE_WITH_CONFIG "$kubeconfig" get "$KIND" --all-namespaces -o jsonpath='{.items[0].metadata.namespace}' 2>/dev/null)
        fi
        
        if [[ -n "$cluster_namespace" ]]; then
            log "HSPC namespace on $cluster_name: $cluster_namespace"
        else
            log "WARNING: No HSPC CR found on $cluster_name - will collect cluster info only"
        fi
    else
        log "WARNING: CRD $CRD_NAME not found on $cluster_name - will collect cluster info only"
    fi
    
    # Collect HSPC pod logs (only if namespace was discovered)
    if [[ -n "$cluster_namespace" ]]; then
        mapfile -t PODS < <(get_pods "$kubeconfig" "$cluster_namespace" 2>/dev/null || true)
        if [[ ${#PODS[@]} -gt 0 ]]; then
            log "Found ${#PODS[@]} HSPC pods on $cluster_name: ${PODS[*]}"
            log "Collecting HSPC logs..."
            for pod in "${PODS[@]}"; do
                if [[ "$CANCELLED" == "true" ]]; then
                    return 1
                fi
                collect_pod_logs "$kubeconfig" "$pod" "$cluster_namespace" "$cluster_output_dir"
            done
        else
            log "No HSPC pods found on $cluster_name"
        fi
        
        # Collect HSPC Operator logs (hspc-operator-controller-manager)
        mapfile -t OPERATOR_PODS < <(get_operator_pods "$kubeconfig" "$cluster_namespace" 2>/dev/null || true)
        if [[ ${#OPERATOR_PODS[@]} -gt 0 ]]; then
            log "Found ${#OPERATOR_PODS[@]} HSPC Operator pods on $cluster_name: ${OPERATOR_PODS[*]}"
            log "Collecting HSPC Operator logs..."
            for pod in "${OPERATOR_PODS[@]}"; do
                if [[ "$CANCELLED" == "true" ]]; then
                    return 1
                fi
                collect_pod_logs "$kubeconfig" "$pod" "$cluster_namespace" "$cluster_output_dir"
            done
        else
            log "No HSPC Operator pods found on $cluster_name"
        fi
    fi
    
    # Check for DR-Operator
    local dr_operator_detected=false
    local required_crds=("localvolumes.hspc.hitachi.com" "remotevolumes.hspc.hitachi.com" "replications.hspc.hitachi.com")
    local found_required=0
    
    for crd in "${required_crds[@]}"; do
        if KUBE_WITH_CONFIG "$kubeconfig" get crd "$crd" >/dev/null 2>&1; then
            ((found_required++))
        fi
    done
    
    if [[ $found_required -eq ${#required_crds[@]} ]]; then
        dr_operator_detected=true
        log "DR-Operator detected on $cluster_name"
        
        # Collect replication operator logs
        if KUBE_WITH_CONFIG "$kubeconfig" get namespace "$REPLICATION_NAMESPACE" >/dev/null 2>&1; then
            log "Collecting logs from $REPLICATION_NAMESPACE namespace..."
            local rep_output_dir="$cluster_output_dir/$REPLICATION_NAMESPACE"
            mkdir -p "$rep_output_dir"
            
            mapfile -t REP_PODS < <(get_all_pods "$kubeconfig" "$REPLICATION_NAMESPACE")
            if [[ ${#REP_PODS[@]} -gt 0 ]]; then
                log "Found ${#REP_PODS[@]} pods in $REPLICATION_NAMESPACE"
                for pod in "${REP_PODS[@]}"; do
                    if [[ "$CANCELLED" == "true" ]]; then
                        return 1
                    fi
                    collect_pod_logs "$kubeconfig" "$pod" "$REPLICATION_NAMESPACE" "$rep_output_dir"
                done
            else
                log "No pods found in $REPLICATION_NAMESPACE"
            fi
        else
            log "Namespace $REPLICATION_NAMESPACE not found on $cluster_name"
        fi
    fi
    
    # Extract DR operator and HRPC versions from deployments (if DR operator detected)
    local dr_operator_version=""
    local hrpc_version=""
    if [[ "$dr_operator_detected" == "true" ]] && KUBE_WITH_CONFIG "$kubeconfig" get namespace "$REPLICATION_NAMESPACE" >/dev/null 2>&1; then
        # Get all deployments in the replication operator namespace
        local deployments_yaml
        deployments_yaml=$(KUBE_WITH_CONFIG "$kubeconfig" get deploy -n "$REPLICATION_NAMESPACE" -o yaml 2>/dev/null)
        
        if [[ -n "$deployments_yaml" ]]; then
            # Extract DR operator version (look for hv-dr-operator image)
            local dr_image
            dr_image=$(echo "$deployments_yaml" | grep -E "image:\s*.*hv-dr-operator:" | head -1 | sed -E 's/.*image:\s*[^:]*:([^[:space:]]+).*/\1/' | tr -d '"' | tr -d "'")
            if [[ -n "$dr_image" ]]; then
                dr_operator_version="$dr_image"
                log "DR-Operator version detected: $dr_operator_version"
            fi
            
            # Extract HRPC version (look for hspc-replication-operator image)
            local hrpc_image
            hrpc_image=$(echo "$deployments_yaml" | grep -E "image:\s*.*hspc-replication-operator:" | head -1 | sed -E 's/.*image:\s*[^:]*:([^[:space:]]+).*/\1/' | tr -d '"' | tr -d "'")
            if [[ -n "$hrpc_image" ]]; then
                hrpc_version="$hrpc_image"
                log "HRPC version detected: $hrpc_version"
            fi
        fi
    fi
    
    # Generate cluster context (always, even if there were errors)
    local context_file="$cluster_output_dir/cluster-context.txt"
    log "Generating cluster-context.txt for $cluster_name..."
    
    # Helper function to run version command with the appropriate tool (oc or kubectl)
    local version_cmd
    version_cmd() {
        if [[ -n "$kubeconfig" ]]; then
            "$cluster_cmd" --kubeconfig="$kubeconfig" "$@"
        else
            "$cluster_cmd" "$@"
        fi
    }
    
    # Use a subshell with set +e to prevent early exit on errors
    (
        set +e  # Don't exit on errors in this subshell
        echo "=== Log Collection Script Version ==="
        echo "Script Version: $SCRIPT_VERSION"
        echo "Collection Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
        echo "Cluster: $cluster_name"
        
        echo -e "\n=== Cluster Version ==="
        version_cmd version 2>>"$cluster_output_dir/errors.log"
        
        echo -e "\n=== Orchestration Platform ==="
        local line_count
        line_count=$(KUBE_WITH_CONFIG "$kubeconfig" api-resources --api-group=route.openshift.io 2>/dev/null | wc -l)
        if [[ $line_count -gt 1 ]]; then
            echo "Platform: OpenShift"
            # Output full JSON (like PowerShell script) to preserve structure and get correct OpenShift version
            version_cmd version -o json 2>/dev/null || true
        else
            echo "Platform: Kubernetes"
        fi
        
        echo -e "\n=== Node OS & Runtime Information ==="
        KUBE_WITH_CONFIG "$kubeconfig" get nodes -o wide 2>>"$cluster_output_dir/errors.log"
        echo -e "\n--- Detailed Node Info ---"
        KUBE_WITH_CONFIG "$kubeconfig" get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}  OS: {.status.nodeInfo.osImage}{"\n"}  Kernel: {.status.nodeInfo.kernelVersion}{"\n"}  Architecture: {.status.nodeInfo.architecture}{"\n"}  Container Runtime: {.status.nodeInfo.containerRuntimeVersion}{"\n"}  Kubelet: {.status.nodeInfo.kubeletVersion}{"\n"}{"\n"}{end}' 2>>"$cluster_output_dir/errors.log"
        
        if [[ -n "$cluster_namespace" ]]; then
            echo -e "\n=== HSPC CR ==="
            KUBE_WITH_CONFIG "$kubeconfig" get hspc -n "$cluster_namespace" -o yaml 2>/dev/null || echo "No HSPC CR found"
			
			# ---------------------------------------------------------
            # TELEMETRY CR COLLECTION (ADDED SECTION)
            # Telemetry CR exists only after HSPC CR installation
            # ---------------------------------------------------------

            echo -e "\n=== Telemetry CR ==="

            if KUBE_WITH_CONFIG "$kubeconfig" get crd telemetries.csi.hitachi.com >/dev/null 2>&1; then
                if ! KUBE_WITH_CONFIG "$kubeconfig" get telemetry cluster-telemetry -n "$cluster_namespace" -o yaml 2>/dev/null; then
                    echo "Telemetry CR not found"
                fi
            else
                echo "Telemetry CRD not installed"
            fi
            
            echo -e "\n=== Deployments ==="
            KUBE_WITH_CONFIG "$kubeconfig" get deploy -n "$cluster_namespace" -o yaml 2>/dev/null || echo "No deployments found"
            
            echo -e "\n=== DaemonSets ==="
            KUBE_WITH_CONFIG "$kubeconfig" get daemonset -n "$cluster_namespace" -o yaml 2>/dev/null || echo "No DaemonSets found"
            
            echo -e "\n=== ReplicaSets ==="
            KUBE_WITH_CONFIG "$kubeconfig" get rs -n "$cluster_namespace" -o yaml 2>/dev/null || echo "No ReplicaSets found"
            
            echo -e "\n=== HSPC StorageClasses ==="
            sc_names=$(KUBE_WITH_CONFIG "$kubeconfig" get storageclass -o jsonpath='{range .items[?(@.provisioner=="hspc.csi.hitachi.com")]}{.metadata.name}{"\n"}{end}' 2>/dev/null | grep -v '^$' || true)
            if [[ -n "$sc_names" ]]; then
                echo "$sc_names" | while read -r sc; do
                    [[ -n "$sc" ]] && KUBE_WITH_CONFIG "$kubeconfig" get storageclass "$sc" -o yaml 2>/dev/null || true
                done
            else
                echo "No HSPC StorageClasses found"
            fi
            
            # Collect Custom Resources if DR-Operator detected
            if [[ "$dr_operator_detected" == "true" ]]; then
                collect_custom_resources "$kubeconfig"
                
                # Capture DR operator and HRPC deployments from replication operator namespace
                if KUBE_WITH_CONFIG "$kubeconfig" get namespace "$REPLICATION_NAMESPACE" >/dev/null 2>&1; then
                    echo -e "\n=== HRPC Replication Operator Deployments ==="
                    KUBE_WITH_CONFIG "$kubeconfig" get deploy -n "$REPLICATION_NAMESPACE" -o yaml 2>/dev/null || echo "No deployments found in $REPLICATION_NAMESPACE"
                fi
            fi
            
            # Extract HSPC version - try multiple sources for different deployment methods
            echo -e "\n=== HSPC Versions ==="
            local hspc_csv_version=""
            local hspc_driver_version=""
            local hspc_operator_version=""
            
            # Method 1: Try CSV description (OpenShift/OLM deployments)
            hspc_driver_version=$(KUBE_WITH_CONFIG "$kubeconfig" get csv -n "$cluster_namespace" -o jsonpath='{.items[*].spec.description}' 2>/dev/null | grep -oE "HSPC v[0-9]+\.[0-9]+\.[0-9]+" | head -1 | sed 's/HSPC v//')
            
            # Method 2: Try image tag from deployment (Helm/direct install)
            if [[ -z "$hspc_driver_version" ]]; then
                local image_tag=""
                image_tag=$(KUBE_WITH_CONFIG "$kubeconfig" get deploy hspc-csi-controller -n "$cluster_namespace" -o jsonpath='{.spec.template.spec.containers[?(@.name=="hspc-csi-driver")].image}' 2>/dev/null | grep -oE ':[0-9]+\.[0-9]+\.[0-9]+' | sed 's/://')
                if [[ -n "$image_tag" ]]; then
                    hspc_driver_version="$image_tag"
                fi
            fi

            # Method 3: Try image tag from DaemonSet (node pods)
            if [[ -z "$hspc_driver_version" ]]; then
                local image_tag=""
                image_tag=$(KUBE_WITH_CONFIG "$kubeconfig" get daemonset hspc-csi-node -n "$cluster_namespace" -o jsonpath='{.spec.template.spec.containers[?(@.name=="hspc-csi-driver")].image}' 2>/dev/null | grep -oE ':[0-9]+\.[0-9]+\.[0-9]+' | sed 's/://')
                if [[ -n "$image_tag" ]]; then
                    hspc_driver_version="$image_tag"
                fi
            fi

            # Method 4: Try version from already-collected CSI driver log files
            if [[ -z "$hspc_driver_version" ]]; then
                local version_from_log=""
                version_from_log=$(grep -h -m 1 "HSPC version" "$cluster_output_dir"/*_hspc-csi-driver.log 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
                if [[ -n "$version_from_log" ]]; then
                    hspc_driver_version="$version_from_log"
                fi
            fi

            if [[ -n "$hspc_driver_version" ]]; then
                echo "HSPC Version: $hspc_driver_version"
            else
                echo "HSPC Version: Not found (check CSI driver logs for startup version info)"
            fi
            
            # Get operator version - try CSV first, then image tag
            hspc_operator_version=$(KUBE_WITH_CONFIG "$kubeconfig" get csv -n "$cluster_namespace" -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.version}{"\n"}{end}' 2>/dev/null | grep "hspc-operator" | head -1 | sed 's/.*: //')
            if [[ -z "$hspc_operator_version" ]]; then
                # Try from operator deployment image tag
                hspc_operator_version=$(KUBE_WITH_CONFIG "$kubeconfig" get deploy hspc-operator-controller-manager -n "$cluster_namespace" -o jsonpath='{.spec.template.spec.containers[?(@.name=="manager")].image}' 2>/dev/null | grep -oE ':[0-9]+\.[0-9]+\.[0-9]+' | sed 's/://')
            fi
            if [[ -n "$hspc_operator_version" ]]; then
                echo "HSPC Operator Version: $hspc_operator_version"
            fi
            
            # Add DR operator version information if available
            if [[ -n "$dr_operator_version" ]] || [[ -n "$hrpc_version" ]]; then
                echo -e "\n=== DR Operator and HRPC Versions ==="
                if [[ -n "$dr_operator_version" ]]; then
                    echo "DR-Operator Version: $dr_operator_version"
                fi
                if [[ -n "$hrpc_version" ]]; then
                    echo "HRPC Version: $hrpc_version"
                fi
            fi
            
            if [[ ${#PODS[@]} -gt 0 ]]; then
                echo -e "\n=== Pod Ownership Chain ==="
                for pod in "${PODS[@]}"; do
                    if [[ "$CANCELLED" == "true" ]]; then
                        break
                    fi
                    owner_kind=$(KUBE_WITH_CONFIG "$kubeconfig" get pod "$pod" -n "$cluster_namespace" -o jsonpath='{.metadata.ownerReferences[0].kind}' 2>/dev/null || echo "None")
                    owner_name=$(KUBE_WITH_CONFIG "$kubeconfig" get pod "$pod" -n "$cluster_namespace" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || echo "None")
                    if [[ "$owner_kind" == "ReplicaSet" ]]; then
                        deploy=$(KUBE_WITH_CONFIG "$kubeconfig" get rs "$owner_name" -n "$cluster_namespace" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null || echo "unknown")
                        echo "$pod → ReplicaSet/$owner_name → Deployment/$deploy"
                    else
                        echo "$pod → $owner_kind/$owner_name"
                    fi
                done
                
                echo -e "\n=== Pod Descriptions ==="
                for pod in "${PODS[@]}"; do
                    if [[ "$CANCELLED" == "true" ]]; then
                        break
                    fi
                    echo "=== $pod ==="
                    KUBE_WITH_CONFIG "$kubeconfig" describe pod "$pod" -n "$cluster_namespace" 2>/dev/null || true
                    echo
                done
            fi
            
            echo -e "\n=== Recent Events ==="
            KUBE_WITH_CONFIG "$kubeconfig" get events -n "$cluster_namespace" --sort-by='.lastTimestamp' 2>/dev/null | tail -100 || KUBE_WITH_CONFIG "$kubeconfig" get events -n "$cluster_namespace" 2>/dev/null | tail -100 || echo "No events available"
        else
            echo -e "\n=== Note ==="
            echo "HSPC namespace not discovered - limited cluster information collected"
        fi
    ) > "$context_file" 2>>"$cluster_output_dir/errors.log"
    
    if [[ -f "$context_file" ]]; then
        log "Cluster context saved: $context_file"
    else
        log "WARNING: Failed to create cluster-context.txt"
    fi
    
    # Run MTC must-gather if requested
    if [[ "$COLLECT_MTC" == "true" ]]; then
        if [[ "$CANCELLED" == "true" ]]; then
            KUBECONFIG_ARG="$saved_kubeconfig_arg"
            return 1
        fi
        collect_must_gather "$kubeconfig" "$cluster_output_dir" "mtc" \
            "registry.redhat.io/rhmtc/openshift-migration-must-gather-rhel8:v1.8"
    fi

    # Run MTV must-gather if requested
    if [[ "$COLLECT_MTV" == "true" ]]; then
        if [[ "$CANCELLED" == "true" ]]; then
            KUBECONFIG_ARG="$saved_kubeconfig_arg"
            return 1
        fi
        collect_must_gather "$kubeconfig" "$cluster_output_dir" "mtv" \
            "registry.redhat.io/migration-toolkit-virtualization/mtv-must-gather-rhel8:2.11.0"
    fi

    KUBECONFIG_ARG="$saved_kubeconfig_arg"
    log "Collection from $cluster_name complete"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --kubeconfig) KUBECONFIG_ARG="--kubeconfig=$2"; KUBECONFIG_PRIMARY="$2"; shift 2 ;;
        --kubeconfig-primary) KUBECONFIG_PRIMARY="$2"; shift 2 ;;
        --kubeconfig-secondary) KUBECONFIG_SECONDARY="$2"; shift 2 ;;
        --oc)         [[ -n "$OC_CMD" ]] || die "oc binary not found"; CMD="$OC_CMD"; shift ;;
        -n|--namespace) NAMESPACE="$2"; shift 2 ;;
        -d|--dir)     OUTPUT_DIR="$2"; shift 2 ;;
        --no-compress) COMPRESS=false; shift ;;
        --mtc)        COLLECT_MTC=true; shift ;;
        --mtv)        COLLECT_MTV=true; shift ;;
        -h|--help)
            cat <<'EOF'
Usage: ./get_hitachicsilogs.sh [options]
  --kubeconfig <file>          Primary cluster kubeconfig (backward compatible)
  --kubeconfig-primary <file>  Primary cluster kubeconfig
  --kubeconfig-secondary <file>  Secondary cluster kubeconfig (for dual-cluster collection)
  --oc                         Force ./oc or system oc
  -n <ns>                      Force namespace
  -d <dir>                     Output dir
  --no-compress                No zip
  --mtc                        Run oc adm must-gather for Migration Toolkit for Containers
                               (OpenShift + oc required; skipped with warning if not detected)
  --mtv                        Run oc adm must-gather for Migration Toolkit for Virtualization
                               (OpenShift + oc required; skipped with warning if not detected)
EOF
            exit 0
            ;;
        *) die "Unknown option: $1" ;;
    esac
done

# Set KUBECONFIG_ARG from primary if not already set (for backward compatibility)
if [[ -z "$KUBECONFIG_ARG" ]] && [[ -n "$KUBECONFIG_PRIMARY" ]]; then
    KUBECONFIG_ARG="--kubeconfig=$KUBECONFIG_PRIMARY"
fi

log "Using: $CMD ${KUBECONFIG_ARG:- (default kubeconfig)}"

# Determine which kubeconfig to use for primary
PRIMARY_KUBECONFIG="$KUBECONFIG_PRIMARY"
if [[ -z "$PRIMARY_KUBECONFIG" ]] && [[ -n "$KUBECONFIG_ARG" ]]; then
    # Extract kubeconfig path from --kubeconfig=path format
    PRIMARY_KUBECONFIG="${KUBECONFIG_ARG#--kubeconfig=}"
fi

mkdir -p "$OUTPUT_DIR"

# Collect from primary cluster (always)
# Use set +e temporarily to prevent script exit on errors
set +e
collect_from_cluster "$PRIMARY_KUBECONFIG" "primary-cluster"
primary_exit_code=$?
set -e

# Check if cancelled
if [[ "$CANCELLED" == "true" ]]; then
    exit 130
fi

if [[ $primary_exit_code -ne 0 ]]; then
    log "WARNING: Primary cluster collection completed with errors (exit code: $primary_exit_code)"
fi

# Collect from secondary cluster if specified
if [[ -n "$KUBECONFIG_SECONDARY" ]]; then
    # Check for cancellation before secondary collection
    if [[ "$CANCELLED" == "true" ]]; then
        exit 130
    fi
    
    log ""
    set +e
    collect_from_cluster "$KUBECONFIG_SECONDARY" "secondary-cluster"
    secondary_exit_code=$?
    set -e
    
    # Check if cancelled after secondary collection
    if [[ "$CANCELLED" == "true" ]]; then
        exit 130
    fi
    
    if [[ $secondary_exit_code -ne 0 ]]; then
        log "WARNING: Secondary cluster collection completed with errors (exit code: $secondary_exit_code)"
    fi
fi

# Check for cancellation before compression
if [[ "$CANCELLED" == "true" ]]; then
    log "Collection cancelled - skipping compression"
    exit 130
fi

log "Collection complete → $OUTPUT_DIR"

if $COMPRESS; then
    zipfile="${OUTPUT_DIR}.zip"
    if command -v zip >/dev/null 2>&1; then
        zip -r -q "$zipfile" "$OUTPUT_DIR"
        log "Zip created (system zip): $zipfile"
    elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
        python_cmd=$(command -v python3 || command -v python)
        log "Creating zip with Python"
        "$python_cmd" -c "
import zipfile, os, sys
zip_path, dir_path = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(dir_path):
        for file in files:
            full = os.path.join(root, file)
            arcname = os.path.relpath(full, os.path.dirname(dir_path))
            z.write(full, arcname)
" "$zipfile" "$OUTPUT_DIR"
        log "Zip created (Python): $zipfile"
    else
        log "No zip/python → folder only"
    fi
fi

log "Hitachi CSI support bundle ready."
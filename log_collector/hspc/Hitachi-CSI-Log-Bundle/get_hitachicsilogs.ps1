<#
.SYNOPSIS
    Hitachi HSPC CSI Driver Log Bundle Collector v1.6.4 - PowerShell Edition
    -Kubeconfig optional · auto-detect OpenShift · full manifests
    -Collects logs from ALL containers in each pod
    -Supports dual-cluster collection with DR-Operator detection
    -Oc optional
    -Optional MTC/MTV must-gather (-Mtc / -Mtv; OpenShift + oc required)
.PARAMETER Kubeconfig
    Primary cluster kubeconfig file (backward compatible, maps to KubeconfigPrimary)
.PARAMETER KubeconfigPrimary
    Primary cluster kubeconfig file
.PARAMETER KubeconfigSecondary
    Secondary cluster kubeconfig file (for dual-cluster collection)
.PARAMETER Oc
    Force use of OpenShift oc binary
.PARAMETER Namespace
    Target namespace (auto-discovered if not specified)
.PARAMETER Dir
    Output directory (default: ./hspc-csi-logs-YYYYMMDD-HHMMSS)
.PARAMETER NoCompress
    Skip zip file creation
.PARAMETER Mtc
    Run oc adm must-gather for Migration Toolkit for Containers.
    Requires OpenShift and oc to be available; skipped with a warning if not detected.
.PARAMETER Mtv
    Run oc adm must-gather for Migration Toolkit for Virtualization.
    Requires OpenShift and oc to be available; skipped with a warning if not detected.
.PARAMETER Help
    Display this help message. Can also use -h or -? to view help.
.PARAMETER h
    Alias for -Help. Display this help message.
.EXAMPLE
    # View help
    ./get_hitachicsilogs.ps1 -Help
    ./get_hitachicsilogs.ps1 -h
    Get-Help ./get_hitachicsilogs.ps1
    
    # Dual-cluster collection (note: PowerShell parameters use PascalCase, no hyphens)
    ./get_hitachicsilogs.ps1 -KubeconfigPrimary ./dc-1-kubeconfig -KubeconfigSecondary ./dc2-kubeconfig
    
    # Single cluster (backward compatible)
    ./get_hitachicsilogs.ps1 -Kubeconfig ./kubeconfig
    
    # Other examples
    ./get_hitachicsilogs.ps1 -Oc -Namespace my-namespace
    ./get_hitachicsilogs.ps1 -KubeconfigPrimary ./primary-kubeconfig -Dir ./my-output-dir -NoCompress

.NOTES
    PowerShell parameter names are case-insensitive but cannot contain hyphens.
    Use -KubeconfigPrimary (not -kubeconfig-primary) and -KubeconfigSecondary (not -kubeconfig-secondary).
    To view help: -Help, -h, -?, or Get-Help ./get_hitachicsilogs.ps1

.LINK
    https://github.com/cmccuistion-hv/Hitachi-CSI-Log-Bundle
#>

param(
    [string]$Kubeconfig = "",
    [string]$KubeconfigPrimary = "",
    [string]$KubeconfigSecondary = "",
    [switch]$Oc,
    [string]$Namespace = "",
    [string]$Dir = "",
    [switch]$NoCompress,
    [switch]$Mtc,
    [switch]$Mtv,
    [Alias("h")]
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# Script version
$SCRIPT_VERSION = "1.6.4-ps1"

# Cancellation handling
$script:Cancelled = $false
$script:ChildProcesses = @()

# Function to handle cleanup on cancellation
function Stop-Collection {
    $script:Cancelled = $true
    Write-Host ""
    Log "Cancellation requested (Ctrl+C) - cleaning up..."
    
    # Kill all tracked child processes
    foreach ($proc in $script:ChildProcesses) {
        if ($proc -and -not $proc.HasExited) {
            try {
                $proc.Kill()
            } catch {
                # Process may have already exited
            }
        }
    }
    
    # Kill any remaining kubectl/oc processes spawned by this script
    try {
        Get-Process | Where-Object { 
            ($_.Path -like "*kubectl*" -or $_.Path -like "*oc*") -and 
            $_.Parent.Id -eq $PID 
        } | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {
        # Ignore errors
    }
    
    Log "Script cancelled. Partial results may be in: $OutputDir"
    exit 130
}

# Register handler for Ctrl+C cancellation (cross-platform compatible)
# Try to register CancelKeyPress if available (Windows PowerShell), otherwise rely on try-catch
$cancelHandler = {
    param($eventSender, $e)
    $e.Cancel = $true  # Prevent immediate termination, allow cleanup
    Stop-Collection
}

# Check if CancelKeyPress event exists (Windows PowerShell) vs PowerShell Core
# In PowerShell Core on Linux, this event doesn't exist
$hasCancelKeyPress = [Console].GetEvents() | Where-Object { $_.Name -eq 'CancelKeyPress' }

if ($hasCancelKeyPress) {
    try {
        [Console]::CancelKeyPress += $cancelHandler
    } catch {
        # If registration fails, we'll handle cancellation through try-catch blocks
    }
} else {
    # CancelKeyPress not available (PowerShell Core on Linux)
    # We'll handle cancellation through try-catch blocks in the main execution
    # and check $script:Cancelled in loops
    # Ctrl+C will still work, but we rely on loop checks for graceful cleanup
}

# Prefer local binaries if present, otherwise system PATH
$Kubectl = if (Test-Path "./kubectl.exe") { "./kubectl.exe" } elseif (Test-Path "./kubectl") { "./kubectl" } elseif (Get-Command "kubectl" -ErrorAction SilentlyContinue) { "kubectl" } else { "" }
$OcCmd   = if (Test-Path "./oc.exe") { "./oc.exe" } elseif (Test-Path "./oc") { "./oc" } elseif (Get-Command "oc" -ErrorAction SilentlyContinue) { "oc" } else { "" }

# Ensure at least one command is available
if ($Oc -and -not $OcCmd) {
    Die "oc binary not found (required when -Oc flag is used)"
}

if (-not $Oc) {
    # Not explicitly using -Oc flag, prefer kubectl but fall back to oc
    if ($Kubectl) {
        $Cmd = $Kubectl
    } elseif ($OcCmd) {
        $Cmd = $OcCmd
        Log "kubectl not found, using oc command"
    } else {
        Die "Neither kubectl nor oc found. Please install kubectl/oc or configure PATH with location, or place it in the current directory."
    }
} else {
    # Explicitly using -Oc flag
    $Cmd = $OcCmd
}

$OutputDir = if ($Dir) { $Dir } else { "./hspc-csi-logs-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
$Compress = -not $NoCompress

$CRD_NAME = "hspcs.csi.hitachi.com"
$KIND = "HSPC"
$SERVICE_ACCOUNT = "hspc-csi-sa"
$REPLICATION_NAMESPACE = "hspc-replication-operator-system"

# Define helper functions first (before they're used)
function Log { param([string]$msg) Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $msg" }

function Die { param([string]$msg) Write-Error "ERROR: $msg"; exit 1 }

# Display help if requested
if ($Help) {
    @"
Usage: ./get_hitachicsilogs.ps1 [options]
  -Kubeconfig <file>          Primary cluster kubeconfig (backward compatible)
  -KubeconfigPrimary <file>   Primary cluster kubeconfig
  -KubeconfigSecondary <file> Secondary cluster kubeconfig (for dual-cluster collection)
  -Oc                          Force ./oc or system oc
  -Namespace <ns>              Force namespace
  -Dir <dir>                   Output dir
  -NoCompress                  No zip
  -Mtc                         Run oc adm must-gather for Migration Toolkit for Containers
                               Requires OpenShift and oc; skipped with warning if not available
  -Mtv                         Run oc adm must-gather for Migration Toolkit for Virtualization
                               Requires OpenShift and oc; skipped with warning if not available
  -Help, -h                    Show this help message
"@
    exit 0
}

# Set primary kubeconfig from Kubeconfig parameter if not explicitly set
if (-not $KubeconfigPrimary -and $Kubeconfig) {
    $KubeconfigPrimary = $Kubeconfig
}

# Validate kubeconfig files exist if provided
if ($KubeconfigPrimary -and -not (Test-Path $KubeconfigPrimary)) {
    Die "Primary kubeconfig file not found: $KubeconfigPrimary"
}
if ($KubeconfigSecondary -and -not (Test-Path $KubeconfigSecondary)) {
    Die "Secondary kubeconfig file not found: $KubeconfigSecondary"
}

# Log which kubeconfigs are being used
if ($KubeconfigPrimary) {
    Log "Using primary kubeconfig: $KubeconfigPrimary"
} else {
    Log "Using default kubeconfig for primary cluster"
}
if ($KubeconfigSecondary) {
    Log "Using secondary kubeconfig: $KubeconfigSecondary"
}

function Kube {
    $fullArgs = @()
    if ($Kubeconfig) {
        $fullArgs += "--kubeconfig"
        $fullArgs += $Kubeconfig
    }
    $fullArgs += $args
    & $Cmd @fullArgs
}

function Invoke-KubeWithConfig {
    param(
        [string]$KubeconfigPath
    )
    # Get all remaining arguments using $args (this avoids PowerShell parameter parsing issues)
    $remainingArgs = $args
    
    # Build argument array - PowerShell will properly pass these to external commands
    $allArgs = @()
    if ($KubeconfigPath) {
        $allArgs += "--kubeconfig"
        $allArgs += $KubeconfigPath
    }
    $allArgs += $remainingArgs
    
    # Use call operator with array - this is the correct way to pass arguments to external commands
    # PowerShell will not try to parse -o, -n, etc. as PowerShell parameters when using & with an array
    & $Cmd $allArgs
}

function Test-OpenShift {
    # Check if any of these API groups return actual resources (more than just header line)
    # kubectl api-resources returns a header line even when no resources exist, so check for >1 line
    $routeCheck = @(Kube api-resources --api-group=route.openshift.io 2>$null | Where-Object { $_.Trim() })
    if ($routeCheck.Count -gt 1) { return $true }
    
    $securityCheck = @(Kube api-resources --api-group=security.openshift.io 2>$null | Where-Object { $_.Trim() })
    if ($securityCheck.Count -gt 1) { return $true }
    
    $consoleCheck = @(Kube api-resources --api-group=console.openshift.io 2>$null | Where-Object { $_.Trim() })
    if ($consoleCheck.Count -gt 1) { return $true }
    
    return $false
}

function Test-DROperator {
    # Check for CRDs in group hspc.hitachi.com
    # Required: LocalVolume, RemoteVolume, Replication
    # Optional: DRPolicy
    $requiredCrds = @("localvolumes.hspc.hitachi.com", "remotevolumes.hspc.hitachi.com", "replications.hspc.hitachi.com")
    $optionalCrds = @("drpolicies.hspc.hitachi.com")
    $foundRequired = 0
    
    foreach ($crd in $requiredCrds) {
        $ErrorActionPreference = 'SilentlyContinue'
        $null = Kube get crd $crd 2>$null
        if ($?) {
            $foundRequired++
        }
        $ErrorActionPreference = 'Stop'
    }
    
    # All required CRDs must be present
    if ($foundRequired -eq $requiredCrds.Count) {
        # Check optional DRPolicy (log but don't require)
        $ErrorActionPreference = 'SilentlyContinue'
        $null = Kube get crd $optionalCrds[0] 2>$null
        if ($?) {
            Log "DR-Operator detected (with DRPolicy)"
        } else {
            Log "DR-Operator detected (DRPolicy not found)"
        }
        $ErrorActionPreference = 'Stop'
        return $true
    }
    
    return $false
}

function Get-CustomResources {
    param(
        [string]$KubeconfigPath,
        [string]$OutputFile
    )
    
    # Collect LocalVolumes
    "`n=== LocalVolumes ===" | Out-File -Encoding utf8 -Append $OutputFile
    try {
        Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get localvolume --all-namespaces -o yaml | Out-File -Encoding utf8 -Append $OutputFile
    } catch {
        "No LocalVolumes found" | Out-File -Encoding utf8 -Append $OutputFile
    }
    
    # Collect RemoteVolumes
    "`n=== RemoteVolumes ===" | Out-File -Encoding utf8 -Append $OutputFile
    try {
        Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get remotevolume --all-namespaces -o yaml | Out-File -Encoding utf8 -Append $OutputFile
    } catch {
        "No RemoteVolumes found" | Out-File -Encoding utf8 -Append $OutputFile
    }
    
    # Collect Replications
    "`n=== Replications ===" | Out-File -Encoding utf8 -Append $OutputFile
    try {
        Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get replication --all-namespaces -o yaml | Out-File -Encoding utf8 -Append $OutputFile
    } catch {
        "No Replications found" | Out-File -Encoding utf8 -Append $OutputFile
    }
    
    # Collect DRPolicies (optional)
    "`n=== DRPolicies ===" | Out-File -Encoding utf8 -Append $OutputFile
    try {
        Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get drpolicy --all-namespaces -o yaml | Out-File -Encoding utf8 -Append $OutputFile
    } catch {
        "No DRPolicies found" | Out-File -Encoding utf8 -Append $OutputFile
    }
    
    # Collect ReplicationGroups
    "`n=== ReplicationGroups ===" | Out-File -Encoding utf8 -Append $OutputFile
    try {
        Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get replicationgroup --all-namespaces -o yaml | Out-File -Encoding utf8 -Append $OutputFile
    } catch {
        "No ReplicationGroups found" | Out-File -Encoding utf8 -Append $OutputFile
    }
}

function Invoke-MustGather {
    param(
        [string]$KubeconfigPath,
        [string]$ClusterOutputDir,
        [string]$Tool,    # "mtc" or "mtv"
        [string]$Image
    )

    # Require oc (must-gather is an oc adm command, not available in kubectl)
    if (-not $OcCmd) {
        Log "Skipping $Tool must-gather: oc command not available"
        return
    }

    # Require OpenShift (re-use the route.openshift.io API group check)
    $ErrorActionPreference = 'SilentlyContinue'
    $routeCheck = @(Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath api-resources --api-group=route.openshift.io 2>$null | Where-Object { $_.Trim() })
    $ErrorActionPreference = 'Stop'
    if ($routeCheck.Count -le 1) {
        Log "Skipping $Tool must-gather: OpenShift not detected on this cluster"
        return
    }

    $destDir = Join-Path $ClusterOutputDir "must-gather-$Tool"
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null

    Log "Running $Tool must-gather (this may take up to 30 minutes)..."

    $ocArgs = @()
    if ($KubeconfigPath) {
        $ocArgs += "--kubeconfig=$KubeconfigPath"
    }
    $ocArgs += @("adm", "must-gather", "--image=$Image", "--dest-dir=$destDir")

    $errorsLog = "$ClusterOutputDir/errors.log"
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        & $OcCmd @ocArgs 2>> $errorsLog
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'

        if ($exitCode -eq 0) {
            Log "  `u{2713} $Tool must-gather saved to: $destDir"
        } else {
            if ($script:Cancelled) { return }
            Log "  `u{2717} $Tool must-gather failed (exit $exitCode) - see errors.log"
        }
    } catch {
        $ErrorActionPreference = 'Stop'
        if ($script:Cancelled) { return }
        Log "  `u{2717} $Tool must-gather failed: $_ - see errors.log"
    }
}

function Get-FromCluster {
    param(
        [string]$KubeconfigPath,
        [string]$ClusterName
    )
    
    $clusterOutputDir = Join-Path $OutputDir $ClusterName
    New-Item -ItemType Directory -Force -Path $clusterOutputDir | Out-Null
    
    Log "=== Collecting from $ClusterName cluster ==="
    
    # Validate kubeconfig path if provided
    if ($KubeconfigPath) {
        if (-not (Test-Path $KubeconfigPath)) {
            Log "ERROR: Kubeconfig file not found: $KubeconfigPath"
            throw "Kubeconfig file not found: $KubeconfigPath"
        }
        Log "Using kubeconfig: $KubeconfigPath"
    } else {
        Log "Using default kubeconfig"
    }
    
    # Save current Kubeconfig and set for this cluster
    $savedKubeconfig = $Kubeconfig
    $Kubeconfig = $KubeconfigPath
    
    # Detect OpenShift and switch command if needed
    # Also check if kubectl actually works, if not use oc
    $clusterCmd = $Cmd
    $cmdSwitched = $false
    
    # First check if kubectl actually exists and works
    if ($clusterCmd -like "*kubectl*") {
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            $kubectlTest = & $clusterCmd version --client 2>$null
            if (-not $? -or -not $kubectlTest) {
                throw "kubectl test failed"
            }
        } catch {
            # kubectl doesn't work, try oc
            if ($OcCmd) {
                try {
                    $ocTest = & $OcCmd version --client 2>$null
                    if ($? -and $ocTest) {
                        $clusterCmd = $OcCmd
                        $script:Cmd = $OcCmd
                        $cmdSwitched = $true
                        Log "kubectl not available on $ClusterName → using oc"
                    }
                } catch {
                    # oc also doesn't work, keep trying with kubectl
                }
            }
        }
        $ErrorActionPreference = 'Stop'
    }
    
    # Now check for OpenShift (only if we haven't already switched to oc)
    if (-not $cmdSwitched -and $clusterCmd -like "*kubectl*") {
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            $routeCheck = @(Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath api-resources --api-group=route.openshift.io 2>$null | Where-Object { $_.Trim() })
            if ($routeCheck.Count -gt 1 -and $OcCmd) {
                $clusterCmd = $OcCmd
                $script:Cmd = $OcCmd
                $cmdSwitched = $true
                Log "OpenShift detected on $ClusterName → using oc"
            }
        } catch {
            # If kubectl fails, try oc
            if ($OcCmd) {
                $clusterCmd = $OcCmd
                $script:Cmd = $OcCmd
                $cmdSwitched = $true
                Log "kubectl command failed on $ClusterName → using oc"
            }
        }
        $ErrorActionPreference = 'Stop'
    }
    
    # Check for HSPC CRD and fallback to oc if kubectl fails
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $null = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get crd $CRD_NAME 2>$null
        if (-not $?) {
            throw "CRD check failed"
        }
    } catch {
        if (-not $cmdSwitched -and $clusterCmd -like "*kubectl*" -and $OcCmd) {
            $clusterCmd = $OcCmd
            $script:Cmd = $OcCmd
            Log "CRD not visible with kubectl on $ClusterName → forcing oc"
        }
    }
    $ErrorActionPreference = 'Stop'
    
    # Initialize pods array (may be empty if no pods found)
    $pods = @()
    $clusterNamespace = ""
    
    # Check for HSPC CRD and discover namespace
    $ErrorActionPreference = 'SilentlyContinue'
    $null = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get crd $CRD_NAME 2>$null
    $ErrorActionPreference = 'Stop'
    if ($?) {
        # Discover namespace
        $clusterNamespace = $Namespace
        if (-not $clusterNamespace) {
            $ErrorActionPreference = 'SilentlyContinue'
            $clusterNamespace = (Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get $KIND --all-namespaces -o jsonpath='{.items[0].metadata.namespace}' 2>$null)
            $ErrorActionPreference = 'Stop'
        }
        
        if ($clusterNamespace) {
            Log "HSPC namespace on ${ClusterName}: $clusterNamespace"
        } else {
            Log "WARNING: No HSPC CR found on $ClusterName - will collect cluster info only"
        }
    } else {
        Log "WARNING: CRD $CRD_NAME not found on $ClusterName - will collect cluster info only"
    }
    
    # Check for cancellation at start of collection
    if ($script:Cancelled) {
        return
    }
    
    # Collect HSPC pod logs (only if namespace was discovered)
    if ($clusterNamespace) {
        $ErrorActionPreference = 'SilentlyContinue'
        $podsOutput = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pods -n $clusterNamespace -o jsonpath="{range .items[?(@.spec.serviceAccountName=='$SERVICE_ACCOUNT')]}{.metadata.name}{'\n'}{end}" 2>$null
        $ErrorActionPreference = 'Stop'
        
        if ($podsOutput) {
            $pods = $podsOutput.Trim() -split "`n" | Where-Object { $_.Length -gt 0 }
        }
    }
    
    if ($pods -and $pods.Count -gt 0) {
        Log "Found $($pods.Count) HSPC pods on ${ClusterName}: $($pods -join ' ')"
        
        Log "Collecting HSPC logs..."
        foreach ($pod in $pods) {
            # Check for cancellation in loop
            if ($script:Cancelled) {
                return
            }
            
            Log "Collecting logs from pod $pod ..."
            
                    try {
                        $ErrorActionPreference = 'SilentlyContinue'
                        $containersOutput = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pod $pod -n $clusterNamespace -o jsonpath='{.spec.containers[*].name}' 2>> "$clusterOutputDir/errors.log"
                        $ErrorActionPreference = 'Stop'
                        
                        $containers = @()
                        if ($containersOutput) {
                            $containers = $containersOutput.Trim() -split '\s+' | Where-Object { $_.Length -gt 0 }
                        }
                        
                        if (-not $containers -or $containers.Count -eq 0) {
                    "$pod (no containers found)" | Out-File -Append "$clusterOutputDir/failed-pods.txt"
                    Log "FAILED $pod - no containers found"
                    continue
                }
                
                foreach ($container in $containers) {
                    # Check for cancellation in container loop
                    if ($script:Cancelled) {
                        return
                    }
                    
                    $file = "$clusterOutputDir/${pod}_${container}.log"
                    try {
                        Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath logs $pod -n $clusterNamespace -c $container --limit-bytes=200000000 > $file 2>> "$clusterOutputDir/errors.log"
                        Log "  `u{2713} Saved $pod/$container"
                    } catch {
                        # Check if failure was due to cancellation
                        if ($script:Cancelled) {
                            return
                        }
                        "$pod/$container" | Out-File -Append "$clusterOutputDir/failed-pods.txt"
                        Log "  `u{2717} FAILED $pod/$container - see errors.log"
                    }
                }
            } catch {
                "$pod (error getting containers)" | Out-File -Append "$clusterOutputDir/failed-pods.txt"
                Log "FAILED $pod - error getting containers"
            }
        }
    } else {
        Log "No HSPC pods found on $ClusterName"
    }
    
    # Collect HSPC Operator logs (hspc-operator-controller-manager)
    if ($clusterNamespace) {
        $ErrorActionPreference = 'SilentlyContinue'
        $operatorPodsOutput = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pods -n $clusterNamespace -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>$null
        $ErrorActionPreference = 'Stop'
        
        $operatorPods = @()
        if ($operatorPodsOutput) {
            $operatorPods = $operatorPodsOutput.Trim() -split "`n" | Where-Object { $_ -match "hspc-operator-controller-manager" }
        }
        
        if ($operatorPods -and $operatorPods.Count -gt 0) {
            Log "Found $($operatorPods.Count) HSPC Operator pods on ${ClusterName}: $($operatorPods -join ' ')"
            Log "Collecting HSPC Operator logs..."
            foreach ($pod in $operatorPods) {
                # Check for cancellation in loop
                if ($script:Cancelled) {
                    return
                }
                
                Log "Collecting logs from pod $pod ..."
                try {
                    $ErrorActionPreference = 'SilentlyContinue'
                    $containersOutput = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pod $pod -n $clusterNamespace -o jsonpath='{.spec.containers[*].name}' 2>> "$clusterOutputDir/errors.log"
                    $ErrorActionPreference = 'Stop'
                    
                    $containers = @()
                    if ($containersOutput) {
                        $containers = $containersOutput.Trim() -split '\s+' | Where-Object { $_.Length -gt 0 }
                    }
                    
                    if (-not $containers -or $containers.Count -eq 0) {
                        "$pod (no containers found)" | Out-File -Append "$clusterOutputDir/failed-pods.txt"
                        Log "FAILED $pod - no containers found"
                        continue
                    }
                    
                    foreach ($container in $containers) {
                        # Check for cancellation in container loop
                        if ($script:Cancelled) {
                            return
                        }
                        
                        $file = "$clusterOutputDir/${pod}_${container}.log"
                        try {
                            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath logs $pod -n $clusterNamespace -c $container --limit-bytes=200000000 > $file 2>> "$clusterOutputDir/errors.log"
                            Log "  `u{2713} Saved $pod/$container"
                        } catch {
                            # Check if failure was due to cancellation
                            if ($script:Cancelled) {
                                return
                            }
                            "$pod/$container" | Out-File -Append "$clusterOutputDir/failed-pods.txt"
                            Log "  `u{2717} FAILED $pod/$container - see errors.log"
                        }
                    }
                } catch {
                    "$pod (error getting containers)" | Out-File -Append "$clusterOutputDir/failed-pods.txt"
                    Log "FAILED $pod - error getting containers"
                }
            }
        } else {
            Log "No HSPC Operator pods found on $ClusterName"
        }
    }
    
    # Check for DR-Operator
    $drOperatorDetected = $false
    $requiredCrds = @("localvolumes.hspc.hitachi.com", "remotevolumes.hspc.hitachi.com", "replications.hspc.hitachi.com")
    $foundRequired = 0
    
    $ErrorActionPreference = 'SilentlyContinue'
    foreach ($crd in $requiredCrds) {
        $null = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get crd $crd 2>$null
        if ($?) {
            $foundRequired++
        }
    }
    $ErrorActionPreference = 'Stop'
    
    if ($foundRequired -eq $requiredCrds.Count) {
        $drOperatorDetected = $true
        Log "DR-Operator detected on $ClusterName"
        
        # Collect replication operator logs
        $ErrorActionPreference = 'SilentlyContinue'
        $null = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get namespace $REPLICATION_NAMESPACE 2>$null
        $ErrorActionPreference = 'Stop'
        if ($?) {
            Log "Collecting logs from $REPLICATION_NAMESPACE namespace..."
            $repOutputDir = Join-Path $clusterOutputDir $REPLICATION_NAMESPACE
            New-Item -ItemType Directory -Force -Path $repOutputDir | Out-Null
            
            $ErrorActionPreference = 'SilentlyContinue'
            $repPodsOutput = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pods -n $REPLICATION_NAMESPACE -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>$null
            $ErrorActionPreference = 'Stop'
            
            $repPods = @()
            if ($repPodsOutput) {
                $repPods = $repPodsOutput.Trim() -split "`n" | Where-Object { $_.Length -gt 0 }
            }
            
            if ($repPods -and $repPods.Count -gt 0) {
                Log "Found $($repPods.Count) pods in $REPLICATION_NAMESPACE"
                foreach ($pod in $repPods) {
                    # Check for cancellation in loop
                    if ($script:Cancelled) {
                        return
                    }
                    
                    Log "Collecting logs from pod $pod ..."
                    try {
                        $ErrorActionPreference = 'SilentlyContinue'
                        $containersOutput = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pod $pod -n $REPLICATION_NAMESPACE -o jsonpath='{.spec.containers[*].name}' 2>> "$repOutputDir/errors.log"
                        $ErrorActionPreference = 'Stop'
                        
                        $containers = @()
                        if ($containersOutput) {
                            $containers = $containersOutput.Trim() -split '\s+' | Where-Object { $_.Length -gt 0 }
                        }
                        
                        if (-not $containers -or $containers.Count -eq 0) {
                            "$pod (no containers found)" | Out-File -Append "$repOutputDir/failed-pods.txt"
                            Log "FAILED $pod - no containers found"
                            continue
                        }
                        
                        foreach ($container in $containers) {
                            # Check for cancellation in container loop
                            if ($script:Cancelled) {
                                return
                            }
                            
                            $file = "$repOutputDir/${pod}_${container}.log"
                            try {
                                Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath logs $pod -n $REPLICATION_NAMESPACE -c $container --limit-bytes=200000000 > $file 2>> "$repOutputDir/errors.log"
                                Log "  `u{2713} Saved $pod/$container"
                            } catch {
                                # Check if failure was due to cancellation
                                if ($script:Cancelled) {
                                    return
                                }
                                "$pod/$container" | Out-File -Append "$repOutputDir/failed-pods.txt"
                                Log "  `u{2717} FAILED $pod/$container - see errors.log"
                            }
                        }
                    } catch {
                        "$pod (error getting containers)" | Out-File -Append "$repOutputDir/failed-pods.txt"
                        Log "FAILED $pod - error getting containers"
                    }
                }
            } else {
                Log "No pods found in $REPLICATION_NAMESPACE"
            }
        } else {
            Log "Namespace $REPLICATION_NAMESPACE not found on $ClusterName"
        }
    }
    
    # Extract DR operator and HRPC versions from deployments (if DR operator detected)
    $drOperatorVersion = ""
    $hrpcVersion = ""
    if ($drOperatorDetected) {
        $ErrorActionPreference = 'SilentlyContinue'
        $null = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get namespace $REPLICATION_NAMESPACE 2>$null
        $ErrorActionPreference = 'Stop'
        if ($?) {
            # Get all deployments in the replication operator namespace
            $ErrorActionPreference = 'SilentlyContinue'
            $deploymentsYaml = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get deploy -n $REPLICATION_NAMESPACE -o yaml 2>$null
            $ErrorActionPreference = 'Stop'
            
            if ($deploymentsYaml) {
                # Extract DR operator version (look for hv-dr-operator image)
                $drImageMatch = $deploymentsYaml | Select-String -Pattern "image:\s*.*hv-dr-operator:([^\s`"']+)" | Select-Object -First 1
                if ($drImageMatch) {
                    $drOperatorVersion = $drImageMatch.Matches[0].Groups[1].Value
                    Log "DR-Operator version detected: $drOperatorVersion"
                }
                
                # Extract HRPC version (look for hspc-replication-operator image)
                $hrpcImageMatch = $deploymentsYaml | Select-String -Pattern "image:\s*.*hspc-replication-operator:([^\s`"']+)" | Select-Object -First 1
                if ($hrpcImageMatch) {
                    $hrpcVersion = $hrpcImageMatch.Matches[0].Groups[1].Value
                    Log "HRPC version detected: $hrpcVersion"
                }
            }
        }
    }
    
    # Generate cluster context
    $contextFile = Join-Path $clusterOutputDir "cluster-context.txt"
    
    "=== Log Collection Script Version ===" | Out-File -Encoding utf8 $contextFile
    "Script Version: $SCRIPT_VERSION" | Out-File -Encoding utf8 -Append $contextFile
    "Collection Date: $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss UTC'))" | Out-File -Encoding utf8 -Append $contextFile
    "Cluster: $ClusterName" | Out-File -Encoding utf8 -Append $contextFile
    
    "`n=== Cluster Version ===" | Out-File -Encoding utf8 -Append $contextFile
    Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath version | Out-File -Encoding utf8 -Append $contextFile
    
    "`n=== Orchestration Platform ===" | Out-File -Encoding utf8 -Append $contextFile
    $ErrorActionPreference = 'SilentlyContinue'
    $routeCheck = @(Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath api-resources --api-group=route.openshift.io 2>$null | Where-Object { $_.Trim() })
    $ErrorActionPreference = 'Stop'
    if ($routeCheck.Count -gt 1) {
        "Platform: OpenShift" | Out-File -Encoding utf8 -Append $contextFile
        try {
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath version -o json | Out-File -Encoding utf8 -Append $contextFile
        } catch {
            "OpenShift (version details unavailable)" | Out-File -Encoding utf8 -Append $contextFile
        }
    } else {
        "Platform: Kubernetes" | Out-File -Encoding utf8 -Append $contextFile
    }
    
    "`n=== Node OS & Runtime Information ===" | Out-File -Encoding utf8 -Append $contextFile
    Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get nodes -o wide | Out-File -Encoding utf8 -Append $contextFile
    "`n--- Detailed Node Info ---" | Out-File -Encoding utf8 -Append $contextFile
    Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get nodes -o jsonpath="{range .items[*]}{.metadata.name}{'\n'}  OS: {.status.nodeInfo.osImage}{'\n'}  Kernel: {.status.nodeInfo.kernelVersion}{'\n'}  Architecture: {.status.nodeInfo.architecture}{'\n'}  Container Runtime: {.status.nodeInfo.containerRuntimeVersion}{'\n'}  Kubelet: {.status.nodeInfo.kubeletVersion}{'\n'}{'\n'}{end}" | Out-File -Encoding utf8 -Append $contextFile
    
    if ($clusterNamespace) {
        "`n=== HSPC CR ===" | Out-File -Encoding utf8 -Append $contextFile
        try {
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get hspc -n $clusterNamespace -o yaml | Out-File -Encoding utf8 -Append $contextFile
        } catch {
            "No HSPC CR found" | Out-File -Encoding utf8 -Append $contextFile
        }
		
		"`n=== Telemetry CR ===" | Out-File -Encoding utf8 -Append $contextFile

        try {
            $telemetryCRD = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get crd telemetries.csi.hitachi.com -o name 2>$null
        } catch {
            $telemetryCRD = $null
        }

        if ($telemetryCRD) {
            try {
                Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get telemetry cluster-telemetry -n $clusterNamespace -o yaml |
                    Out-File -Encoding utf8 -Append $contextFile
            } catch {
                "Telemetry CR not found" | Out-File -Encoding utf8 -Append $contextFile
            }
        } else {
            "Telemetry CRD not installed" | Out-File -Encoding utf8 -Append $contextFile
        }
        
        "`n=== All Deployments ===" | Out-File -Encoding utf8 -Append $contextFile
        try {
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get deploy -n $clusterNamespace -o yaml | Out-File -Encoding utf8 -Append $contextFile
        } catch {
            "No deployments found" | Out-File -Encoding utf8 -Append $contextFile
        }
        
        "`n=== All DaemonSets ===" | Out-File -Encoding utf8 -Append $contextFile
        try {
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get daemonset -n $clusterNamespace -o yaml | Out-File -Encoding utf8 -Append $contextFile
        } catch {
            "No DaemonSets found" | Out-File -Encoding utf8 -Append $contextFile
        }
        
        "`n=== All ReplicaSets ===" | Out-File -Encoding utf8 -Append $contextFile
        try {
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get rs -n $clusterNamespace -o yaml | Out-File -Encoding utf8 -Append $contextFile
        } catch {
            "No ReplicaSets found" | Out-File -Encoding utf8 -Append $contextFile
        }
    } else {
        "`n=== Note ===" | Out-File -Encoding utf8 -Append $contextFile
        "HSPC namespace not discovered - limited cluster information collected" | Out-File -Encoding utf8 -Append $contextFile
    }
    
    "`n=== HSPC StorageClasses ===" | Out-File -Encoding utf8 -Append $contextFile
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        $scNames = (Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get storageclass -o jsonpath='{range .items[?(@.provisioner=="hspc.csi.hitachi.com")]}{.metadata.name}{"\n"}{end}' 2>$null).Trim() -split "`n" | Where-Object { $_.Length -gt 0 }
        $ErrorActionPreference = 'Stop'
        if ($scNames.Count -gt 0) {
            foreach ($sc in $scNames) {
                Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get storageclass $sc -o yaml | Out-File -Encoding utf8 -Append $contextFile
            }
        } else {
            "No HSPC StorageClasses found" | Out-File -Encoding utf8 -Append $contextFile
        }
    } catch {
        "Error retrieving HSPC StorageClasses" | Out-File -Encoding utf8 -Append $contextFile
    }
    
    # Collect Custom Resources if DR-Operator detected
    if ($drOperatorDetected) {
        Get-CustomResources -KubeconfigPath $KubeconfigPath -OutputFile $contextFile
        
        # Capture DR operator and HRPC deployments from replication operator namespace
        $ErrorActionPreference = 'SilentlyContinue'
        $null = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get namespace $REPLICATION_NAMESPACE 2>$null
        $ErrorActionPreference = 'Stop'
        if ($?) {
            "`n=== HRPC Replication Operator Deployments ===" | Out-File -Encoding utf8 -Append $contextFile
            try {
                Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get deploy -n $REPLICATION_NAMESPACE -o yaml | Out-File -Encoding utf8 -Append $contextFile
            } catch {
                "No deployments found in $REPLICATION_NAMESPACE" | Out-File -Encoding utf8 -Append $contextFile
            }
        }
    }
    
    # Extract HSPC version - try multiple sources for different deployment methods
    if ($clusterNamespace) {
        "`n=== HSPC Versions ===" | Out-File -Encoding utf8 -Append $contextFile
        $hspcDriverVersion = ""
        $hspcOperatorVersion = ""
        
        # Method 1: Try CSV description (OpenShift/OLM deployments)
        $ErrorActionPreference = 'SilentlyContinue'
        $csvDescription = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get csv -n $clusterNamespace -o jsonpath='{.items[*].spec.description}' 2>$null
        $ErrorActionPreference = 'Stop'
        if ($csvDescription) {
            $hspcVersionMatch = $csvDescription | Select-String -Pattern "HSPC v([0-9]+\.[0-9]+\.[0-9]+)" | Select-Object -First 1
            if ($hspcVersionMatch) {
                $hspcDriverVersion = $hspcVersionMatch.Matches[0].Groups[1].Value
            }
        }
        
        # Method 2: Try image tag from deployment (Helm/direct install)
        if (-not $hspcDriverVersion) {
            $ErrorActionPreference = 'SilentlyContinue'
            $driverImage = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get deploy hspc-csi-controller -n $clusterNamespace -o jsonpath='{.spec.template.spec.containers[?(@.name=="hspc-csi-driver")].image}' 2>$null
            $ErrorActionPreference = 'Stop'
            if ($driverImage) {
                $imageTagMatch = $driverImage | Select-String -Pattern ":([0-9]+\.[0-9]+\.[0-9]+)" | Select-Object -First 1
                if ($imageTagMatch) {
                    $hspcDriverVersion = $imageTagMatch.Matches[0].Groups[1].Value
                }
            }
        }

        # Method 3: Try image tag from DaemonSet (node pods)
        if (-not $hspcDriverVersion) {
            $ErrorActionPreference = 'SilentlyContinue'
            $nodeImage = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get daemonset hspc-csi-node -n $clusterNamespace -o jsonpath='{.spec.template.spec.containers[?(@.name=="hspc-csi-driver")].image}' 2>$null
            $ErrorActionPreference = 'Stop'
            if ($nodeImage) {
                $imageTagMatch = $nodeImage | Select-String -Pattern ":([0-9]+\.[0-9]+\.[0-9]+)" | Select-Object -First 1
                if ($imageTagMatch) { $hspcDriverVersion = $imageTagMatch.Matches[0].Groups[1].Value }
            }
        }

        # Method 4: Try version from already-collected CSI driver log files
        if (-not $hspcDriverVersion) {
            $logFiles = Get-ChildItem -Path $clusterOutputDir -Filter "*_hspc-csi-driver.log" -ErrorAction SilentlyContinue
            foreach ($logFile in $logFiles) {
                $versionLine = Get-Content $logFile.FullName -ErrorAction SilentlyContinue |
                    Select-String "HSPC version" | Select-Object -First 1
                if ($versionLine) {
                    $versionMatch = $versionLine.Line | Select-String -Pattern "([0-9]+\.[0-9]+\.[0-9]+)" | Select-Object -First 1
                    if ($versionMatch) {
                        $hspcDriverVersion = $versionMatch.Matches[0].Groups[1].Value
                        break
                    }
                }
            }
        }

        if ($hspcDriverVersion) {
            "HSPC Version: $hspcDriverVersion" | Out-File -Encoding utf8 -Append $contextFile
            Log "HSPC Version detected: $hspcDriverVersion"
        } else {
            "HSPC Version: Not found (check CSI driver logs for startup version info)" | Out-File -Encoding utf8 -Append $contextFile
        }
        
        # Get operator version - try CSV first, then image tag
        $ErrorActionPreference = 'SilentlyContinue'
        $csvVersions = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get csv -n $clusterNamespace -o jsonpath='{range .items[*]}{.metadata.name}: {.spec.version}{"\n"}{end}' 2>$null
        $ErrorActionPreference = 'Stop'
        if ($csvVersions) {
            $operatorCsvLine = $csvVersions -split "`n" | Where-Object { $_ -match "hspc-operator" } | Select-Object -First 1
            if ($operatorCsvLine) {
                $hspcOperatorVersion = ($operatorCsvLine -split ": ")[-1].Trim()
            }
        }
        
        # Fallback: Try from operator deployment image tag
        if (-not $hspcOperatorVersion) {
            $ErrorActionPreference = 'SilentlyContinue'
            $operatorImage = Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get deploy hspc-operator-controller-manager -n $clusterNamespace -o jsonpath='{.spec.template.spec.containers[?(@.name=="manager")].image}' 2>$null
            $ErrorActionPreference = 'Stop'
            if ($operatorImage) {
                $opImageTagMatch = $operatorImage | Select-String -Pattern ":([0-9]+\.[0-9]+\.[0-9]+)" | Select-Object -First 1
                if ($opImageTagMatch) {
                    $hspcOperatorVersion = $opImageTagMatch.Matches[0].Groups[1].Value
                }
            }
        }
        
        if ($hspcOperatorVersion) {
            "HSPC Operator Version: $hspcOperatorVersion" | Out-File -Encoding utf8 -Append $contextFile
        }
    }
    
    # Add DR operator version information if available
    if ($drOperatorVersion -or $hrpcVersion) {
        "`n=== DR Operator and HRPC Versions ===" | Out-File -Encoding utf8 -Append $contextFile
        if ($drOperatorVersion) {
            "DR-Operator Version: $drOperatorVersion" | Out-File -Encoding utf8 -Append $contextFile
        }
        if ($hrpcVersion) {
            "HRPC Version: $hrpcVersion" | Out-File -Encoding utf8 -Append $contextFile
        }
    }
    
    if ($pods.Count -gt 0) {
        "`n=== Pod Ownership Chain ===" | Out-File -Encoding utf8 -Append $contextFile
        foreach ($pod in $pods) {
            $ErrorActionPreference = 'SilentlyContinue'
            $ownerKind = (Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pod $pod -n $clusterNamespace -o jsonpath='{.metadata.ownerReferences[0].kind}' 2>$null) ?? "None"
            $ownerName = (Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get pod $pod -n $clusterNamespace -o jsonpath='{.metadata.ownerReferences[0].name}' 2>$null) ?? "None"
            $ErrorActionPreference = 'Stop'
            if ($ownerKind -eq "ReplicaSet") {
                $ErrorActionPreference = 'SilentlyContinue'
                $deploy = (Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get rs $ownerName -n $clusterNamespace -o jsonpath='{.metadata.ownerReferences[0].name}' 2>$null) ?? "unknown"
                $ErrorActionPreference = 'Stop'
                "$pod → ReplicaSet/$ownerName → Deployment/$deploy" | Out-File -Encoding utf8 -Append $contextFile
            } else {
                "$pod → $ownerKind/$ownerName" | Out-File -Encoding utf8 -Append $contextFile
            }
        }
        
        "`n=== Pod Descriptions ===" | Out-File -Encoding utf8 -Append $contextFile
        foreach ($pod in $pods) {
            "=== $pod ===" | Out-File -Encoding utf8 -Append $contextFile
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath describe pod $pod -n $clusterNamespace 2>$null | Out-File -Encoding utf8 -Append $contextFile
            "" | Out-File -Encoding utf8 -Append $contextFile
        }
    }
    
    if ($clusterNamespace) {
        "`n=== Recent Events ===" | Out-File -Encoding utf8 -Append $contextFile
        try {
            Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get events -n $clusterNamespace --sort-by='.lastTimestamp' 2>$null | Select-Object -Last 100 | Out-File -Encoding utf8 -Append $contextFile
        } catch {
            try {
                Invoke-KubeWithConfig -KubeconfigPath $KubeconfigPath get events -n $clusterNamespace 2>$null | Select-Object -Last 100 | Out-File -Encoding utf8 -Append $contextFile
            } catch {
                "No events available" | Out-File -Encoding utf8 -Append $contextFile
            }
        }
    }
    
    if (Test-Path $contextFile) {
        Log "Cluster context saved: $contextFile"
    } else {
        Log "WARNING: Failed to create cluster-context.txt"
    }
    
    # Run MTC must-gather if requested
    if ($Mtc) {
        if ($script:Cancelled) {
            $Kubeconfig = $savedKubeconfig
            return
        }
        Invoke-MustGather -KubeconfigPath $KubeconfigPath -ClusterOutputDir $clusterOutputDir `
            -Tool "mtc" -Image "registry.redhat.io/rhmtc/openshift-migration-must-gather-rhel8:v1.8"
    }

    # Run MTV must-gather if requested
    if ($Mtv) {
        if ($script:Cancelled) {
            $Kubeconfig = $savedKubeconfig
            return
        }
        Invoke-MustGather -KubeconfigPath $KubeconfigPath -ClusterOutputDir $clusterOutputDir `
            -Tool "mtv" -Image "registry.redhat.io/migration-toolkit-virtualization/mtv-must-gather-rhel8:2.11.0"
    }

    $Kubeconfig = $savedKubeconfig
    Log "Collection from $ClusterName complete"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Track collection success and auth errors
$hasAuthErrors = $false
$collectionErrors = @()

# Collect from primary cluster (always)
# Use try-catch to prevent script exit on errors
try {
    Get-FromCluster -KubeconfigPath $KubeconfigPrimary -ClusterName "primary-cluster"
} catch {
    $errorMsg = $_.Exception.Message
    $collectionErrors += "Primary cluster: $errorMsg"
    if ($errorMsg -match "Unauthorized|credentials|authentication|login") {
        $hasAuthErrors = $true
    }
    Log "WARNING: Primary cluster collection completed with errors: $errorMsg"
}

# Check for cancellation after primary collection
if ($script:Cancelled) {
    Log "Collection cancelled - skipping remaining operations"
    exit 130
}

# Collect from secondary cluster if specified
if ($KubeconfigSecondary) {
    # Check for cancellation before secondary collection
    if ($script:Cancelled) {
        Log "Collection cancelled - skipping secondary cluster"
        exit 130
    }
    
    Log ""
    try {
        Get-FromCluster -KubeconfigPath $KubeconfigSecondary -ClusterName "secondary-cluster"
    } catch {
        $errorMsg = $_.Exception.Message
        $collectionErrors += "Secondary cluster: $errorMsg"
        if ($errorMsg -match "Unauthorized|credentials|authentication|login") {
            $hasAuthErrors = $true
        }
        Log "WARNING: Secondary cluster collection completed with errors: $errorMsg"
    }
    
    # Check for cancellation after secondary collection
    if ($script:Cancelled) {
        Log "Collection cancelled - skipping compression"
        exit 130
    }
}

# Check for auth errors in error logs
$errorLogs = Get-ChildItem -Path $OutputDir -Recurse -Filter "errors.log" -ErrorAction SilentlyContinue
foreach ($errorLog in $errorLogs) {
    $errorContent = Get-Content $errorLog.FullName -ErrorAction SilentlyContinue
    if ($errorContent -match "Unauthorized|You must be logged in|credentials|authentication") {
        $hasAuthErrors = $true
        break
    }
}

# Check if we collected any data before zipping
$hasData = $false
if (Test-Path "$OutputDir\primary-cluster") {
    $primaryFiles = Get-ChildItem -Path "$OutputDir\primary-cluster" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "errors.log" -and $_.Name -ne "failed-pods.txt" }
    if ($primaryFiles -and $primaryFiles.Count -gt 0) {
        $hasData = $true
    }
}
if (Test-Path "$OutputDir\secondary-cluster") {
    $secondaryFiles = Get-ChildItem -Path "$OutputDir\secondary-cluster" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "errors.log" -and $_.Name -ne "failed-pods.txt" }
    if ($secondaryFiles -and $secondaryFiles.Count -gt 0) {
        $hasData = $true
    }
}

if ($hasAuthErrors) {
    Log "ERROR: Authentication errors detected. Collection may be incomplete."
    Log "Please verify your kubeconfig files are valid and you have proper credentials."
    if ($collectionErrors.Count -gt 0) {
        foreach ($err in $collectionErrors) {
            Log "  - $err"
        }
    }
    Log "Collection incomplete → $OutputDir"
    exit 1
}

if (-not $hasData) {
    Log "ERROR: No data collected from any cluster. Collection may have failed."
    Log "Collection incomplete → $OutputDir"
    exit 1
}

# Check for cancellation before compression
if ($script:Cancelled) {
    Log "Collection cancelled - skipping compression"
    exit 130
}

Log "Collection complete → $OutputDir"

if ($Compress) {
    $zipfile = "$OutputDir.zip"
    try {
        # Suppress xdg-open errors by redirecting stderr
        Compress-Archive -Path "$OutputDir\*" -DestinationPath $zipfile -Force 2>$null
        Log "Zip created (built-in): $zipfile"
    } catch {
        Log "WARNING: Failed to create zip file: $_"
    }
}

Log "Hitachi CSI support bundle ready."
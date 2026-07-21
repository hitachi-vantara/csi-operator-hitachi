#!/bin/bash
#
#===============================================================================
#
#   •	Hitachi Vantara CSI - Offline Bundle Script
#
#   This script facilitates the deployment of Hitachi Vantara CSI components 
#   in air-gapped or offline environments. It provides
#   functionality to create a self-contained bundle with all necessary
#   container images and manifest files, and to prepare those assets for
#   deployment against a local container registry.
#
#   Key Features:
#
#   1. Bundle Creation (-c):
#      - Downloads all required HV CSI and sidecar container images for the specified HV CSI version.
#      - Packages images and HV CSI manifests into a single tar.gz archive.
#      - Automatically handles images referenced by digest by assigning a stable tag.
#
#   2. Image Deployment (-p):
#      - Loads images from the bundle into the local container runtime.
#      - Tags and pushes images to a specified private/local registry.
#      - Generates offline-ready manifest files with updated image paths.
#
#   3. Manifest-Only Updates (-u):
#      - Updates manifest files to point to a new registry path without
#        re-processing images.
#
#   4. Offline CRD Generation (-n):
#      - Creates a version-specific offline CRD file populated with the
#        correct image references for a given Kubernetes version.
#
#   Usage Examples:
#
#   # Prerequisites:
#   - Ensure Git and 'skopeo' are installed and configured on your system.
#     Minimum version of skopeo: 1.14.5 (for --preserve-digests support).
#
#   - Before running the script, Git clone the HV CSI public repo
#     git clone https://github.com/hitachi-vantara/csi-operator-hitachi.git
#
#     Navigate to the script directory and copy the script there:
#
#   # Create a bundle for HSPC v3.18.2 and all associated K8s versions
#   ./hvcsi-offline-bundle.sh -c -v v3.18.2              (plugin defaults to hspc)
#   ./hvcsi-offline-bundle.sh -c -t hspc -v v3.18.2
#
#   # Create a bundle for HRPC or HSPP
#   ./hvcsi-offline-bundle.sh -c -t hrpc -v v3.17.4
#   ./hvcsi-offline-bundle.sh -c -t hspp -v v3.17.4
#
#   # Create bundles for the LATEST version of all three plugins (one bundle each)
#   ./hvcsi-offline-bundle.sh -c -t all
#
#   # Create a bundle for a specific K8s version (e.g., 1.34) - hspc only
#   ./hvcsi-offline-bundle.sh -c -v v3.18.2 -k 1.34
#
#   # After extracting a bundle, push images and generate offline manifests
#   # (the plugin is auto-detected from the extracted bundle contents)
#   ./hvcsi-offline-bundle.sh -p -r my-registry.local:5000/hspc
#   ./hvcsi-offline-bundle.sh -p -r my-registry.local:5000/hrpc
#
#   # Only update manifests to point to a different registry
#   ./hvcsi-offline-bundle.sh -u -r new-registry.local:5000/hspc
#
#   # Only generate the offline CRD for a specific K8s version (hspc only)
#   ./hvcsi-offline-bundle.sh -n -k 1.34
#
#   For self-signed or HTTP registry: (push to new registry)
#   HSPC_INSECURE_REG=1 ./hvcsi-offline-bundle.sh -p -r k8s-registry.scelab.local/hspc-offline
#
#===============================================================================

# --- Script version ---
SCRIPT_VERSION="1.1.0"

# --- Supported plugins ---
SUPPORTED_PLUGINS=("hspc" "hspp" "hrpc")

# --- Functions ---
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
LOG_FILE="./hvcsi-offline-bundle_${TIMESTAMP}.log"

# Print script version
print_version() {
  echo "hvcsi-offline-bundle.sh version ${SCRIPT_VERSION}"
  exit 0
}
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE" >&2
}
lognexit() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE" >&2
  exit 1
}

# Print usage information
usage() {
  echo "hvcsi-offline-bundle.sh version ${SCRIPT_VERSION}"
  echo "Usage: $0 -c [-t <plugin>] -v <plugin_version>"
  echo "Usage: $0 -c -t all"
  echo "Usage: $0 -c -v <hspc_version> -k <k8s_version>"
  echo "Usage: $0 -p -r <registry_path>"
  echo "Usage: $0 -u -r <registry_path>"
  echo "Usage: $0 -n -k <k8s_version>"
  echo "Options:"
  echo "  -c                     Create the installation bundle (tar.gz)."
  echo "  -p                     Tag and push images to a local registry."
  echo "  -u                     Update manifest files with new registry path only."
  echo "  -n                     Create offline CRD file for specified k8s version (hspc only)."
  echo "  -t <plugin>            Plugin/component: hspc (default), hspp, hrpc, or all."
  echo "                         'all' creates one bundle per plugin using the latest"
  echo "                         available version of each (requires -c, ignores -v)."
  echo "  -v <plugin_version>    Plugin version (e.g., v3.18.2). (required for -c, except -t all)."
  echo "  -k <k8s_version>       Kubernetes major.minor version (e.g., 1.34). (hspc only, required for -n)."
  echo "  -r <registry_path>     Path to your local container registry (required for -p and -u)."
  echo "  -h                     Display this help message."
  echo "  --version              Display script version and exit."
  exit 1
}

# Check for required commands
check_deps() {
  if ! command -v "skopeo" &> /dev/null; then
    lognexit "Error: 'skopeo' is not installed. Please install skopeo."
  fi
}

# Validate a plugin name against the supported list
validate_plugin() {
  local p="$1"
  for sp in "${SUPPORTED_PLUGINS[@]}"; do
    [[ "$p" == "$sp" ]] && return 0
  done
  return 1
}

# Return the latest available version folder for a plugin (e.g. v3.18.2)
get_latest_version() {
  local plugin="$1"
  local plugin_dir="${BASE_DIR}/${plugin}"
  [[ -d "$plugin_dir" ]] || lognexit "Error: Plugin folder not found: ${plugin_dir}. Did you clone the csi-operator-hitachi repo and place the script inside it?"
  local latest
  latest=$(ls -1 "$plugin_dir" 2>/dev/null | grep -E '^v[0-9]' | sort -V | tail -1)
  [[ -z "$latest" ]] && lognexit "Error: No version folders (v*) found under ${plugin_dir}"
  echo "$latest"
}

# Normalize image refs: append :latest to bare images with no tag/digest (e.g. 'busybox')
# so that the flattened push destination is always addressable by tag.
normalize_images() {
  while IFS= read -r img; do
    [[ -z "$img" ]] && continue
    local last="${img##*/}"
    if [[ "$last" != *:* && "$last" != *@sha256:* ]]; then
      echo "${img}:latest"
    else
      echo "$img"
    fi
  done
}

# Extract image names from HSPC manifest files (operator + sample driver manifests)
get_images_hspc() {
  local plugin_version="$1"
  local k8s_version="$2"

  # Determine manifest base: newer layout uses <plugin_path>/yaml/, older uses <plugin_path>/
  local manifest_base
  if [[ -d "${plugin_path}/yaml/operator" && -d "${plugin_path}/yaml/sample" ]]; then
    manifest_base="${plugin_path}/yaml"
  elif [[ -d "${plugin_path}/operator" && -d "${plugin_path}/sample" ]]; then
    manifest_base="${plugin_path}"
  else
    log "Error: Could not find 'operator' and 'sample' folders for HSPC version '$plugin_version'."
    lognexit "Checked paths: ${plugin_path}/yaml/ and ${plugin_path}/"
  fi

  local operator_yaml="${manifest_base}/operator/hspc-operator.yaml"
  local driver_files

  if [[ -n "$k8s_version" ]]; then
    # k8s version is specified, look for a specific file
    driver_files="${manifest_base}/sample/hspc-k8s${k8s_version}.yaml"
    if [[ ! -f "$driver_files" ]]; then
      lognexit "Error: Specified driver manifest not found: $driver_files"
    fi
  else
    # k8s version is not specified, glob all driver manifests
    driver_files="${manifest_base}/sample/hspc-k8s"*.yaml
    # Check if the glob found any files
    if ! ls $driver_files &> /dev/null; then
        lognexit "Error: No driver manifests found in ${manifest_base}/sample/"
    fi
  fi

  if [[ ! -f "$operator_yaml" ]]; then
    log "Error: Operator manifest file not found for HSPC version '$plugin_version'."
    lognexit "Checked path: $operator_yaml"
  fi

  # Use grep to find lines with 'image:', awk to get the second field, and sed to remove quotes.
  # The glob for driver_files will expand to all matching files.
  # Sort -u ensures a unique list of images across all files.
  grep -h 'image:' "$operator_yaml" $driver_files | awk '{print $2}' | sed 's/"//g' | sort -u
}

# Extract image names from generic plugin manifests (hrpc, hspp).
# - hrpc: <plugin_path>/yaml/*.yaml and <plugin_path>/dr-operator/yaml/*.yaml
# - hspp: <plugin_path>/yaml/*.yaml
# Falls back to <plugin_path>/*.yaml for older layouts without a yaml/ subfolder.
get_images_generic() {
  local plugin="$1"
  local plugin_version="$2"
  local -a manifest_files=()

  if [[ -d "${plugin_path}/yaml" ]]; then
    while IFS= read -r f; do manifest_files+=("$f"); done \
      < <(find "${plugin_path}/yaml" -maxdepth 1 -name "*.yaml" -type f 2>/dev/null)
  fi
  if [[ -d "${plugin_path}/dr-operator/yaml" ]]; then
    while IFS= read -r f; do manifest_files+=("$f"); done \
      < <(find "${plugin_path}/dr-operator/yaml" -maxdepth 1 -name "*.yaml" -type f 2>/dev/null)
  fi
  if [[ ${#manifest_files[@]} -eq 0 ]]; then
    # Older layout fallback: yaml files directly under the version folder
    while IFS= read -r f; do manifest_files+=("$f"); done \
      < <(find "${plugin_path}" -maxdepth 1 -name "*.yaml" -type f 2>/dev/null)
  fi

  if [[ ${#manifest_files[@]} -eq 0 ]]; then
    log "Error: Could not find any manifest files for ${plugin} version '$plugin_version'."
    lognexit "Checked paths: ${plugin_path}/yaml/, ${plugin_path}/dr-operator/yaml/ and ${plugin_path}/"
  fi

  log "Scanning ${#manifest_files[@]} manifest file(s) for images (${plugin})..." 
  grep -h 'image:' "${manifest_files[@]}" | awk '{print $2}' | sed 's/"//g' | sort -u
}

# Extract image names from manifest files - dispatch per plugin
get_images() {
  local plugin="$1"
  local plugin_version="$2"
  local k8s_version="$3"

  case "$plugin" in
    hspc) get_images_hspc "$plugin_version" "$k8s_version" | normalize_images | sort -u ;;
    hrpc|hspp) get_images_generic "$plugin" "$plugin_version" | normalize_images | sort -u ;;
    *) lognexit "Error: Unsupported plugin '$plugin'." ;;
  esac
}


# Create the installation bundle
create_bundle() {
  local plugin="$1"
  local plugin_version="$2"
  local k8s_version="$3"
  local images_str="$4"

  local bundle_name="hvcsi-${plugin}-${plugin_version}-bundle"
  local images_folder="${plugin}-images"
  local temp_dir
  mkdir -p "$bundle_name" && temp_dir="${PWD}/${bundle_name}"
  mkdir -p "${temp_dir}/${images_folder}"

  # Mapping file: source ref -> on-disk dir name. No digest->tag dance needed;
  # skopeo's dir: transport preserves the original manifest (and digest) verbatim.
  local map_file="${temp_dir}/${images_folder}/image-map.csv"
  echo "source_ref,dir_name" > "$map_file"

  log "--- Copying ${plugin} images into bundle (digest-preserving) ---"
  local final_images
  read -ra final_images <<< "$images_str"
  for img in "${final_images[@]}"; do
    [[ -z "$img" ]] && continue
    local safe_name
    safe_name=$(echo "$img" | sed 's|[/:@]|_|g')
    local img_dir="${temp_dir}/${images_folder}/${safe_name}"
    log "  Copying $img -> ${safe_name}"
    skopeo copy --all --preserve-digests \
      "docker://${img}" "dir:${img_dir}" >> "$LOG_FILE" 2>&1 \
      || lognexit "Error: skopeo copy failed for $img"
    echo "\"${img}\",\"${safe_name}\"" >> "$map_file"
  done

  log "Copying installation files from ${plugin_path}..."
  mkdir -p "${temp_dir}/${plugin_version}"
  cp -r "${plugin_path}/." "${temp_dir}/${plugin_version}"

  log "Building final archive: ${bundle_name}.tar.gz"
  tar -czf "${bundle_name}.tar.gz" "$bundle_name"
  rm -rf "$temp_dir"
  log "--- Bundle created successfully: ${bundle_name}.tar.gz ---"
}


# Detect the extracted images folder in the current directory.
# Looks for <plugin>-images (hspc-images, hspp-images, hrpc-images) containing image-map.csv.
# Sets globals: images_folder, detected_plugin
detect_images_folder() {
  images_folder=""
  detected_plugin=""
  # If a plugin was explicitly requested, prefer its folder
  if [[ -n "${plugin:-}" && "${plugin}" != "all" && -d "${plugin}-images" ]]; then
    images_folder="${plugin}-images"
    detected_plugin="${plugin}"
    return 0
  fi
  local d
  for d in hspc-images hspp-images hrpc-images; do
    if [[ -d "$d" && -f "$d/image-map.csv" ]]; then
      if [[ -n "$images_folder" ]]; then
        lognexit "Error: Multiple '*-images' folders found ($images_folder and $d). Use -t <plugin> to choose one."
      fi
      images_folder="$d"
      detected_plugin="${d%-images}"
    fi
  done
  return 0
}

# Tag and push images from the extracted images folder to a new registry
tag_and_push_images() {
  local registry_path="$1"

  detect_images_folder
  if [[ -z "$images_folder" ]]; then
    log "Error: No images folder (hspc-images, hspp-images or hrpc-images) found in the current directory."
    lognexit "Please extract the main bundle first and try again."
  fi
  log "Detected plugin '${detected_plugin}' (images folder: ${images_folder})"

  local map_file
  map_file=$(find "$images_folder" -name "image-map.csv" -type f | head -1)
  [[ -z "$map_file" ]] && lognexit "Error: image-map.csv not found; re-create the bundle with the updated script."

  log "--- Pushing images to '$registry_path' (digest-preserving) ---"

  # TLS flag for internal/self-signed mirror registries. Prefer trusting the CA;
  # set HSPC_INSECURE_REG=1 (or HVCSI_INSECURE_REG=1) to fall back to skipping verification.
  local dest_tls="--dest-tls-verify=true"
  [[ "${HSPC_INSECURE_REG:-0}" == "1" || "${HVCSI_INSECURE_REG:-0}" == "1" ]] && dest_tls="--dest-tls-verify=false"

  while IFS=',' read -r source_ref dir_name; do
    source_ref=$(echo "$source_ref" | sed 's/"//g')
    dir_name=$(echo "$dir_name" | sed 's/"//g')
    [[ "$source_ref" == "source_ref" || -z "$source_ref" ]] && continue

    local img_dir="${images_folder}/${dir_name}"
    [[ ! -d "$img_dir" ]] && { log "Warning: missing dir $img_dir, skipping"; continue; }

    # Flatten to your existing layout: <registry_path>/<image-basename>:<tag>
    # Strip registry+namespace, keep the final repo component and the tag.
    local repo_and_tag="${source_ref##*/}"          # e.g. hspc-csi-driver:v3.18.2  OR  hspc-csi-driver@sha256:...
    local repo tag
    if [[ "$repo_and_tag" == *@sha256:* ]]; then
      # digest-only source: derive a tag so the flattened dest is addressable by tag too
      repo="${repo_and_tag%@*}"
      tag="bndl-${repo_and_tag##*@sha256:}"          # bndl-<short-ish>; the original digest is still preserved
      tag="${tag:0:64}"
    else
      repo="${repo_and_tag%%:*}"
      tag="${repo_and_tag##*:}"
    fi
    local dest="${registry_path}/${repo}:${tag}"

    log "  Pushing $dir_name -> $dest"
    skopeo copy --all --preserve-digests $dest_tls \
      "dir:${img_dir}" "docker://${dest}" >> "$LOG_FILE" 2>&1 \
      || lognexit "Error: skopeo copy push failed for $dest"
  done < "$map_file"

  log "--- All images pushed successfully to '$registry_path' ---"
}

# Verification function to compare source and destination image digests after push
verify_bundle_digests() {
  local registry_path="$1"

  detect_images_folder
  if [[ -z "$images_folder" ]]; then
    log "verify: no images folder found; skipping digest verification."
    return 0
  fi

  local map_file
  map_file=$(find "$images_folder" -name "image-map.csv" -type f | head -1)
  if [[ -z "$map_file" ]]; then
    log "verify: image-map.csv not found; skipping digest verification."
    return 0
  fi

  # Match the TLS/auth posture used by the push step.
  local tls="--tls-verify=true"
  [[ "${HSPC_INSECURE_REG:-0}" == "1" || "${HVCSI_INSECURE_REG:-0}" == "1" ]] && tls="--tls-verify=false"
  local authflag=""
  [[ -n "${HSPC_DEST_AUTHFILE:-}" ]] && authflag="--authfile ${HSPC_DEST_AUTHFILE}"

  log "--- Verifying digests (bundle dir vs pushed mirror) ---"
  log "    using: skopeo inspect ${tls} ${authflag:-<no authfile>}"

  local total=0 ok=0 fail=0
  local tmp_src tmp_dst err
  tmp_src=$(mktemp); tmp_dst=$(mktemp)

  while IFS=',' read -r source_ref dir_name; do
    source_ref=$(echo "$source_ref" | sed 's/"//g')
    dir_name=$(echo "$dir_name" | sed 's/"//g')
    [[ "$source_ref" == "source_ref" || -z "$source_ref" ]] && continue
    total=$((total+1))

    local img_dir="${images_folder}/${dir_name}"
    if [[ ! -d "$img_dir" ]]; then
      log "  FAIL  $source_ref : bundle dir missing ($img_dir)"; fail=$((fail+1)); continue
    fi

    # Reconstruct the destination ref the push used (flattened: <registry>/<repo>:<tag>)
    local repo_and_tag repo tag dst
    repo_and_tag="${source_ref##*/}"
    if [[ "$repo_and_tag" == *@sha256:* ]]; then
      repo="${repo_and_tag%@*}"; tag="bndl-${repo_and_tag##*@sha256:}"; tag="${tag:0:64}"
    else
      repo="${repo_and_tag%%:*}"; tag="${repo_and_tag##*:}"
    fi
    dst="${registry_path}/${repo}:${tag}"

    # Source digest from the bundle dir (local, no TLS/network).
    if ! err=$(skopeo inspect --raw "dir:${img_dir}" 2>&1 1>"$tmp_src"); then
      log "  FAIL  $source_ref : cannot read bundle manifest: ${err}"; fail=$((fail+1)); continue
    fi
    local src_digest; src_digest=$(sha256sum "$tmp_src" | cut -d' ' -f1)

    # Destination digest from the mirror (network + TLS + maybe auth).
    if ! err=$(skopeo inspect --raw $tls $authflag "docker://${dst}" 2>&1 1>"$tmp_dst"); then
      log "  FAIL  $dst : cannot read mirror manifest: ${err}"
      log "        hint: push used '${tls}'. If the registry is self-signed or HTTP,"
      log "        run with HSPC_INSECURE_REG=1, or add the CA to the host trust store."
      fail=$((fail+1)); continue
    fi
    local dst_digest; dst_digest=$(sha256sum "$tmp_dst" | cut -d' ' -f1)

    if [[ -n "$src_digest" && "$src_digest" == "$dst_digest" ]]; then
      log "  OK    $source_ref == $dst @ sha256:$src_digest"; ok=$((ok+1))
    else
      log "  FAIL  digest mismatch: $source_ref (sha256:$src_digest) != $dst (sha256:$dst_digest)"
      fail=$((fail+1))
    fi
  done < "$map_file"

  rm -f "$tmp_src" "$tmp_dst"
  log "--- Verification summary: ${ok}/${total} OK, ${fail} failed ---"
  [[ $fail -eq 0 ]] && return 0 || return 1
}

# Update manifest files with new registry and hash mappings
update_manifests() {
  local registry_path="$1"

  # Figure out which plugin we're working with (from -t or extracted images folder)
  detect_images_folder
  local active_plugin="${detected_plugin:-}"
  [[ -z "$active_plugin" && -n "${plugin:-}" && "${plugin}" != "all" ]] && active_plugin="${plugin}"
  [[ -z "$active_plugin" ]] && active_plugin="hspc"   # backward-compatible default

  # Rewrite tag- and digest-pinned image refs to the offline registry, flattening
  # the repo path to its last component to match the push layout:
  #   <any-registry>/<ns...>/<repo>:<tag>      -> <registry_path>/<repo>:<tag>
  #   <any-registry>/<ns...>/<repo>@sha256:<d> -> <registry_path>/<repo>@sha256:<d>
  #   <repo>:<tag>            (e.g. grafana/grafana:12.3.2, busybox:1.36) -> <registry_path>/<repo>:<tag>
  #   <repo>  (bare, no tag — e.g. busybox)    -> <registry_path>/<repo>:latest
  # Digests are preserved end-to-end at the mirror, so digest refs just need
  # their registry+namespace swapped; the digest stays valid.
  rewrite_images() {
    local f="$1"
    # digest refs (any number of path components, quoted or not)
    sed -i -E "s|(image:[[:space:]]*[\"']?)([^\"'[:space:]]+/)?([^/\"'[:space:]@:]+)@sha256:|\1${registry_path}/\3@sha256:|g" "$f"
    # tag refs (any number of path components, quoted or not)
    sed -i -E "s|(image:[[:space:]]*[\"']?)([^\"'[:space:]]+/)?([^/\"'[:space:]@:]+):([^\"'[:space:]]+)|\1${registry_path}/\3:\4|g" "$f"
    # bare image with no registry/tag (e.g. 'image: busybox') -> <registry_path>/busybox:latest
    sed -i -E "s|^([[:space:]]*-?[[:space:]]*image:[[:space:]]*[\"']?)([A-Za-z0-9._-]+)([\"']?)[[:space:]]*$|\1${registry_path}/\2:latest\3|" "$f"
  }

  if [[ "$active_plugin" == "hspc" ]]; then
    update_manifests_hspc "$registry_path"
  else
    update_manifests_generic "$active_plugin" "$registry_path"
  fi
}

# HSPC-specific manifest update (operator + sample driver manifests)
update_manifests_hspc() {
  local registry_path="$1"
  local operator_file
  local hspc_path

  # Anchor on the operator manifest (no more hash_mapping.csv dependency)
  operator_file=$(find . -name "hspc-operator.yaml" -path "*/operator/*" | head -1)
  if [[ -z "$operator_file" ]]; then
    lognexit "Error: Could not find hspc-operator.yaml in current directory structure"
  fi
  hspc_path=$(dirname "$(dirname "$operator_file")")

  log "--- Updating HSPC manifest files with new registry ---"

  # Operator manifest
  local operator_yaml="${hspc_path}/operator/hspc-operator.yaml"
  local operator_offline_yaml="${hspc_path}/operator/hspc-operator-offline.yaml"
  if [[ -f "$operator_yaml" ]]; then
    log "Creating offline operator manifest: hspc-operator-offline.yaml"
    cp "$operator_yaml" "$operator_offline_yaml"
    rewrite_images "$operator_offline_yaml"
  fi

  # Sample manifests
  local sample_files="${hspc_path}/sample/hspc-k8s"*.yaml
  for sample_file in $sample_files; do
    if [[ -f "$sample_file" ]]; then
      # Skip already generated offline manifests
      [[ "$sample_file" == *-offline.yaml ]] && continue
      local filename=$(basename "$sample_file")
      local offline_file="${hspc_path}/sample/${filename%.*}-offline.yaml"
      log "Creating offline sample manifest: $(basename "$offline_file")"
      cp "$sample_file" "$offline_file"
      rewrite_images "$offline_file"
    fi
  done

  log "--- Manifest files updated successfully ---"
}

# Generic manifest update for hrpc / hspp.
# Creates an '-offline.yaml' copy of every manifest containing an 'image:' line,
# under both <version>/yaml/ and <version>/dr-operator/yaml/ folders.
update_manifests_generic() {
  local active_plugin="$1"
  local registry_path="$2"

  log "--- Updating ${active_plugin} manifest files with new registry ---"

  local -a manifest_files=()
  while IFS= read -r f; do
    # Only process manifests that actually reference images
    grep -q 'image:' "$f" && manifest_files+=("$f")
  done < <(find . -path "*/yaml/*.yaml" -type f ! -name "*-offline.yaml" 2>/dev/null)

  if [[ ${#manifest_files[@]} -eq 0 ]]; then
    lognexit "Error: Could not find any ${active_plugin} manifest files (*/yaml/*.yaml) in the current directory structure"
  fi

  local f
  for f in "${manifest_files[@]}"; do
    local dir filename offline_file
    dir=$(dirname "$f")
    filename=$(basename "$f")
    offline_file="${dir}/${filename%.*}-offline.yaml"
    log "Creating offline manifest: ${offline_file#./}"
    cp "$f" "$offline_file"
    rewrite_images "$offline_file"
  done

  log "--- Manifest files updated successfully ---"
}


# Create offline CRD file with updated images from sample manifests (hspc only)
create_offline_crd() {
  local k8s_version="$1"

  # The CRD workflow only applies to HSPC
  detect_images_folder 2>/dev/null || true
  local active_plugin="${detected_plugin:-}"
  [[ -z "$active_plugin" && -n "${plugin:-}" && "${plugin}" != "all" ]] && active_plugin="${plugin}"
  if [[ -n "$active_plugin" && "$active_plugin" != "hspc" ]]; then
    log "Skipping offline CRD creation: not applicable to plugin '${active_plugin}' (hspc only)."
    return 0
  fi

  # If using -u flag, determine hspc_path from current directory structure
  operator_file=$(find . -name "hspc_v1_hspc.yaml" -path "*/operator/*" | head -1)
  if [[ -z "$operator_file" ]]; then
    lognexit "Error: Could not find hspc_v1_hspc.yaml in current directory structure"
  fi
  # Extract the base path (remove /operator/hspc_v1_hspc.yaml)
  hspc_path=$(dirname "$(dirname "$operator_file")")

  # Find the original CRD file
  local crd_file="${hspc_path}/operator/hspc_v1_hspc.yaml"
  local offline_crd_file="${hspc_path}/operator/hspc_v1_hspc_offline.yaml"

  if [[ ! -f "$crd_file" ]]; then
    log "Warning: CRD file not found: $crd_file"
    return
  fi

  log "Creating offline CRD file: hspc_v1_hspc_offline.yaml"
  cp "$crd_file" "$offline_crd_file"

  # Find the latest offline sample manifest to extract images from
  local sample_offline_file
  if [[ -n "$k8s_version" ]]; then
    # Specific k8s version provided, look for matching offline file
    sample_offline_file="${hspc_path}/sample/hspc-k8s${k8s_version}-offline.yaml"
    if [[ ! -f "$sample_offline_file" ]]; then
      log "Warning: Offline sample manifest not found for k8s version $k8s_version: $sample_offline_file"
      return
    fi
    # Create version-specific offline CRD file
    offline_crd_file="${hspc_path}/operator/hspc_v1_hspc_offline-k8s${k8s_version}.yaml"
  else
    # No k8s version specified, use the latest available
    sample_offline_file=$(find "${hspc_path}/sample" -name "hspc-k8s*-offline.yaml" | sort -V | tail -1)
  fi

  if [[ ! -f "$sample_offline_file" ]]; then
    log "Warning: No offline sample manifest found to extract images from"
    return
  fi

  log "Using images from: $(basename "$sample_offline_file")"

  # Extract images from the offline sample manifest
  local hspc_driver_image=$(grep -A 20 "name: hspc-csi-driver" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')
  local external_attacher_image=$(grep -A 10 "name: external-attacher" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')
  local csi_provisioner_image=$(grep -A 10 "name: csi-provisioner" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')
  local liveness_probe_image=$(grep -A 5 "name: liveness-probe" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')
  local csi_resizer_image=$(grep -A 5 "name: csi-resizer" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')
  local csi_snapshotter_image=$(grep -A 5 "name: csi-snapshotter" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')
  local driver_registrar_image=$(grep -A 15 "name: driver-registrar" "$sample_offline_file" | grep "image:" | head -1 | awk '{print $2}' | sed 's/"//g')

  # First, remove the existing spec: {} line from the CRD file
  sed -i '/^spec: {}$/d' "$offline_crd_file"

  # Create the updated spec section
  cat >> "$offline_crd_file" << EOF
spec:
  csiDriver:
    enable: true
  controller:
    containers:
      - name: hspc-csi-driver
        image: ${hspc_driver_image}
      - name: external-attacher
        image: ${external_attacher_image}
      - name: csi-provisioner
        image: ${csi_provisioner_image}
      - name: liveness-probe
        image: ${liveness_probe_image}
      - name: csi-resizer
        image: ${csi_resizer_image}
      - name: csi-snapshotter
        image: ${csi_snapshotter_image}
  node:
    containers:
      - name: hspc-csi-driver
        image: ${hspc_driver_image}
      - name: driver-registrar
        image: ${driver_registrar_image}
EOF

  log "Offline CRD file created with updated image references"
  log "--- Proceed to installation step ---"
}

#
# --- Main script ---
#

set -eo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

BASE_DIR="$SCRIPT_DIR"

while [[ "$BASE_DIR" != "/" ]]; do
    if [[ -d "${BASE_DIR}/hspc" ]] || [[ -d "${BASE_DIR}/hspp" ]] || [[ -d "${BASE_DIR}/hrpc" ]]; then
        break
    fi
    BASE_DIR="$(dirname "$BASE_DIR")"
done

if [[ "$BASE_DIR" == "/" ]]; then
    lognexit "Error: Could not locate the csi-operator-hitachi repository. Place the script inside the repository (for example, in an 'offline-bundle' directory)."
fi

main() {
  local plugin_version=""
  local k8s_version=""
  local registry_path=""
  local create_flag=false
  local push_flag=false
  local update_manifests_flag=false
  local new_crd_flag=false
  plugin=""   # global on purpose: used by detect_images_folder / update_manifests / create_offline_crd

  # Handle long --version option before getopts
  for arg in "$@"; do
    case "$arg" in
      --version|-version) print_version ;;
    esac
  done

  while getopts "cpunt:v:k:r:h" opt; do
    case ${opt} in
      c) create_flag=true ;;
      p) push_flag=true ;;
      u) update_manifests_flag=true ;;
      n) new_crd_flag=true ;;
      t) plugin=$OPTARG ;;
      v) plugin_version=$OPTARG ;;
      k) k8s_version=$OPTARG ;;
      r) registry_path=$OPTARG ;;
      h) usage ;;
      *) usage ;;
    esac
  done


  if ! $create_flag && ! $push_flag && ! $update_manifests_flag && ! $new_crd_flag; then
    log "Error: You must specify an action: -c (create bundle), -p (push images), -u (update manifests), or -n (create new CRD)."
    usage
  fi

  # Validate -t value if provided
  if [[ -n "$plugin" && "$plugin" != "all" ]] && ! validate_plugin "$plugin"; then
    log "Error: Invalid plugin '$plugin'. Supported: ${SUPPORTED_PLUGINS[*]} or 'all'."
    usage
  fi

  check_deps

  # Download and create the installation bundle with all required images
  if $create_flag; then
    local -a plugins_to_process=()

    if [[ "$plugin" == "all" ]]; then
      if [[ -n "$plugin_version" ]]; then
        log "Error: -v cannot be combined with '-t all'. The latest version of each plugin is used automatically."
        usage
      fi
      plugins_to_process=("${SUPPORTED_PLUGINS[@]}")
    else
      # Default to hspc for backward compatibility
      [[ -z "$plugin" ]] && plugin="hspc"
      if [[ -z "$plugin_version" ]]; then
        log "Error: Plugin version (-v) is required (or use '-t all' for latest versions)."
        usage
      fi
      plugins_to_process=("$plugin")
    fi

    if [[ -n "$k8s_version" && "${plugins_to_process[*]}" != "hspc" ]]; then
      log "Warning: -k <k8s_version> only applies to hspc; it will be ignored for other plugins."
    fi

    local p ver
    for p in "${plugins_to_process[@]}"; do
      if [[ "$plugin" == "all" ]]; then
        ver=$(get_latest_version "$p")
        log "=== Plugin '$p': latest available version is $ver ==="
      else
        ver="$plugin_version"
      fi

      plugin_path="${BASE_DIR}/${p}/${ver}"
      if [[ ! -d "$plugin_path" ]]; then
        lognexit "Error: Version folder not found: ${plugin_path}"
      fi

      local effective_k8s=""
      [[ "$p" == "hspc" ]] && effective_k8s="$k8s_version"

      log "Determining required images for ${p} ${ver}${effective_k8s:+ on K8s $effective_k8s}..."
      local image_list
      image_list=$(get_images "$p" "$ver" "$effective_k8s")

      if [ -z "$image_list" ]; then
        lognexit "Error: Could not find any images to process for ${p} ${ver}."
      fi

      # Convert newline-separated string to array
      local -a images=()
      readarray -t images < <(echo "$image_list")
      log "Found ${#images[@]} unique image(s) for ${p} ${ver}."

      create_bundle "$p" "$ver" "$effective_k8s" "${images[*]}"
    done
  fi

  # Tag and push images to a local registry, and update manifest files
  if $push_flag; then
    if [[ -z "$registry_path" ]]; then
      log "Error: Registry path (-r) is required for pushing images."; usage
    fi
    tag_and_push_images "$registry_path"
    update_manifests "$registry_path"
    create_offline_crd

    # Verification is advisory - never abort the run on a verify-only failure.
    set +e
    verify_bundle_digests "$registry_path"
    verify_rc=$?
    set -e
    if [[ $verify_rc -ne 0 ]]; then
      log "WARNING: digest verification reported issues (see above)."
      log "         Images were pushed and manifests generated; review before relying on the mirror."
    fi
  fi

  #  when there is a need to update manifest files only with new registry path without re-pulling images
  if $update_manifests_flag; then
    if [[ -z "$registry_path" ]]; then
      log "Error: Registry path (-r) is required for updating manifest files."
      usage
    fi
    update_manifests "$registry_path"
    create_offline_crd
  fi

  # when there is a need to create only the offline CRD file for specific k8s version
  if $new_crd_flag; then
    if [[ -z "$k8s_version" ]]; then
      log "Error: Kubernetes version (-k) is required."
      usage
    fi
    create_offline_crd "$k8s_version"
  fi

}

main "$@"
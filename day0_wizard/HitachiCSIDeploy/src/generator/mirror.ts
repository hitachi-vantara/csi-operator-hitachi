import { PLATFORMS } from '../catalog/platforms'
import type { WizardState } from '../catalog/types'
import { wizardVersion } from '../wizardVersion'
import { offlineRegistryPaths } from './offline'

function t(v: string | undefined | null): string {
  return (v || '').trim()
}

export function generateMirrorScript(
  state: WizardState,
  opts?: {
    extrasImages?: string[]
    hspcExtrasImages?: string[]
    verifyImages?: string[]
  },
): string {
  const plat = PLATFORMS[state.platform]
  const registryBase = t(state.offline?.registryBase)
  const paths = offlineRegistryPaths(state)
  const extrasRegistryBase = t(paths.extras)
  const extrasImages = (opts?.extrasImages || []).map((s) => s.trim()).filter(Boolean)
  const hspcExtrasImages = (opts?.hspcExtrasImages || []).map((s) => s.trim()).filter(Boolean)
  const verifyImages = (opts?.verifyImages || []).map((s) => s.trim()).filter(Boolean)
  const catalogSourceName = t(state.offline?.catalogSourceName) || 'certified-operators'
  const catalogIndexImage = t(state.offline?.catalogIndexImage)

  const bundles: { plugin: 'hspc' | 'hrpc' | 'hspp'; version: string; registryPath: string }[] = []
  if (state.components.driver) bundles.push({ plugin: 'hspc', version: state.versions.driver, registryPath: paths.hspc })
  if (state.components.replication)
    bundles.push({ plugin: 'hrpc', version: state.versions.replication, registryPath: paths.hrpc })
  if (state.components.metrics) bundles.push({ plugin: 'hspp', version: state.versions.metrics, registryPath: paths.hspp })

  const bundleLines: string[] = [
    '# On a connected computer (public internet + access to your private registry):',
    '# 1) Run ./mirror.sh to clone the operator repo and mirror images.',
    '# 2) (Optional) Mirror gap-fill images with ./mirror.sh extras (wizard-owned and any known gaps).',
    '#',
    '# Requirements on the connected computer: git, skopeo, and access to Docker registries.',
    '',
    '# This ZIP includes hvcsi-offline-bundle.sh for convenience. mirror.sh will also clone',
    '# hitachi-vantara/csi-operator-hitachi and can use the script from that repo checkout.',
    '',
    '# Mirror component images (this package):',
    'chmod +x ./mirror.sh ./hvcsi-offline-bundle.sh',
    './mirror.sh',
    '',
    '# Under the hood, mirror.sh runs these offline bundle commands per enabled plugin:',
    '#   create bundle (-c), extract tarball, push images (-p from extracted directory)',
  ]

  for (const b of bundles) {
    bundleLines.push(`hvcsi-offline-bundle.sh -c -t ${b.plugin} -v ${b.version}`)
    bundleLines.push(`tar -xzf hvcsi-${b.plugin}-${b.version}-bundle.tar.gz -C offline-bundles`)
    bundleLines.push(
      `(cd offline-bundles/hvcsi-${b.plugin}-${b.version}-bundle && hvcsi-offline-bundle.sh -p -r ${b.registryPath})`,
    )
    bundleLines.push('')
  }
  while (bundleLines.length && bundleLines[bundleLines.length - 1] === '') bundleLines.pop()

  if (extrasImages.length || hspcExtrasImages.length) {
    bundleLines.push(
      '',
      '# Optional: mirror gap-fill images (when needed by this ZIP):',
      'chmod +x ./mirror.sh && ./mirror.sh extras',
    )
  }

  const openshiftCatalogNotes = plat.operatorHub
    ? [
        '',
        '# OpenShift/ROSA (OperatorHub / OLM): mirrored catalogs',
        '# In an air-gapped cluster, OLM must see a mirrored OperatorHub catalog (separate from image mirroring).',
        '# Mirror the catalog with oc-mirror and apply the generated mirror policy (for example ImageDigestMirrorSet)',
        '# and the mirrored CatalogSource manifests in the disconnected environment.',
        `# This wizard’s Subscription uses CatalogSource name: ${catalogSourceName}`,
        catalogIndexImage
          ? `# This ZIP includes 02-driver/operatorhub-catalogsource.yaml (index image: ${catalogIndexImage}). install.sh applies it and waits for READY.`
          : '# If your mirrored CatalogSource already exists on-cluster, keep the wizard configured with that existing CatalogSource name.',
      ].join('\n')
    : ''

  const replicationInstallNotes = state.components.replication
    ? '# Replication exports a dual-site ZIP. Install order is primary then secondary (run primary/install.sh, then secondary/install.sh).'
    : '# Single-site exports run ./install.sh from the ZIP root.'

  const planText = [
    '# Air-gapped mirror plan',
    `# Wizard: ${wizardVersion()}`,
    '',
    '# Configure → Mirror → Install',
    '# 1) Configure (this wizard / ZIP): set the private registry base, then export the ZIP.',
    '# 2) Mirror (connected computer): mirroring copies container images into your private registry so the cluster does not need the public internet. Run mirror.sh to mirror images (and on OpenShift/ROSA, catalogs) into your private registry.',
    '# 3) Install (cluster admin host): in the disconnected environment, unzip and run install.sh.',
    '#',
    '# This wizard rewrites manifests to reference your private registry. It does not push images into that registry.',
    '',
    '# Private registry base:',
    `# ${registryBase}`,
    '',
    '# Component registry paths (this package):',
    state.components.driver ? `# - CSI Driver: ${paths.hspc}` : undefined,
    state.components.replication ? `# - Replication (includes DR Operator): ${paths.hrpc}` : undefined,
    state.components.metrics ? `# - Performance Metrics: ${paths.hspp}` : undefined,
    '',
    '# Mirror commands (connected computer):',
    ...bundleLines.map((l) => `# ${l}`),
    openshiftCatalogNotes ? openshiftCatalogNotes.split('\n').map((l) => `# ${l}`).join('\n') : '',
    '',
    '# Install commands (cluster admin host):',
    '# - Unzip on a machine that can reach the cluster API and the private registry.',
    `# ${replicationInstallNotes}`,
  ]
    .filter((l): l is string => typeof l === 'string')
    .join('\n')
    .replaceAll('# #', '#')

  const extrasArray =
    extrasImages.length > 0 ? `EXTRAS_IMAGES=(${extrasImages.map((i) => JSON.stringify(i)).join(' ')})` : 'EXTRAS_IMAGES=()'
  const hspcExtrasArray =
    hspcExtrasImages.length > 0
      ? `HSPC_EXTRAS_IMAGES=(${hspcExtrasImages.map((i) => JSON.stringify(i)).join(' ')})`
      : 'HSPC_EXTRAS_IMAGES=()'
  const verifyImagesArray =
    verifyImages.length > 0 ? `VERIFY_IMAGES=(${verifyImages.map((i) => JSON.stringify(i)).join(' ')})` : 'VERIFY_IMAGES=()'

  return `#!/usr/bin/env bash
set -euo pipefail

# mirror.sh — air-gapped mirror entrypoint (plan + optional extras)

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

WIZARD_VERSION=${JSON.stringify(wizardVersion())}
REGISTRY_BASE=${JSON.stringify(registryBase)}
EXTRAS_REGISTRY_BASE=${JSON.stringify(extrasRegistryBase)}
HSPC_REGISTRY_BASE=${JSON.stringify(t(paths.hspc))}
HRPC_REGISTRY_BASE=${JSON.stringify(t(paths.hrpc))}
HSPP_REGISTRY_BASE=${JSON.stringify(t(paths.hspp))}
${extrasArray}
${hspcExtrasArray}
${verifyImagesArray}

REPO_URL="https://github.com/hitachi-vantara/csi-operator-hitachi.git"
REPO_REF="main"
REPO_DIR="\${SCRIPT_DIR}/csi-operator-hitachi"
BUNDLES=(${bundles.map((b) => JSON.stringify(`${b.plugin}|${b.version}|${b.registryPath}`)).join(' ')})

VERIFY_PREFIXES=("\${EXTRAS_REGISTRY_BASE}" "\${HSPC_REGISTRY_BASE}" "\${HRPC_REGISTRY_BASE}" "\${HSPP_REGISTRY_BASE}")

print_plan() {
  cat <<'EOF'
${planText}
EOF
}

usage() {
  cat <<'EOF'
Usage: ./mirror.sh [mirror|plan|extras]

  mirror Mirror component images into your private registry (default)
  plan   Print the mirror plan for this ZIP
  extras Mirror gap-fill images with skopeo (only if this ZIP needs them)
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing required command: $1" >&2; exit 1; }
}

ensure_repo() {
  require_cmd git
  if [[ -d "\${REPO_DIR}/.git" ]]; then
    echo "==> Using existing repo clone: \${REPO_DIR}"
    return 0
  fi
  echo "==> Cloning \${REPO_URL} (\${REPO_REF}) to \${REPO_DIR}"
  git clone --depth 1 --branch "\${REPO_REF}" "\${REPO_URL}" "\${REPO_DIR}"
}

pick_bundle_script() {
  local bundled="\${SCRIPT_DIR}/hvcsi-offline-bundle.sh"
  local repo_script="\${REPO_DIR}/hvcsi-offline-bundle.sh"
  if [[ -f "\${bundled}" && -f "\${repo_script}" ]]; then
    if grep -q "WIZARD_OFFLINE_BUNDLE_PLACEHOLDER=1" "\${bundled}" 2>/dev/null; then
      echo "\${repo_script}"
      return 0
    fi
    # Prefer the wizard-packaged copy (day-0 UX); overwrite the repo copy to ensure consistency.
    cp -f "\${bundled}" "\${repo_script}"
  fi
  echo "\${repo_script}"
}

run_bundle() {
  local plugin="$1"
  local version="$2"
  local registry_path="$3"
  local script_path="$4"

  echo "==> Bundle: \${plugin} \${version}"
  (cd "\${REPO_DIR}" && chmod +x "\${script_path}" && "\${script_path}" -c -t "\${plugin}" -v "\${version}")

  local tarball="\${REPO_DIR}/hvcsi-\${plugin}-\${version}-bundle.tar.gz"
  if [[ ! -f "\${tarball}" ]]; then
    echo "ERROR: Expected bundle tarball not found: \${tarball}" >&2
    exit 1
  fi

  local out_base="\${SCRIPT_DIR}/offline-bundles"
  mkdir -p "\${out_base}"
  rm -rf "\${out_base}/hvcsi-\${plugin}-\${version}-bundle"
  tar -xzf "\${tarball}" -C "\${out_base}"

  local extracted="\${out_base}/hvcsi-\${plugin}-\${version}-bundle"
  echo "==> Push: \${plugin} images to \${registry_path}"
  (cd "\${extracted}" && "\${script_path}" -p -r "\${registry_path}")
}

is_truthy() {
  case "\${1:-}" in
    1|true|TRUE|yes|YES|y|Y) return 0 ;;
    *) return 1 ;;
  esac
}

skopeo_tls_flag() {
  # Carry over insecure-registry behavior from other scripts when set.
  # (Common: HSPC_INSECURE_REG=1 for OpenShift route-based registries.)
  if is_truthy "\${HSPC_INSECURE_REG:-}" || is_truthy "\${HRPC_INSECURE_REG:-}" || is_truthy "\${HSPP_INSECURE_REG:-}" || is_truthy "\${INSECURE_REG:-}"; then
    echo "--tls-verify=false"
  else
    echo ""
  fi
}

image_matches_verify_prefixes() {
  local ref="$1"
  local p
  for p in "\${VERIFY_PREFIXES[@]}"; do
    [[ -z "\${p}" ]] && continue
    if [[ "\${ref}" == "\${p}"* ]]; then
      return 0
    fi
  done
  return 1
}

inspect_image_exists() {
  local ref="$1"

  if command -v skopeo >/dev/null 2>&1; then
    local tls
    tls="$(skopeo_tls_flag)"
    # shellcheck disable=SC2086
    skopeo inspect \${tls} "docker://\${ref}" >/dev/null 2>&1
    return $?
  fi

  if command -v docker >/dev/null 2>&1; then
    docker manifest inspect "\${ref}" >/dev/null 2>&1
    return $?
  fi

  echo "ERROR: verify requires skopeo (preferred) or docker." >&2
  return 2
}

verify_images() {
  if is_truthy "\${SKIP_VERIFY:-}"; then
    echo "==> Verify: SKIP_VERIFY=1 (skipping image existence checks)"
    return 0
  fi

  if [[ "\${#VERIFY_IMAGES[@]}" -eq 0 ]]; then
    echo "==> Verify: no images listed to verify"
    return 0
  fi

  declare -A seen=()
  local images=()
  local img
  for img in "\${VERIFY_IMAGES[@]}"; do
    [[ -z "\${img}" ]] && continue
    image_matches_verify_prefixes "\${img}" || continue
    [[ -n "\${seen[\${img}]:-}" ]] && continue
    seen[\${img}]=1
    images+=("\${img}")
  done

  if [[ "\${#images[@]}" -eq 0 ]]; then
    echo "==> Verify: no images matched your configured registry base"
    return 0
  fi

  echo "==> Verify: checking \${#images[@]} images exist in your registry"
  local missing=()
  for img in "\${images[@]}"; do
    if ! inspect_image_exists "\${img}"; then
      missing+=("\${img}")
    fi
  done

  if [[ "\${#missing[@]}" -gt 0 ]]; then
    echo "ERROR: \${#missing[@]}/\${#images[@]} images are missing from your registry:" >&2
    for img in "\${missing[@]}"; do
      echo "  - \${img}" >&2
    done
    echo "\${#missing[@]} images missing — re-run mirror.sh to retry." >&2
    exit 1
  fi

  echo "\${#images[@]}/\${#images[@]} images verified"
}

run_mirror() {
  require_cmd skopeo
  ensure_repo
  local script_path
  script_path="$(pick_bundle_script)"
  if [[ ! -f "\${script_path}" ]]; then
    echo "ERROR: offline bundle helper not found at \${script_path}" >&2
    exit 1
  fi

  if [[ "\${#BUNDLES[@]}" -eq 0 ]]; then
    echo "No components enabled for mirroring in this ZIP."
    return 0
  fi

  local entry plugin version registry_path
  for entry in "\${BUNDLES[@]}"; do
    plugin="\${entry%%|*}"
    version="\${entry#*|}"; version="\${version%%|*}"
    registry_path="\${entry##*|}"
    run_bundle "\${plugin}" "\${version}" "\${registry_path}" "\${script_path}"
  done

  verify_images
}

run_extras() {
  if [[ "\${#EXTRAS_IMAGES[@]}" -eq 0 && "\${#HSPC_EXTRAS_IMAGES[@]}" -eq 0 ]]; then
    echo "No gap-fill images are required for this ZIP."
    return 0
  fi
  command -v skopeo >/dev/null 2>&1 || { echo "ERROR: skopeo is required." >&2; exit 1; }

  if [[ "\${#EXTRAS_IMAGES[@]}" -gt 0 && -z "\${EXTRAS_REGISTRY_BASE:-}" ]]; then
    echo "ERROR: EXTRAS_REGISTRY_BASE is empty (wizard did not compute an extras path)." >&2
    exit 1
  fi
  if [[ "\${#HSPC_EXTRAS_IMAGES[@]}" -gt 0 && -z "\${HSPC_REGISTRY_BASE:-}" ]]; then
    echo "ERROR: HSPC_REGISTRY_BASE is empty (wizard did not compute an hspc path)." >&2
    exit 1
  fi

  if [[ "\${#EXTRAS_IMAGES[@]}" -gt 0 ]]; then
    echo "==> Mirroring wizard-owned images to \$EXTRAS_REGISTRY_BASE"
  fi
  local src dst
  for src in "\${EXTRAS_IMAGES[@]}"; do
    dst="\${src##*/}"
    skopeo copy "docker://\${src}" "docker://\${EXTRAS_REGISTRY_BASE}/\${dst}"
  done

  if [[ "\${#HSPC_EXTRAS_IMAGES[@]}" -gt 0 ]]; then
    echo "==> Mirroring component gap-fill images to \$HSPC_REGISTRY_BASE"
  fi
  for src in "\${HSPC_EXTRAS_IMAGES[@]}"; do
    dst="\${src##*/}"
    skopeo copy "docker://\${src}" "docker://\${HSPC_REGISTRY_BASE}/\${dst}"
  done

  verify_images
}

cmd="\${1:-mirror}"
case "$cmd" in
  mirror|--mirror|run)
    run_mirror
    ;;
  plan|--plan|-p|'')
    print_plan
    ;;
  extras|--extras)
    run_extras
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "ERROR: unknown command: $cmd" >&2
    echo >&2
    usage >&2
    exit 2
    ;;
esac
`
}


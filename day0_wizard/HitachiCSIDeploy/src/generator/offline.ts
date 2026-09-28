export type OfflineRegistryConfig = {
  registryBase: string
  hspcPath?: string
  hrpcPath?: string
  hsppPath?: string
}

const IMAGE_LINE_RE = /^(\s*-?\s*image:\s*)(['"]?)([^\s'"]+)\2/

function trimRegistryBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function pluginPath(base: string, override: string | undefined, suffix: string): string {
  const trimmedOverride = override?.trim()
  if (trimmedOverride) return trimmedOverride
  return `${base}/${suffix}`
}

export function offlineRegistryPaths(state: {
  offline?: OfflineRegistryConfig
}): { hspc: string; hrpc: string; hspp: string; extras: string } {
  const base = trimRegistryBase(state.offline?.registryBase?.trim() ?? '')
  if (!base) {
    return { hspc: '', hrpc: '', hspp: '', extras: '' }
  }

  return {
    hspc: pluginPath(base, state.offline?.hspcPath, 'hspc'),
    hrpc: pluginPath(base, state.offline?.hrpcPath, 'hrpc'),
    hspp: pluginPath(base, state.offline?.hsppPath, 'hspp'),
    extras: base,
  }
}

export function rewriteImagesToRegistry(yaml: string, registryPath: string): string {
  const prefix = `${registryPath}/`
  return yaml
    .split('\n')
    .map((line) => {
      const match = line.match(IMAGE_LINE_RE)
      if (!match) return line

      const imgPrefix = match[1]
      const quote = match[2] ?? ''
      const ref = match[3] ?? ''

      if (ref.startsWith(prefix)) {
        return line
      }

      let rewritten = ''
      if (ref.includes('@sha256:')) {
        const [before, digestRest] = ref.split('@sha256:')
        const repo = before.split('/').pop() || before
        rewritten = `${registryPath}/${repo}@sha256:${digestRest}`
      } else {
        const lastSlash = ref.lastIndexOf('/')
        const lastColon = ref.lastIndexOf(':')
        if (lastColon > lastSlash) {
          const before = ref.slice(0, lastColon)
          const tag = ref.slice(lastColon + 1)
          const repo = before.split('/').pop() || before
          rewritten = `${registryPath}/${repo}:${tag}`
        } else {
          const repo = ref.split('/').pop() || ref
          rewritten = `${registryPath}/${repo}:latest`
        }
      }

      return line.replace(IMAGE_LINE_RE, `${imgPrefix}${quote}${rewritten}${quote}`)
    })
    .join('\n')
}

export function extractImages(yaml: string): string[] {
  const images = new Set<string>()

  for (const line of yaml.split('\n')) {
    if (!line.includes('image:')) continue
    const match = line.match(/image:\s*(['"]?)([^\s'"]+)\1/)
    if (match) images.add(match[2])
  }

  return [...images].sort()
}

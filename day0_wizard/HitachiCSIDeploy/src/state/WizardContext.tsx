import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  createDefaultState,
  STORAGE_KEY,
  WIZARD_STATE_VERSION,
  type WizardState,
} from '../catalog/types'
import { copyPrimarySiteMetricsToTopLevel } from '../catalog/metrics'
import { ensureSitesForReplication, resolvedStorageClassName, type SiteId } from '../catalog/sites'
import type { WizardFix } from '../catalog/validation'
import {
  PLATFORMS,
  coerceConnectionType,
  connectionsForStorageClassKind,
  defaultOpenShiftTopology,
  effectiveMultipathDelivery,
  multipathFlagsForDelivery,
  migrateStorageSystemFamily,
  supportsImmutableSnapshots,
} from '../catalog/platforms'
import { migrateArrayBinding } from '../catalog/arrayBinding'
import { fetchVersions, pickListedVersion, type VersionInfo } from '../services/versions'
import { exportConfigJson, parseWizardConfigJson } from './exportConfig'
import { migrateMetricsConfig } from './migrateMetrics'
import { migrateOfflineConfig } from './migrateOffline'
import { STEPS_BASE, type VisibleStep } from './steps'
import { persistSiteTabFocus } from './siteTabFocus'

interface WizardContextValue {
  state: WizardState
  setState: React.Dispatch<React.SetStateAction<WizardState>>
  update: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void
  patch: (partial: Partial<WizardState>) => void
  reset: () => void
  exportConfig: () => string
  importConfig: (json: string) => void
  versions: VersionInfo | null
  versionsLoading: boolean
  stepIndex: number
  setStepIndex: (i: number) => void
  visibleSteps: VisibleStep[]
  /** One-shot: open this site tab on Storage systems / StorageClasses */
  siteTabFocus: SiteId | null
  clearSiteTabFocus: () => void
  goToFix: (fix: WizardFix) => void
}

const WizardContext = createContext<WizardContextValue | null>(null)

function loadState(): WizardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultState()
    const parsed = JSON.parse(raw) as WizardState
    if (parsed.version !== WIZARD_STATE_VERSION) return createDefaultState()
    let merged = { ...createDefaultState(), ...parsed }
    if (merged.storageClassesEnabled === undefined) {
      merged.storageClassesEnabled = true
    }
    if (parsed.telemetryEnabled === undefined) {
      merged.telemetryEnabled = true
    }
    // Deep-merge nested objects that may be missing from older saves
    merged.multipath = { ...createDefaultState().multipath, ...(parsed.multipath || {}) }
    merged.components = { ...createDefaultState().components, ...(parsed.components || {}) }
    merged.snapshotClass = {
      ...createDefaultState().snapshotClass,
      ...(parsed.snapshotClass || {}),
    }
    merged.replication = {
      ...createDefaultState().replication,
      ...(parsed.replication || {}),
      primaryKubeconfig: undefined,
      secondaryKubeconfig: undefined,
    }
    // Migrate stale OpenShift default: CR must share OperatorHub namespace
    const plat = PLATFORMS[merged.platform]
    if (plat?.operatorHub && merged.driverNamespace === 'kube-system') {
      merged.driverNamespace = merged.operatorNamespace || 'hspc-operator-system'
      merged.operatorNamespace = merged.operatorNamespace || 'hspc-operator-system'
    }
    // Storage Secrets default to the CSI Driver install namespace (not "default")
    merged.storageClasses = (merged.storageClasses || []).map((sc) =>
      sc.secretNamespace === 'default'
        ? { ...sc, secretNamespace: merged.driverNamespace }
        : sc,
    )
    // Topology + multipath delivery flags (do not force MachineConfig on all useOc)
    if (merged.openshiftTopology !== 'classic' && merged.openshiftTopology !== 'hosted') {
      merged.openshiftTopology = defaultOpenShiftTopology(merged.platform)
    } else if (!parsed.openshiftTopology && plat?.useOc) {
      merged.openshiftTopology = defaultOpenShiftTopology(merged.platform)
    }
    const needsDm =
      merged.connectionType === 'fc' || merged.connectionType === 'iscsi'
    const delivery =
      merged.multipath.enabled && needsDm
        ? effectiveMultipathDelivery({
            platform: merged.platform,
            openshiftTopology: merged.openshiftTopology,
            needsDm: true,
          })
        : 'none'
    const flags = multipathFlagsForDelivery(delivery)
    merged.multipath = {
      ...merged.multipath,
      ...flags,
      alreadyApplied: !!merged.multipath.alreadyApplied,
    }
    // Coerce connection types against node environment + StorageClass kind limits
    const env = merged.nodeEnvironment || 'bare-metal'
    merged.nodeEnvironment = env
    merged.connectionType = coerceConnectionType(
      merged.connectionType,
      connectionsForStorageClassKind('standard', env),
    )
    merged.storageClasses = (merged.storageClasses || []).map((sc) => ({
      ...sc,
      connectionType: coerceConnectionType(
        sc.connectionType,
        connectionsForStorageClassKind(sc.kind, env),
      ),
    }))
    // At most one default StorageClass
    let sawDefaultSc = false
    merged.storageClasses = merged.storageClasses.map((sc) => {
      if (!sc.isDefault) return sc
      if (sawDefaultSc) return { ...sc, isDefault: false }
      sawDefaultSc = true
      return sc
    })
    merged.storageSystems = (merged.storageSystems || []).map((sys) =>
      migrateStorageSystemFamily(sys),
    )
    if (merged.sites) {
      merged.sites = {
        primary: {
          ...merged.sites.primary,
          storageSystems: (merged.sites.primary.storageSystems || []).map((sys) =>
            migrateStorageSystemFamily(sys),
          ),
        },
        secondary: {
          ...merged.sites.secondary,
          storageSystems: (merged.sites.secondary.storageSystems || []).map((sys) =>
            migrateStorageSystemFamily(sys),
          ),
        },
      }
    }
    // Immutable snapshots: B20 / High End only; drop stale flag on unsupported arrays
    const primary = merged.storageSystems?.[0]
    if (merged.snapshotClass.immutable && !supportsImmutableSnapshots(primary)) {
      merged.snapshotClass = { ...merged.snapshotClass, immutable: false }
    }
    if (!merged.snapshotClass.retentionPeriod) {
      merged.snapshotClass.retentionPeriod = '24'
    }
    merged.metrics = migrateMetricsConfig(parsed.metrics, createDefaultState().metrics)
    merged.offline = migrateOfflineConfig(parsed.offline, createDefaultState().offline)
    if (merged.components.replication) {
      merged = ensureSitesForReplication(merged)
    }
    merged = migrateArrayBinding(merged)
    merged.quickstart = {
      ...merged.quickstart,
      storageClassName: resolvedStorageClassName(merged),
    }
    return merged
  } catch {
    return createDefaultState()
  }
}

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WizardState>(loadState)
  const [stepIndex, setStepIndex] = useState(0)
  const [siteTabFocus, setSiteTabFocus] = useState<SiteId | null>(null)
  const [versions, setVersions] = useState<VersionInfo | null>(null)
  const [versionsLoading, setVersionsLoading] = useState(true)

  useEffect(() => {
    const toStore = {
      ...state,
      replication: {
        ...state.replication,
        // Never persist kubeconfig credentials in localStorage
        primaryKubeconfig: undefined,
        secondaryKubeconfig: undefined,
      },
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore))
  }, [state])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setVersionsLoading(true)
      const v = await fetchVersions()
      if (cancelled) return
      setVersions(v)
      setState((s) => ({
        ...s,
        versions: {
          driver: pickListedVersion(s.versions.driver, v.hspc, v.latest.hspc),
          replication: pickListedVersion(s.versions.replication, v.hrpc, v.latest.hrpc),
          metrics: pickListedVersion(s.versions.metrics, v.hspp, v.latest.hspp),
        },
      }))
      setVersionsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Sync dependent flags when platform/components change
  useEffect(() => {
    const plat = PLATFORMS[state.platform]
    setState((s) => {
      let changed = false
      const next = { ...s }
      if (!plat.supportsConsolePlugin && s.components.consolePlugin) {
        next.components = { ...s.components, consolePlugin: false }
        changed = true
      }
      if (s.components.consolePlugin && !s.components.metrics) {
        next.components = { ...next.components, metrics: true }
        changed = true
      }
      // DR Operator is always included with Replication
      if (s.components.replication && !s.components.disasterRecovery) {
        next.components = { ...next.components, disasterRecovery: true }
        next.replication = { ...next.replication, disasterRecovery: true }
        changed = true
      }
      if (!s.components.replication && s.components.disasterRecovery) {
        next.components = { ...next.components, disasterRecovery: false }
        next.replication = { ...next.replication, disasterRecovery: false }
        changed = true
      }
      return changed ? next : s
    })
  }, [
    state.platform,
    state.components.consolePlugin,
    state.components.disasterRecovery,
    state.components.metrics,
    state.components.replication,
  ])

  const prevReplicationRef = useRef(state.components.replication)
  useEffect(() => {
    const wasReplication = prevReplicationRef.current
    const isReplication = state.components.replication
    prevReplicationRef.current = isReplication
    if (wasReplication && !isReplication) {
      setState((s) => copyPrimarySiteMetricsToTopLevel(s))
    }
  }, [state.components.replication])

  // Keep the saved PVC StorageClass name in the live class list (rename / delete / site switch).
  useEffect(() => {
    setState((s) => {
      const next = resolvedStorageClassName(s)
      if ((s.quickstart.storageClassName || '').trim() === next) return s
      return { ...s, quickstart: { ...s.quickstart, storageClassName: next } }
    })
  }, [
    state.storageClassesEnabled,
    state.components.replication,
    state.storageClasses,
    state.sites,
  ])

  const visibleSteps = useMemo((): VisibleStep[] => {
    return STEPS_BASE.filter((step) => {
      if (step.id === 'prerequisites-multipath') return state.multipath.enabled
      if (step.id === 'replication') return state.components.replication
      if (step.id === 'metrics') return state.components.metrics
      if (step.id === 'console') {
        return state.components.consolePlugin && PLATFORMS[state.platform].supportsConsolePlugin
      }
      if (step.id === 'quickstart') return state.storageClassesEnabled
      return true
    }).map((step) => {
      if (step.id === 'prerequisites-checklist' && !state.multipath.enabled) {
        return {
          id: step.id,
          title: 'Prerequisites',
          description: 'Environment checklist',
          group: step.group,
        }
      }
      return {
        id: step.id,
        title: step.title,
        description: step.description,
        group: step.group,
      }
    })
  }, [state.components, state.platform, state.multipath.enabled, state.storageClassesEnabled])

  const stepIdRef = useRef(visibleSteps[0]?.id ?? 'platform')
  useEffect(() => {
    stepIdRef.current = visibleSteps[stepIndex]?.id ?? stepIdRef.current
  }, [stepIndex, visibleSteps])

  useEffect(() => {
    const wanted = stepIdRef.current
    let idx = visibleSteps.findIndex((s) => s.id === wanted)
    if (idx < 0 && wanted === 'prerequisites-multipath') {
      idx = visibleSteps.findIndex((s) => s.id === 'prerequisites-checklist')
    }
    if (idx < 0) idx = Math.max(0, visibleSteps.length - 1)
    setStepIndex((current) => (current === idx ? current : idx))
  }, [visibleSteps])

  const update = useCallback(<K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState((s) => ({ ...s, [key]: value }))
  }, [])

  const patch = useCallback((partial: Partial<WizardState>) => {
    setState((s) => ({ ...s, ...partial }))
  }, [])

  const reset = useCallback(() => {
    const fresh = createDefaultState()
    if (versions) {
      fresh.versions = {
        driver: versions.latest.hspc,
        replication: versions.latest.hrpc,
        metrics: versions.latest.hspp,
      }
    }
    setState(fresh)
    setStepIndex(0)
  }, [versions])

  const exportConfig = useCallback(() => exportConfigJson(state), [state])

  const importConfig = useCallback((json: string) => {
    const parsed = parseWizardConfigJson(json)
    const base = createDefaultState()
    const next = { ...base, ...parsed, version: WIZARD_STATE_VERSION }
    next.metrics = migrateMetricsConfig(parsed.metrics, base.metrics)
    next.offline = migrateOfflineConfig(parsed.offline, base.offline)
    next.storageSystems = (next.storageSystems || []).map((sys) => migrateStorageSystemFamily(sys))
    if (next.sites) {
      next.sites = {
        primary: {
          ...next.sites.primary,
          storageSystems: (next.sites.primary.storageSystems || []).map((sys) =>
            migrateStorageSystemFamily(sys),
          ),
        },
        secondary: {
          ...next.sites.secondary,
          storageSystems: (next.sites.secondary.storageSystems || []).map((sys) =>
            migrateStorageSystemFamily(sys),
          ),
        },
      }
    }
    const ensured = next.components.replication ? ensureSitesForReplication(next) : next
    setState(migrateArrayBinding(ensured))
  }, [])

  const clearSiteTabFocus = useCallback(() => setSiteTabFocus(null), [])

  const goToFix = useCallback(
    (fix: WizardFix) => {
      if (fix.site) {
        setSiteTabFocus(fix.site)
        persistSiteTabFocus(fix.site)
      }
      const idx = visibleSteps.findIndex((s) => s.id === fix.stepId)
      if (idx >= 0) setStepIndex(idx)
    },
    [visibleSteps],
  )

  const value: WizardContextValue = {
    state,
    setState,
    update,
    patch,
    reset,
    exportConfig,
    importConfig,
    versions,
    versionsLoading,
    stepIndex,
    setStepIndex,
    visibleSteps,
    siteTabFocus,
    clearSiteTabFocus,
    goToFix,
  }

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>
}

export function useWizard() {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error('useWizard must be used within WizardProvider')
  return ctx
}

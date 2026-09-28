/**
 * Animated resource-topology diagram for the welcome modal.
 * Draws the resources the wizard generates, in install order, with
 * connector lines and flowing "provisioning" packets. Pure SVG + CSS.
 * Remounts when the welcome modal opens (parent gates on `open`).
 */

const CARD_W = 148
const CARD_H = 46

// Column x origins (4 columns) and row y origins
const COL = [22, 196, 370, 544]
const ROW1 = 26
const ROW2 = 128
const OPT_Y = 240

// Curve Driver → Secret; ends vertically inside the arrow body so the join stays flush
const DRIVER_TO_SECRET = 'M 444 72 C 300 105 96 80 96 126'
// Dashed drop from CSI Driver into the optional add-on lane
const ADDON_PATH = 'M 444 72 C 444 96 531 96 531 124 L 531 230'

type IconId =
  | 'machineconfig'
  | 'operator'
  | 'driver'
  | 'secret'
  | 'storageclass'
  | 'pvc'
  | 'pod'
  | 'replication'
  | 'metrics'
  | 'console'

function Icon({ id }: { id: IconId }) {
  switch (id) {
    case 'machineconfig':
      return (
        <g>
          <rect x="-6" y="-5.5" width="12" height="4.6" rx="1.2" />
          <rect x="-6" y="0.9" width="12" height="4.6" rx="1.2" />
          <circle cx="-3.4" cy="-3.2" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="-3.4" cy="3.2" r="0.9" fill="currentColor" stroke="none" />
        </g>
      )
    case 'operator':
      return (
        <g>
          <circle r="2.6" />
          <path d="M 0 -6.2 V -4 M 0 4 V 6.2 M -6.2 0 H -4 M 4 0 H 6.2 M -4.4 -4.4 L -2.9 -2.9 M 2.9 2.9 L 4.4 4.4 M 4.4 -4.4 L 2.9 -2.9 M -2.9 2.9 L -4.4 4.4" />
        </g>
      )
    case 'driver':
      return (
        <g>
          <path d="M 0 -6.4 L 5.6 -3.2 V 3.2 L 0 6.4 L -5.6 3.2 V -3.2 Z" />
          <circle cx="0" cy="0" r="1.6" fill="currentColor" stroke="none" />
        </g>
      )
    case 'secret':
      return (
        <g>
          <rect x="-4.6" y="-1" width="9.2" height="7.2" rx="1.4" />
          <path d="M -2.6 -1 V -2.8 A 2.6 2.6 0 0 1 2.6 -2.8 V -1" />
          <circle cx="0" cy="2.6" r="1" fill="currentColor" stroke="none" />
        </g>
      )
    case 'storageclass':
      return (
        <g>
          <ellipse cx="0" cy="-3.8" rx="5.4" ry="2.2" />
          <path d="M -5.4 -3.8 V 3.8 A 5.4 2.2 0 0 0 5.4 3.8 V -3.8" />
          <path d="M -5.4 0 A 5.4 2.2 0 0 0 5.4 0" />
        </g>
      )
    case 'pvc':
      return (
        <g>
          <rect x="-4.4" y="-6" width="8.8" height="12" rx="1.4" />
          <path d="M -2 -2.4 H 2 M -2 0.4 H 2 M -2 3.2 H 0.6" />
        </g>
      )
    case 'pod':
      return (
        <g>
          <path d="M 0 -6.2 L 5.4 -3.1 V 3.1 L 0 6.2 L -5.4 3.1 V -3.1 Z" />
          <path d="M -5.4 -3.1 L 0 0 L 5.4 -3.1 M 0 0 V 6.2" />
        </g>
      )
    case 'replication':
      return (
        <g>
          <path d="M -5 -1.6 A 5.4 5.4 0 0 1 4.6 -3.4" />
          <path d="M 5 1.6 A 5.4 5.4 0 0 1 -4.6 3.4" />
          <path d="M 4.8 -6 L 4.6 -3.4 L 2 -3.7" fill="none" />
          <path d="M -4.8 6 L -4.6 3.4 L -2 3.7" fill="none" />
        </g>
      )
    case 'metrics':
      return (
        <g>
          <path d="M -4.6 6 V 0.6 M 0 6 V -4.6 M 4.6 6 V -1.6" strokeWidth="2.2" />
        </g>
      )
    case 'console':
      return (
        <g>
          <rect x="-6" y="-4.8" width="12" height="9.6" rx="1.4" />
          <path d="M -6 -1.8 H 6" />
          <path d="M -3.6 0.8 L -1.6 2.4 L -3.6 4" fill="none" />
        </g>
      )
  }
}

interface NodeSpec {
  x: number
  y: number
  kind: string
  name: string
  icon: IconId
  delay: number
  optional?: boolean
  width?: number
}

const OPT_W = 168

const NODES: NodeSpec[] = [
  { x: COL[0], y: ROW1, kind: 'MACHINECONFIG', name: 'Multipath', icon: 'machineconfig', delay: 0.2 },
  { x: COL[1], y: ROW1, kind: 'OPERATOR', name: 'CSI Operator', icon: 'operator', delay: 0.85 },
  { x: COL[2], y: ROW1, kind: 'HSPC', name: 'CSI Driver', icon: 'driver', delay: 1.5 },
  { x: COL[0], y: ROW2, kind: 'SECRET', name: 'Array credentials', icon: 'secret', delay: 2.1 },
  { x: COL[1], y: ROW2, kind: 'STORAGECLASS', name: 'Hitachi VSP', icon: 'storageclass', delay: 2.75 },
  { x: COL[2], y: ROW2, kind: 'PVC', name: 'Test volume', icon: 'pvc', delay: 3.4 },
  { x: COL[3], y: ROW2, kind: 'POD', name: 'Test workload', icon: 'pod', delay: 4.05 },
  { x: 92, y: OPT_Y, kind: 'OPERATOR · HRPC', name: 'Replication + DR', icon: 'replication', delay: 4.65, optional: true, width: OPT_W },
  { x: 278, y: OPT_Y, kind: 'EXPORTER · HSPP', name: 'Performance Metrics', icon: 'metrics', delay: 4.8, optional: true, width: OPT_W },
  { x: 464, y: OPT_Y, kind: 'CONSOLEPLUGIN', name: 'OpenShift Console', icon: 'console', delay: 4.95, optional: true, width: OPT_W },
]

interface EdgeSpec {
  d: string
  delay: number
  /** Use marker-end (horizontal). Driver→Secret uses an explicit down arrow instead. */
  marker?: boolean
}

const EDGES: EdgeSpec[] = [
  { d: 'M 170 49 L 198 49', delay: 0.6, marker: true },
  { d: 'M 344 49 L 372 49', delay: 1.25, marker: true },
  { d: DRIVER_TO_SECRET, delay: 1.95 },
  { d: 'M 170 151 L 198 151', delay: 2.5, marker: true },
  { d: 'M 344 151 L 372 151', delay: 3.15, marker: true },
  { d: 'M 518 151 L 546 151', delay: 3.8, marker: true },
]

function Node({ spec }: { spec: NodeSpec }) {
  const { x, y, kind, name, icon, delay, optional, width = CARD_W } = spec
  return (
    <g className={`topo-node${optional ? ' topo-node-optional' : ''}`} style={{ animationDelay: `${delay}s` }}>
      <rect className="topo-card" x={x} y={y} width={width} height={CARD_H} rx="10" />
      <circle className="topo-icon-bg" cx={x + 23} cy={y + 23} r="13" />
      <g className="topo-icon" transform={`translate(${x + 23}, ${y + 23})`}>
        <Icon id={icon} />
      </g>
      <text className="topo-kind" x={x + 44} y={y + 19}>
        {kind}
      </text>
      <text className="topo-name" x={x + 44} y={y + 34}>
        {name}
      </text>
    </g>
  )
}

export function TopologyDiagram() {
  return (
    <div className="topo-wrap">
      <div className="topo-header">
        <span className="topo-title">What this wizard assembles for your cluster</span>
      </div>
      <div className="topo-canvas">
        <svg
          viewBox="0 0 720 312"
          role="img"
          aria-label="Topology of resources this wizard generates: multipath MachineConfig, CSI operator and driver, array credential Secret, StorageClass, then a test PVC and Pod, with optional Replication, Performance Metrics, and OpenShift Console Plugin add-ons"
        >
          <defs>
            <pattern id="topo-grid" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" className="topo-grid-dot" />
            </pattern>
            <radialGradient id="topo-bg" cx="50%" cy="0%" r="120%">
              <stop offset="0%" stopColor="#131c2b" />
              <stop offset="100%" stopColor="#0a0f18" />
            </radialGradient>
            <marker
              id="topo-arrowhead"
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="rgba(148, 163, 184, 0.85)" />
            </marker>
          </defs>

          <rect x="0" y="0" width="720" height="312" fill="url(#topo-bg)" rx="0" />
          <rect x="0" y="0" width="720" height="312" fill="url(#topo-grid)" />

          {/* Edges (behind cards so packets glide underneath them) */}
          {EDGES.map((e, i) => (
            <path
              key={i}
              className="topo-edge"
              d={e.d}
              markerEnd={e.marker ? 'url(#topo-arrowhead)' : undefined}
              style={{ animationDelay: `${e.delay}s` }}
            />
          ))}
          {/* Explicit down-arrow: auto-orient markers mis-aim after the L-bend */}
          <polygon
            className="topo-edge-cap"
            points="96,134 91.5,122 100.5,122"
            style={{ animationDelay: '2.3s' }}
          />

          {/* Dashed drop into the optional add-on lane */}
          <path className="topo-edge-dashed" d={ADDON_PATH} style={{ animationDelay: '4.5s' }} />

          {/* Optional add-on lane */}
          <g className="topo-group" style={{ animationDelay: '4.5s' }}>
            <rect x="80" y="230" width="560" height="66" rx="12" className="topo-group-box" />
            <text x="96" y="226" className="topo-group-label">
              OPTIONAL ADD-ONS
            </text>
          </g>

          {/* Flowing packets (start after the build sequence settles) */}
          <g className="topo-packets">
            <circle className="topo-packet" r="3">
              <animateMotion dur="2.4s" begin="5.2s" repeatCount="indefinite" path="M 170 49 H 370" />
            </circle>
            <circle className="topo-packet" r="3">
              <animateMotion dur="2.2s" begin="5.8s" repeatCount="indefinite" path={DRIVER_TO_SECRET} />
            </circle>
            <circle className="topo-packet" r="3">
              <animateMotion dur="3.2s" begin="5.2s" repeatCount="indefinite" path="M 170 151 H 544" />
            </circle>
            <circle className="topo-packet" r="3">
              <animateMotion dur="3.2s" begin="6.8s" repeatCount="indefinite" path="M 170 151 H 544" />
            </circle>
          </g>

          {/* Resource cards */}
          {NODES.map((n) => (
            <Node key={n.name} spec={n} />
          ))}

          {/* Payoff: PVC binds */}
          <g className="topo-bound" style={{ animationDelay: '5s' }}>
            <rect x="466" y="119" width="58" height="17" rx="8.5" className="topo-bound-pill" />
            <circle cx="476" cy="127.5" r="2.4" className="topo-bound-dot" />
            <text x="483" y="131" className="topo-bound-text">
              Bound
            </text>
          </g>
        </svg>
      </div>
      <div className="topo-legend">
        <span className="topo-legend-item">
          <span className="topo-legend-line" /> Applied in order by <code>install.sh</code>
        </span>
        <span className="topo-legend-item">
          <span className="topo-legend-line dashed" /> Optional components
        </span>
        <span className="topo-legend-item">
          <span className="topo-legend-dot" /> Provisioning flow
        </span>
      </div>
    </div>
  )
}

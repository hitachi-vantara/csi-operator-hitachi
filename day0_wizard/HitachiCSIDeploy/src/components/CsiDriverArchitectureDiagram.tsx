/**
 * Theme-aware CSI Driver architecture: controller Deployment, node DaemonSet, REST vs data path.
 */

function Volume({ cx }: { cx: number }) {
  return (
    <g className="rp-diagram-volume">
      <ellipse cx={cx} cy="318" rx="32" ry="8" className="rp-diagram-volume-cap" />
      <rect x={cx - 32} y="318" width="64" height="36" className="rp-diagram-volume-body" />
      <ellipse cx={cx} cy="354" rx="32" ry="8" className="rp-diagram-volume-cap" />
      <text x={cx} y="340" textAnchor="middle" className="rp-diagram-body">
        Volume
      </text>
    </g>
  )
}

export function CsiDriverArchitectureDiagram({
  clusterLabel = 'Kubernetes cluster',
  dataPathLabel = 'FC / iSCSI / NVMe',
}: {
  clusterLabel?: string
  dataPathLabel?: string
}) {
  return (
    <svg
      className="rp-diagram"
      viewBox="0 0 640 418"
      role="img"
      aria-label={`CSI Driver architecture in a ${clusterLabel}: a controller Deployment provisions volumes over the array REST API; a csi-node DaemonSet on each worker attaches volumes. Pods use the data path (${dataPathLabel}) to Hitachi storage.`}
    >
      <defs>
        <marker
          id="csi-rest-arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" className="rp-diagram-marker-rest" />
        </marker>
        <marker
          id="csi-data-arr"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 Z" className="rp-diagram-marker-data" />
        </marker>
      </defs>

      <rect x="0" y="0" width="640" height="418" rx="10" className="rp-diagram-bg" />

      <text x="320" y="20" textAnchor="middle" className="rp-diagram-title">
        CSI Driver architecture
      </text>

      <rect x="12" y="32" width="616" height="200" rx="12" className="rp-diagram-cluster" />
      <text x="320" y="50" textAnchor="middle" className="rp-diagram-site">
        {clusterLabel}
      </text>

      <g className="rp-diagram-plane">
        <rect x="24" y="60" width="148" height="156" rx="10" />
        <text x="98" y="78" textAnchor="middle" className="rp-diagram-card-title">
          Control plane
        </text>
        <g className="rp-diagram-pill">
          <rect x="36" y="86" width="124" height="18" rx="9" />
          <text x="98" y="99" textAnchor="middle" className="rp-diagram-link-label">
            DEPLOYMENT
          </text>
        </g>
        <g className="rp-diagram-chip-ctrl">
          <rect x="36" y="112" width="124" height="44" rx="8" />
          <text x="98" y="130" textAnchor="middle" className="rp-diagram-chip-title">
            csi-controller
          </text>
          <text x="98" y="146" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI controller
          </text>
        </g>
      </g>

      {[
        { x: 184, cx: 252, w: 136 },
        { x: 332, cx: 400, w: 136 },
        { x: 480, cx: 548, w: 136 },
      ].map((n) => (
        <g key={n.x} className="rp-diagram-worker">
          <rect x={n.x} y="60" width={n.w} height="156" rx="10" />
          <text x={n.cx} y="78" textAnchor="middle" className="rp-diagram-card-title">
            Worker node
          </text>
          <g className="rp-diagram-pill">
            <rect x={n.x + 8} y="86" width="120" height="18" rx="9" />
            <text x={n.cx} y="99" textAnchor="middle" className="rp-diagram-link-label">
              DAEMONSET
            </text>
          </g>
          <g className="rp-diagram-chip-node">
            <rect x={n.x + 8} y="112" width="120" height="44" rx="8" />
            <text x={n.cx} y="130" textAnchor="middle" className="rp-diagram-chip-title">
              csi-node
            </text>
            <text x={n.cx} y="146" textAnchor="middle" className="rp-diagram-chip-sub">
              CSI node
            </text>
          </g>
        </g>
      ))}

      <line
        x1="98"
        y1="156"
        x2="200"
        y2="268"
        className="rp-diagram-link-rest"
        markerEnd="url(#csi-rest-arr)"
      />
      <circle cx="98" cy="156" r="3.2" className="rp-diagram-dot-rest" />
      <g className="rp-diagram-pill">
        <rect x="70" y="198" width="72" height="18" rx="9" />
        <text x="106" y="211" textAnchor="middle" className="rp-diagram-link-label">
          REST API
        </text>
      </g>

      <line x1="252" y1="216" x2="252" y2="268" className="rp-diagram-link-data" markerEnd="url(#csi-data-arr)" />
      <line x1="400" y1="216" x2="400" y2="268" className="rp-diagram-link-data" markerEnd="url(#csi-data-arr)" />
      <line x1="548" y1="216" x2="548" y2="268" className="rp-diagram-link-data" markerEnd="url(#csi-data-arr)" />
      <circle cx="252" cy="216" r="3.2" className="rp-diagram-dot-data" />
      <circle cx="400" cy="216" r="3.2" className="rp-diagram-dot-data" />
      <circle cx="548" cy="216" r="3.2" className="rp-diagram-dot-data" />
      <g className="rp-diagram-pill">
        <rect x="345" y="228" width="110" height="18" rx="9" />
        <text x="400" y="241" textAnchor="middle" className="rp-diagram-link-label">
          Data path
        </text>
      </g>

      <g className="rp-diagram-card">
        <rect x="12" y="268" width="616" height="108" rx="10" />
        <text x="320" y="286" textAnchor="middle" className="rp-diagram-card-title">
          Hitachi storage
        </text>
        <text x="320" y="300" textAnchor="middle" className="rp-diagram-muted">
          VSP volumes for container workloads
        </text>
        <Volume cx={250} />
        <Volume cx={390} />
      </g>

      <line x1="24" y1="396" x2="56" y2="396" className="rp-diagram-link-rest" />
      <text x="62" y="400" className="rp-diagram-muted">
        REST API — management / provisioning
      </text>
      <line x1="320" y1="396" x2="352" y2="396" className="rp-diagram-link-data" />
      <text x="358" y="400" className="rp-diagram-muted">
        {`Data path — ${dataPathLabel}`}
      </text>
    </svg>
  )
}

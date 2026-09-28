/**
 * Theme-aware GAD data paths: one stretched cluster, nodes at two geographic
 * sites, local vs cross I/O, REST, and sync paths between arrays.
 */

function Volume({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="rp-diagram-volume">
      <ellipse cx={cx} cy={cy} rx="32" ry="8" className="rp-diagram-volume-cap" />
      <rect x={cx - 32} y={cy} width="64" height="36" className="rp-diagram-volume-body" />
      <ellipse cx={cx} cy={cy + 36} rx="32" ry="8" className="rp-diagram-volume-cap" />
      <text x={cx} y={cy + 22} textAnchor="middle" className="rp-diagram-body">
        Volume
      </text>
    </g>
  )
}

export function GadDataPathsDiagram({
  clusterLabel = 'Kubernetes cluster',
}: {
  clusterLabel?: string
}) {
  return (
    <svg
      className="rp-diagram"
      viewBox="0 0 640 448"
      role="img"
      aria-label={`Stretched PVC data paths in one ${clusterLabel}: worker nodes at Site A and Site B, a csi-controller on the control plane, local and cross data paths to both arrays, REST API management, and two sync I/O paths between arrays.`}
    >
      <rect x="0" y="0" width="640" height="448" rx="10" className="rp-diagram-bg" />

      <text x="320" y="18" textAnchor="middle" className="rp-diagram-title">
        Stretched PVC data paths
      </text>
      <text x="320" y="34" textAnchor="middle" className="rp-diagram-muted">
        One cluster — worker nodes at two geographic sites
      </text>

      <rect x="12" y="44" width="616" height="176" rx="12" className="rp-diagram-cluster" />
      <text x="320" y="62" textAnchor="middle" className="rp-diagram-site">
        {`Stretched ${clusterLabel}`}
      </text>

      <g className="rp-diagram-worker">
        <rect x="24" y="72" width="188" height="132" rx="10" />
        <text x="118" y="90" textAnchor="middle" className="rp-diagram-card-title">
          Site A
        </text>
        <text x="118" y="104" textAnchor="middle" className="rp-diagram-muted">
          Worker node
        </text>
        <g className="rp-diagram-chip-node">
          <rect x="40" y="114" width="156" height="44" rx="8" />
          <text x="118" y="132" textAnchor="middle" className="rp-diagram-chip-title">
            csi-node
          </text>
          <text x="118" y="148" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI node
          </text>
        </g>
      </g>

      <g className="rp-diagram-worker">
        <rect x="226" y="72" width="188" height="132" rx="10" />
        <text x="320" y="90" textAnchor="middle" className="rp-diagram-card-title">
          Site B
        </text>
        <text x="320" y="104" textAnchor="middle" className="rp-diagram-muted">
          Worker node
        </text>
        <g className="rp-diagram-chip-node">
          <rect x="242" y="114" width="156" height="44" rx="8" />
          <text x="320" y="132" textAnchor="middle" className="rp-diagram-chip-title">
            csi-node
          </text>
          <text x="320" y="148" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI node
          </text>
        </g>
      </g>

      <g className="rp-diagram-plane">
        <rect x="428" y="72" width="184" height="132" rx="10" />
        <text x="520" y="90" textAnchor="middle" className="rp-diagram-card-title">
          Control plane
        </text>
        <text x="520" y="104" textAnchor="middle" className="rp-diagram-muted">
          Deployment
        </text>
        <g className="rp-diagram-chip-ctrl">
          <rect x="442" y="114" width="156" height="44" rx="8" />
          <text x="520" y="132" textAnchor="middle" className="rp-diagram-chip-title">
            csi-controller
          </text>
          <text x="520" y="148" textAnchor="middle" className="rp-diagram-chip-sub">
            CSI controller
          </text>
        </g>
      </g>

      <line x1="118" y1="204" x2="158" y2="292" className="rp-diagram-link-data" />
      <line x1="320" y1="204" x2="482" y2="292" className="rp-diagram-link-data" />
      <line
        x1="138"
        y1="204"
        x2="462"
        y2="292"
        className="rp-diagram-link-data rp-diagram-link-dashed"
      />
      <line
        x1="300"
        y1="204"
        x2="178"
        y2="292"
        className="rp-diagram-link-data rp-diagram-link-dashed"
      />
      <line x1="500" y1="204" x2="200" y2="292" className="rp-diagram-link-rest" />
      <line x1="520" y1="204" x2="500" y2="292" className="rp-diagram-link-rest" />

      <g className="rp-diagram-card">
        <rect x="12" y="292" width="268" height="92" rx="10" />
        <text x="28" y="312" className="rp-diagram-card-title">
          Storage system
        </text>
        <text x="28" y="328" className="rp-diagram-muted">
          Site A
        </text>
        <Volume cx={198} cy={308} />
      </g>

      <g className="rp-diagram-card">
        <rect x="360" y="292" width="268" height="92" rx="10" />
        <text x="376" y="312" className="rp-diagram-card-title">
          Storage system
        </text>
        <text x="376" y="328" className="rp-diagram-muted">
          Site B
        </text>
        <Volume cx={546} cy={308} />
      </g>

      <line x1="280" y1="332" x2="360" y2="332" className="rp-diagram-link-data" />
      <line x1="280" y1="340" x2="360" y2="340" className="rp-diagram-link-data" />

      <line x1="16" y1="406" x2="48" y2="406" className="rp-diagram-link-data" />
      <text x="54" y="410" className="rp-diagram-muted">
        Straight path (local)
      </text>
      <line
        x1="200"
        y1="406"
        x2="232"
        y2="406"
        className="rp-diagram-link-data rp-diagram-link-dashed"
      />
      <text x="238" y="410" className="rp-diagram-muted">
        Cross path (remote)
      </text>
      <line x1="380" y1="406" x2="412" y2="406" className="rp-diagram-link-rest" />
      <text x="418" y="410" className="rp-diagram-muted">
        REST API (management)
      </text>
      <line x1="16" y1="428" x2="40" y2="428" className="rp-diagram-link-data" />
      <line x1="16" y1="434" x2="40" y2="434" className="rp-diagram-link-data" />
      <text x="46" y="434" className="rp-diagram-muted">
        Two I/O paths between arrays (sync)
      </text>
    </svg>
  )
}

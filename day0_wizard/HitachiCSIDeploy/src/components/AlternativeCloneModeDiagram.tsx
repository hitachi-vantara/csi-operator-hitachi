/**
 * Theme-aware alternative clone mode.
 * Off: one volume. On: hidden parent volume plus the child volume the workload uses.
 * Expansion grows the parent first when it is too small, then the child.
 */

function Volume({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g className="rp-diagram-volume">
      <ellipse cx={cx} cy={cy} rx="36" ry="7" className="rp-diagram-volume-cap" />
      <rect x={cx - 36} y={cy} width="72" height="28" className="rp-diagram-volume-body" />
      <ellipse cx={cx} cy={cy + 28} rx="36" ry="7" className="rp-diagram-volume-cap" />
    </g>
  )
}

function PodLink({ cx, top }: { cx: number; top: number }) {
  return (
    <g>
      <g className="rp-diagram-chip-node">
        <rect x={cx - 32} y={top} width="64" height="22" rx="6" />
        <text x={cx} y={top + 15} textAnchor="middle" className="rp-diagram-chip-title">
          Pod
        </text>
      </g>
      <line
        x1={cx}
        y1={top + 22}
        x2={cx}
        y2={top + 36}
        className="rp-diagram-link-data"
        markerEnd="url(#acm-step-arr)"
      />
    </g>
  )
}

function StepCard({
  x,
  title,
  muted,
  line1,
  line2,
}: {
  x: number
  title: string
  muted?: string
  line1: string
  line2: string
}) {
  return (
    <g className="rp-diagram-card">
      <rect x={x} y="304" width="146" height="104" rx="8" />
      <text
        x={x + 73}
        y="324"
        textAnchor="middle"
        className="rp-diagram-card-title"
        style={{ fontSize: 8.5 }}
      >
        {title}
      </text>
      {muted ? (
        <text x={x + 73} y="340" textAnchor="middle" className="rp-diagram-muted">
          {muted}
        </text>
      ) : null}
      <text
        x={x + 73}
        y={muted ? 360 : 348}
        textAnchor="middle"
        className="rp-diagram-body"
        style={{ fontSize: 8.5 }}
      >
        {line1}
      </text>
      <text
        x={x + 73}
        y={muted ? 376 : 364}
        textAnchor="middle"
        className="rp-diagram-body"
        style={{ fontSize: 8.5 }}
      >
        {line2}
      </text>
    </g>
  )
}

const ARIA_LABEL =
  'Turn this on to create VMs from a template, or to clone a volume, and still grow those disks. Off, a pod connects to one volume and there is no parent volume. On, a pod connects to the child volume. CSI creates a parent volume and a child volume for every new volume from this Secret. The parent volume stays hidden. Volume expansion: you ask to expand the child volume, CSI checks the parent volume, expands the parent first if it is too small, then expands the child volume. Delete the child volume, and CSI deletes the parent volume. You do not delete the parent yourself. Every new volume needs about twice the pool space, even if you never clone. A 100 Gi volume needs about 200 Gi free.'

export function AlternativeCloneModeDiagram() {
  return (
    <svg
      className="rp-diagram acm-diagram"
      viewBox="0 0 640 528"
      role="img"
      aria-label={ARIA_LABEL}
    >
      <defs>
        <marker
          id="acm-step-arr"
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

      <rect x="0" y="0" width="640" height="528" rx="10" className="rp-diagram-bg" />

      <text x="320" y="22" textAnchor="middle" className="rp-diagram-title">
        Alternative clone mode
      </text>
      <text x="320" y="40" textAnchor="middle" className="rp-diagram-muted">
        Turn this on to create VMs from a template, or to clone a volume, and still grow those disks.
      </text>

      <g className="acm-without rp-diagram-card">
        <rect x="12" y="54" width="302" height="204" rx="10" />
        <text x="163" y="74" textAnchor="middle" className="rp-diagram-card-title">
          Off
        </text>
        <PodLink cx={163} top={84} />
        <Volume cx={163} cy={122} />
        <text x="163" y="184" textAnchor="middle" className="rp-diagram-body">
          Volume
        </text>
        <text x="163" y="204" textAnchor="middle" className="rp-diagram-body">
          The workload uses this volume.
        </text>
        <text x="163" y="220" textAnchor="middle" className="rp-diagram-muted">
          No parent volume.
        </text>
      </g>

      <g className="acm-with rp-diagram-card">
        <rect x="326" y="54" width="302" height="204" rx="10" />
        <text x="477" y="74" textAnchor="middle" className="rp-diagram-card-title">
          On
        </text>
        <PodLink cx={400} top={84} />
        <Volume cx={400} cy={122} />
        <text x="400" y="184" textAnchor="middle" className="rp-diagram-body">
          Child volume
        </text>
        <g className="rp-diagram-pill">
          <rect x="449" y="132" width="56" height="16" rx="8" />
          <text x="477" y="144" textAnchor="middle" className="rp-diagram-link-label">
            clone
          </text>
        </g>
        <line x1="436" y1="140" x2="449" y2="140" className="rp-diagram-link rp-diagram-link-dashed" />
        <line x1="505" y1="140" x2="518" y2="140" className="rp-diagram-link rp-diagram-link-dashed" />
        <g className="acm-parent">
          <Volume cx={554} cy={122} />
          <text x="554" y="184" textAnchor="middle" className="rp-diagram-body">
            Parent volume
          </text>
        </g>
        <text x="477" y="204" textAnchor="middle" className="rp-diagram-body">
          The workload uses the child volume.
        </text>
        <text x="477" y="220" textAnchor="middle" className="rp-diagram-muted">
          The parent volume stays hidden.
        </text>
        <text x="477" y="234" textAnchor="middle" className="rp-diagram-muted" style={{ fontSize: 8 }}>
          CSI creates both for every new volume from this Secret.
        </text>
      </g>

      <text x="320" y="284" textAnchor="middle" className="rp-diagram-title">
        Volume expansion flow
      </text>

      <StepCard
        x={8}
        title="1. Expansion request"
        line1="You ask to expand"
        line2="the child volume."
      />
      <line
        x1="156"
        y1="356"
        x2="166"
        y2="356"
        className="rp-diagram-link-data"
        markerEnd="url(#acm-step-arr)"
      />
      <StepCard
        x={168}
        title="2. Capacity check"
        line1="CSI checks the"
        line2="parent volume."
      />
      <line
        x1="316"
        y1="356"
        x2="326"
        y2="356"
        className="rp-diagram-link-data"
        markerEnd="url(#acm-step-arr)"
      />
      <StepCard
        x={328}
        title="3. Expand the parent volume"
        muted="if required"
        line1="If it is too small,"
        line2="CSI expands it first."
      />
      <line
        x1="476"
        y1="356"
        x2="486"
        y2="356"
        className="rp-diagram-link-data"
        markerEnd="url(#acm-step-arr)"
      />
      <StepCard
        x={488}
        title="4. Expand the child volume"
        line1="CSI expands it after the"
        line2="parent volume is large enough."
      />

      <text x="320" y="440" textAnchor="middle" className="rp-diagram-body">
        Delete the child volume, and CSI deletes the parent volume.
      </text>
      <text x="320" y="456" textAnchor="middle" className="rp-diagram-muted">
        You do not delete the parent yourself.
      </text>

      <g className="rp-diagram-card">
        <rect x="12" y="472" width="616" height="44" rx="10" />
        <text x="320" y="490" textAnchor="middle" className="rp-diagram-body">
          Every new volume from this Secret needs about twice the pool space, even if you never clone.
        </text>
        <text x="320" y="506" textAnchor="middle" className="rp-diagram-muted">
          A 100 Gi volume needs about 200 Gi free.
        </text>
      </g>
    </svg>
  )
}

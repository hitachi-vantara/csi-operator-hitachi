/**
 * Live Review diagram: configured objects, nested pools, click → generated YAML.
 * Theme tokens via rp-diagram-* — not a copy of the CSI Driver worker poster.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildReviewTopology, type ReviewArrayView, type ReviewChip, type ReviewSiteView } from '../catalog/reviewTopology'
import type { WizardState } from '../catalog/types'
import type { GeneratedFile } from '../generator/yaml'
import { CodeBlock, DownloadButton } from './ui'

function clipId(id: string): string {
  return `rt-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
}

/** Approximate SVG fit: truncate with an ellipsis and keep the full string in a tooltip. */
function FittedText({
  x,
  y,
  width,
  text,
  className,
  fontSize,
}: {
  x: number
  y: number
  width: number
  text: string
  className: string
  fontSize: number
}) {
  const max = Math.max(4, Math.floor(width / (fontSize * 0.58)))
  const shown = text.length <= max ? text : `${text.slice(0, max - 1)}…`
  return (
    <text x={x} y={y} textAnchor="middle" className={className}>
      {shown !== text ? <title>{text}</title> : null}
      {shown}
    </text>
  )
}

function Hit({
  id,
  selected,
  onSelect,
  children,
}: {
  id: string
  selected: string | null
  onSelect: (id: string) => void
  children: ReactNode
}) {
  return (
    <g
      className={`rp-diagram-hit${selected === id ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(id)
        }
      }}
    >
      {children}
    </g>
  )
}

function Chip({
  chip,
  x,
  y,
  w,
  h,
  selected,
  onSelect,
}: {
  chip: ReviewChip
  x: number
  y: number
  w: number
  h: number
  selected: string | null
  onSelect: (id: string) => void
}) {
  const cx = x + w / 2
  const tw = w - 14
  const cid = clipId(chip.id)
  const filled = chip.tone === 'ctrl' || chip.tone === 'dr' || chip.tone === 'node' || chip.tone === 'plugin'
  const cls =
    chip.tone === 'ctrl'
      ? 'rp-diagram-chip-ctrl'
      : chip.tone === 'dr'
        ? 'rp-diagram-chip-dr'
        : chip.tone === 'node'
          ? 'rp-diagram-chip-node'
          : chip.tone === 'plugin'
            ? 'rp-diagram-chip-plugin'
            : chip.tone === 'pill'
              ? 'rp-diagram-pill'
              : 'rp-diagram-card'
  const titleClass = filled
    ? 'rp-diagram-chip-title'
    : chip.tone === 'pill'
      ? 'rp-diagram-link-label'
      : 'rp-diagram-card-title'
  const titleSize = chip.tone === 'pill' ? 8 : 11
  const subClass = filled
    ? 'rp-diagram-chip-sub'
    : 'rp-diagram-muted'
  const subSize = filled ? 9 : 9.5
  return (
    <Hit id={chip.id} selected={selected} onSelect={onSelect}>
      <clipPath id={cid}>
        <rect x={x + 5} y={y} width={w - 10} height={h} rx={6} />
      </clipPath>
      <g className={cls}>
        <rect x={x} y={y} width={w} height={h} rx={chip.tone === 'pill' ? 9 : 8} />
        <g clipPath={`url(#${cid})`}>
          {chip.sub ? (
            <>
              <FittedText
                x={cx}
                y={y + h / 2 - 3}
                width={tw}
                text={chip.label}
                className={titleClass}
                fontSize={titleSize}
              />
              <FittedText
                x={cx}
                y={y + h / 2 + 10}
                width={tw}
                text={chip.sub}
                className={subClass}
                fontSize={subSize}
              />
            </>
          ) : (
            <FittedText
              x={cx}
              y={y + h / 2 + 4}
              width={tw}
              text={chip.label}
              className={titleClass}
              fontSize={titleSize}
            />
          )}
        </g>
      </g>
    </Hit>
  )
}

function SiteColumn({
  site,
  x,
  width,
  y,
  selected,
  onSelect,
}: {
  site: ReviewSiteView
  x: number
  width: number
  y: number
  selected: string | null
  onSelect: (id: string) => void
}) {
  const pad = 12
  const inner = width - pad * 2
  let cy = y + 22
  const rows: ReactNode[] = []

  rows.push(
    <text key="t" x={x + width / 2} y={y + 16} textAnchor="middle" className="rp-diagram-site">
      {site.title}
    </text>,
  )
  if (site.clusterLabel) {
    rows.push(
      <text key="cl" x={x + width / 2} y={y + 28} textAnchor="middle" className="rp-diagram-muted">
        {site.clusterLabel}
      </text>,
    )
    cy = y + 36
  }

  for (let r = 0; r < site.chips.length; r++) {
    const row = site.chips[r]
    const gap = 8
    const cw = row.length === 1 ? inner : (inner - gap * (row.length - 1)) / row.length
    const h = row.some((c) => c.sub) ? 32 : 26
    row.forEach((chip, i) => {
      rows.push(
        <Chip
          key={chip.id}
          chip={chip}
          x={x + pad + i * (cw + gap)}
          y={cy}
          w={cw}
          h={h}
          selected={selected}
          onSelect={onSelect}
        />,
      )
    })
    cy += h + 6
  }

  const scs = [...site.storageClasses]
  if (site.snapshot) scs.push(site.snapshot)
  if (scs.length) {
    const gap = 8
    const cols = Math.min(2, scs.length)
    const cw = cols === 1 ? inner : (inner - gap) / 2
    scs.forEach((chip, i) => {
      const col = i % 2
      const row = Math.floor(i / 2)
      rows.push(
        <Chip
          key={chip.id}
          chip={chip}
          x={x + pad + col * (cw + gap)}
          y={cy + row * 40}
          w={cw}
          h={36}
          selected={selected}
          onSelect={onSelect}
        />,
      )
    })
    cy += Math.ceil(scs.length / 2) * 40
  }
  if (site.moreStorageClasses) {
    rows.push(
      <Hit key={site.moreStorageClasses.id} id={site.moreStorageClasses.id} selected={selected} onSelect={onSelect}>
        <g className="rp-diagram-pill">
          <rect x={x + pad} y={cy} width={inner} height={18} rx={9} />
          <FittedText
            x={x + width / 2}
            y={cy + 13}
            width={inner - 8}
            text={site.moreStorageClasses.label}
            className="rp-diagram-link-label"
            fontSize={8}
          />
        </g>
      </Hit>,
    )
    cy += 24
  }

  const clusterH = cy - y + 8

  return { nodes: rows, clusterH, clusterBottom: y + clusterH }
}

function arrayBodyHeight(arr: ReviewArrayView): number {
  const poolH = 52
  const gap = 8
  const poolRows = Math.ceil(Math.max(arr.pools.length, 1) / 2)
  const moreH = arr.morePools ? 22 : 0
  return 40 + (arr.pools.length ? poolRows * (poolH + gap) : 28) + moreH + 8
}

type ArrayBox = { systemId: string; id: string; x: number; y: number; w: number; h: number }

function renderOneArray(
  arr: ReviewArrayView,
  x: number,
  y: number,
  width: number,
  tone: 'primary' | 'secondary',
  selected: string | null,
  onSelect: (id: string) => void,
): { nodes: ReactNode[]; height: number; box: ArrayBox } {
  const pad = 12
  const inner = width - pad * 2
  const poolH = 52
  const gap = 8
  const bodyH = arrayBodyHeight(arr)
  const nodes: ReactNode[] = []
  nodes.push(
    <Hit key={arr.id} id={arr.id} selected={selected} onSelect={onSelect}>
      <g className={tone === 'primary' ? 'rp-diagram-rg-primary' : 'rp-diagram-rg-secondary'}>
        <rect x={x} y={y} width={width} height={bodyH} rx={10} />
      </g>
      <FittedText
        x={x + width / 2}
        y={y + 18}
        width={width - 16}
        text={arr.title}
        className="rp-diagram-card-title"
        fontSize={11}
      />
      <FittedText
        x={x + width / 2}
        y={y + 32}
        width={width - 16}
        text={arr.sub}
        className="rp-diagram-muted"
        fontSize={9.5}
      />
    </Hit>,
  )
  if (!arr.pools.length) {
    nodes.push(
      <text key={`${arr.id}-nopool`} x={x + width / 2} y={y + 52} textAnchor="middle" className="rp-diagram-muted">
        No pools yet — add a StorageClass
      </text>,
    )
  }
  arr.pools.forEach((p, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const pw = arr.pools.length === 1 ? inner : (inner - gap) / 2
    const px = x + pad + col * (pw + gap)
    const py = y + 40 + row * (poolH + gap)
    nodes.push(
      <Hit key={p.id} id={p.id} selected={selected} onSelect={onSelect}>
        <g className="rp-diagram-card">
          <rect x={px} y={py} width={pw} height={poolH} rx={8} />
          <FittedText
            x={px + pw / 2}
            y={py + 16}
            width={pw - 12}
            text={p.title}
            className="rp-diagram-card-title"
            fontSize={11}
          />
          <FittedText
            x={px + pw / 2}
            y={py + 30}
            width={pw - 12}
            text={p.sub}
            className="rp-diagram-muted"
            fontSize={9.5}
          />
          {p.extra ? (
            <FittedText
              x={px + pw / 2}
              y={py + 42}
              width={pw - 12}
              text={p.extra}
              className="rp-diagram-muted"
              fontSize={9.5}
            />
          ) : null}
        </g>
      </Hit>,
    )
  })
  if (arr.morePools) {
    const my = y + bodyH - 26
    nodes.push(
      <Hit key={arr.morePools.id} id={arr.morePools.id} selected={selected} onSelect={onSelect}>
        <g className="rp-diagram-pill">
          <rect x={x + pad} y={my} width={inner} height={18} rx={9} />
          <FittedText
            x={x + width / 2}
            y={my + 13}
            width={inner - 8}
            text={arr.morePools.label}
            className="rp-diagram-link-label"
            fontSize={8}
          />
        </g>
      </Hit>,
    )
  }
  return {
    nodes,
    height: bodyH,
    box: { systemId: arr.systemId, id: arr.id, x, y, w: width, h: bodyH },
  }
}

function renderSiteArrays(
  site: ReviewSiteView,
  x: number,
  width: number,
  arrayY: number,
  sideBySide: boolean,
  selected: string | null,
  onSelect: (id: string) => void,
): { nodes: ReactNode[]; height: number; boxes: ArrayBox[] } {
  const nodes: ReactNode[] = []
  const boxes: ArrayBox[] = []
  const arrays = site.arrays
  const gap = 16
  let height = 0

  if (sideBySide && arrays.length > 1) {
    const arrW = (width - gap * (arrays.length - 1)) / arrays.length
    const heights = arrays.map(arrayBodyHeight)
    height = Math.max(...heights, 0)
    arrays.forEach((arr, i) => {
      const ax = x + i * (arrW + gap)
      const drawn = renderOneArray(
        arr,
        ax,
        arrayY,
        arrW,
        i % 2 === 0 ? 'primary' : 'secondary',
        selected,
        onSelect,
      )
      nodes.push(<g key={arr.id}>{drawn.nodes}</g>)
      boxes.push(drawn.box)
    })
  } else {
    let ay = arrayY
    arrays.forEach((arr, i) => {
      const drawn = renderOneArray(
        arr,
        x,
        ay,
        width,
        i % 2 === 0 ? 'primary' : 'secondary',
        selected,
        onSelect,
      )
      nodes.push(<g key={arr.id}>{drawn.nodes}</g>)
      boxes.push(drawn.box)
      ay += drawn.height + (i < arrays.length - 1 ? 12 : 0)
    })
    height = ay - arrayY
  }

  if (site.moreArrays) {
    const my = arrayY + height + 8
    nodes.push(
      <Hit key={site.moreArrays.id} id={site.moreArrays.id} selected={selected} onSelect={onSelect}>
        <g className="rp-diagram-pill">
          <rect x={x} y={my} width={width} height={18} rx={9} />
          <FittedText
            x={x + width / 2}
            y={my + 13}
            width={width - 8}
            text={site.moreArrays.label}
            className="rp-diagram-link-label"
            fontSize={8}
          />
        </g>
      </Hit>,
    )
    height += 26
  }

  for (const link of site.gadLinks) {
    const from = boxes.find((b) => b.systemId === link.fromSystemId)
    const to = boxes.find((b) => b.systemId === link.toSystemId)
    if (!from || !to) continue
    const sameRow = Math.abs(from.y - to.y) < 4
    if (sameRow) {
      const left = from.x < to.x ? from : to
      const right = from.x < to.x ? to : from
      const y = from.y + Math.min(from.h, to.h) / 2
      const x1 = left.x + left.w
      const x2 = right.x
      nodes.push(
        <Hit key={link.id} id={link.id} selected={selected} onSelect={onSelect}>
          <line x1={x1} y1={y} x2={x2} y2={y} className="rp-diagram-link" />
          <FittedText
            x={(x1 + x2) / 2}
            y={y - 6}
            width={Math.max(24, x2 - x1)}
            text="GAD"
            className="rp-diagram-link-label"
            fontSize={8}
          />
        </Hit>,
      )
    } else {
      const top = from.y < to.y ? from : to
      const bottom = from.y < to.y ? to : from
      const lx = Math.max(from.x + from.w, to.x + to.w) + 8
      nodes.push(
        <Hit key={link.id} id={link.id} selected={selected} onSelect={onSelect}>
          <line x1={top.x + top.w} y1={top.y + top.h / 2} x2={lx} y2={top.y + top.h / 2} className="rp-diagram-link" />
          <line x1={lx} y1={top.y + top.h / 2} x2={lx} y2={bottom.y + 18} className="rp-diagram-link" />
          <line x1={lx} y1={bottom.y + 18} x2={bottom.x + bottom.w} y2={bottom.y + 18} className="rp-diagram-link" />
          <text x={lx + 6} y={(top.y + bottom.y) / 2 + 12} className="rp-diagram-link-label">
            GAD
          </text>
        </Hit>,
      )
    }
  }

  return { nodes, height, boxes }
}

function testVolumeBox(
  x: number,
  width: number,
  clusterY: number,
  clusterH: number,
): { x: number; y: number; w: number; h: number } {
  const inner = width - 24
  const tw = Math.min(210, Math.max(148, inner * 0.46))
  const th = 36
  return {
    x: x + (width - tw) / 2,
    y: clusterY + clusterH - 8 - th,
    w: tw,
    h: th,
  }
}

function PathLabel({
  x,
  y,
  text,
  anchor = 'start',
}: {
  x: number
  y: number
  text: string
  anchor?: 'start' | 'middle'
}) {
  const est = Math.min(220, Math.max(40, Math.floor(text.length * 8 * 0.56)))
  const bgX = anchor === 'middle' ? x - est / 2 - 3 : x - 3
  return (
    <g>
      <rect x={bgX} y={y - 9} width={est + 6} height={12} rx={2} className="rp-diagram-link-label-bg" />
      <text x={x} y={y} textAnchor={anchor} className="rp-diagram-link-label">
        {text}
      </text>
    </g>
  )
}

function renderDataPaths(
  vol: { x: number; y: number; w: number; h: number } | undefined,
  arrayIds: string[],
  boxes: ArrayBox[],
  protocolLabel: string | undefined,
): ReactNode[] {
  if (!vol || !arrayIds.length) return []
  const targets = boxes.filter((b) => arrayIds.includes(b.systemId))
  if (!targets.length) return []
  const x0 = vol.x + vol.w / 2
  const y0 = vol.y + vol.h
  const nodes: ReactNode[] = []
  for (const box of targets) {
    nodes.push(
      <line
        key={`data-${box.id}`}
        x1={x0}
        y1={y0}
        x2={box.x + box.w / 2}
        y2={box.y}
        className="rp-diagram-link-data"
      />,
    )
  }
  if (protocolLabel) {
    const label = `data path · ${protocolLabel}`
    if (targets.length === 1) {
      const midY = (y0 + targets[0].y) / 2 + 3
      nodes.push(<PathLabel key={`data-label-${arrayIds.join('-')}`} x={x0 + 10} y={midY} text={label} />)
    } else {
      nodes.push(
        <PathLabel
          key={`data-label-${arrayIds.join('-')}`}
          x={x0}
          y={y0 + 11}
          text={label}
          anchor="middle"
        />,
      )
    }
  }
  return nodes
}

export function ReviewTopologyDiagram({
  state,
  files,
}: {
  state: WizardState
  files: GeneratedFile[]
}) {
  const model = useMemo(() => buildReviewTopology(state, files), [state, files])
  const [selected, setSelected] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)

  const hit = selected ? model.hits[selected] : null
  const hitFiles = (hit?.files ?? [])
    .map((p) => files.find((f) => f.path === p))
    .filter((f): f is GeneratedFile => !!f)
  const current = hitFiles.find((f) => f.path === filePath) ?? hitFiles[0]

  const select = (id: string) => {
    setSelected(id)
    const next = model.hits[id]
    setFilePath(next?.files[0] ?? '')
  }

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (selected) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  }, [selected])

  const close = () => setSelected(null)

  const dual = model.dualSite
  const colW = dual ? 300 : 616
  const leftX = 12
  const rightX = 328
  const clusterY = 44

  const left = SiteColumn({
    site: model.sites[0],
    x: leftX,
    width: colW,
    y: clusterY,
    selected,
    onSelect: select,
  })
  const right = dual && model.sites[1]
    ? SiteColumn({
        site: model.sites[1],
        x: rightX,
        width: colW,
        y: clusterY,
        selected,
        onSelect: select,
      })
    : null

  const clusterH =
    Math.max(left.clusterH, right?.clusterH ?? 0) +
    (model.sites[0].testVolume || model.sites[1]?.testVolume ? 44 : 0)
  const arrayY = clusterY + clusterH + 36
  const sideBySide = !dual
  const leftVol = model.sites[0].testVolume ? testVolumeBox(leftX, colW, clusterY, clusterH) : undefined
  const rightVol =
    dual && model.sites[1]?.testVolume ? testVolumeBox(rightX, colW, clusterY, clusterH) : undefined

  const leftArr = renderSiteArrays(model.sites[0], leftX, colW, arrayY, sideBySide, selected, select)
  const rightArr =
    dual && model.sites[1]
      ? renderSiteArrays(model.sites[1], rightX, colW, arrayY, false, selected, select)
      : null
  const arrayH = Math.max(leftArr.height, rightArr?.height ?? 0)
  const svgH = arrayY + arrayH + 28
  const restLine = (box: ArrayBox, site: ReviewSiteView) => {
    const hasData = site.testVolumeArrayIds.includes(box.systemId)
    const rx = hasData ? box.x + box.w * 0.22 : box.x + box.w / 2
    return (
      <g key={`rest-${box.id}`}>
        <line x1={rx} y1={clusterY + clusterH} x2={rx} y2={box.y} className="rp-diagram-link-rest" />
        {box.y === arrayY ? (
          <text x={rx + 8} y={arrayY - 6} className="rp-diagram-link-label">
            REST
          </text>
        ) : null}
      </g>
    )
  }

  return (
    <div className="review-topo">
      <svg
        className="rp-diagram"
        viewBox={`0 0 640 ${svgH}`}
        role="img"
        aria-label={`Your Hitachi CSI deployment: ${model.subtitle}. Click an object to open the YAML files that make it.`}
      >
        <rect x="0" y="0" width="640" height={svgH} rx="10" className="rp-diagram-bg" />
        <text x="320" y="20" textAnchor="middle" className="rp-diagram-title">
          Your Hitachi CSI deployment
        </text>
        <FittedText
          x={320}
          y={34}
          width={600}
          text={model.subtitle}
          className="rp-diagram-muted"
          fontSize={9.5}
        />

        <rect x={leftX} y={clusterY} width={colW} height={clusterH} rx="12" className="rp-diagram-cluster" />
        {left.nodes}
        {leftVol && model.sites[0].testVolume ? (
          <Chip
            key={model.sites[0].testVolume.id}
            chip={model.sites[0].testVolume}
            x={leftVol.x}
            y={leftVol.y}
            w={leftVol.w}
            h={leftVol.h}
            selected={selected}
            onSelect={select}
          />
        ) : null}
        {right ? (
          <>
            <rect x={rightX} y={clusterY} width={colW} height={clusterH} rx="12" className="rp-diagram-cluster" />
            {right.nodes}
            <line x1={leftX + colW} y1={clusterY + 88} x2={rightX} y2={clusterY + 88} className="rp-diagram-link" />
            {rightVol && model.sites[1].testVolume ? (
              <Chip
                key={model.sites[1].testVolume.id}
                chip={model.sites[1].testVolume}
                x={rightVol.x}
                y={rightVol.y}
                w={rightVol.w}
                h={rightVol.h}
                selected={selected}
                onSelect={select}
              />
            ) : null}
          </>
        ) : null}

        {leftArr.boxes.map((box) => restLine(box, model.sites[0]))}
        {rightArr?.boxes.map((box) => restLine(box, model.sites[1]))}
        {right && leftArr.boxes[0] && rightArr?.boxes[0] ? (
          <Hit id="journals" selected={selected} onSelect={select}>
            <rect
              x={leftArr.boxes[0].x + leftArr.boxes[0].w - 8}
              y={arrayY + 20}
              width={rightArr.boxes[0].x - (leftArr.boxes[0].x + leftArr.boxes[0].w) + 16}
              height={28}
              rx={6}
              fill="transparent"
            />
            <line
              x1={leftArr.boxes[0].x + leftArr.boxes[0].w}
              y1={arrayY + 36}
              x2={rightArr.boxes[0].x}
              y2={arrayY + 36}
              className="rp-diagram-link"
            />
          </Hit>
        ) : null}

        {leftArr.nodes}
        {rightArr?.nodes}
        {renderDataPaths(
          leftVol,
          model.sites[0].testVolumeArrayIds,
          leftArr.boxes,
          model.sites[0].testVolumeProtocolLabel,
        )}
        {right && model.sites[1]
          ? renderDataPaths(
              rightVol,
              model.sites[1].testVolumeArrayIds,
              rightArr?.boxes ?? [],
              model.sites[1].testVolumeProtocolLabel,
            )
          : null}

        <text x="320" y={svgH - 10} textAnchor="middle" className="rp-diagram-muted">
          Click any object to open its YAML
        </text>
      </svg>

      <dialog
        ref={dialogRef}
        className="yaml-dialog"
        aria-labelledby="yaml-dialog-title"
        onCancel={(e) => {
          e.preventDefault()
          close()
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close()
        }}
        onClose={close}
      >
        <div className="yaml-dialog-body">
          <div className="yaml-dialog-head">
            <div>
              <h2 id="yaml-dialog-title">{hit?.title ?? 'Generated files'}</h2>
              {hit?.why ? <p className="yaml-dialog-why">{hit.why}</p> : null}
            </div>
            <button type="button" className="btn btn-secondary" onClick={close}>
              Close
            </button>
          </div>
          {hitFiles.length > 1 ? (
            <div className="tabs" role="tablist" aria-label="Generated files">
              {hitFiles.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  role="tab"
                  aria-selected={current?.path === f.path}
                  className={`tab${current?.path === f.path ? ' active' : ''}`}
                  onClick={() => setFilePath(f.path)}
                  title={f.path}
                >
                  {f.path.split('/').pop() || f.path}
                </button>
              ))}
            </div>
          ) : null}
          {current ? (
            <>
              <div className="yaml-dialog-meta">
                <code>{current.path}</code>
                {current.description ? <span> — {current.description}</span> : null}
                <DownloadButton
                  filename={current.path.split('/').pop() || 'file'}
                  content={current.content}
                  label="Download file"
                />
              </div>
              <CodeBlock className="yaml-preview" text={current.content}>
                {current.content}
              </CodeBlock>
            </>
          ) : (
            <p>No generated file for this object in the current package.</p>
          )}
        </div>
      </dialog>
    </div>
  )
}

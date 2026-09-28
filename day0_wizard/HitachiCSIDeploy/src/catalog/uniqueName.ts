function t(v: string | undefined | null): string {
  return (v || '').trim()
}

export function nextUniqueName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => t(n)).filter(Boolean))
  const stem = t(base) || 'item'
  if (!used.has(stem)) return stem
  let n = 2
  while (used.has(`${stem}-${n}`)) n += 1
  return `${stem}-${n}`
}


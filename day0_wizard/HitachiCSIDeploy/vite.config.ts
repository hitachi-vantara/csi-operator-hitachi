import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

function injectedWizardVersion(): string {
  let sha = 'unknown'
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    sha = 'unknown'
  }
  return `${pkg.version}+${sha}`
}

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __WIZARD_VERSION__: JSON.stringify(injectedWizardVersion()),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

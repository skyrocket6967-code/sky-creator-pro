import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const distDir = new URL('../dist/', import.meta.url)
const assetsDir = new URL('./assets/', distDir)
const indexPath = new URL('./index.html', distDir)

const files = await readdir(assetsDir)
const cssFile = files.find((file) => file.endsWith('.css'))

if (!cssFile) {
  throw new Error('No CSS asset found in dist/assets.')
}

const css = await readFile(join(fileURLToPath(assetsDir), cssFile), 'utf8')
const html = await readFile(indexPath, 'utf8')
const escapedCss = css.replaceAll('</style', '<\\/style')
const nextHtml = html.replace(
  /\s*<link rel="stylesheet" crossorigin href="\.\/assets\/[^"]+">\s*/u,
  `\n    <style data-inline-build-css>\n${escapedCss}\n    </style>\n`,
)

await writeFile(indexPath, nextHtml, 'utf8')

import { promises as fs } from 'node:fs'
import path from 'node:path'

const DEFAULT_EXTENSIONS = [
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.css',
  '.scss',
  '.less',
  '.html',
  '.json',
  '.yaml',
  '.yml',
  '.sh',
  '.sql',
  '.svg',
]

const DEFAULT_EXCLUDES = [
  '.git',
  '.idea',
  '.vscode',
  '.next',
  '.nuxt',
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.turbo',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  'logs',
  'log',
  'tmp',
  'temp',
]

function printHelp() {
  console.log(`用法：

node generate-source-correction.mjs --root <项目根目录> --out <补正材料目录> --name <软件全称> [选项]

选项：
  --root <目录>        需要收录源码的项目根目录
  --out <目录>         补正材料输出目录
  --name <名称>        软件全称，例如 萌姨萌嫂客户关系管理系统
  --short <简称>       软件简称，可选
  --version <版本>     版本号，默认 V1.0
  --serial <流水号>    补正流水号，可选
  --include <路径>     优先收录文件，相对 root，可重复传入
  --only-include       只收录 --include 指定文件，不自动追加其他文件
  --exclude <片段>     排除路径片段，可重复传入
  --ext <扩展名>       收录扩展名，例如 .ts，可重复传入
  --display-strip <前缀> 展示路径去掉的前缀，可选
  --help              显示帮助

输出：
  源程序-前30页后30页.md
  源程序补正统计.json
`)
}

function parseArgs(argv) {
  const options = {
    root: undefined,
    out: undefined,
    name: undefined,
    shortName: undefined,
    version: 'V1.0',
    serial: undefined,
    includes: [],
    onlyInclude: false,
    excludes: [],
    extensions: [],
    displayStrip: undefined,
    showHelp: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    if (current === '--help') {
      options.showHelp = true
      continue
    }

    if (current === '--root') {
      options.root = argv[index + 1]
      index += 1
      continue
    }

    if (current === '--out') {
      options.out = argv[index + 1]
      index += 1
      continue
    }

    if (current === '--name') {
      options.name = argv[index + 1]
      index += 1
      continue
    }

    if (current === '--short') {
      options.shortName = argv[index + 1]
      index += 1
      continue
    }

    if (current === '--version') {
      options.version = argv[index + 1]
      index += 1
      continue
    }

    if (current === '--serial') {
      options.serial = argv[index + 1]
      index += 1
      continue
    }

    if (current === '--include') {
      options.includes.push(argv[index + 1])
      index += 1
      continue
    }

    if (current === '--only-include') {
      options.onlyInclude = true
      continue
    }

    if (current === '--exclude') {
      options.excludes.push(argv[index + 1])
      index += 1
      continue
    }

    if (current === '--ext') {
      options.extensions.push(argv[index + 1])
      index += 1
      continue
    }

    if (current === '--display-strip') {
      options.displayStrip = argv[index + 1]
      index += 1
      continue
    }

    throw new Error(`不支持的参数：${current}`)
  }

  return options
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function normalizeRelative(value) {
  return value.split(path.sep).join('/')
}

function normalizeExtension(value) {
  if (!value) return value
  return value.startsWith('.') ? value.toLowerCase() : `.${value.toLowerCase()}`
}

function hasExcludedPath(relPath, excludes) {
  const parts = relPath.split('/')
  if (parts.some((part) => excludes.includes(part))) {
    return true
  }
  return excludes.some((item) => relPath.includes(item))
}

async function walkFiles(rootDir, extensions, excludes) {
  const collected = []

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      const relPath = normalizeRelative(path.relative(rootDir, fullPath))

      if (hasExcludedPath(relPath, excludes)) {
        continue
      }

      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      if (!extensions.has(path.extname(entry.name).toLowerCase())) {
        continue
      }

      collected.push(relPath)
    }
  }

  await walk(rootDir)
  return collected.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.py': 'python',
    '.js': 'js',
    '.mjs': 'js',
    '.cjs': 'js',
    '.ts': 'ts',
    '.tsx': 'tsx',
    '.jsx': 'jsx',
    '.vue': 'vue',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.html': 'html',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.sh': 'bash',
    '.sql': 'sql',
    '.svg': 'xml',
  }
  return map[ext] || ''
}

function formatSoftwareName({ name, shortName, version }) {
  const suffix = version ? version : ''
  return shortName ? `${name}[简称：${shortName}]${suffix}` : `${name}${suffix}`
}

function displayPathFor(relPath, displayStrip) {
  let normalized = normalizeRelative(relPath)
  const strip = displayStrip ? normalizeRelative(displayStrip).replace(/\/$/, '') : ''
  if (strip && normalized.startsWith(`${strip}/`)) {
    normalized = normalized.slice(strip.length + 1)
  }
  return normalized
}

function splitFenceSafe(text) {
  return text.replaceAll('```', '` ` `')
}

function pushSnippet(markdown, snippet) {
  if (snippet.lines.length === 0) {
    return
  }

  markdown.push(`### 文件：\`${snippet.displayPath}\``)
  markdown.push('')
  markdown.push(`\`\`\`${snippet.language}`)
  for (const line of snippet.lines) {
    markdown.push(splitFenceSafe(line.text))
  }
  markdown.push('```')
  markdown.push('')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.showHelp) {
    printHelp()
    process.exit(0)
  }

  if (!options.root || !options.out || !options.name) {
    printHelp()
    throw new Error('缺少必要参数：--root、--out、--name')
  }

  const rootDir = path.resolve(options.root)
  const outDir = path.resolve(options.out)
  if (!(await exists(rootDir))) {
    throw new Error(`项目根目录不存在：${rootDir}`)
  }

  const extensions = new Set(
    (options.extensions.length > 0 ? options.extensions : DEFAULT_EXTENSIONS)
      .map(normalizeExtension)
      .filter(Boolean)
  )
  const excludes = [...DEFAULT_EXCLUDES, ...options.excludes]
  const discovered = await walkFiles(rootDir, extensions, excludes)

  const explicitIncludes = []
  for (const include of options.includes) {
    const relPath = normalizeRelative(include)
    const fullPath = path.join(rootDir, relPath)
    if (!(await exists(fullPath))) {
      throw new Error(`指定收录文件不存在：${relPath}`)
    }
    explicitIncludes.push(relPath)
  }

  if (options.onlyInclude && explicitIncludes.length === 0) {
    throw new Error('使用 --only-include 时必须至少提供一个 --include 文件')
  }

  const orderedFiles = options.onlyInclude
    ? explicitIncludes
    : [
        ...explicitIncludes,
        ...discovered.filter((filePath) => !explicitIncludes.includes(filePath)),
      ]

  const sourceLines = []
  const sourceFiles = []
  for (const relPath of orderedFiles) {
    const fullPath = path.join(rootDir, relPath)
    const raw = await fs.readFile(fullPath, 'utf8')
    const normalized = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '')
    const lines = normalized.length > 0 ? normalized.split('\n') : ['']
    const displayPath = displayPathFor(relPath, options.displayStrip)
    const language = languageFor(relPath)
    sourceFiles.push({
      diskPath: relPath,
      displayPath,
      language,
      lineCount: lines.length,
    })
    for (const [lineIndex, text] of lines.entries()) {
      sourceLines.push({
        sourceLineNumber: sourceLines.length + 1,
        diskPath: relPath,
        displayPath,
        language,
        lineNumber: lineIndex + 1,
        text,
      })
    }
  }

  if (sourceLines.length < 3000) {
    throw new Error(`真实源码不足 3000 行，当前仅 ${sourceLines.length} 行`)
  }

  const front = sourceLines.slice(0, 1500)
  const backStartIndex = sourceLines.length - 1500
  const back = sourceLines.slice(backStartIndex)
  const selected = [...front, ...back]
  const softwareFullName = formatSoftwareName(options)
  const frontRange = [1, 1500]
  const backRange = [backStartIndex + 1, sourceLines.length]

  const markdown = []
  markdown.push(`# ${softwareFullName}源程序（前30页后30页）`)
  markdown.push('')
  if (options.serial) {
    markdown.push(`- 流水号：${options.serial}`)
  }
  markdown.push(`- 软件名称：${softwareFullName}`)
  markdown.push('- 材料类型：源程序补正件')
  markdown.push('- 统计口径：每页按 50 行折算，共 60 页，本文件合计 3000 行')
  markdown.push(`- 收录范围：前 30 页对应第 ${frontRange[0]} 行至第 ${frontRange[1]} 行；后 30 页对应第 ${backRange[0]} 行至第 ${backRange[1]} 行`)
  markdown.push('')

  let currentSnippet = null
  let previousLine = null
  for (const line of selected) {
    const isContinuous =
      previousLine &&
      previousLine.diskPath === line.diskPath &&
      previousLine.sourceLineNumber + 1 === line.sourceLineNumber

    if (
      !currentSnippet ||
      currentSnippet.diskPath !== line.diskPath ||
      !isContinuous
    ) {
      pushSnippet(markdown, currentSnippet || { lines: [] })
      currentSnippet = {
        diskPath: line.diskPath,
        displayPath: line.displayPath,
        language: line.language,
        lines: [],
      }
    }
    currentSnippet.lines.push(line)
    previousLine = line
  }
  pushSnippet(markdown, currentSnippet || { lines: [] })

  await fs.mkdir(outDir, { recursive: true })
  const mdPath = path.join(outDir, '源程序-前30页后30页.md')
  const statsPath = path.join(outDir, '源程序补正统计.json')
  await fs.writeFile(mdPath, `${markdown.join('\n')}\n`, 'utf8')

  const selectedFiles = new Map()
  for (const line of selected) {
    selectedFiles.set(line.diskPath, {
      diskPath: line.diskPath,
      displayPath: line.displayPath,
      language: line.language,
    })
  }

  const stats = {
    softwareFullName,
    serialNumber: options.serial || null,
    sourceRoot: rootDir,
    sourceLineTotal: sourceLines.length,
    selectedLineTotal: selected.length,
    linesPerPage: 50,
    totalPages: 60,
    frontRange,
    backRange,
    markdownFile: mdPath,
    pdfFile: path.join(outDir, '导出PDF/源程序-前30页后30页.pdf'),
    sourceFiles: [...selectedFiles.values()],
    allSourceFiles: sourceFiles,
    onlyInclude: options.onlyInclude,
    excludedPathParts: excludes,
    extensions: [...extensions],
  }
  await fs.writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    markdownFile: mdPath,
    statsFile: statsPath,
    softwareFullName,
    sourceLineTotal: sourceLines.length,
    selectedLineTotal: selected.length,
    frontRange,
    backRange,
    selectedFileCount: selectedFiles.size,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})

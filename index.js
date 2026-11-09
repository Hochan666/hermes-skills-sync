/**
 * Host half of the Hermes Skills Sync bundle.
 *
 * Responsibilities:
 *  - discover every Hermes installation reachable on this machine,
 *  - enumerate the skills of the main agent and of each Hermes profile,
 *  - copy a selected skill into DSH's global or project skill root.
 *
 * The Client half owns rendering; this module owns every privileged
 * filesystem operation. All state is derived from the filesystem on each
 * request so the UI never serves a stale cache.
 */

import { readFile, readdir, stat, mkdir, cp, rm, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, basename, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'

const name = 'hermes-skills-sync'
// Both services are needed for the plugin to be useful:
//  - `webServer` serves the HTTP routes, and
//  - `workspaceRegistry` supplies the project list for a project-scoped
//    import. Reading an undeclared Cordis service THROWS, so this service
//    must be declared here; probing it dynamically silently yielded an empty
//    project list.
// In a profile without either service the plugin stays inactive instead of
// half-working, which is the correct outcome for a Web-UI-only plugin.
const inject = ['webServer', 'workspaceRegistry']

/**
 * DSH's frontmatter skill-name grammar. It constrains the SKILL.md `name:`
 * field, NOT the skill's directory name, so folder names stay untouched.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Hermes directories that never contain importable skills. */
const SKIP_DIRS = new Set([
  '.archive', '.curator_backups', '.git', 'node_modules', '__pycache__',
  'cache', 'tmp', '.tmp', 'audio_cache', 'image_cache', 'images', 'videos',
])

/** Guard rails so a scan can never exhaust memory or wedge the Host. */
const MAX_SKILLS_PER_ROOT = 2000
const MAX_FILE_BYTES = 1 << 20

function resolveDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/**
 * Candidate Hermes home directories, in priority order.
 *
 * Every path is probed independently, so a machine with Hermes installed in
 * several places reports all of them instead of only the first hit.
 */
function candidateHermesHomes() {
  const home = homedir()
  const candidates = [
    { path: join(home, '.hermes'), source: 'default' },
    { path: join(home, '.config', 'hermes'), source: 'xdg-config' },
    { path: join(home, '.local', 'share', 'hermes'), source: 'xdg-data' },
    { path: join(home, '.hermes-agent'), source: 'legacy' },
    { path: '/opt/hermes', source: 'system' },
    { path: '/usr/local/hermes', source: 'system' },
    { path: '/usr/lib/hermes', source: 'system' },
  ]
  // Honour an explicit override first, the way other DSH tools honour
  // DSH_<AGENT>_HOME.
  const override = process.env.DSH_HERMES_HOME
  if (override) candidates.unshift({ path: resolve(override), source: 'env' })
  return candidates
}

/** True when a directory looks like a Hermes home (it owns a skills dir). */
async function looksLikeHermesHome(dir) {
  try {
    const info = await stat(dir)
    if (!info.isDirectory()) return false
  } catch {
    return false
  }
  try {
    return (await stat(join(dir, 'skills'))).isDirectory()
  } catch {
    return false
  }
}

/**
 * Parse a YAML-ish frontmatter block into flat key/value pairs.
 *
 * Only the small subset Hermes actually uses is supported: `key: value`,
 * block scalars (`|`, `>`), quoted values and simple lists. This is
 * intentionally not a full YAML parser — a malformed block must never
 * throw during a scan.
 */
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end === -1) return {}
  const block = text.slice(3, end)
  const out = {}
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.trim() === '') continue
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const raw = match[2].trim()
    if (raw === '' || raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      out[key] = ''
      continue
    }
    out[key] = unquote(raw)
  }
  // Fold block scalars: their value was set to '' and the indented body was
  // skipped, so re-read it from the raw block.
  for (const key of Object.keys(out)) {
    if (out[key] !== '') continue
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`^${escaped}\\s*:\\s*[|>]-?\\s*\\n((?:[ \\t]+.*(?:\\n|$))*)`, 'm')
    const m = re.exec(block)
    if (!m) continue
    out[key] = m[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]+/, '').trimEnd())
      .filter((l) => l !== '')
      .join(' ')
  }
  return out
}

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1)
    }
  }
  return value
}

/** First non-empty body line, used as a description fallback. */
function firstBodyLine(text) {
  const withoutFrontmatter = text.startsWith('---')
    ? text.slice(text.indexOf('\n---', 3) + 4)
    : text
  for (const line of withoutFrontmatter.split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/** Read a SKILL.md and extract name/description without throwing. */
async function readSkillMeta(path) {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined
    const text = await readFile(path, 'utf8')
    const meta = parseFrontmatter(text)
    const declared = typeof meta.name === 'string' ? meta.name.trim() : ''
    const description = typeof meta.description === 'string' ? meta.description.trim() : ''
    const displayName = typeof meta.display_name === 'string' ? meta.display_name.trim() : ''
    return {
      name: declared || undefined,
      description: description || firstBodyLine(text) || undefined,
      displayName: displayName || undefined,
    }
  } catch {
    return undefined
  }
}

/**
 * Recursively collect importable skills under a root.
 *
 * A skill is a directory that directly contains SKILL.md. Directories that
 * only group other skills (Hermes uses these for categories) are traversed
 * rather than reported.
 */
async function collectSkills(root, budget) {
  const results = []
  const queue = [{ dir: root, depth: 0 }]
  while (queue.length > 0) {
    if (budget.used >= MAX_SKILLS_PER_ROOT) break
    const { dir, depth } = queue.shift()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const hasSkillFile = entries.some((e) => e.isFile() && e.name.toLowerCase() === 'skill.md')
    if (hasSkillFile) {
      const meta = await readSkillMeta(join(dir, 'SKILL.md'))
      if (meta) {
        budget.used += 1
        results.push({ dir, meta })
        continue
      }
    }
    if (depth > 4) continue
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.system') continue
      queue.push({ dir: join(dir, entry.name), depth: depth + 1 })
    }
  }
  return results
}

/** Total byte size and file count of a skill directory. */
async function measureSkill(dir) {
  let bytes = 0
  let files = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(full)
        bytes += info.size
        files += 1
      } catch {
        // Unreadable entries are skipped rather than failing the whole skill.
      }
    }
  }
  return { bytes, files }
}

/**
 * Enumerate the profiles of a Hermes home.
 *
 * A profile is a directory under `profiles/` that owns a `skills/` folder.
 * Loose `*.json` files in `profiles/` describe user personas, not profiles,
 * and are therefore not listed.
 */
async function collectProfiles(hermesHome) {
  const profilesDir = join(hermesHome, 'profiles')
  const profiles = []
  let entries
  try {
    entries = await readdir(profilesDir, { withFileTypes: true })
  } catch {
    return profiles
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillsDir = join(profilesDir, entry.name, 'skills')
    try {
      const info = await stat(skillsDir)
      if (!info.isDirectory()) continue
    } catch {
      continue
    }
    profiles.push({ name: entry.name, skillsDir })
  }
  profiles.sort((a, b) => a.name.localeCompare(b.name))
  return profiles
}

/** True when a directory contains no importable skill. */
async function isEmptyGroup(dir) {
  const budget = { used: 0 }
  const found = await collectSkills(dir, budget)
  return found.length === 0
}

/** Scan one Hermes home into instances → groups (main + profiles) → skills. */
async function scanHermesHome(hermesHome, source) {
  const mainSkillsDir = join(hermesHome, 'skills')
  const groups = []

  const budget = { used: 0 }
  const mainSkills = await collectSkills(mainSkillsDir, budget)

  // Hermes stores category containers (a directory with DESCRIPTION.md and
  // no SKILL.md). Keep them so the UI can show the grouping, but mark them
  // as containers so they are never offered as importable skills.
  const mainContainers = []
  try {
    const entries = await readdir(mainSkillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      const dir = join(mainSkillsDir, entry.name)
      const names = await readdir(dir).catch(() => [])
      if (names.some((n) => n.toLowerCase() === 'skill.md')) continue
      if (await isEmptyGroup(dir)) continue
      mainContainers.push({ name: entry.name, dir })
    }
  } catch {
    // An unreadable skills dir simply yields no containers.
  }

  groups.push({
    key: 'main',
    label: 'main',
    kind: 'agent',
    path: mainSkillsDir,
    skills: mainSkills.map((s) => ({ dir: s.dir, meta: s.meta })),
    containers: mainContainers,
  })

  const profiles = await collectProfiles(hermesHome)
  for (const profile of profiles) {
    const pBudget = { used: 0 }
    const skills = await collectSkills(profile.skillsDir, pBudget)
    groups.push({
      key: `profile:${profile.name}`,
      label: profile.name,
      kind: 'profile',
      path: profile.skillsDir,
      skills: skills.map((s) => ({ dir: s.dir, meta: s.meta })),
      containers: [],
    })
  }

  return { id: hermesHome, path: hermesHome, source, groups }
}

/** Discover every Hermes installation on this machine. */
export async function discoverHermes() {
  const candidates = candidateHermesHomes()
  const seen = new Set()
  const instances = []
  for (const candidate of candidates) {
    const key = candidate.path
    if (seen.has(key)) continue
    seen.add(key)
    if (!(await looksLikeHermesHome(candidate.path))) continue
    try {
      const instance = await scanHermesHome(candidate.path, candidate.source)
      const total = instance.groups.reduce((sum, g) => sum + g.skills.length, 0)
      if (total === 0) continue
      instances.push(instance)
    } catch {
      // A broken installation must not abort the whole discovery.
    }
  }
  return instances
}

/**
 * Sanitize a skill name into a safe directory name, PRESERVING it otherwise.
 *
 * DSH does not constrain the skill's directory name: discovery only reads
 * `<dir>/SKILL.md` and validates the frontmatter `name`. Chinese folder names,
 * spaces and dots therefore work unchanged, so the import must not rename the
 * folder. Only characters that cannot appear in a path segment are replaced.
 */
export function folderNameFor(sourceName) {
  const raw = typeof sourceName === 'string' ? sourceName.trim() : ''
  const base = raw === '' ? 'unnamed-skill' : raw
  const safe = base
    // Path separators and NUL would escape or break the target directory.
    .replace(/[/\\\u0000]/g, '-')
    // Control characters are rejected by most filesystems.
    .replace(/[\u0001-\u001f\u007f]/g, '')
    .trim()
  if (safe === '') return 'unnamed-skill'
  // A leading dot would hide the directory from the list.
  return safe.startsWith('.') ? `skill${safe}` : safe
}

/** True when a declared name satisfies DSH's frontmatter grammar. */
export function isValidDeclaredName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name)
}

/**
 * Produce a DSH-compatible value for the frontmatter `name:` field.
 *
 * This is only ever applied to the `name:` line of SKILL.md — never to the
 * directory — and only when the caller opts in, because a non-kebab declared
 * name makes `skill-filesystem` drop the whole skill:
 *   `skill file <path> ignored: invalid skill name "<name>"`
 */
export function toDshDeclaredName(sourceName, fallbackSeed) {
  const trimmed = (sourceName ?? '').trim()
  if (SKILL_NAME.test(trimmed)) return trimmed
  // Latin words that survive lower-casing are transliterated as-is.
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (ascii !== '' && ascii.length >= 2) {
    const suffixed = ascii
      .split('-')
      .filter((part) => part !== '')
      .map((part) => (/^[a-z]/.test(part) ? part : `s${part}`))
      .join('-')
      .slice(0, 60)
      .replace(/-+$/g, '')
    if (SKILL_NAME.test(suffixed)) return suffixed
  }
  // Everything else (pure CJK, symbols) falls back to a stable hash slug.
  const digest = createHash('sha256')
    .update(`${trimmed}\u0000${fallbackSeed ?? ''}`)
    .digest('hex')
    .slice(0, 8)
  return `skill-${digest}`
}

/** Backwards-compatible alias used by older callers/tests. */
export const toDshSkillName = toDshDeclaredName

/** Resolve the DSH destination root for a target scope. */
export function resolveTargetRoot(target) {
  if (target && target.kind === 'project' && typeof target.projectRoot === 'string') {
    const projectRoot = resolve(target.projectRoot)
    return {
      kind: 'project',
      path: join(projectRoot, '.dsh', 'skills'),
      projectRoot,
    }
  }
  return { kind: 'global', path: join(resolveDshHome(), 'skills') }
}

/** List the skill folder names already present in a destination root. */
export async function listExistingSkillNames(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch {
    // A missing destination simply has no conflicts.
    return []
  }
}

/**
 * Report which items would collide with an existing skill folder.
 *
 * The Client checks this before importing so it can offer overwrite / rename /
 * skip instead of reporting a failure afterwards.
 */
export async function checkConflicts(items, target) {
  const root = resolveTargetRoot(target)
  const existing = new Set(await listExistingSkillNames(root.path))
  return items.map((item) => {
    const folderName = folderNameFor(item.sourceName ?? item.name)
    return {
      sourcePath: item.sourcePath ?? item.path,
      sourceName: item.sourceName ?? item.name,
      folderName,
      exists: existing.has(folderName),
    }
  })
}

/**
 * Copy one skill directory into a DSH root.
 *
 * The copy is staged in a temporary sibling directory and then renamed into
 * place, so a failed copy never leaves a half-written skill behind.
 */
async function copySkill(sourceDir, targetDir) {
  await mkdir(dirname(targetDir), { recursive: true })
  const staging = `${targetDir}.hermes-tmp-${Date.now().toString(36)}`
  try {
    await rm(staging, { recursive: true, force: true })
    await cp(sourceDir, staging, {
      recursive: true,
      dereference: false,
      filter: (src) => basename(src) !== '.DS_Store',
    })
    // Remove any pre-existing target before the atomic rename.
    await rm(targetDir, { recursive: true, force: true })
    await rename(staging, targetDir)
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/**
 * Rewrite ONLY the frontmatter `name:` line of an imported SKILL.md.
 *
 * The directory keeps its original name; this field is the one DSH validates,
 * and a non-kebab value makes `skill-filesystem` drop the whole skill. Callers
 * opt in via `normalizeDeclaredName`, and the result reports the change so the
 * UI can disclose it.
 */
async function rewriteDeclaredName(skillDir, nextName, previousName) {
  const skillFile = join(skillDir, 'SKILL.md')
  let text
  try {
    text = await readFile(skillFile, 'utf8')
  } catch {
    return false
  }
  if (!text.startsWith('---')) return false
  const end = text.indexOf('\n---', 3)
  if (end === -1) return false
  const head = text.slice(0, end)
  const tail = text.slice(end)
  if (!/^name\s*:/m.test(head)) return false
  if (previousName && nextName === previousName) return false
  // Preserve the original as a visible alias the author can still read.
  const claimed = /^display_name\s*:/m.test(head)
  const withAlias = claimed || !previousName
    ? head
    : `${head}\n# original-name: ${previousName.replace(/\r?\n/g, ' ')}`
  const rewritten = withAlias.replace(/^name\s*:.*$/m, `name: ${nextName}`)
  await writeFile(skillFile, rewritten + tail, 'utf8')
  return true
}

/**
 * Import one skill into a DSH root.
 *
 * Naming rules (verified against dsh-skill-filesystem):
 *  - the destination FOLDER keeps the skill's original name, only sanitized
 *    for path safety, because DSH never validates a folder name;
 *  - the frontmatter `name:` is left untouched unless `normalizeDeclaredName`
 *    is set, in which case only that line changes so DSH can load the skill.
 *
 * Returns a structured result rather than throwing, so the Client can show
 * the reason for a failure.
 */
export async function importSkill(skill, target, options = {}) {
  const root = resolveTargetRoot(target)
  const originalName = skill.name
  const folderName = folderNameFor(options.renameTo || originalName)
  const targetDir = join(root.path, folderName)
  const existed = await stat(targetDir).then(() => true).catch(() => false)

  const onConflict = options.onConflict === 'rename'
    ? 'rename'
    : (options.onConflict === 'overwrite' ? 'overwrite' : 'skip')
  if (existed && onConflict === 'skip') {
    return {
      ok: false,
      code: 'error.conflict',
      folderName,
      dshName: folderName,
      originalName,
      target: root.path,
      existed: true,
    }
  }

  // Opt-out: callers that must keep the file byte-identical set this false.
  const normalize = options.normalizeDeclaredName !== false
  const declaredValid = isValidDeclaredName(originalName)
  const compatName = normalize && !declaredValid
    ? toDshDeclaredName(originalName, skill.dir)
    : null

  try {
    await copySkill(skill.dir, targetDir)
    let declaredRewritten = false
    if (compatName !== null) {
      declaredRewritten = await rewriteDeclaredName(targetDir, compatName, originalName)
    }
    return {
      ok: true,
      folderName,
      dshName: folderName,
      originalName,
      target: root.path,
      targetKind: root.kind,
      replaced: existed,
      declaredName: declaredRewritten ? compatName : originalName,
      declaredNameRewritten: declaredRewritten,
      declaredNameValid: declaredValid,
      // A skill whose declared name stayed invalid will be ignored by DSH.
      willLoad: declaredValid || declaredRewritten,
    }
  } catch (error) {
    return {
      ok: false,
      code: 'error.copyFailed',
      folderName,
      dshName: folderName,
      originalName,
      target: root.path,
      reason: String(error?.message ?? error),
    }
  }
}

/**
 * List the workspaces that can receive a project-scoped import.
 *
 * `workspaceRegistry` is declared in `inject`, so reading it does not throw.
 * The defensive try/catch remains for a profile that mounts a registry
 * implementation without `list()`, and so one bad record cannot blank the
 * whole list.
 *
 * `workspaceRegistry.list()` returns the durable registry order, which is
 * already the order the user sees in the sidebar.
 */
export function listProjectTargets(ctx) {
  let workspaces = []
  try {
    const registry = ctx.workspaceRegistry
    if (registry && typeof registry.list === 'function') {
      workspaces = registry.list() ?? []
    }
  } catch {
    // A registry without a usable `list()` degrades to global-only imports.
    return []
  }
  return workspaces
    .map((w) => {
      const path = typeof w.path === 'string' ? w.path : undefined
      let sessions = 0
      try {
        sessions = Array.isArray(w.sessionIds) ? w.sessionIds.length : 0
      } catch {
        sessions = 0
      }
      return {
        id: String(w.id),
        title: typeof w.title === 'string' && w.title !== '' ? w.title : path,
        path,
        sessions,
      }
    })
    .filter((w) => typeof w.path === 'string' && isAbsolute(w.path))
}
/** Build the full client-facing snapshot. */
export async function buildSnapshot(ctx) {
  const started = Date.now()
  const instances = await discoverHermes()
  const groups = []
  const containers = []
  let skillTotal = 0
  for (const instance of instances) {
    for (const group of instance.groups) {
      const skills = []
      for (const entry of group.skills) {
        const meta = entry.meta ?? {}
        const measured = await measureSkill(entry.dir)
        const sourceName = meta.name ?? basename(entry.dir)
        const declaredValid = isValidDeclaredName(sourceName)
        skills.push({
          id: `${instance.path}::${group.key}::${entry.dir}`,
          sourceName,
          // The destination folder is the original name; `folderName` only
          // reflects path-safety sanitization, never a display rename.
          folderName: folderNameFor(sourceName),
          // What the frontmatter `name:` would become if the caller opts into
          // normalization. Only relevant when `declaredNameValid` is false.
          compatName: declaredValid
            ? sourceName
            : toDshDeclaredName(sourceName, entry.dir),
          declaredNameValid: declaredValid,
          displayName: meta.displayName ?? sourceName,
          description: meta.description ?? '',
          path: entry.dir,
          bytes: measured.bytes,
          files: measured.files,
          groupKey: group.key,
          groupLabel: group.label,
          groupKind: group.kind,
          instancePath: instance.path,
          instanceSource: instance.source,
        })
      }
      skillTotal += skills.length
      groups.push({
        key: `${instance.path}::${group.key}`,
        kind: group.kind,
        label: group.label,
        path: group.path,
        instancePath: instance.path,
        instanceSource: instance.source,
        skillCount: skills.length,
        skills,
      })
      for (const container of group.containers) {
        containers.push({
          key: `${instance.path}::${group.key}::${container.dir}`,
          name: container.name,
          path: container.dir,
          groupKey: group.key,
          groupLabel: group.label,
          instancePath: instance.path,
        })
      }
    }
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    instanceCount: instances.length,
    skillCount: skillTotal,
    groups,
    containers,
    projectTargets: listProjectTargets(ctx),
  }
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 4 << 20) {
        rejectBody(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') {
        resolveBody({})
        return
      }
      try {
        resolveBody(JSON.parse(raw))
      } catch (error) {
        rejectBody(error)
      }
    })
    req.on('error', rejectBody)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Hard ceiling on one batch so a malformed request cannot flood the disk. */
const MAX_BATCH_ITEMS = 500
/** Copies run with bounded concurrency to keep the filesystem responsive. */
const BATCH_CONCURRENCY = 4

/**
 * Map over items with at most `limit` promises in flight, preserving order.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await fn(items[index], index)
      }
    },
  )
  await Promise.all(workers)
  return results
}

/**
 * Import many skills into one destination and report a per-item outcome.
 *
 * Each item is copied independently, so one failure never aborts the batch.
 */
export async function importSkillBatch(items, target, options = {}) {
  const onConflict = options.onConflict === 'skip'
    ? 'skip'
    : (options.onConflict === 'rename' ? 'rename' : 'overwrite')
  const normalizeDeclaredName = options.normalizeDeclaredName !== false
  const limited = items.slice(0, MAX_BATCH_ITEMS)
  const results = await mapLimit(limited, BATCH_CONCURRENCY, async (item) => {
    const sourcePath = item.sourcePath ?? item.path
    const sourceName = item.sourceName ?? item.name
    const result = await importSkill({ name: sourceName, dir: sourcePath }, target, {
      onConflict,
      normalizeDeclaredName,
      renameTo: item.renameTo,
    })
    return {
      sourcePath,
      sourceName,
      ...result,
    }
  })
  const summary = {
    total: results.length,
    imported: results.filter((r) => r.ok && !r.replaced).length,
    replaced: results.filter((r) => r.ok && r.replaced).length,
    conflicted: results.filter((r) => !r.ok && r.code === 'error.conflict').length,
    failed: results.filter((r) => !r.ok && r.code !== 'error.conflict').length,
    // Imported but DSH will ignore it because the declared name stayed invalid.
    unloadable: results.filter((r) => r.ok && r.willLoad === false).length,
    declaredRenamed: results.filter((r) => r.ok && r.declaredNameRewritten).length,
  }
  return { ok: true, results, summary, truncated: items.length > limited.length }
}

/** Register the HTTP routes the Client half calls. */
export function apply(ctx, config = {}) {
  const basePath = '/api/hermes-skills-sync'
  const maxGroups = Number.isInteger(config.maxGroups) ? config.maxGroups : 256
  registerRoutes(ctx, basePath, maxGroups)
}

/** Register the plugin's HTTP routes on a context that has webServer. */
function registerRoutes(ctx, basePath, maxGroups) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: basePath,
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = url.pathname.replace(/\/+$/, '') || basePath
      try {
        if (route === `${basePath}/snapshot` && req.method === 'GET') {
          const snapshot = await buildSnapshot(ctx)
          sendJson(res, 200, { ...snapshot, groups: snapshot.groups.slice(0, maxGroups) })
          return
        }
        if (route === `${basePath}/import` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const target = body.target ?? { kind: 'global' }
          const result = await importSkill(
            { name: body.sourceName ?? body.name, dir: body.sourcePath ?? body.path },
            target,
            {
              onConflict: body.onConflict === 'rename'
                ? 'rename'
                : (body.onConflict === 'overwrite' ? 'overwrite' : 'skip'),
              renameTo: typeof body.renameTo === 'string' && body.renameTo.trim() !== ''
                ? body.renameTo.trim()
                : undefined,
              normalizeDeclaredName: body.normalizeDeclaredName !== false,
            },
          )
          sendJson(res, result.ok ? 200 : 409, result)
          return
        }
        if (route === `${basePath}/import-batch` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const items = Array.isArray(body.items) ? body.items : []
          if (items.length === 0) {
            sendJson(res, 400, { ok: false, code: 'error.emptyBatch' })
            return
          }
          const valid = items.filter((item) =>
            typeof (item.sourcePath ?? item.path) === 'string'
            && (item.sourcePath ?? item.path).length > 0)
          if (valid.length === 0) {
            sendJson(res, 400, { ok: false, code: 'error.emptyBatch' })
            return
          }
          const report = await importSkillBatch(
            valid,
            body.target ?? { kind: 'global' },
            {
              onConflict: body.onConflict === 'skip'
                ? 'skip'
                : (body.onConflict === 'rename' ? 'rename' : 'overwrite'),
              normalizeDeclaredName: body.normalizeDeclaredName !== false,
            },
          )
          sendJson(res, 200, report)
          return
        }
        if (route === `${basePath}/conflicts` && req.method === 'POST') {
          const body = await readJsonBody(req)
          const items = Array.isArray(body.items) ? body.items : []
          const target = body.target ?? { kind: 'global' }
          const conflicts = await checkConflicts(items, target)
          sendJson(res, 200, {
            ok: true,
            target: resolveTargetRoot(target).path,
            conflicts,
            conflictCount: conflicts.filter((c) => c.exists).length,
          })
          return
        }
        if (route === `${basePath}/targets` && req.method === 'GET') {
          sendJson(res, 200, { ok: true, projectTargets: listProjectTargets(ctx) })
          return
        }
        sendJson(res, 404, { ok: false, code: 'error.notFound' })
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          code: 'error.requestFailed',
          reason: String(error?.message ?? error),
        })
      }
    },
  }))
}

export { name, inject }

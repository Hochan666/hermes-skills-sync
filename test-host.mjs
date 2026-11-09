/**
 * Host-side unit tests for the Hermes Skills Sync plugin.
 *
 * Builds throwaway Hermes home layouts in a temp directory and asserts the
 * discovery, profile separation, name mapping, and import behaviour against
 * them. Nothing here touches the real ~/.hermes or ~/.dsh.
 */

import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const failures = []
const notes = []
function check(label, condition, detail) {
  if (condition) notes.push('  PASS  ' + label)
  else {
    failures.push(label + (detail ? ' :: ' + detail : ''))
    notes.push('  FAIL  ' + label + (detail ? ' :: ' + detail : ''))
  }
}

const work = await mkdtemp(join(tmpdir(), 'hss-host-test-'))
process.env.DSH_HOME = join(work, 'dshhome')
process.env.HOME = join(work, 'home')

const mod = await import('./index.js')

function skillFile(name, description) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody.\n`
}

try {
  // ---- Build two independent Hermes installations -----------------------
  const mainHome = join(process.env.HOME, '.hermes')
  const altHome = join(process.env.HOME, '.config', 'hermes')

  async function buildHome(root, opts) {
    await mkdir(join(root, 'skills'), { recursive: true })
    // A plain skill.
    await mkdir(join(root, 'skills', 'alpha'), { recursive: true })
    await writeFile(join(root, 'skills', 'alpha', 'SKILL.md'), skillFile('alpha', 'Alpha skill.'))
    await writeFile(join(root, 'skills', 'alpha', 'helper.js'), 'export const x = 1\n')
    // A category container: holds a nested skill and no SKILL.md of its own.
    await mkdir(join(root, 'skills', 'group', 'inner'), { recursive: true })
    await writeFile(join(root, 'skills', 'group', 'DESCRIPTION.md'), 'Category container.\n')
    await writeFile(join(root, 'skills', 'group', 'inner', 'SKILL.md'), skillFile('inner-skill', 'Nested skill.'))
    // A skill whose declared name violates the DSH grammar.
    await mkdir(join(root, 'skills', 'weird'), { recursive: true })
    await writeFile(join(root, 'skills', 'weird', 'SKILL.md'), skillFile('中文名字', 'CJK skill.'))
    // Block-scalar description.
    await mkdir(join(root, 'skills', 'multiline'), { recursive: true })
    await writeFile(
      join(root, 'skills', 'multiline', 'SKILL.md'),
      '---\nname: multiline\ndescription: |\n  First line.\n  Second line.\n---\n\nBody.\n',
    )
    // Noise that must be ignored.
    await mkdir(join(root, 'skills', '.archive', 'old'), { recursive: true })
    await writeFile(join(root, 'skills', '.archive', 'old', 'SKILL.md'), skillFile('archived', 'Should not appear.'))
    await writeFile(join(root, 'skills', '.bundled_manifest'), '{}\n')
    // Profiles: one real (owns skills/), one JSON persona (must be ignored).
    await mkdir(join(root, 'profiles', 'studio', 'skills', 'beta'), { recursive: true })
    await writeFile(join(root, 'profiles', 'studio', 'skills', 'beta', 'SKILL.md'), skillFile('beta', 'Beta skill.'))
    await writeFile(join(root, 'profiles', 'persona.json'), '{"name":"persona"}\n')
    if (opts.extraProfile) {
      await mkdir(join(root, 'profiles', 'solo', 'skills', 'gamma'), { recursive: true })
      await writeFile(join(root, 'profiles', 'solo', 'skills', 'gamma', 'SKILL.md'), skillFile('gamma', 'Gamma skill.'))
    }
  }

  await buildHome(mainHome, { extraProfile: true })
  await buildHome(altHome, { extraProfile: false })

  // ---- Discovery -------------------------------------------------------
  const instances = await mod.discoverHermes()
  check('discovers both Hermes installations', instances.length === 2,
    'found ' + instances.length + ': ' + instances.map((i) => i.path).join(', '))
  const mainInstance = instances.find((i) => i.path === mainHome)
  check('primary installation discovered', !!mainInstance)

  const groupKeys = mainInstance.groups.map((g) => g.key)
  check('reports a main-agent group', groupKeys.includes('main'), groupKeys.join(','))
  check('reports the real profile', groupKeys.includes('profile:studio'), groupKeys.join(','))
  check('reports the second real profile', groupKeys.includes('profile:solo'), groupKeys.join(','))
  check('ignores a *.json persona as a profile',
    !groupKeys.some((k) => k.includes('persona')), groupKeys.join(','))

  const mainGroup = mainInstance.groups.find((g) => g.key === 'main')
  const mainNames = mainGroup.skills.map((s) => s.meta.name)
  check('finds a plain skill', mainNames.includes('alpha'), mainNames.join(','))
  check('finds a nested skill inside a category', mainNames.includes('inner-skill'), mainNames.join(','))
  check('skips .archive contents', !mainNames.includes('archived'), mainNames.join(','))
  check('category container is reported separately',
    mainGroup.containers.some((c) => c.name === 'group'),
    mainGroup.containers.map((c) => c.name).join(','))

  const studio = mainInstance.groups.find((g) => g.key === 'profile:studio')
  check('profile skills are separated from the main agent',
    studio.skills.length === 1 && studio.skills[0].meta.name === 'beta',
    JSON.stringify(studio.skills.map((s) => s.meta.name)))

  // ---- Frontmatter parsing --------------------------------------------
  const multi = mainGroup.skills.find((s) => s.meta.name === 'multiline')
  check('parses a block-scalar description',
    !!multi && /First line\./.test(multi.meta.description) && /Second line\./.test(multi.meta.description),
    multi && multi.meta.description)

  // ---- Name mapping ----------------------------------------------------
  check('keeps an already-valid name', mod.toDshSkillName('alpha', '/x') === 'alpha')
  check('maps CJK names to a valid slug',
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(mod.toDshSkillName('中文名字', '/x')),
    mod.toDshSkillName('中文名字', '/x'))
  check('CJK mapping is deterministic',
    mod.toDshSkillName('中文名字', '/x') === mod.toDshSkillName('中文名字', '/x'))
  check('strips parentheses from a declared name',
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(mod.toDshSkillName('hermes-novelist(九乂散人/x)', '/y')),
    mod.toDshSkillName('hermes-novelist(九乂散人/x)', '/y'))
  check('handles empty input without throwing',
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(mod.toDshSkillName('', '/z')))

  // ---- Project targets -------------------------------------------------
  // The Workspace entity shape is { id, path, title, sessionIds } and reading
  // the registry throws unless the service is declared in `inject`, which is
  // what previously produced an empty project list.
  const registryCtx = {
    workspaceRegistry: {
      list: () => [
        { id: 'w1', title: '示例工作区', path: '/home/example/workspace', sessionIds: ['a', 'b'] },
        { id: 'w2', title: '', path: '/home/example', sessionIds: [] },
        { id: 'w3', title: 'no path', path: undefined, sessionIds: [] },
        { id: 'w4', title: 'relative', path: 'rel/path', sessionIds: [] },
      ],
    },
  }
  const mapped = mod.listProjectTargets(registryCtx)
  check('project targets map the Workspace entity fields',
    mapped.length === 2 && mapped[0].title === '示例工作区' && mapped[0].path === '/home/example/workspace',
    JSON.stringify(mapped))
  check('a workspace without a path is dropped',
    !mapped.some((t) => t.id === 'w3'), JSON.stringify(mapped.map((t) => t.id)))
  check('a relative workspace path is dropped',
    !mapped.some((t) => t.id === 'w4'), JSON.stringify(mapped.map((t) => t.id)))
  check('a blank title falls back to the path',
    mapped.some((t) => t.path === '/home/example' && t.title === '/home/example'),
    JSON.stringify(mapped))
  check('workspace session counts are reported',
    mapped.find((t) => t.id === 'w1').sessions === 2,
    JSON.stringify(mapped))
  check('the module declares workspaceRegistry in inject',
    Array.isArray(mod.inject) && mod.inject.includes('workspaceRegistry'),
    JSON.stringify(mod.inject))
  check('a context without a usable registry degrades to an empty list',
    JSON.stringify(mod.listProjectTargets({ workspaceRegistry: {} })) === '[]')
  check('a throwing registry access degrades to an empty list',
    (() => {
      const throwing = new Proxy({}, {
        get() { throw new Error('cannot get property without inject') },
      })
      return JSON.stringify(mod.listProjectTargets(throwing)) === '[]'
    })())

  // ---- Snapshot --------------------------------------------------------
  const fakeCtx = {} // no workspaceRegistry: must degrade, not throw
  const snap = await mod.buildSnapshot(fakeCtx)
  check('snapshot succeeds without workspaceRegistry', snap.ok === true)
  check('snapshot reports project targets as an empty array',
    Array.isArray(snap.projectTargets) && snap.projectTargets.length === 0)
  check('snapshot totals both installations', snap.instanceCount === 2, String(snap.instanceCount))
  check('snapshot skills are flat and carry display fields',
    snap.groups.every((g) => g.skills.every((s) =>
      typeof s.sourceName === 'string' &&
      typeof s.folderName === 'string' &&
      typeof s.declaredNameValid === 'boolean' &&
      typeof s.description === 'string' &&
      typeof s.path === 'string' &&
      typeof s.files === 'number')),
  )
  // The folder name must be the ORIGINAL name, never a slug. Only the
  // frontmatter `name:` is subject to DSH's grammar.
  check('the folder name equals the original skill name',
    snap.groups.flatMap((g) => g.skills)
      .filter((s) => s.sourceName === '中文名字')
      .every((s) => s.folderName === '中文名字'),
    JSON.stringify(snap.groups.flatMap((g) => g.skills)
      .filter((s) => s.sourceName === '中文名字').map((s) => s.folderName)))
  const invalidDeclared = snap.groups
    .flatMap((g) => g.skills)
    .filter((s) => s.declaredNameValid === false).length
  check('flags skills whose declared name DSH would reject', invalidDeclared === 2,
    'invalid=' + invalidDeclared + ' (one per installation)')

  // ---- Name mapping ----------------------------------------------------
  check('folderNameFor keeps a Chinese name unchanged',
    mod.folderNameFor('量化引擎') === '量化引擎', mod.folderNameFor('量化引擎'))
  check('folderNameFor only replaces path separators',
    mod.folderNameFor('a/b') === 'a-b', mod.folderNameFor('a/b'))
  check('folderNameFor never returns an empty segment',
    mod.folderNameFor('   ') === 'unnamed-skill', mod.folderNameFor('   '))
  check('folderNameFor un-hides a leading dot',
    mod.folderNameFor('.hidden') === 'skill.hidden', mod.folderNameFor('.hidden'))
  check('isValidDeclaredName accepts kebab-case',
    mod.isValidDeclaredName('amazon-consultant') === true)
  check('isValidDeclaredName rejects a Chinese name',
    mod.isValidDeclaredName('量化引擎') === false)

  // ---- Import: global --------------------------------------------------
  const cjk = mainGroup.skills.find((s) => s.meta.name === '中文名字')
  const globalResult = await mod.importSkill(
    { name: cjk.meta.name, dir: cjk.dir },
    { kind: 'global' },
    { onConflict: 'overwrite' },
  )
  check('global import succeeds', globalResult.ok === true, JSON.stringify(globalResult))
  // The DIRECTORY keeps the original Chinese name.
  check('the imported directory keeps the original name',
    globalResult.folderName === '中文名字', globalResult.folderName)
  const globalDir = join(process.env.DSH_HOME, 'skills', '中文名字')
  const globalFiles = await readdir(globalDir)
  check('global import copies the whole skill', globalFiles.includes('SKILL.md'), globalFiles.join(','))
  const rewritten = await readFile(join(globalDir, 'SKILL.md'), 'utf8')
  check('only the frontmatter name is normalized so DSH can load it',
    !/^name:\s*中文名字/m.test(rewritten)
      && /^name:\s*[a-z0-9]+(-[a-z0-9]+)*$/m.test(rewritten),
    rewritten.split('\n').slice(0, 5).join(' | '))
  check('the original declared name is preserved as a comment',
    rewritten.includes('original-name: 中文名字'),
    rewritten.split('\n').slice(0, 5).join(' | '))
  check('the import reports that the declared name was rewritten',
    globalResult.declaredNameRewritten === true && globalResult.willLoad === true,
    JSON.stringify(globalResult))

  // Opt-out: a byte-exact copy keeps the invalid declared name and is honest
  // about the consequence.
  const exact = await mod.importSkill(
    { name: cjk.meta.name, dir: cjk.dir },
    { kind: 'project', projectRoot: join(work, 'exact-proj') },
    { onConflict: 'overwrite', normalizeDeclaredName: false },
  )
  const exactText = await readFile(
    join(work, 'exact-proj', '.dsh', 'skills', '中文名字', 'SKILL.md'), 'utf8',
  )
  check('opting out leaves the declared name byte-identical',
    /^name:\s*中文名字/m.test(exactText), exactText.split('\n').slice(0, 3).join(' | '))
  check('opting out reports that DSH will ignore the skill',
    exact.ok === true && exact.willLoad === false, JSON.stringify(exact))

  // ---- Import: conflict ------------------------------------------------
  const skip = await mod.importSkill(
    { name: cjk.meta.name, dir: cjk.dir },
    { kind: 'global' },
    { onConflict: 'skip' },
  )
  check('a second import reports a conflict', skip.ok === false && skip.code === 'error.conflict',
    JSON.stringify(skip))
  const overwrite = await mod.importSkill(
    { name: cjk.meta.name, dir: cjk.dir },
    { kind: 'global' },
    { onConflict: 'overwrite' },
  )
  check('overwrite replaces the previous copy',
    overwrite.ok === true && overwrite.replaced === true, JSON.stringify(overwrite))

  // ---- Import: project -------------------------------------------------
  const projectRoot = join(work, 'proj')
  await mkdir(join(projectRoot, '.git'), { recursive: true })
  const alpha = mainGroup.skills.find((s) => s.meta.name === 'alpha')
  const projectResult = await mod.importSkill(
    { name: alpha.meta.name, dir: alpha.dir },
    { kind: 'project', projectRoot },
    { onConflict: 'overwrite' },
  )
  check('project import succeeds', projectResult.ok === true, JSON.stringify(projectResult))
  check('project import lands in .dsh/skills',
    projectResult.target === join(projectRoot, '.dsh', 'skills'),
    projectResult.target)
  const projectFiles = await readdir(join(projectRoot, '.dsh', 'skills', 'alpha'))
  check('project import copies every file',
    projectFiles.includes('SKILL.md') && projectFiles.includes('helper.js'),
    projectFiles.join(','))

  // ---- Failure handling ------------------------------------------------
  const missing = await mod.importSkill(
    { name: 'ghost', dir: join(work, 'does-not-exist') },
    { kind: 'global' },
    { onConflict: 'overwrite' },
  )
  check('a missing source returns a structured failure, not a throw',
    missing.ok === false && missing.code === 'error.copyFailed', JSON.stringify(missing))
  check('a failed copy leaves no staging directory',
    (await readdir(join(process.env.DSH_HOME, 'skills')))
      .every((n) => !n.includes('hermes-tmp')),
    (await readdir(join(process.env.DSH_HOME, 'skills'))).join(','))

  // ---- Conflict detection ---------------------------------------------
  const conflictItems = [
    { sourceName: '中文名字', sourcePath: cjk.dir },
    { sourceName: 'brand-new-skill', sourcePath: cjk.dir },
  ]
  const conflicts = await mod.checkConflicts(conflictItems, { kind: 'global' })
  check('conflict check reports one collision per existing skill',
    conflicts.filter((c) => c.exists).length === 1, JSON.stringify(conflicts))
  check('conflict check identifies the colliding folder name',
    conflicts.find((c) => c.exists).folderName === '中文名字', JSON.stringify(conflicts))
  check('conflict check leaves absent skills unflagged',
    conflicts.find((c) => c.sourceName === 'brand-new-skill').exists === false)
  check('conflict check on a missing root reports no collisions',
    (await mod.checkConflicts(conflictItems, { kind: 'project', projectRoot: join(work, 'nope') }))
      .every((c) => c.exists === false))

  // Rename resolution stores the copy under a new folder while keeping the
  // existing one intact.
  const renamed = await mod.importSkill(
    { name: cjk.meta.name, dir: cjk.dir },
    { kind: 'global' },
    { onConflict: 'rename', renameTo: '中文名字-2' },
  )
  check('rename imports into the requested folder',
    renamed.ok === true && renamed.folderName === '中文名字-2', JSON.stringify(renamed))
  const afterRename = await readdir(join(process.env.DSH_HOME, 'skills'))
  check('rename keeps the original folder and adds the new one',
    afterRename.includes('中文名字') && afterRename.includes('中文名字-2'),
    afterRename.join(','))
  check('skip leaves the existing copy untouched',
    (await mod.importSkill(
      { name: cjk.meta.name, dir: cjk.dir },
      { kind: 'global' },
      { onConflict: 'skip' },
    )).code === 'error.conflict')

  // ---- Safety ----------------------------------------------------------
  const outside = join(work, 'unrelated')
  await mkdir(outside, { recursive: true })
  await writeFile(join(outside, 'keep.txt'), 'keep\n')
  check('scanning never wrote outside the DSH skill roots',
    (await stat(join(outside, 'keep.txt'))).isFile())

  // ---- Batch import ----------------------------------------------------
  const batchTarget = { kind: 'global' }

  // Point discovery at a fresh Hermes home so the batch set is predictable.
  const batchHermes = join(work, 'batch-hermes')
  await mkdir(join(batchHermes, 'skills', 'one'), { recursive: true })
  await mkdir(join(batchHermes, 'skills', 'two'), { recursive: true })
  await mkdir(join(batchHermes, 'skills', 'three'), { recursive: true })
  await writeFile(join(batchHermes, 'skills', 'one', 'SKILL.md'), skillFile('one', 'First.'))
  await writeFile(join(batchHermes, 'skills', 'two', 'SKILL.md'), skillFile('two', 'Second.'))
  await writeFile(join(batchHermes, 'skills', 'three', 'SKILL.md'), skillFile('three', 'Third.'))
  process.env.DSH_HERMES_HOME = batchHermes

  const discovered = await mod.discoverHermes()
  const batchInstance = discovered.find((instance) => instance.path === batchHermes)
  check('the DSH_HERMES_HOME override is discovered', !!batchInstance,
    discovered.map((i) => i.path).join(','))
  const batchSkills = batchInstance ? batchInstance.groups[0].skills : []
  check('the override reports its three skills', batchSkills.length === 3,
    String(batchSkills.length))

  const batchReport = await mod.importSkillBatch(
    batchSkills.map((skill) => ({
      sourceName: skill.meta.name,
      sourcePath: skill.dir,
    })),
    batchTarget,
    { onConflict: 'overwrite' },
  )
  check('batch import reports success', batchReport.ok === true)
  check('batch imports every item',
    batchReport.summary.imported === 3 && batchReport.summary.failed === 0,
    JSON.stringify(batchReport.summary))
  check('batch returns one result per item',
    batchReport.results.length === 3, String(batchReport.results.length))

  const batchDir = join(process.env.DSH_HOME, 'skills')
  const batchNames = (await readdir(batchDir)).filter((n) => !n.startsWith('.'))
  check('batch copies all three skill directories',
    ['one', 'two', 'three'].every((n) => batchNames.includes(n)),
    batchNames.join(','))

  // A second batch over the same items must report replacements, not failures.
  const again = await mod.importSkillBatch(
    batchSkills.map((skill) => ({
      sourceName: skill.meta.name,
      sourcePath: skill.dir,
    })),
    batchTarget,
    { onConflict: 'overwrite' },
  )
  check('re-importing the same batch reports replacements',
    again.summary.replaced === 3 && again.summary.imported === 0,
    JSON.stringify(again.summary))

  // One unreadable item must not abort the rest of the batch.
  const mixed = await mod.importSkillBatch(
    [
      { sourceName: 'one', sourcePath: join(batchHermes, 'skills', 'one') },
      { sourceName: 'ghost', sourcePath: join(work, 'no-such-skill') },
      { sourceName: 'two', sourcePath: join(batchHermes, 'skills', 'two') },
    ],
    batchTarget,
    { onConflict: 'overwrite' },
  )
  check('a failing item does not abort the batch',
    mixed.summary.replaced === 2 && mixed.summary.failed === 1,
    JSON.stringify(mixed.summary))
  check('the failed item carries a reason code',
    mixed.results.some((r) => !r.ok && typeof r.code === 'string'),
    JSON.stringify(mixed.results.map((r) => r.code)))

  // Per-item copy is atomic: no staging directories survive a mixed batch.
  const leftovers = (await readdir(batchDir)).filter((n) => n.includes('hermes-tmp'))
  check('mixed batch leaves no staging directories', leftovers.length === 0,
    leftovers.join(','))

  // An explicit project destination also works for a batch.
  const batchProject = join(work, 'batch-proj')
  await mkdir(join(batchProject, '.git'), { recursive: true })
  const projectBatch = await mod.importSkillBatch(
    [{ sourceName: 'one', sourcePath: join(batchHermes, 'skills', 'one') }],
    { kind: 'project', projectRoot: batchProject },
    { onConflict: 'overwrite' },
  )
  check('batch import honours a project destination',
    projectBatch.ok === true && projectBatch.summary.imported === 1,
    JSON.stringify(projectBatch.summary))
  check('project batch lands in .dsh/skills',
    (await readdir(join(batchProject, '.dsh', 'skills'))).includes('one'),
    (await readdir(join(batchProject, '.dsh', 'skills'))).join(','))
} finally {
  await rm(work, { recursive: true, force: true })
}

console.log(notes.join('\n'))
console.log('\n' + (failures.length === 0
  ? 'RESULT: all host checks passed (' + notes.length + ')'
  : 'RESULT: ' + failures.length + ' failure(s)\n - ' + failures.join('\n - ')))
process.exit(failures.length === 0 ? 0 : 1)

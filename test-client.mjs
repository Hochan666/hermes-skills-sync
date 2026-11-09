/**
 * Headless harness test for the plugin's Client half.
 *
 * Loads client.js with a mocked `window.__ModuleLoader__` and a minimal React
 * stand-in, then drives `apply` against a fake slot/locale context. The
 * stand-in keeps per-component hook state so clicks can be simulated and the
 * tree re-rendered, which is what catches the runtime errors a syntax check
 * cannot: missing React exports, wrong slot API usage, undefined props,
 * render-time crashes, and dead interactions.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')

const failures = []
const notes = []
function check(label, condition, detail) {
  if (condition) {
    notes.push('  PASS  ' + label)
  } else {
    failures.push(label + (detail ? ' :: ' + detail : ''))
    notes.push('  FAIL  ' + label + (detail ? ' :: ' + detail : ''))
  }
}

// --- Minimal React stand-in with per-component hook state -----------------
function createElement(type, props, ...children) {
  return { type, props: props || {}, children, key: props && props.key }
}

const stores = new Map()
let currentComponent = 'root'
let cursor = 0
const pendingEffects = []

function store() {
  if (!stores.has(currentComponent)) {
    stores.set(currentComponent, { state: [], refs: [] })
  }
  return stores.get(currentComponent)
}

const React = {
  createElement,
  Fragment: Symbol('Fragment'),
  useState(initial) {
    const s = store()
    const index = cursor++
    if (!(index in s.state)) s.state[index] = initial
    const set = (next) => {
      s.state[index] = typeof next === 'function' ? next(s.state[index]) : next
    }
    return [s.state[index], set]
  },
  useEffect(fn) {
    const s = store()
    const index = cursor++
    pendingEffects.push({ component: currentComponent, index, fn, s })
  },
  useMemo(fn) {
    cursor += 1
    return fn()
  },
  useCallback(fn) {
    cursor += 1
    return fn
  },
  useRef(initial) {
    const s = store()
    const index = cursor++
    if (!(index in s.refs)) s.refs[index] = { current: initial }
    return s.refs[index]
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    cursor += 1
    subscribe(() => {})
    return getSnapshot()
  },
}

// --- Minimal DOM stubs ----------------------------------------------------
// The dialog's effects touch `document` and `HTMLElement`; the harness has no
// real DOM, so provide just enough for the code paths to run.
class HTMLElementStub {}
globalThis.HTMLElement = HTMLElementStub
globalThis.Node = class NodeStub {}
globalThis.document = {
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
  querySelector() {
    return null
  },
}

// --- Fake module loader ---------------------------------------------------
let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registered = entry
    },
  },
}

const requireShim = (id) => {
  if (id === 'react') return React
  throw new Error('unexpected module require: ' + id)
}

new Function('window', 'require', source)(globalThis.window, requireShim)

check('bundle calls window.__ModuleLoader__.load', registered !== null)
check('loader id matches package name',
  registered && registered.id === 'hermes-skills-sync',
  registered && registered.id)

const mod = registered && registered.factory(requireShim)
check('factory returns an object', !!mod)
check('declares inject slots+locale',
  mod && Array.isArray(mod.inject) && mod.inject.includes('slots') && mod.inject.includes('locale'),
  mod && JSON.stringify(mod.inject))
check('exposes apply()', mod && typeof mod.apply === 'function')

// --- Fake Client context --------------------------------------------------
let registeredSlot = null
const dicts = new Map()

const localeFace = {
  register(ns, localeOrDicts) {
    const entries = typeof localeOrDicts === 'string' ? [] : Object.entries(localeOrDicts)
    for (const [locale, dict] of entries) dicts.set(ns + ':' + locale, dict)
    return () => {}
  },
  bind(ns) {
    return (key, params) => {
      const zh = dicts.get(ns + ':zh') || {}
      const en = dicts.get(ns + ':en') || {}
      const template = zh[key] !== undefined ? zh[key] : (en[key] !== undefined ? en[key] : key)
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (m, n) => (n in params ? String(params[n]) : m))
    }
  },
  getSnapshot() {
    return { active: 'zh', revision: 1 }
  },
  subscribe() {
    return () => {}
  },
}

const pickerCalls = [];
const ctx = {
  locale: localeFace,
  effect(fn) {
    const disposer = fn()
    return typeof disposer === 'function' ? disposer : () => {}
  },
  // Soft injection used by the plugin to find the host folder picker.
  inject(_deps, callback) {
    callback({
      uiWorkspace: {
        async pickDirectory() {
          pickerCalls.push('pick')
          return '/tmp/picked-folder'
        },
      },
    })
  },
  slots: {
    inject(_name, callback) {
      return callback()
    },
    register(options, Component) {
      registeredSlot = { options, Component }
      return () => {}
    },
  },
}

let applyError = null
try {
  mod.apply(ctx)
} catch (error) {
  applyError = error
}
check('apply() runs without throwing', applyError === null, applyError && applyError.message)
check('registered a settings.section entry',
  registeredSlot && registeredSlot.options.name === 'settings.section',
  registeredSlot && registeredSlot.options.name)
check('slot entry carries a stable id',
  registeredSlot && registeredSlot.options.id === 'hermes-skills-sync',
  registeredSlot && registeredSlot.options.id)
check('slot label resolves to a non-empty string',
  registeredSlot && typeof registeredSlot.options.label() === 'string' && registeredSlot.options.label().length > 0,
  registeredSlot && registeredSlot.options.label())
check('locale dictionaries registered', dicts.size >= 2, 'size=' + dicts.size)

// --- Mini renderer that resolves function components ----------------------
function render(node, depth = 0) {
  if (depth > 30) throw new Error('render depth exceeded (possible loop)')
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map((child) => render(child, depth + 1))
  if (typeof node.type === 'function') {
    const previous = currentComponent
    currentComponent = node.type.name || 'anon' + depth
    cursor = 0
    const produced = node.type(node.props || {})
    currentComponent = previous
    return render(produced, depth + 1)
  }
  return {
    type: node.type,
    props: node.props || {},
    // React treats a nested children array as flat siblings; mirror that so
    // assertions can index into `children` directly.
    children: (node.children || []).flatMap((child) => {
      const rendered = render(child, depth + 1)
      return Array.isArray(rendered) ? rendered : [rendered]
    }),
  }
}

function flatten(node, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
    return out
  }
  if (typeof node === 'object') {
    out.push(node)
    for (const child of node.children || []) flatten(child, out)
  }
  return out
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && node.children) return node.children.map(textOf).join('')
  return ''
}

// Drain effects once after the initial paint.
function settle() {
  const queued = pendingEffects.splice(0)
  for (const entry of queued) {
    const disposer = entry.fn()
    if (typeof disposer === 'function') disposer()
  }
}

let tree = null
let renderError = null
try {
  tree = render(registeredSlot.Component({ close: () => {} }))
  settle()
  // Second pass so the state written by useEffect's async loader applies.
  tree = render(registeredSlot.Component({ close: () => {} }))
} catch (error) {
  renderError = error
}
check('component renders without throwing', renderError === null,
  renderError && (renderError.stack || renderError.message))

const root = tree
check('root element uses the plugin container class',
  root && root.props && root.props.className === 'hss-root',
  root && root.props && root.props.className)

let nodes = flatten(root)
const styleNode = nodes.find((n) => n.type === 'style')
check('renders a <style> element', !!styleNode)
const css = styleNode && styleNode.children[0]
check('css only uses --dsw-* custom properties',
  typeof css === 'string' && !/#[0-9a-fA-F]{3,8}\b/.test(css.replace(/rgba?\([^)]*\)/g, '')),
  typeof css === 'string' ? (css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).join(',') : 'no css')
check('css declares the narrow-screen breakpoint',
  typeof css === 'string' && css.includes('max-width: 767px'))
check('css declares the bottom-sheet dialog',
  typeof css === 'string' && css.includes('margin-top: auto'))

// The action panel must be inline, never a viewport-anchored popover: that is
// what previously made the "More" button appear to do nothing.
check('action panel is not absolutely positioned',
  typeof css === 'string' && !/\.hss-action-panel\s*\{[^}]*position:\s*absolute/.test(css))
check('no floating menu class remains',
  typeof css === 'string' && !css.includes('.hss-menu'))

const allText = textOf(root)
check('title copy renders (zh)', allText.includes('Hermes 技能'), allText.slice(0, 80))
check('renders the rescan control', allText.includes('重新扫描'))

const searchInput = nodes.find((n) => n.type === 'input' && n.props && n.props.type === 'search')
check('renders a search input', !!searchInput)
check('renders the search placeholder',
  !!searchInput && searchInput.props.placeholder === '搜索技能…',
  searchInput && searchInput.props.placeholder)
check('search input is labelled for assistive tech',
  !!searchInput && searchInput.props['aria-label'] === '搜索技能',
  searchInput && searchInput.props['aria-label'])

// --- Requirement 1: the profile filter -----------------------------------
const select = nodes.find((n) => n.type === 'select')
check('renders a profile filter control', !!select)
check('profile filter is labelled',
  !!select && select.props['aria-label'] === 'Hermes Profile',
  select && select.props['aria-label'])
check('profile filter has an "all" option',
  !!select && select.children.some((o) => o && o.props && o.props.value === 'all'),
  select && select.children.map((o) => o && o.props && o.props.value).join(','))

// Filtering must be driven by snapshot groups, so the component has to read
// them; assert the wiring exists in the source and that the option builder is
// present rather than hard-coded profile names.
check('filter options derive from discovered groups',
  source.includes('for (const group of groups)') && source.includes('profileFilter'))
check('filter narrows groups by group key',
  source.includes("profileFilter === 'all' || group.key === profileFilter"))

// --- Requirement 2: More -> inline panel -> dialog ------------------------
const moreButton = () => flatten(
  render(registeredSlot.Component({ close: () => {} })),
).find((n) => n.type === 'button' && n.props && typeof n.props.className === 'string'
  && n.props.className.includes('hss-btn-more'))

// The list cannot render without a successful snapshot, so inject one through
// the mocked fetch and re-render.
const fakeSkills = [
  {
    id: '/h::main::/h/skills/alpha', sourceName: 'alpha', folderName: 'alpha',
    compatName: 'alpha', declaredNameValid: true,
    displayName: 'alpha', description: 'Alpha skill.', path: '/h/skills/alpha',
    bytes: 2048, files: 3, groupKey: '/h::main',
    groupLabel: 'main', groupKind: 'agent', instancePath: '/h', instanceSource: 'default',
  },
  {
    id: '/h::profile:studio::/h/profiles/studio/skills/beta', sourceName: 'beta',
    folderName: 'beta', compatName: 'beta', declaredNameValid: true,
    displayName: 'beta', description: 'Beta skill.',
    path: '/h/profiles/studio/skills/beta', bytes: 4096, files: 5,
    groupKey: '/h::profile:studio', groupLabel: 'studio', groupKind: 'profile',
    instancePath: '/h', instanceSource: 'default',
  },
]
const fakeSnapshot = {
  ok: true,
  generatedAt: new Date().toISOString(),
  durationMs: 42,
  instanceCount: 1,
  skillCount: 2,
  groups: [
    {
      key: '/h::main', kind: 'agent', label: 'main', path: '/h/skills',
      instancePath: '/h', instanceSource: 'default', skillCount: 1,
      skills: [fakeSkills[0]],
    },
    {
      key: '/h::profile:studio', kind: 'profile', label: 'studio',
      path: '/h/profiles/studio/skills', instancePath: '/h',
      instanceSource: 'default', skillCount: 1, skills: [fakeSkills[1]],
    },
  ],
  containers: [],
  projectTargets: [{ id: 'w1', title: 'Proj A', path: '/tmp/proj-a' }],
}

globalThis.fetch = async (url) => {
  if (String(url).includes('/snapshot')) {
    return { ok: true, status: 200, json: async () => fakeSnapshot }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

// Re-mount from scratch so the loader effect runs against the mocked fetch.
stores.clear()
pendingEffects.length = 0
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
// Let the loader promise resolve, then paint with the snapshot present.
await new Promise((resolve) => setTimeout(resolve, 0))
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)

const groupHeads = nodes.filter((n) => n.props && n.props.className === 'hss-group-head')
check('renders one group per discovered Hermes group', groupHeads.length === 2,
  String(groupHeads.length))
const headText = groupHeads.map(textOf).join(' | ')
check('main-agent group is labelled as the main agent',
  headText.includes('主 agent'), headText)
check('profile group is labelled with its profile name',
  headText.includes('Profile：studio') || headText.includes('Profile: studio'), headText)

const moreButtons = nodes.filter((n) =>
  n.type === 'button' && typeof n.props.className === 'string'
  && n.props.className.includes('hss-btn-more'))
check('each skill row renders a More button', moreButtons.length === 2, String(moreButtons.length))
check('More button reports a collapsed state',
  moreButtons.length > 0 && moreButtons[0].props['aria-expanded'] === 'false',
  moreButtons[0] && moreButtons[0].props['aria-expanded'])
check('More button points at its action panel',
  moreButtons.length > 0 && typeof moreButtons[0].props['aria-controls'] === 'string',
  moreButtons[0] && moreButtons[0].props['aria-controls'])

// Click "More" on the first row and re-render.
moreButtons[0].props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)

const panel = nodes.find((n) => n.props && n.props.className === 'hss-action-panel')
check('clicking More expands an inline action panel', !!panel)
check('expanded panel is labelled', !!panel && typeof panel.props['aria-label'] === 'string',
  panel && panel.props['aria-label'])

const openImport = nodes.find((n) =>
  n.type === 'button' && typeof n.props.className === 'string'
  && n.props.className.includes('hss-action-item'))
check('panel offers the "import into DSH" action', !!openImport)
check('the action explains it copies the whole skill',
  !!openImport && textOf(openImport).includes('复制完整 skill'), openImport && textOf(openImport))

const moreAfter = nodes.filter((n) =>
  n.type === 'button' && typeof n.props.className === 'string'
  && n.props.className.includes('hss-btn-more'))
check('expanded More button flips to expanded state',
  moreAfter.length > 0 && moreAfter[0].props['aria-expanded'] === 'true',
  moreAfter[0] && moreAfter[0].props['aria-expanded'])

// Click the import action and re-render: the dialog must appear.
openImport.props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)

const dialog = nodes.find((n) => n.props && n.props.className === 'hss-dialog')
check('clicking the action opens the import dialog', !!dialog)
check('dialog is a modal for assistive tech',
  !!dialog && dialog.props.role === 'dialog' && dialog.props['aria-modal'] === 'true',
  dialog && (dialog.props.role + '/' + dialog.props['aria-modal']))

const choices = nodes.filter((n) =>
  n.type === 'button' && typeof n.props.className === 'string'
  && n.props.className.includes('hss-choice'))
const choiceText = choices.map(textOf).join(' | ')
check('dialog offers exactly the two required destinations', choices.length === 2,
  String(choices.length) + ': ' + choiceText)
check('offers "import as global skill"', choiceText.includes('导入为 DSH 全局 skills'), choiceText)
check('offers "import into a DSH project"', choiceText.includes('导入至 DSH 指定项目'), choiceText)

// Selecting the project destination exposes the project list.
const projectChoice = choices.find((n) => textOf(n).includes('导入至 DSH 指定项目'))
projectChoice.props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)
const projectText = nodes.map(textOf).join('')
check('project destination lists registered projects',
  projectText.includes('Proj A'), projectText.slice(0, 200))
check('project destination shows the project path',
  projectText.includes('/tmp/proj-a'))

// The dialog must be dismissible.
const closeButton = nodes.find((n) =>
  n.type === 'button' && typeof n.props.className === 'string'
  && n.props.className.includes('hss-btn') && textOf(n) === '关闭')
check('dialog has a close control', !!closeButton)

// --- API wiring -----------------------------------------------------------
const apiMatch = source.match(/'\/api\/[a-z0-9-]+'/g) || []
check('client references the plugin API prefix',
  apiMatch.some((p) => p.includes('/api/hermes-skills-sync')),
  apiMatch.join(','))
check('client uses fetch against the API', source.includes('fetch(API_BASE'))
check('client requests /snapshot', source.includes("'/snapshot'"))
check('client posts to /import', source.includes("'/import'"))
check('client posts to /import-batch', source.includes("'/import-batch'"))

// ==========================================================================
// Batch multi-select (the feature this suite was extended for)
// ==========================================================================

/** Fresh mount with the mocked snapshot, discarding any prior interaction. */
function remount() {
  stores.clear()
  pendingEffects.length = 0
  const paint = render(registeredSlot.Component({ close: () => {} }))
  settle()
  return paint
}

function paintWithSnapshot() {
  const paint = remount()
  return paint
}

// Re-mount and let the loader effect resolve.
stores.clear()
pendingEffects.length = 0
render(registeredSlot.Component({ close: () => {} }))
settle()
await new Promise((resolve) => setTimeout(resolve, 0))
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)

const checkboxes = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .filter((n) => n.type === 'input' && n.props && n.props.type === 'checkbox')

let boxes = checkboxes()
check('each skill row renders a checkbox', boxes.length === 2, String(boxes.length))
check('checkbox is labelled for assistive tech',
  boxes.length > 0 && typeof boxes[0].props['aria-label'] === 'string'
    && boxes[0].props['aria-label'].length > 0,
  boxes[0] && boxes[0].props['aria-label'])
check('checkbox starts unchecked',
  boxes.length > 0 && boxes[0].props.checked === false,
  boxes[0] && String(boxes[0].props.checked))

const groupSelectButtons = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-group-select'))
check('each group offers a select-all control',
  groupSelectButtons().length === 2, String(groupSelectButtons().length))

// Tick the first checkbox.
boxes[0].props.onChange({ target: { checked: true } })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)

check('ticking a checkbox checks it',
  checkboxes()[0].props.checked === true,
  String(checkboxes()[0].props.checked))

const selectBar = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.props && n.props.className === 'hss-selectbar')
check('a selection bar appears once something is selected', !!selectBar())
check('selection bar reports the selected count',
  !!selectBar() && textOf(selectBar()).includes('已选 1 个'),
  selectBar() && textOf(selectBar()))

const batchButton = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary') && textOf(n) === '批量导入')
check('selection bar offers a batch import button', !!batchButton())

// Select the whole visible set from the toolbar.
const selectAllButton = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && textOf(n) === '全选')
check('toolbar offers select-all', !!selectAllButton())
selectAllButton().props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
check('select-all selects every visible skill',
  checkboxes().every((box) => box.props.checked === true),
  checkboxes().map((b) => String(b.props.checked)).join(','))
check('selection bar counts both skills',
  textOf(selectBar()).includes('已选 2 个'), textOf(selectBar()))

// Open the batch dialog.
batchButton().props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
nodes = flatten(tree)

const batchDialog = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.props && n.props.className === 'hss-dialog')
check('batch button opens the batch dialog', !!batchDialog())
check('batch dialog title states how many skills',
  !!batchDialog() && textOf(batchDialog()).includes('批量导入 2 个 skill'),
  batchDialog() && textOf(batchDialog()).slice(0, 80))

const batchChoices = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-choice'))
check('batch dialog offers the two destinations', batchChoices().length === 2,
  String(batchChoices().length))

// Choose global, then confirm: the client must call /import-batch.
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null })
  if (String(url).includes('/snapshot')) {
    return { ok: true, status: 200, json: async () => fakeSnapshot }
  }
  if (String(url).includes('/import-batch')) {
    const items = (init && JSON.parse(init.body).items) || []
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        results: items.map((item) => ({
          sourcePath: item.sourcePath,
          sourceName: item.sourceName,
          ok: true,
          dshName: item.sourceName,
          replaced: false,
        })),
        summary: { total: items.length, imported: items.length, replaced: 0, conflicted: 0, failed: 0 },
      }),
    }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

const globalChoice = batchChoices().find((n) => textOf(n).includes('导入为 DSH 全局 skills'))
globalChoice.props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()

const confirmButton = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary') && textOf(n) === '导入')
check('chosen destination exposes a confirm button', !!confirmButton())
confirmButton().props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })

// Let the chunked requests resolve.
for (let i = 0; i < 6; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = render(registeredSlot.Component({ close: () => {} }))
  settle()
}

const batchCall = calls.find((call) => call.url.includes('/import-batch'))
check('confirming calls the batch endpoint', !!batchCall)
check('batch request carries both selected skills',
  !!batchCall && Array.isArray(batchCall.body.items) && batchCall.body.items.length === 2,
  batchCall && JSON.stringify(batchCall.body.items))
check('batch request targets the chosen global scope',
  !!batchCall && batchCall.body.target && batchCall.body.target.kind === 'global',
  batchCall && JSON.stringify(batchCall.body.target))

nodes = flatten(render(registeredSlot.Component({ close: () => {} })))
const doneText = textOf(batchDialog() || nodes)
check('batch dialog reports a completion summary',
  doneText.includes('完成') && doneText.includes('新增'), doneText.slice(0, 160))
check('successful items leave the selection',
  !flatten(render(registeredSlot.Component({ close: () => {} })))
    .find((n) => n.props && n.props.className === 'hss-selectbar'),
  'selection bar still present')
check('imported rows show the imported badge',
  textOf(render(registeredSlot.Component({ close: () => {} }))).includes('已导入'))

// --- Fallback when the Host predates the batch route ----------------------
// A restarted Host is not required for batch import to work: a 404 from
// /import-batch must fall back to concurrent single imports.
const fallbackCalls = []
globalThis.fetch = async (url, init) => {
  const target = String(url)
  fallbackCalls.push(target)
  if (target.includes('/snapshot')) {
    return { ok: true, status: 200, json: async () => fakeSnapshot }
  }
  if (target.includes('/import-batch')) {
    // Simulate an older Host that has no such route.
    return { ok: false, status: 404, json: async () => ({ ok: false, code: 'error.notFound' }) }
  }
  if (target.includes('/import')) {
    const body = JSON.parse(init.body)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        dshName: body.sourceName,
        originalName: body.sourceName,
        replaced: false,
      }),
    }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

stores.clear()
pendingEffects.length = 0
render(registeredSlot.Component({ close: () => {} }))
settle()
await new Promise((resolve) => setTimeout(resolve, 0))
tree = render(registeredSlot.Component({ close: () => {} }))
settle()

// Select everything and run a batch against the 404-ing endpoint.
flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && textOf(n) === '全选')
  .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary') && textOf(n) === '批量导入')
  .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
flatten(render(registeredSlot.Component({ close: () => {} })))
  .filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-choice'))
  .find((n) => textOf(n).includes('导入为 DSH 全局 skills'))
  .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
tree = render(registeredSlot.Component({ close: () => {} }))
settle()
flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary') && textOf(n) === '导入')
  .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })

for (let i = 0; i < 8; i += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  tree = render(registeredSlot.Component({ close: () => {} }))
  settle()
}

const singleCalls = fallbackCalls.filter((url) => /\/import$/.test(url))
check('a 404 from the batch route falls back to single imports',
  singleCalls.length === 2, String(singleCalls.length) + ' single calls')
const fallbackText = textOf(batchDialog() || flatten(render(registeredSlot.Component({ close: () => {} }))))
check('the fallback still reports a completion summary',
  fallbackText.includes('完成') && fallbackText.includes('新增'), fallbackText.slice(0, 160))

// ==========================================================================
// Project destination: registered list + folder picker
// ==========================================================================

const dialogOf = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.props && n.props.className === 'hss-dialog')
const choicesOf = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-choice'))

/** Mount with a given snapshot, select one skill, and open the single dialog. */
async function openSingleDialogOnProject(snapshot) {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/snapshot')) {
      return { ok: true, status: 200, json: async () => snapshot }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  stores.clear()
  pendingEffects.length = 0
  render(registeredSlot.Component({ close: () => {} }))
  settle()
  await new Promise((resolve) => setTimeout(resolve, 0))
  render(registeredSlot.Component({ close: () => {} }))
  settle()

  // Open the first row's More, then its import action.
  flatten(render(registeredSlot.Component({ close: () => {} })))
    .filter((n) => n.type === 'button' && typeof n.props.className === 'string'
      && n.props.className.includes('hss-btn-more'))[0]
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {} }))
  settle()
  flatten(render(registeredSlot.Component({ close: () => {} })))
    .find((n) => n.type === 'button' && typeof n.props.className === 'string'
      && n.props.className.includes('hss-action-item'))
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {} }))
  settle()

  // Choose the project destination.
  choicesOf().find((n) => textOf(n).includes('导入至 DSH 指定项目'))
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {} }))
  settle()
}

// Case A: workspaces ARE registered (the state the user expects to see).
await openSingleDialogOnProject({
  ...fakeSnapshot,
  projectTargets: [
    { id: 'w1', title: '示例工作区', path: '/home/example/workspace', sessions: 16 },
    { id: 'w2', title: '示例写作', path: '/home/example/workspace/writing', sessions: 3 },
  ],
})
let projText = textOf(dialogOf())
check('project step lists every registered workspace',
  projText.includes('示例工作区') && projText.includes('示例写作'), projText.slice(0, 200))
check('project step shows each workspace path',
  projText.includes('/home/example/workspace') && projText.includes('/home/example/workspace/writing'))
check('project step reports how many are registered',
  projText.includes('已注册 2 个项目'), projText.slice(0, 160))
check('workspace rows show their session counts',
  projText.includes('16 个会话') && projText.includes('3 个会话'), projText.slice(0, 240))
check('the empty-state message is NOT shown when workspaces exist',
  !projText.includes('尚未注册项目'), projText.slice(0, 200))
check('a folder-picker control is offered',
  choicesOf().some((n) => textOf(n).includes('选择其他目录')), 
  choicesOf().map(textOf).join(' | '))

// Case B: the registry is empty — the picker must keep the flow alive.
await openSingleDialogOnProject({ ...fakeSnapshot, projectTargets: [] })
projText = textOf(dialogOf())
check('empty registry explains the fallback instead of dead-ending',
  projText.includes('尚未注册项目') && projText.includes('仍可以直接选择目录'),
  projText.slice(0, 200))
check('empty registry still offers the folder picker',
  choicesOf().some((n) => textOf(n).includes('选择其他目录')),
  choicesOf().map(textOf).join(' | '))

const confirmBefore = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary') && textOf(n) === '导入')
check('confirm is disabled before a folder is chosen',
  !!confirmBefore() && confirmBefore().props.disabled === true,
  confirmBefore() && String(confirmBefore().props.disabled))

// Pick a folder; confirm must enable and carry that path.
pickerCalls.length = 0
choicesOf().find((n) => textOf(n).includes('选择其他目录'))
  .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
await new Promise((resolve) => setTimeout(resolve, 0))
render(registeredSlot.Component({ close: () => {} }))
settle()
check('clicking the picker asks the host', pickerCalls.length === 1, String(pickerCalls.length))
projText = textOf(dialogOf())
check('the picked folder is displayed',
  projText.includes('/tmp/picked-folder'), projText.slice(0, 240))
check('confirm becomes available after picking',
  !!confirmBefore() && confirmBefore().props.disabled === false,
  confirmBefore() && String(confirmBefore().props.disabled))

// Confirm and assert the request carries the picked path.
const targetCalls = []
globalThis.fetch = async (url, init) => {
  targetCalls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null })
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, dshName: 'alpha', originalName: 'alpha', replaced: false }),
  }
}
confirmBefore().props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
await new Promise((resolve) => setTimeout(resolve, 0))
render(registeredSlot.Component({ close: () => {} }))
settle()

const projectImportCall = targetCalls.find((call) => /\/import$/.test(call.url))
check('confirming posts the project target',
  !!projectImportCall && projectImportCall.body.target.kind === 'project',
  projectImportCall && JSON.stringify(projectImportCall.body.target))
check('the request carries the picked project root',
  !!projectImportCall && projectImportCall.body.target.projectRoot === '/tmp/picked-folder',
  projectImportCall && JSON.stringify(projectImportCall.body.target))

// --- The Client projection is the primary source -------------------------
// Host code only reloads on restart, so a Client that trusts only the Host
// list would show an empty project picker. The renderer's `useWorkspaces`
// hook must be enough on its own.
const clientEdit = readFileSync(join(here, 'client.js'), 'utf8')
check('client reads the renderer useWorkspaces hook',
  clientEdit.includes('useWorkspaces'))
check('client merges the Client projection with the Host list',
  clientEdit.includes('clientProjectTargets.length > 0'))

async function openDialogWithWorkspaces(workspaceItems) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('/snapshot')) {
      // Host reports NO project targets, exactly like the running process
      // that has not been restarted since the fix.
      return { ok: true, status: 200, json: async () => ({ ...fakeSnapshot, projectTargets: [] }) }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  const useWorkspaces = (selector) => selector({
    items: workspaceItems,
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'ready',
    phase: 'ready',
    error: null,
  })
  stores.clear()
  pendingEffects.length = 0
  render(registeredSlot.Component({ close: () => {}, useWorkspaces }))
  settle()
  await new Promise((resolve) => setTimeout(resolve, 0))
  render(registeredSlot.Component({ close: () => {}, useWorkspaces }))
  settle()

  const paint = () => flatten(render(registeredSlot.Component({ close: () => {}, useWorkspaces })))
  paint().filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-more'))[0]
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {}, useWorkspaces }))
  settle()
  paint().find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-action-item'))
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {}, useWorkspaces }))
  settle()
  paint().filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-choice'))
    .find((n) => textOf(n).includes('导入至 DSH 指定项目'))
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {}, useWorkspaces }))
  settle()
  return paint
}

const paintWs = await openDialogWithWorkspaces([
  { workspaceId: 'w1', path: '/home/example/workspace', title: '示例工作区', sessionIds: ['a', 'b', 'c'], createdAt: '', updatedAt: '' },
  { workspaceId: 'w2', path: '/home/example/workspace/writing', title: '示例写作', sessionIds: ['d'], createdAt: '', updatedAt: '' },
])
const wsText = textOf(flatten(paintWs()).find((n) => n.props && n.props.className === 'hss-dialog'))
check('workspaces render even when the Host reports none',
  wsText.includes('示例工作区') && wsText.includes('示例写作'), wsText.slice(0, 200))
check('the Client-sourced list shows workspace paths',
  wsText.includes('/home/example/workspace/writing'))
check('the Client-sourced list shows session counts',
  wsText.includes('3 个会话'), wsText.slice(0, 240))
check('the empty-state message is gone once workspaces arrive',
  !wsText.includes('尚未注册项目'), wsText.slice(0, 200))
check('a Client-sourced workspace can be selected and confirmed',
  flatten(paintWs()).some((n) => n.type === 'button'
    && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary')
    && textOf(n) === '导入'
    && n.props.disabled === false))

// ==========================================================================
// Original names + conflict resolution
// ==========================================================================

const cjkSkill = {
  id: '/h::main::/h/skills/cjk', sourceName: '量化引擎', folderName: '量化引擎',
  compatName: 'skill-b0b100bb', declaredNameValid: false,
  displayName: '量化引擎', description: 'CJK named skill.',
  path: '/h/skills/量化引擎', bytes: 1024, files: 2,
  groupKey: '/h::main', groupLabel: 'main', groupKind: 'agent',
  instancePath: '/h', instanceSource: 'default',
}
const cjkSnapshot = {
  ok: true,
  generatedAt: new Date().toISOString(),
  durationMs: 10,
  instanceCount: 1,
  skillCount: 1,
  groups: [{
    key: '/h::main', kind: 'agent', label: 'main', path: '/h/skills',
    instancePath: '/h', instanceSource: 'default', skillCount: 1, skills: [cjkSkill],
  }],
  containers: [],
  projectTargets: [{ id: 'w1', title: 'Proj', path: '/tmp/proj-a', sessions: 1 }],
}

/** Mount with the CJK fixture and open its import dialog on the global step. */
async function openCjkDialog(conflictResponse) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, body: init && init.body ? JSON.parse(init.body) : null })
    if (target.includes('/snapshot')) {
      return { ok: true, status: 200, json: async () => cjkSnapshot }
    }
    if (target.includes('/conflicts')) {
      return { ok: true, status: 200, json: async () => conflictResponse }
    }
    return {
      ok: true, status: 200,
      json: async () => ({
        ok: true, folderName: '量化引擎', originalName: '量化引擎',
        declaredNameRewritten: true, willLoad: true, replaced: false,
      }),
    }
  }
  stores.clear()
  pendingEffects.length = 0
  const paint = () => flatten(render(registeredSlot.Component({ close: () => {} })))
  render(registeredSlot.Component({ close: () => {} }))
  settle()
  await new Promise((resolve) => setTimeout(resolve, 0))
  render(registeredSlot.Component({ close: () => {} }))
  settle()

  paint().filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-more'))[0]
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {} }))
  settle()
  paint().find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-action-item'))
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {} }))
  settle()
  paint().filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-choice'))
    .find((n) => textOf(n).includes('导入为 DSH 全局 skills'))
    .props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
  render(registeredSlot.Component({ close: () => {} }))
  settle()
  return { calls, paint }
}

// --- Original name is shown, never a slug -------------------------------
let opened = await openCjkDialog({ ok: true, target: '/home/example/.dsh/skills', conflicts: [], conflictCount: 0 })
let dlgText = textOf(flatten(opened.paint()).find((n) => n.props && n.props.className === 'hss-dialog'))
check('the dialog shows the original name as the folder name',
  dlgText.includes('目录名（保持原名）') && dlgText.includes('量化引擎'), dlgText.slice(0, 240))
check('the dialog no longer claims an automatic rename happened',
  !dlgText.includes('将导入为'), dlgText.slice(0, 240))

// --- Invalid declared name is disclosed with an opt-in fix ---------------
check('an invalid declared name raises a warning',
  dlgText.includes('DSH 会忽略此 skill'), dlgText.slice(0, 300))
check('the warning offers the frontmatter-only fix',
  dlgText.includes('仅改写 frontmatter 的 name'), dlgText.slice(0, 320))
check('the fix states the folder name is untouched',
  dlgText.includes('目录名保持完全不变'), dlgText.slice(0, 340))
check('the dialog predicts the load outcome',
  dlgText.includes('DSH 可正常加载') || dlgText.includes('DSH 会忽略此 skill'))

// Scope to the dialog: the list behind it also renders row checkboxes.
const dialogNode = flatten(opened.paint())
  .find((n) => n.props && n.props.className === 'hss-dialog')
const normalizeBox = flatten(dialogNode)
  .filter((n) => n.type === 'input' && n.props && n.props.type === 'checkbox')
  .find((n) => typeof n.props.className === 'string' && n.props.className.includes('hss-check'))
check('the normalization switch is a real checkbox', !!normalizeBox)
check('normalization is on by default',
  !!normalizeBox && normalizeBox.props.checked === true,
  normalizeBox && String(normalizeBox.props.checked))

// --- A conflict opens the resolution dialog -----------------------------
opened = await openCjkDialog({
  ok: true,
  target: '/home/example/.dsh/skills',
  conflicts: [{ sourceName: '量化引擎', sourcePath: '/h/skills/量化引擎', folderName: '量化引擎', exists: true }],
  conflictCount: 1,
})
const confirmBtn = () => flatten(opened.paint())
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-btn-primary') && textOf(n) === '导入')
confirmBtn().props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
await new Promise((resolve) => setTimeout(resolve, 0))
render(registeredSlot.Component({ close: () => {} }))
settle()

let conflictDialog = flatten(opened.paint())
  .find((n) => n.props && n.props.className === 'hss-dialog'
    && textOf(n).includes('已存在同名 skill'))
check('a collision opens the conflict dialog', !!conflictDialog)
const conflictText = textOf(conflictDialog)
check('the conflict dialog names the colliding skill',
  conflictText.includes('量化引擎'), conflictText.slice(0, 200))
check('the conflict dialog offers overwrite', conflictText.includes('覆盖'))
check('the conflict dialog offers rename', conflictText.includes('重命名导入的副本'))
check('the conflict dialog offers skip', conflictText.includes('跳过'))
check('nothing was imported before the user chose',
  !opened.calls.some((call) => /\/import$/.test(call.url)),
  opened.calls.map((c) => c.url).join(','))

// Choose rename: a field appears and rejects the unchanged name.
const choiceBtn = (label) => flatten(opened.paint())
  .filter((n) => n.type === 'button' && typeof n.props.className === 'string'
    && n.props.className.includes('hss-choice'))
  .find((n) => textOf(n).includes(label))
choiceBtn('重命名导入的副本').props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
render(registeredSlot.Component({ close: () => {} }))
settle()
const conflictNode = flatten(opened.paint())
  .find((n) => n.props && n.props.className === 'hss-dialog'
    && textOf(n).includes('已存在同名 skill'))
const renameInput = flatten(conflictNode)
  .find((n) => n.type === 'input' && n.props && n.props.type === 'text')
check('choosing rename reveals a name field', !!renameInput)
check('the rename field suggests a suffixed default',
  !!renameInput && renameInput.props.value === '量化引擎-2',
  renameInput && renameInput.props.value)

renameInput.props.onChange({ target: { value: '我的量化引擎' } })
render(registeredSlot.Component({ close: () => {} }))
settle()
const applyBtn = () => flatten(opened.paint())
  .find((n) => n.type === 'button' && typeof n.props.className === 'string'
    && textOf(n) === '应用')
check('the rename choice exposes an apply button', !!applyBtn())
applyBtn().props.onClick({ stopPropagation() {}, currentTarget: {}, target: {} })
await new Promise((resolve) => setTimeout(resolve, 0))
render(registeredSlot.Component({ close: () => {} }))
settle()

const importCall = opened.calls.find((call) => /\/import$/.test(call.url))
check('resolving the conflict performs the import', !!importCall)
check('the import carries the rename policy',
  !!importCall && importCall.body.onConflict === 'rename',
  importCall && importCall.body.onConflict)
check('the import carries the new folder name',
  !!importCall && importCall.body.renameTo === '我的量化引擎',
  importCall && importCall.body.renameTo)
check('the import asks for frontmatter normalization',
  !!importCall && importCall.body.normalizeDeclaredName === true,
  importCall && String(importCall.body.normalizeDeclaredName))
check('the original source name is sent unchanged',
  !!importCall && importCall.body.sourceName === '量化引擎',
  importCall && importCall.body.sourceName)

console.log(notes.join('\n'))
console.log('\n' + (failures.length === 0
  ? 'RESULT: all client checks passed (' + notes.length + ')'
  : 'RESULT: ' + failures.length + ' failure(s)\n - ' + failures.join('\n - ')))
process.exit(failures.length === 0 ? 0 : 1)

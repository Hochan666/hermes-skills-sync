/**
 * Client half of the Hermes Skills Sync bundle.
 *
 * Renders a settings section that lists every Hermes skill discovered on
 * this machine, lets the user narrow the list to one Hermes profile, and
 * copies a chosen skill into DSH either as a global skill or into a project.
 *
 * Only theme tokens (`--dsw-alias-*`) drive colour. Layout is responsive from
 * narrow phones to wide desktops: below 768px each row stacks into a card and
 * the import dialog becomes a bottom sheet.
 *
 * The per-row action panel is rendered *inline* (inside the list item) rather
 * than as a floating popover. A floated menu anchored with viewport
 * coordinates is clipped or displaced by the settings panel's scroll
 * container, which previously made the "More" button look unresponsive.
 */

window.__ModuleLoader__.load({
  id: 'hermes-skills-sync',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {
      useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore,
    } = React;

    const NS = 'hermes-skills-sync';
    const API_BASE = '/api/hermes-skills-sync';

    // ---------------------------------------------------------------------
    // Locale
    // ---------------------------------------------------------------------

    const DICT = {
      en: {
        'meta.title': 'Hermes Skills Sync',
        'meta.description': 'Discovers Hermes skills on this machine and imports them into DSH.',
        'title': 'Hermes Skills',
        'desc': 'Discover skills installed by Hermes on this machine and copy them into DSH.',
        'btn.refresh': 'Rescan',
        'btn.retry': 'Retry',
        'btn.more': 'More',
        'btn.less': 'Less',
        'btn.close': 'Close',
        'btn.back': 'Back',
        'btn.import': 'Import',
        'btn.importing': 'Importing…',
        'btn.importGlobal': 'Import as DSH global skill',
        'btn.importProject': 'Import into a DSH project',
        'btn.openImport': 'Import into DSH',
        'btn.openImportHint': 'Copies the complete skill folder.',
        'search.placeholder': 'Search skills…',
        'search.label': 'Search skills',
        'filter.label': 'Hermes profile',
        'filter.all': 'All profiles',
        'filter.count': '{count} shown',
        'loading': 'Scanning Hermes installations…',
        'empty.none': 'No Hermes installation was found on this machine.',
        'empty.noneHint': 'Hermes usually installs to ~/.hermes. Set DSH_HERMES_HOME to point at another location.',
        'empty.filtered': 'No skill matches the current filter.',
        'error.load': 'Failed to scan Hermes installations: {error}',
        'summary.title': 'Scanned {instances} installation(s), {skills} skill(s) in {duration} ms.',
        'summary.none': 'Scan finished, but no skills were found.',
        'group.main': 'Main agent',
        'group.profile': 'Profile: {name}',
        'kind.agent': 'Main agent',
        'kind.profile': 'Profile',
        'meta.instance': 'Instance',
        'meta.files': '{count} file(s)',
        'meta.renamed': 'Will be imported as {name}',
        'target.title': 'Import {name}',
        'target.desc': 'Choose where this skill should be installed.',
        'target.global': 'DSH global skills',
        'target.globalHint': 'Available in every project. Stored in {path}.',
        'target.project': 'DSH project',
        'target.projectHint': 'Stored inside one project. Project skills shadow a global skill of the same name.',
        'target.selectProject': 'Select a project',
        'target.noProject': 'No project is registered yet.',
        'target.noProjectHint': 'Open a project in DSH first, then import into it.',
        'target.pickDirectory': 'Choose another folder…',
        'target.pickDirectoryHint': 'Pick any folder on this machine to use as the project root.',
        'target.pickedPath': 'Selected folder',
        'target.picking': 'Opening the folder picker…',
        'target.pickUnavailable': 'The folder picker is unavailable; a project must be registered in DSH.',
        'target.noProjectFallback': 'No project is registered yet. You can still choose a folder.',
        'target.registered': '{count} registered project(s)',
        'target.sessions': '{count} session(s)',
        'result.ok': 'Imported “{name}” as {dshName}.',
        'result.replaced': 'Imported “{name}” as {dshName} and replaced the previous copy.',
        'result.conflict': 'A skill named {dshName} already exists in this location.',
        'result.failed': 'Import failed: {reason}',
        'status.imported': 'Imported',
        'status.importing': 'Importing',
        'status.conflict': 'Exists',
        'status.failed': 'Failed',
        'container.title': 'Category folders',
        'container.desc': 'These folders group other skills and are not importable on their own.',
        'aria.moreActions': 'More actions for {name}',
        'aria.group': 'Skills from {label}',
        'a11y.skillCount': '{count} skills',
        'a11y.actions': 'Import actions for {name}',
        'a11y.selectSkill': 'Select {name} for batch import',
        'a11y.selectVisible': 'Select every visible skill',
        'a11y.selectGroup': 'Select every skill in {label}',
        'btn.selectVisible': 'Select all',
        'btn.selectGroup': 'Select all',
        'btn.clearSelection': 'Clear',
        'selection.count': '{count} selected',
        'selection.hidden': '{count} hidden by the filter',
        'selection.batchImport': 'Batch import',
        'batch.title': 'Import {count} skill(s)',
        'batch.desc': 'Choose one destination. Every selected skill is copied there.',
        'batch.running': 'Importing {done} / {total}…',
        'batch.done': 'Done: {imported} new, {replaced} replaced, {failed} failed.',
        'batch.failedTitle': 'Failed items',
        'batch.retry': 'Retry failed',
        'batch.close': 'Done',
        'batch.overwriteNote': 'An existing skill with the same name is replaced.',
        'name.folder': 'Folder name (unchanged)',
        'name.declaredInvalid': 'DSH will ignore this skill: its frontmatter name is not kebab-case.',
        'name.normalize': 'Rewrite only the frontmatter "name" so DSH can load it',
        'name.normalizeHint': 'The folder name stays exactly as it is.',
        'name.willLoad': 'Will load in DSH',
        'name.willNotLoad': 'DSH will ignore this skill',
        'conflict.title': 'Name already exists',
        'conflict.desc': 'A skill named {name} already exists in {target}.',
        'conflict.batchDesc': '{count} selected skill(s) already exist in {target}.',
        'conflict.overwrite': 'Overwrite',
        'conflict.overwriteHint': 'Replace the existing folder with this source copy.',
        'conflict.rename': 'Rename the imported copy',
        'conflict.renameHint': 'Keep the existing one and store this copy under a new folder name.',
        'conflict.skip': 'Skip',
        'conflict.skipHint': 'Leave the existing skill untouched.',
        'conflict.newName': 'New folder name',
        'conflict.renamePlaceholder': 'new-folder-name',
        'conflict.renameInvalid': 'Enter a different, non-empty folder name.',
        'conflict.apply': 'Apply',
        'conflict.names': 'Conflicting skills',
        'conflict.renameAll': 'Rename every conflicting copy',
        'conflict.renameAllHint': 'Each new folder gets a numeric suffix (-2, -3, …).',
        'result.skipped': 'Skipped “{name}” because it already exists.',
        'result.renamed': 'Imported “{name}” into the new folder {folder}.',
        'result.unloadable': 'Imported “{name}”, but DSH will ignore it: its name is not kebab-case.',
      },
      zh: {
        'meta.title': 'Hermes 技能同步',
        'meta.description': '自动发现本机 Hermes 技能并导入 DSH。',
        'title': 'Hermes 技能',
        'desc': '发现本机 Hermes 已安装的技能，并复制到 DSH。',
        'btn.refresh': '重新扫描',
        'btn.retry': '重试',
        'btn.more': '更多',
        'btn.less': '收起',
        'btn.close': '关闭',
        'btn.back': '返回',
        'btn.import': '导入',
        'btn.importing': '导入中…',
        'btn.importGlobal': '导入为 DSH 全局 skills',
        'btn.importProject': '导入至 DSH 指定项目',
        'btn.openImport': '导入到 DSH',
        'btn.openImportHint': '复制完整 skill 目录。',
        'search.placeholder': '搜索技能…',
        'search.label': '搜索技能',
        'filter.label': 'Hermes Profile',
        'filter.all': '全部 Profile',
        'filter.count': '显示 {count} 个',
        'loading': '正在扫描 Hermes 安装…',
        'empty.none': '未在本机发现 Hermes 安装。',
        'empty.noneHint': 'Hermes 通常安装在 ~/.hermes。也可设置 DSH_HERMES_HOME 指向其他位置。',
        'empty.filtered': '没有符合当前筛选条件的技能。',
        'error.load': '扫描 Hermes 安装失败：{error}',
        'summary.title': '已扫描 {instances} 个安装，{skills} 个技能，耗时 {duration} 毫秒。',
        'summary.none': '扫描完成，但未发现技能。',
        'group.main': '主 agent',
        'group.profile': 'Profile：{name}',
        'kind.agent': '主 agent',
        'kind.profile': 'Profile',
        'meta.instance': '安装位置',
        'meta.files': '{count} 个文件',
        'meta.renamed': '将导入为 {name}',
        'target.title': '导入 {name}',
        'target.desc': '请选择该技能的安装位置。',
        'target.global': 'DSH 全局 skills',
        'target.globalHint': '在所有项目中可用，存储于 {path}。',
        'target.project': 'DSH 项目',
        'target.projectHint': '存储在某个项目内部。项目级同名技能会遮蔽全局技能。',
        'target.selectProject': '选择项目',
        'target.noProject': '尚未注册任何项目。',
        'target.noProjectHint': '请先在 DSH 中打开一个项目，再导入到该项目。',
        'target.pickDirectory': '选择其他目录…',
        'target.pickDirectoryHint': '在本机选择任意目录作为项目根目录。',
        'target.pickedPath': '已选目录',
        'target.picking': '正在打开目录选择器…',
        'target.pickUnavailable': '目录选择器不可用，需要先在 DSH 中注册项目。',
        'target.noProjectFallback': '尚未注册项目，但你仍可以直接选择目录。',
        'target.registered': '已注册 {count} 个项目',
        'target.sessions': '{count} 个会话',
        'result.ok': '已将“{name}”导入为 {dshName}。',
        'result.replaced': '已将“{name}”导入为 {dshName}，并替换了原有副本。',
        'result.conflict': '目标位置已存在名为 {dshName} 的技能。',
        'result.failed': '导入失败：{reason}',
        'status.imported': '已导入',
        'status.importing': '导入中',
        'status.conflict': '已存在',
        'status.failed': '失败',
        'container.title': '分类目录',
        'container.desc': '这些目录用于归类其他技能，本身不可直接导入。',
        'aria.moreActions': '{name} 的更多操作',
        'aria.group': '来自 {label} 的技能',
        'a11y.skillCount': '{count} 个技能',
        'a11y.actions': '{name} 的导入操作',
        'a11y.selectSkill': '选择 {name} 以便批量导入',
        'a11y.selectVisible': '全选当前显示的所有技能',
        'a11y.selectGroup': '全选 {label} 下的所有技能',
        'btn.selectVisible': '全选',
        'btn.selectGroup': '全选本组',
        'btn.clearSelection': '清空',
        'selection.count': '已选 {count} 个',
        'selection.hidden': '另有 {count} 个被筛选隐藏',
        'selection.batchImport': '批量导入',
        'batch.title': '批量导入 {count} 个 skill',
        'batch.desc': '选择目标位置，所有选中的 skill 都会复制过去。',
        'batch.running': '正在导入 {done} / {total}…',
        'batch.done': '完成：新增 {imported}，替换 {replaced}，失败 {failed}。',
        'batch.failedTitle': '失败的项',
        'batch.retry': '重试失败项',
        'batch.close': '完成',
        'batch.overwriteNote': '已存在的同名 skill 会被替换。',
        'name.folder': '目录名（保持原名）',
        'name.declaredInvalid': 'DSH 会忽略此 skill：它的 frontmatter name 不符合 kebab-case 规则。',
        'name.normalize': '仅改写 frontmatter 的 name，使 DSH 能加载',
        'name.normalizeHint': '目录名保持完全不变。',
        'name.willLoad': 'DSH 可正常加载',
        'name.willNotLoad': 'DSH 会忽略此 skill',
        'conflict.title': '已存在同名 skill',
        'conflict.desc': '目标位置 {target} 已存在名为 {name} 的 skill。',
        'conflict.batchDesc': '选中的 {count} 个 skill 在 {target} 中已存在。',
        'conflict.overwrite': '覆盖',
        'conflict.overwriteHint': '用本次来源的副本替换已有目录。',
        'conflict.rename': '重命名导入的副本',
        'conflict.renameHint': '保留已有 skill，把本次副本存到新的目录名。',
        'conflict.skip': '跳过',
        'conflict.skipHint': '保持已有 skill 不变。',
        'conflict.newName': '新的目录名',
        'conflict.renamePlaceholder': '新的目录名',
        'conflict.renameInvalid': '请输入一个不同的、非空的目录名。',
        'conflict.apply': '应用',
        'conflict.names': '冲突的 skill',
        'conflict.renameAll': '重命名全部冲突副本',
        'conflict.renameAllHint': '每个新目录追加数字后缀（-2、-3……）。',
        'result.skipped': '已跳过“{name}”：目标已存在。',
        'result.renamed': '已将“{name}”导入到新目录 {folder}。',
        'result.unloadable': '已导入“{name}”，但 DSH 会忽略它：名称不是 kebab-case。',
      },
    };

    function translate(t, key, params) {
      const template = t(key);
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name) =>
        (name in params ? String(params[name]) : match));
    }

    // ---------------------------------------------------------------------
    // Styling — theme tokens only
    // ---------------------------------------------------------------------

    const STYLE = `
.hss-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1.55;
}
.hss-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; }
.hss-title { margin: 0; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.hss-desc { margin: 0; color: var(--dsw-alias-label-secondary); }
.hss-toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.hss-search {
  flex: 1 1 200px; min-width: 0;
  padding: 6px 10px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.hss-search:focus-visible,
.hss-select:focus-visible,
.hss-btn:focus-visible,
.hss-filter-btn:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.hss-select {
  flex: 0 1 auto; min-width: 0; max-width: 100%;
  min-height: 30px; padding: 5px 10px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit; cursor: pointer;
}
.hss-btn {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 30px; padding: 5px 12px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font: inherit; cursor: pointer; white-space: nowrap;
}
.hss-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.hss-btn[disabled] { opacity: .55; cursor: not-allowed; }
.hss-btn-primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  border-color: transparent;
}
.hss-btn-primary:hover { background: var(--dsw-alias-button-primary-hover); }
.hss-btn-more { min-height: 28px; padding: 3px 10px; }
.hss-btn-more[aria-expanded="true"] {
  border-color: var(--dsw-alias-state-business-primary);
}
.hss-summary { color: var(--dsw-alias-label-secondary); display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.hss-shown { font-size: 12px; color: var(--dsw-alias-label-caption); }
.hss-feedback {
  padding: 8px 10px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.hss-feedback-error { border-color: var(--dsw-alias-state-error-primary); }
.hss-feedback-success { border-color: var(--dsw-alias-state-success-primary); }
.hss-empty { padding: 20px 12px; text-align: center; color: var(--dsw-alias-label-secondary); }
.hss-empty-hint { color: var(--dsw-alias-label-caption); font-size: 12px; margin-top: 6px; }
.hss-group { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.hss-group + .hss-group { margin-top: 10px; }
.hss-group-head {
  display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline;
  padding: 9px 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.hss-group-label { font-weight: 600; color: var(--dsw-alias-label-primary); }
.hss-group-path {
  font-size: 11px; color: var(--dsw-alias-label-caption);
  overflow-wrap: anywhere; min-width: 0;
}
.hss-group-count { font-size: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.hss-list { list-style: none; margin: 0; padding: 0; }

/* flex-wrap lets the inline action panel span the full row width. */
.hss-item {
  display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.hss-item:last-child { border-bottom: none; }
.hss-item-main { flex: 1 1 220px; min-width: 0; }
.hss-item-name { font-weight: 600; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.hss-item-desc {
  color: var(--dsw-alias-label-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; overflow-wrap: anywhere;
}
.hss-item-meta { font-size: 11px; color: var(--dsw-alias-label-caption); display: flex; flex-wrap: wrap; gap: 4px 10px; }
.hss-item-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }

/* Inline action panel: no positioning, so a scrolling parent cannot clip it. */
.hss-action-panel {
  flex: 1 1 100%;
  margin-top: 2px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.hss-action-item {
  display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center;
  width: 100%; text-align: left;
  padding: 8px 10px; border-radius: 6px;
  border: 1px solid transparent;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font: inherit; cursor: pointer;
}
.hss-action-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.hss-action-item:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.hss-action-title { font-weight: 600; }
.hss-action-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.hss-action-note {
  margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-caption);
  overflow-wrap: anywhere;
}
.hss-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.hss-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.hss-dot-success { color: var(--dsw-alias-state-success-primary); }
.hss-dot-error { color: var(--dsw-alias-state-error-primary); }
.hss-dot-warn { color: var(--dsw-alias-state-warn-primary); }
.hss-dot-busy { color: var(--dsw-alias-state-business-primary); }
.hss-backdrop {
  position: fixed; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: var(--dsw-alias-bg-mask-1);
}
.hss-dialog {
  width: min(520px, 100%);
  max-height: min(84vh, 640px);
  display: flex; flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.hss-dialog-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.hss-dialog-title { margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.hss-dialog-desc { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); }
.hss-dialog-body { padding: 12px 16px; overflow-y: auto; overscroll-behavior: contain; }
.hss-dialog-foot {
  display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end;
  padding: 12px 16px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.hss-choice {
  display: block; width: 100%; text-align: left;
  padding: 10px 12px; margin-bottom: 8px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font: inherit; cursor: pointer;
}
.hss-choice:hover { background: var(--dsw-alias-interactive-bg-hover); }
.hss-choice[aria-pressed="true"] { border-color: var(--dsw-alias-state-business-primary); }
.hss-choice:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.hss-choice-title { font-weight: 600; }
.hss-choice-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 2px; overflow-wrap: anywhere; }
.hss-project-list { display: flex; flex-direction: column; gap: 6px; }
.hss-rename-note {
  margin-top: 8px; padding: 7px 9px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  font-size: 11px; color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}
.hss-containers { margin-top: 10px; }
.hss-container-list { font-size: 11px; color: var(--dsw-alias-label-caption); display: flex; flex-wrap: wrap; gap: 4px 8px; }

/* Multi-select */
.hss-check {
  flex: 0 0 auto;
  width: 16px; height: 16px; margin-top: 3px;
  accent-color: var(--dsw-alias-state-business-primary);
  cursor: pointer;
}
.hss-check:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.hss-selectbar {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-bg-layer-2);
}
.hss-selectbar-count { font-weight: 600; color: var(--dsw-alias-label-primary); }
.hss-selectbar-hint { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.hss-selectbar-spacer { flex: 1 1 auto; }
.hss-group-select {
  border: none; background: transparent; padding: 0 2px;
  color: var(--dsw-alias-link); font: inherit; font-size: 12px;
  cursor: pointer; text-decoration: underline;
}
.hss-group-select:hover { color: var(--dsw-alias-label-primary); }
.hss-group-select:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.hss-batch-summary {
  padding: 8px 10px; margin-bottom: 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.hss-progress {
  height: 6px; border-radius: 999px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-3);
}
.hss-progress-fill {
  height: 100%; border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  transition: width .2s ease;
}
.hss-failure-list {
  max-height: 140px; overflow-y: auto; overscroll-behavior: contain;
  margin: 4px 0 0; padding-left: 18px;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
}
.hss-failure-item { overflow-wrap: anywhere; }

/* Warning-tinted feedback for "DSH will ignore this skill". */
.hss-feedback-warning {
  border-color: var(--dsw-alias-state-warn-primary);
  background: var(--dsw-alias-bg-layer-2);
}
/* A checkbox plus its two-line explanation. */
.hss-check-row {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 8px; cursor: pointer;
}
.hss-check-row > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
/* A labelled form field inside a dialog. */
.hss-field { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.hss-field > input { margin-top: 2px; }

/* Narrow screens: stack each row into a card and dock the dialog to the
   bottom edge as a sheet. The 768px threshold keeps 1280px-wide screens at
   200% browser zoom (about 640 CSS px) in the card layout. */
@media (max-width: 767px) {
  .hss-item { flex-direction: column; align-items: stretch; }
  .hss-item-actions { width: 100%; justify-content: flex-end; }
  .hss-action-panel { flex: 1 1 auto; }
  .hss-toolbar { flex-direction: column; align-items: stretch; }
  .hss-select, .hss-search { flex: 1 1 auto; width: 100%; }
  .hss-backdrop { align-items: flex-end; padding: 0; }
  .hss-dialog {
    width: 100%; max-width: 100%;
    max-height: 88vh;
    border-radius: 14px 14px 0 0;
    margin-top: auto;
  }
  .hss-dialog-foot { justify-content: stretch; }
  .hss-dialog-foot .hss-btn { flex: 1 1 auto; justify-content: center; }
}
@media (min-width: 768px) and (max-width: 1100px) {
  .hss-item-desc { -webkit-line-clamp: 3; }
}
`;

    function StyleSheet() {
      return h('style', { key: 'hss-style' }, STYLE);
    }

    // ---------------------------------------------------------------------
    // API access
    // ---------------------------------------------------------------------

    async function request(path, init) {
      const res = await fetch(API_BASE + path, init);
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok) {
        const error = new Error(
          (payload && (payload.reason || payload.code)) || ('HTTP ' + res.status),
        );
        error.payload = payload;
        error.status = res.status;
        throw error;
      }
      return payload;
    }

    function loadSnapshot() {
      return request('/snapshot', { method: 'GET' });
    }

    function importSkill(skill, target, options) {
      const settings = options || {};
      return request('/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceName: skill.sourceName,
          sourcePath: skill.path,
          target,
          onConflict: settings.onConflict || 'skip',
          renameTo: settings.renameTo,
          normalizeDeclaredName: settings.normalizeDeclaredName !== false,
        }),
      });
    }

    /** Ask the Host which of these skills would collide at the destination. */
    function checkConflicts(skills, target) {
      return request('/conflicts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: skills.map((skill) => ({
            sourceName: skill.sourceName,
            sourcePath: skill.path,
          })),
          target,
        }),
      });
    }

    /**
     * Import many skills in one request.
     *
     * The Host copies with bounded concurrency and returns a per-item result,
     * so a single unreadable skill never fails the whole batch.
     *
     * A Host that predates the batch route answers 404. The Host module is
     * only reloaded when the process restarts, whereas this Client bundle hot
     * reloads, so a freshly updated plugin can meet an older Host. Falling
     * back to concurrent single imports keeps batch import working until the
     * next restart, and produces the same report shape either way.
     */
    async function importSkillBatch(skills, target, options) {
      const settings = options || {};
      const normalizeDeclaredName = settings.normalizeDeclaredName !== false;
      const payload = {
        items: skills.map((skill) => ({
          sourceName: skill.sourceName,
          sourcePath: skill.path,
          ...(skill.renameTo ? { renameTo: skill.renameTo } : {}),
        })),
        target,
        onConflict: settings.onConflict || 'overwrite',
        normalizeDeclaredName,
      };
      try {
        return await request('/import-batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (!error || error.status !== 404) throw error;
        return await importSkillSequential(skills, target, settings);
      }
    }

    /** Fallback: bounded-concurrency single imports, shaped like a batch report. */
    async function importSkillSequential(skills, target, options) {
      const settings = options || {};
      const normalizeDeclaredName = settings.normalizeDeclaredName !== false;
      const CONCURRENCY = 4;
      const results = new Array(skills.length);
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, skills.length) },
        async () => {
          for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= skills.length) return;
            const skill = skills[index];
            try {
              const result = await importSkill(skill, target, {
                onConflict: 'overwrite',
                renameTo: skill.renameTo,
                normalizeDeclaredName,
              });
              results[index] = {
                sourcePath: skill.path,
                sourceName: skill.sourceName,
                ...result,
              };
            } catch (caught) {
              const payload = (caught && caught.payload) || {};
              results[index] = {
                sourcePath: skill.path,
                sourceName: skill.sourceName,
                ok: false,
                code: payload.code || 'error.copyFailed',
                reason: String(caught && caught.message ? caught.message : caught),
              };
            }
          }
        },
      );
      await Promise.all(workers);
      const settled = results.filter(Boolean);
      return {
        ok: true,
        results: settled,
        summary: {
          total: settled.length,
          imported: settled.filter((r) => r.ok && !r.replaced).length,
          replaced: settled.filter((r) => r.ok && r.replaced).length,
          conflicted: settled.filter((r) => !r.ok && r.code === 'error.conflict').length,
          failed: settled.filter((r) => !r.ok && r.code !== 'error.conflict').length,
        },
      };
    }

    // ---------------------------------------------------------------------
    // Icons and formatting
    // ---------------------------------------------------------------------

    function IconMore() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      }, h('circle', { cx: 3, cy: 8, r: 1.4, fill: 'currentColor' }),
         h('circle', { cx: 8, cy: 8, r: 1.4, fill: 'currentColor' }),
         h('circle', { cx: 13, cy: 8, r: 1.4, fill: 'currentColor' }));
    }

    function IconRefresh() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
      }, h('path', {
        d: 'M13.5 8A5.5 5.5 0 1 1 8 2.5c2.3 0 4.3 1.4 5.1 3.5m.4-3.5v3.5H10',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }));
    }

    function formatBytes(bytes) {
      if (!bytes) return '0 B';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return Math.ceil(bytes / 1024) + ' KB';
      return (Math.round((bytes / (1024 * 1024)) * 10) / 10) + ' MB';
    }

    // ---------------------------------------------------------------------
    // Project destination picker
    // ---------------------------------------------------------------------

    /**
     * Choose a project root for a project-scoped import.
     *
     * Two sources, in this order of convenience: the DSH workspace registry,
     * and an arbitrary folder picked on this machine. The second one exists
     * because the registry can legitimately be empty on a fresh install —
     * without it the project destination would be a dead end.
     *
     * `value` is the chosen absolute path, or null.
     */
    function ProjectTargetPicker({
      t, targets, value, onChange, onPickDirectory, picking, pickError,
    }) {
      const body = [];

      if (targets.length > 0) {
        body.push(h('div', { key: 'count', className: 'hss-action-note' },
          translate(t, 'target.registered', { count: targets.length })));
        body.push(h('div', { key: 'list', className: 'hss-project-list' },
          targets.map((project) => h('button', {
            key: project.id, type: 'button', className: 'hss-choice',
            'aria-pressed': value === project.path ? 'true' : 'false',
            onClick: () => onChange(project.path),
          },
            h('div', { className: 'hss-choice-title' }, project.title),
            h('div', { className: 'hss-choice-hint' },
              project.path
              + (project.sessions > 0
                ? ' · ' + translate(t, 'target.sessions', { count: project.sessions })
                : '')),
          )),
        ));
      } else {
        body.push(h('div', { key: 'none', className: 'hss-empty' },
          h('div', null, t('target.noProjectFallback')),
          h('div', { className: 'hss-empty-hint' }, t('target.noProjectHint')),
        ));
      }

      if (onPickDirectory) {
        body.push(h('button', {
          key: 'pick', type: 'button', className: 'hss-choice',
          disabled: picking,
          // Only claim the pressed state when the value is not one of the
          // registered projects, i.e. it came from the picker.
          'aria-pressed': value !== null && !targets.some((p) => p.path === value)
            ? 'true' : 'false',
          onClick: () => onPickDirectory(),
        },
          h('div', { className: 'hss-choice-title' },
            picking ? t('target.picking') : t('target.pickDirectory')),
          h('div', { className: 'hss-choice-hint' },
            value !== null && !targets.some((p) => p.path === value)
              ? t('target.pickedPath') + ': ' + value
              : t('target.pickDirectoryHint')),
        ));
      } else {
        body.push(h('div', { key: 'nopick', className: 'hss-action-note' },
          t('target.pickUnavailable')));
      }

      if (pickError) {
        body.push(h('div', {
          key: 'pickerror', className: 'hss-feedback hss-feedback-error', role: 'alert',
        }, pickError));
      }

      return h('div', { key: 'project-picker' }, body);
    }

    // ---------------------------------------------------------------------
    // Conflict dialog
    // ---------------------------------------------------------------------

    /**
     * Ask how to resolve skills whose folder name already exists.
     *
     * Shown for a single import (with a rename field) and for a batch (with a
     * policy). The import never silently overwrites: this is the only place
     * that decides, per the product requirement.
     */
    function ConflictDialog({ t, names, mode, targetPath, busy, error, onResolve, onClose }) {
      const [policy, setPolicy] = useState('overwrite');
      const [renameValue, setRenameValue] = useState(
        names.length > 0 ? names[0] + '-2' : '',
      );
      const dialogRef = useRef(null);
      const previouslyFocused = useRef(null);
      const single = mode === 'single';

      const close = useCallback(() => {
        if (busy) return;
        onClose();
      }, [busy, onClose]);

      useEffect(() => {
        previouslyFocused.current = document.activeElement;
        const node = dialogRef.current;
        if (node) {
          const first = node.querySelector('button, [href], input, select, textarea');
          if (first instanceof HTMLElement) first.focus();
          else node.focus();
        }
        return () => {
          const target = previouslyFocused.current;
          if (target instanceof HTMLElement) target.focus();
        };
      }, []);

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [close]);

      const trimmedRename = renameValue.trim();
      const canApply = policy !== 'rename' || (trimmedRename !== '' && trimmedRename !== names[0]);

      const apply = () => {
        if (busy || !canApply) return;
        onResolve(
          policy === 'rename'
            ? { policy: 'rename', renameTo: trimmedRename }
            : { policy },
        );
      };

      const option = (key, title, hint) => h('button', {
        key, type: 'button', className: 'hss-choice',
        'aria-pressed': policy === key ? 'true' : 'false',
        onClick: () => setPolicy(key),
      },
        h('div', { className: 'hss-choice-title' }, title),
        h('div', { className: 'hss-choice-hint' }, hint),
      );

      const body = [
        h('div', {
          key: 'desc', className: 'hss-batch-summary',
          role: 'alert',
        }, single
          ? translate(t, 'conflict.desc', { name: names[0], target: targetPath })
          : translate(t, 'conflict.batchDesc', { count: names.length, target: targetPath })),
      ];

      if (!single) {
        body.push(h('div', { key: 'names-title', className: 'hss-choice-title' },
          t('conflict.names')));
        body.push(h('ul', { key: 'names', className: 'hss-failure-list' },
          names.slice(0, 30).map((name) => h('li', {
            key: name, className: 'hss-failure-item',
          }, name))));
      }

      body.push(option('overwrite', t('conflict.overwrite'), t('conflict.overwriteHint')));
      body.push(option('rename',
        single ? t('conflict.rename') : t('conflict.renameAll'),
        single ? t('conflict.renameHint') : t('conflict.renameAllHint')));

      if (policy === 'rename' && single) {
        body.push(h('label', { key: 'rename-field', className: 'hss-field' },
          h('span', { className: 'hss-action-note' }, t('conflict.newName')),
          h('input', {
            type: 'text', className: 'hss-search',
            value: renameValue,
            'aria-label': t('conflict.newName'),
            placeholder: t('conflict.renamePlaceholder'),
            onChange: (event) => setRenameValue(event.target.value),
          }),
        ));
        if (!canApply) {
          body.push(h('div', { key: 'rename-invalid', className: 'hss-action-note' },
            t('conflict.renameInvalid')));
        }
      }

      body.push(option('skip', t('conflict.skip'), t('conflict.skipHint')));

      if (error) {
        body.push(h('div', {
          key: 'error', className: 'hss-feedback hss-feedback-error', role: 'alert',
        }, error));
      }

      return h('div', {
        className: 'hss-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) close();
        },
      },
        h('div', {
          ref: dialogRef, className: 'hss-dialog', role: 'dialog',
          'aria-modal': 'true', 'aria-label': t('conflict.title'), tabIndex: -1,
        },
          h('div', { className: 'hss-dialog-head' },
            h('h3', { className: 'hss-dialog-title' }, t('conflict.title')),
          ),
          h('div', { className: 'hss-dialog-body' }, body),
          h('div', { className: 'hss-dialog-foot' },
            h('button', {
              key: 'cancel', type: 'button', className: 'hss-btn',
              disabled: busy, onClick: close,
            }, t('btn.close')),
            h('button', {
              key: 'apply', type: 'button', className: 'hss-btn hss-btn-primary',
              disabled: busy || !canApply, onClick: apply,
            }, busy ? t('btn.importing') : t('conflict.apply')),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Import dialog (the second level of the two-step flow)
    // ---------------------------------------------------------------------

    function ImportDialog({
      t, skill, targets, onClose, onConfirm, busy, error,
      projectPath, onSelectProject, onPickDirectory, picking, pickError,
      normalizeName, onToggleNormalize,
    }) {
      const [step, setStep] = useState('menu');
      const dialogRef = useRef(null);
      const previouslyFocused = useRef(null);

      const close = useCallback(() => {
        if (busy) return;
        onClose();
      }, [busy, onClose]);

      useEffect(() => {
        previouslyFocused.current = document.activeElement;
        const node = dialogRef.current;
        if (node) {
          const first = node.querySelector('button, [href], input, select, textarea');
          if (first instanceof HTMLElement) first.focus();
          else node.focus();
        }
        return () => {
          const target = previouslyFocused.current;
          if (target instanceof HTMLElement) target.focus();
        };
      }, []);

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.key !== 'Tab') return;
          const node = dialogRef.current;
          if (!node) return;
          const focusable = Array.from(node.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
          )).filter((el) => el instanceof HTMLElement);
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [close]);

      const canConfirm = step === 'global' || (step === 'project' && projectPath !== null);

      const confirm = () => {
        if (!canConfirm || busy) return;
        if (step === 'global') {
          onConfirm({ kind: 'global' });
          return;
        }
        onConfirm({ kind: 'project', projectRoot: projectPath });
      };

      const body = [];
      if (step === 'menu') {
        // The two destinations required by the product spec.
        body.push(h('button', {
          key: 'global', type: 'button', className: 'hss-choice',
          onClick: () => setStep('global'),
        },
          h('div', { className: 'hss-choice-title' }, t('btn.importGlobal')),
          h('div', { className: 'hss-choice-hint' },
            translate(t, 'target.globalHint', { path: '~/.dsh/skills' })),
        ));
        body.push(h('button', {
          key: 'project', type: 'button', className: 'hss-choice',
          onClick: () => setStep('project'),
        },
          h('div', { className: 'hss-choice-title' }, t('btn.importProject')),
          h('div', { className: 'hss-choice-hint' }, t('target.projectHint')),
        ));
      } else if (step === 'global') {
        body.push(h('div', { key: 'label', className: 'hss-choice-title' }, t('target.global')));
        body.push(h('div', { key: 'hint', className: 'hss-choice-hint' },
          translate(t, 'target.globalHint', { path: '~/.dsh/skills' })));
      } else {
        body.push(h('div', { key: 'label', className: 'hss-choice-title' }, t('target.selectProject')));
        body.push(h(ProjectTargetPicker, {
          key: 'picker',
          t,
          targets,
          value: projectPath,
          onChange: onSelectProject,
          onPickDirectory,
          picking,
          pickError,
        }));
      }

      if (skill) {
        // The folder name is always the original name; say so explicitly so a
        // user who previously saw an auto-renamed slug sees the change.
        body.push(h('div', { key: 'folder', className: 'hss-action-note' },
          t('name.folder') + ': ' + (skill.folderName || skill.sourceName)));
        if (skill.declaredNameValid === false) {
          body.push(h('div', {
            key: 'declared-warn', className: 'hss-feedback hss-feedback-warning', role: 'alert',
          }, t('name.declaredInvalid')));
          body.push(h('label', { key: 'normalize', className: 'hss-check-row' },
            h('input', {
              type: 'checkbox', className: 'hss-check',
              checked: normalizeName,
              onChange: (event) => onToggleNormalize(event.target.checked),
            }),
            h('span', null,
              h('span', { className: 'hss-action-title' }, t('name.normalize')),
              h('span', { className: 'hss-choice-hint' }, t('name.normalizeHint'))),
          ));
          body.push(h('div', { key: 'willload', className: 'hss-action-note' },
            normalizeName ? t('name.willLoad') : t('name.willNotLoad')));
        }
      }

      if (error) {
        body.push(h('div', {
          key: 'error', className: 'hss-feedback hss-feedback-error', role: 'alert',
        }, error));
      }

      const foot = [];
      if (step !== 'menu') {
        foot.push(h('button', {
          key: 'back', type: 'button', className: 'hss-btn', disabled: busy,
          onClick: () => setStep('menu'),
        }, t('btn.back')));
      }
      foot.push(h('button', {
        key: 'close', type: 'button', className: 'hss-btn', disabled: busy,
        onClick: close,
      }, t('btn.close')));
      if (step !== 'menu') {
        foot.push(h('button', {
          key: 'confirm', type: 'button', className: 'hss-btn hss-btn-primary',
          disabled: busy || !canConfirm,
          onClick: confirm,
        }, busy ? t('btn.importing') : t('btn.import')));
      }

      return h('div', {
        className: 'hss-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) close();
        },
      },
        h('div', {
          ref: dialogRef, className: 'hss-dialog', role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate(t, 'target.title', { name: skill ? skill.sourceName : '' }),
          tabIndex: -1,
        },
          h('div', { className: 'hss-dialog-head' },
            h('h3', { className: 'hss-dialog-title' },
              translate(t, 'target.title', { name: skill ? skill.sourceName : '' })),
            h('p', { className: 'hss-dialog-desc' }, t('target.desc')),
          ),
          h('div', { className: 'hss-dialog-body' }, body),
          h('div', { className: 'hss-dialog-foot' }, foot),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Batch import dialog
    // ---------------------------------------------------------------------

    /**
     * Two-step batch import: pick a destination, then watch progress.
     *
     * `phase` is owned by the parent so the dialog can unmount without losing
     * the run, and so a finished run can be re-opened for its report.
     */
    function BatchImportDialog({
      t, count, targets, phase, progress, report, error, onClose, onConfirm, onRetry,
      projectPath, onSelectProject, onPickDirectory, picking, pickError,
    }) {
      const [step, setStep] = useState('menu');
      const dialogRef = useRef(null);
      const previouslyFocused = useRef(null);
      const running = phase === 'running';

      const close = useCallback(() => {
        if (running) return;
        onClose();
      }, [running, onClose]);

      useEffect(() => {
        previouslyFocused.current = document.activeElement;
        const node = dialogRef.current;
        if (node) {
          const first = node.querySelector('button, [href], input, select, textarea');
          if (first instanceof HTMLElement) first.focus();
          else node.focus();
        }
        return () => {
          const target = previouslyFocused.current;
          if (target instanceof HTMLElement) target.focus();
        };
      }, []);

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.key !== 'Tab') return;
          const node = dialogRef.current;
          if (!node) return;
          const focusable = Array.from(node.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
          )).filter((el) => el instanceof HTMLElement);
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [close]);

      const canConfirm = step === 'global' || (step === 'project' && projectPath !== null);

      const confirm = () => {
        if (!canConfirm || running) return;
        if (step === 'global') onConfirm({ kind: 'global' });
        else onConfirm({ kind: 'project', projectRoot: projectPath });
      };

      const body = [];

      if (phase === 'done' && report) {
        // Report view: what landed, what did not.
        body.push(h('div', { key: 'summary', className: 'hss-batch-summary' },
          translate(t, 'batch.done', {
            imported: report.summary.imported,
            replaced: report.summary.replaced,
            failed: report.summary.failed,
          })));
        if (report.failures.length > 0) {
          body.push(h('div', { key: 'failed-title', className: 'hss-choice-title' },
            t('batch.failedTitle')));
          body.push(h('ul', { key: 'failed', className: 'hss-failure-list' },
            report.failures.slice(0, 20).map((failure) => h('li', {
              key: failure.sourcePath,
              className: 'hss-failure-item',
            }, failure.sourceName || failure.sourcePath))));
        }
      } else if (running) {
        const total = progress.total || count;
        const done = progress.done || 0;
        const percent = total > 0 ? Math.round((done / total) * 100) : 0;
        body.push(h('div', { key: 'running', className: 'hss-batch-summary' },
          translate(t, 'batch.running', { done, total })));
        body.push(h('div', {
          key: 'bar', className: 'hss-progress', role: 'progressbar',
          'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
          'aria-label': translate(t, 'batch.running', { done, total }),
        }, h('div', { className: 'hss-progress-fill', style: { width: percent + '%' } })));
      } else if (step === 'menu') {
        body.push(h('button', {
          key: 'global', type: 'button', className: 'hss-choice',
          onClick: () => setStep('global'),
        },
          h('div', { className: 'hss-choice-title' }, t('btn.importGlobal')),
          h('div', { className: 'hss-choice-hint' },
            translate(t, 'target.globalHint', { path: '~/.dsh/skills' })),
        ));
        body.push(h('button', {
          key: 'project', type: 'button', className: 'hss-choice',
          onClick: () => setStep('project'),
        },
          h('div', { className: 'hss-choice-title' }, t('btn.importProject')),
          h('div', { className: 'hss-choice-hint' }, t('target.projectHint')),
        ));
      } else if (step === 'global') {
        body.push(h('div', { key: 'label', className: 'hss-choice-title' }, t('target.global')));
        body.push(h('div', { key: 'hint', className: 'hss-choice-hint' },
          translate(t, 'target.globalHint', { path: '~/.dsh/skills' })));
      } else {
        body.push(h('div', { key: 'label', className: 'hss-choice-title' }, t('target.selectProject')));
        body.push(h(ProjectTargetPicker, {
          key: 'picker',
          t,
          targets,
          value: projectPath,
          onChange: onSelectProject,
          onPickDirectory,
          picking,
          pickError,
        }));
      }

      if (phase !== 'done' && step !== 'menu' && !running) {
        body.push(h('div', { key: 'note', className: 'hss-action-note' },
          t('batch.overwriteNote')));
      }

      if (error) {
        body.push(h('div', {
          key: 'error', className: 'hss-feedback hss-feedback-error', role: 'alert',
        }, error));
      }

      const foot = [];
      if (phase === 'done') {
        if (report && report.failures.length > 0) {
          foot.push(h('button', {
            key: 'retry', type: 'button', className: 'hss-btn', onClick: onRetry,
          }, t('batch.retry')));
        }
        foot.push(h('button', {
          key: 'close', type: 'button', className: 'hss-btn hss-btn-primary', onClick: close,
        }, t('batch.close')));
      } else if (running) {
        foot.push(h('button', {
          key: 'close', type: 'button', className: 'hss-btn', disabled: true,
        }, t('btn.importing')));
      } else {
        if (step !== 'menu') {
          foot.push(h('button', {
            key: 'back', type: 'button', className: 'hss-btn',
            onClick: () => setStep('menu'),
          }, t('btn.back')));
        }
        foot.push(h('button', {
          key: 'close', type: 'button', className: 'hss-btn', onClick: close,
        }, t('btn.close')));
        if (step !== 'menu') {
          foot.push(h('button', {
            key: 'confirm', type: 'button', className: 'hss-btn hss-btn-primary',
            disabled: !canConfirm, onClick: confirm,
          }, t('btn.import')));
        }
      }

      return h('div', {
        className: 'hss-backdrop',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) close();
        },
      },
        h('div', {
          ref: dialogRef, className: 'hss-dialog', role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate(t, 'batch.title', { count }),
          tabIndex: -1,
        },
          h('div', { className: 'hss-dialog-head' },
            h('h3', { className: 'hss-dialog-title' },
              translate(t, 'batch.title', { count })),
            h('p', { className: 'hss-dialog-desc' }, t('batch.desc')),
          ),
          h('div', { className: 'hss-dialog-body' }, body),
          h('div', { className: 'hss-dialog-foot' }, foot),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Section
    // ---------------------------------------------------------------------

    function HermesSkillsSection(props) {
      const t = props.t;
      const onPickDirectory = props.onPickDirectory || null;
      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [query, setQuery] = useState('');
      const [profileFilter, setProfileFilter] = useState('all');
      const [expandedId, setExpandedId] = useState(null);
      const [dialogSkill, setDialogSkill] = useState(null);
      const [busy, setBusy] = useState(false);
      const [dialogError, setDialogError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [statuses, setStatuses] = useState({});
      // Batch selection is keyed by skill id so it survives filtering; the
      // array stays ordered and de-duplicated at every write.
      const [selectedIds, setSelectedIds] = useState([]);
      const [batchOpen, setBatchOpen] = useState(false);
      const [batchPhase, setBatchPhase] = useState('choose');
      const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
      const [batchReport, setBatchReport] = useState(null);
      const [batchError, setBatchError] = useState(null);
      // Destination for a project-scoped import. Lifted here so the folder
      // picker and both dialogs share one value.
      const [projectPath, setProjectPath] = useState(null);
      const [picking, setPicking] = useState(false);
      const [pickError, setPickError] = useState(null);
      // Rewrite the frontmatter `name:` for skills DSH would otherwise ignore.
      // Defaults to true so imported skills actually load; the dialog states
      // plainly that only that field changes and the folder keeps its name.
      const [normalizeName, setNormalizeName] = useState(true);
      // Pending conflict resolution, if a destination already has the name.
      const [conflict, setConflict] = useState(null);
      const [retryPool, setRetryPool] = useState([]);
      // Remembers the last chosen destination so "retry failed" can reuse it.
      const batchTargetRef = useRef(null);

      const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await loadSnapshot();
          setSnapshot(data);
        } catch (caught) {
          setError(String(caught && caught.message ? caught.message : caught));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        reload();
      }, [reload]);

      const groups = snapshot ? snapshot.groups : [];
      const targets = snapshot ? snapshot.projectTargets : [];

      // The renderer hands every slot a `useWorkspaces` selector hook over the
      // Client's own Workspace projection. Reading it here means the project
      // list is correct even when the Host half is older than this bundle
      // (Host code only reloads on restart), and it also avoids a round trip.
      // Falls back to a constant empty snapshot so the hook call stays
      // unconditional.
      const emptyWorkspaceSnapshot = {
        items: [], archivedSessionIds: [], pinnedSessionIds: [],
        state: 'idle', phase: 'pending', error: null,
      };
      const useWorkspaces = typeof props.useWorkspaces === 'function'
        ? props.useWorkspaces
        : (selector) => selector(emptyWorkspaceSnapshot);
      const workspaceItems = useWorkspaces(
        (snap) => (snap && snap.items) || emptyWorkspaceSnapshot.items,
      );

      const clientProjectTargets = useMemo(() => {
        const list = Array.isArray(workspaceItems) ? workspaceItems : [];
        return list
          .map((workspace) => {
            const path = typeof workspace.path === 'string' ? workspace.path : undefined;
            return {
              id: String(workspace.workspaceId ?? workspace.id ?? path),
              title: typeof workspace.title === 'string' && workspace.title !== ''
                ? workspace.title
                : path,
              path,
              sessions: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
            };
          })
          .filter((target) => typeof target.path === 'string' && target.path.startsWith('/'));
      }, [workspaceItems]);

      // Prefer the Client projection (always current); keep the Host list as a
      // fallback for a Host that reports workspaces this bundle cannot see.
      const projectTargets = clientProjectTargets.length > 0
        ? clientProjectTargets
        : targets;

      // One option per discovered Hermes group: the main agent plus each
      // profile. Values are group keys so the filter survives a rescan.
      const profileOptions = useMemo(() => {
        const options = [{ value: 'all', label: t('filter.all') }];
        for (const group of groups) {
          options.push({
            value: group.key,
            label: group.kind === 'agent'
              ? t('group.main')
              : translate(t, 'group.profile', { name: group.label }),
          });
        }
        return options;
      }, [groups, t]);

      const filteredGroups = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return groups
          .filter((group) => profileFilter === 'all' || group.key === profileFilter)
          .map((group) => {
            if (!needle) return group;
            const skills = group.skills.filter((skill) =>
              (skill.sourceName || '').toLowerCase().includes(needle) ||
              (skill.displayName || '').toLowerCase().includes(needle) ||
              (skill.description || '').toLowerCase().includes(needle) ||
              (skill.dshName || '').toLowerCase().includes(needle));
            return { ...group, skills };
          })
          .filter((group) => group.skills.length > 0);
      }, [groups, query, profileFilter]);

      const shownCount = useMemo(
        () => filteredGroups.reduce((sum, group) => sum + group.skills.length, 0),
        [filteredGroups],
      );

      /** Shared import options built from the current normalization choice. */
      const importOptions = (extra) => ({
        normalizeDeclaredName: normalizeName,
        ...(extra || {}),
      });

      /** Compose the notice for a finished single import. */
      const describeImport = (skill, result) => {
        if (result.skipped) {
          return translate(t, 'result.skipped', { name: skill.sourceName });
        }
        if (result.folderName && result.folderName !== skill.sourceName) {
          return translate(t, 'result.renamed', {
            name: skill.sourceName, folder: result.folderName,
          });
        }
        if (result.willLoad === false) {
          return translate(t, 'result.unloadable', { name: skill.sourceName });
        }
        return result.replaced
          ? translate(t, 'result.replaced', {
            name: skill.sourceName, dshName: result.folderName || skill.sourceName,
          })
          : translate(t, 'result.ok', {
            name: skill.sourceName, dshName: result.folderName || skill.sourceName,
          });
      };

      /**
       * Import one skill, asking the user about a name collision first.
       *
       * `resolution` is absent on the first attempt, which runs the conflict
       * check; a collision then opens the conflict dialog instead of failing.
       */
      const runImport = async (skill, target, resolution) => {
        setBusy(true);
        setDialogError(null);
        const key = skill.id;

        if (!resolution) {
          try {
            const report = await checkConflicts([skill], target);
            const hit = report && Array.isArray(report.conflicts)
              ? report.conflicts.find((entry) => entry.exists)
              : undefined;
            if (hit) {
              setBusy(false);
              setConflict({
                mode: 'single',
                names: [hit.folderName],
                target,
                targetPath: report.target,
                skills: [skill],
              });
              return;
            }
          } catch {
            // A failed pre-check must not block the import; proceed and let the
            // import itself report a collision.
          }
        }

        setStatuses((prev) => ({ ...prev, [key]: 'importing' }));
        try {
          const policy = resolution ? resolution.policy : 'overwrite';
          const result = await importSkill(skill, target, importOptions({
            onConflict: policy,
            renameTo: resolution && resolution.renameTo,
          }));
          if (result && result.ok) {
            setStatuses((prev) => ({ ...prev, [key]: 'imported' }));
            setNotice(describeImport(skill, result));
            setDialogSkill(null);
            setExpandedId(null);
            setConflict(null);
          } else if (result && result.skipped) {
            setStatuses((prev) => ({ ...prev, [key]: undefined }));
            setNotice(translate(t, 'result.skipped', { name: skill.sourceName }));
            setDialogSkill(null);
            setConflict(null);
          } else {
            setStatuses((prev) => ({ ...prev, [key]: 'conflict' }));
            setDialogError(translate(t, 'result.conflict', {
              dshName: result && (result.folderName || result.dshName),
            }));
          }
        } catch (caught) {
          setStatuses((prev) => ({ ...prev, [key]: 'failed' }));
          setDialogError(translate(t, 'result.failed', {
            reason: String(caught && caught.message ? caught.message : caught),
          }));
        } finally {
          setBusy(false);
        }
      };

      const toggleActions = (skillId) => {
        setExpandedId((current) => (current === skillId ? null : skillId));
      };

      // ---------------------------------------------------------------
      // Project destination
      // ---------------------------------------------------------------

      const resolvedProjectPath = projectPath !== null
        ? projectPath
        : (projectTargets.length > 0 ? projectTargets[0].path : null);

      /**
       * Open the host folder picker and adopt whatever it returns.
       *
       * This is the escape hatch when the workspace registry is empty, so a
       * project import is never a dead end.
       */
      const pickProjectDirectory = async () => {
        if (!onPickDirectory) {
          setPickError(t('target.pickUnavailable'));
          return;
        }
        setPicking(true);
        setPickError(null);
        try {
          const picked = await onPickDirectory();
          if (typeof picked === 'string' && picked !== '') {
            setProjectPath(picked);
          }
        } catch (caught) {
          setPickError(String(caught && caught.message ? caught.message : caught));
        } finally {
          setPicking(false);
        }
      };

      // ---------------------------------------------------------------
      // Batch selection
      // ---------------------------------------------------------------

      const selectSkill = (skillId, next) => {
        setSelectedIds((prev) => {
          if (next) return prev.includes(skillId) ? prev : [...prev, skillId];
          return prev.includes(skillId) ? prev.filter((id) => id !== skillId) : prev;
        });
      };

      const addToSelection = (ids) => {
        setSelectedIds((prev) => {
          const merged = new Set(prev);
          for (const id of ids) merged.add(id);
          return [...merged];
        });
      };

      const removeFromSelection = (ids) => {
        const drop = new Set(ids);
        setSelectedIds((prev) => prev.filter((id) => !drop.has(id)));
      };

      /** Every skill in the current filtered view. */
      const visibleSkills = useMemo(
        () => filteredGroups.flatMap((group) => group.skills),
        [filteredGroups],
      );
      const visibleIds = useMemo(
        () => visibleSkills.map((skill) => skill.id),
        [visibleSkills],
      );
      const allVisibleSelected = visibleIds.length > 0
        && visibleIds.every((id) => selectedIds.includes(id));

      /** id → skill across the whole snapshot, so hidden selections resolve. */
      const skillById = useMemo(() => {
        const map = new Map();
        for (const group of groups) for (const skill of group.skills) map.set(skill.id, skill);
        return map;
      }, [groups]);

      const selectedSkills = useMemo(
        () => selectedIds.map((id) => skillById.get(id)).filter(Boolean),
        [selectedIds, skillById],
      );
      const hiddenSelectedCount = selectedSkills.length
        - selectedSkills.filter((skill) => visibleIds.includes(skill.id)).length;

      const batchCount = retryPool.length > 0 && batchPhase === 'done'
        ? retryPool.length
        : selectedSkills.length;

      /**
       * Run a batch import.
       *
       * Requests are chunked so the progress bar advances during a large run
       * instead of freezing until one huge response returns.
       */
      const runBatch = async (skills, target, resolution) => {
        const CHUNK = 8;

        // First attempt: ask about collisions instead of overwriting silently.
        if (!resolution) {
          try {
            const report = await checkConflicts(skills, target);
            const hits = report && Array.isArray(report.conflicts)
              ? report.conflicts.filter((entry) => entry.exists)
              : [];
            if (hits.length > 0) {
              setConflict({
                mode: 'batch',
                names: hits.map((hit) => hit.folderName),
                target,
                targetPath: report.target,
                skills,
              });
              return;
            }
          } catch {
            // Pre-check unavailable: fall through with the default policy.
          }
        }

        const policy = resolution ? resolution.policy : 'overwrite';
        // Batch rename gives every conflicting copy a unique numeric suffix.
        const prepared = skills.map((skill) => {
          if (policy !== 'rename') return { ...skill, renameTo: undefined };
          const base = skill.folderName || skill.sourceName;
          const taken = new Set(skills.map((other) => other.folderName || other.sourceName));
          let candidate = `${base}-2`;
          let counter = 2;
          while (taken.has(candidate)) {
            counter += 1;
            candidate = `${base}-${counter}`;
          }
          taken.add(candidate);
          return { ...skill, renameTo: candidate };
        });
        const renameMap = new Map(
          prepared.map((skill) => [skill.id, skill.renameTo]),
        );

        setBatchError(null);
        setBatchReport(null);
        setBatchPhase('running');
        setBatchProgress({ done: 0, total: skills.length });
        setStatuses((prev) => {
          const next = { ...prev };
          for (const skill of skills) next[skill.id] = 'importing';
          return next;
        });

        const failures = [];
        let imported = 0;
        let replaced = 0;
        let skipped = 0;
        const succeededIds = [];

        try {
          for (let offset = 0; offset < skills.length; offset += CHUNK) {
            const chunk = prepared.slice(offset, offset + CHUNK);
            let report = null;
            try {
              report = await importSkillBatch(chunk, target, importOptions({
                onConflict: policy,
              }));
            } catch (caught) {
              // A chunk-level transport failure marks only its own items.
              for (const skill of chunk) {
                failures.push({
                  sourcePath: skill.path,
                  sourceName: skill.sourceName,
                  reason: String(caught && caught.message ? caught.message : caught),
                });
              }
              setStatuses((prev) => {
                const next = { ...prev };
                for (const skill of chunk) next[skill.id] = 'failed';
                return next;
              });
              setBatchProgress({ done: offset + chunk.length, total: skills.length });
              continue;
            }

            const results = Array.isArray(report && report.results) ? report.results : [];
            results.forEach((result, index) => {
              const skill = chunk[index];
              if (!skill) return;
              if (result.ok) {
                succeededIds.push(skill.id);
                if (result.replaced) replaced += 1;
                else imported += 1;
              } else if (result.code === 'error.conflict' && policy === 'skip') {
                skipped += 1;
              } else {
                failures.push({
                  sourcePath: result.sourcePath || skill.path,
                  sourceName: result.sourceName || skill.sourceName,
                  reason: result.code || 'error.copyFailed',
                });
              }
            });
            setStatuses((prev) => {
              const next = { ...prev };
              results.forEach((result, index) => {
                const skill = chunk[index];
                if (!skill) return;
                next[skill.id] = result.ok ? 'imported' : 'failed';
              });
              return next;
            });
            setBatchProgress({ done: offset + chunk.length, total: skills.length });
          }

          // Successful items leave the selection so a retry targets only the
          // ones that still need attention.
          removeFromSelection(succeededIds);
          setRetryPool(failures.map((failure) => failure.sourcePath));
          setBatchReport({
            summary: {
              total: skills.length, imported, replaced, skipped, failed: failures.length,
            },
            failures,
          });
          setBatchPhase('done');
          if (failures.length === 0) {
            setNotice(translate(t, 'batch.done', {
              imported, replaced, failed: 0,
            }));
            setConflict(null);
          }
        } catch (caught) {
          setBatchError(translate(t, 'result.failed', {
            reason: String(caught && caught.message ? caught.message : caught),
          }));
          setBatchPhase('choose');
        }
      };

      const openBatch = () => {
        setBatchError(null);
        setBatchReport(null);
        setBatchPhase('choose');
        setRetryPool([]);
        setBatchProgress({ done: 0, total: selectedSkills.length });
        setBatchOpen(true);
      };

      const closeBatch = () => {
        if (batchPhase === 'running') return;
        setBatchOpen(false);
        setBatchPhase('choose');
        setBatchReport(null);
        setRetryPool([]);
      };

      const retryFailed = () => {
        const pool = new Set(retryPool);
        const skills = selectedSkills.filter((skill) => pool.has(skill.path));
        if (skills.length === 0) return;
        runBatch(skills, batchTargetRef.current || { kind: 'global' });
      };

      const statusBadge = (skill) => {
        const status = statuses[skill.id];
        if (!status) return null;
        const map = {
          imported: ['hss-dot-success', 'status.imported'],
          importing: ['hss-dot-busy', 'status.importing'],
          conflict: ['hss-dot-warn', 'status.conflict'],
          failed: ['hss-dot-error', 'status.failed'],
        };
        const entry = map[status];
        if (!entry) return null;
        return h('span', { className: 'hss-badge' },
          h('span', { className: 'hss-dot ' + entry[0], 'aria-hidden': true }),
          t(entry[1]));
      };

      const children = [];

      children.push(h(StyleSheet, { key: 'style' }));
      children.push(h('div', { className: 'hss-head', key: 'head' },
        h('div', { key: 'titles' },
          h('h2', { className: 'hss-title' }, t('title')),
          h('p', { className: 'hss-desc' }, t('desc')),
        ),
      ));

      children.push(h('div', { className: 'hss-toolbar', key: 'toolbar' },
        h('input', {
          key: 'search', className: 'hss-search', type: 'search',
          value: query,
          placeholder: t('search.placeholder'),
          'aria-label': t('search.label'),
          onChange: (event) => setQuery(event.target.value),
        }),
        h('select', {
          key: 'profile', className: 'hss-select',
          value: profileFilter,
          'aria-label': t('filter.label'),
          onChange: (event) => {
            setProfileFilter(event.target.value);
            setExpandedId(null);
          },
        }, profileOptions.map((option) =>
          h('option', { key: option.value, value: option.value }, option.label))),
        h('button', {
          key: 'refresh', type: 'button', className: 'hss-btn', disabled: loading,
          onClick: () => reload(),
        }, h(IconRefresh), t('btn.refresh')),
        h('button', {
          key: 'selectall', type: 'button', className: 'hss-btn',
          disabled: visibleIds.length === 0,
          'aria-label': t('a11y.selectVisible'),
          onClick: () => {
            if (allVisibleSelected) removeFromSelection(visibleIds);
            else addToSelection(visibleIds);
          },
        }, t('btn.selectVisible')),
      ));

      // Selection summary + the batch action. Rendered above the list so it
      // stays reachable without scrolling back up.
      if (selectedIds.length > 0) {
        children.push(h('div', { key: 'selectbar', className: 'hss-selectbar' },
          h('span', { key: 'count', className: 'hss-selectbar-count' },
            translate(t, 'selection.count', { count: selectedIds.length })),
          hiddenSelectedCount > 0
            ? h('span', { key: 'hidden', className: 'hss-selectbar-hint' },
              translate(t, 'selection.hidden', { count: hiddenSelectedCount }))
            : null,
          h('span', { key: 'spacer', className: 'hss-selectbar-spacer' }),
          h('button', {
            key: 'clear', type: 'button', className: 'hss-btn',
            onClick: () => setSelectedIds([]),
          }, t('btn.clearSelection')),
          h('button', {
            key: 'batch', type: 'button', className: 'hss-btn hss-btn-primary',
            onClick: openBatch,
          }, t('selection.batchImport')),
        ));
      }

      if (snapshot) {
        children.push(h('p', { key: 'summary', className: 'hss-summary' },
          h('span', null, snapshot.skillCount > 0
            ? translate(t, 'summary.title', {
              instances: snapshot.instanceCount,
              skills: snapshot.skillCount,
              duration: snapshot.durationMs,
            })
            : t('summary.none')),
          profileFilter === 'all' && !query.trim()
            ? null
            : h('span', { className: 'hss-shown' },
              translate(t, 'filter.count', { count: shownCount })),
        ));
      }

      if (error) {
        children.push(h('div', {
          key: 'error', className: 'hss-feedback hss-feedback-error', role: 'alert',
        },
          translate(t, 'error.load', { error }),
          h('div', { key: 'retry', style: { marginTop: '8px' } },
            h('button', { type: 'button', className: 'hss-btn', onClick: () => reload() },
              t('btn.retry'))),
        ));
      }

      if (notice) {
        children.push(h('div', {
          key: 'notice', className: 'hss-feedback hss-feedback-success', role: 'status',
        }, notice));
      }

      if (loading && !snapshot) {
        children.push(h('div', { key: 'loading', className: 'hss-empty' }, t('loading')));
      } else if (snapshot && snapshot.skillCount === 0) {
        children.push(h('div', { key: 'empty', className: 'hss-empty' },
          h('div', null, t('empty.none')),
          h('div', { className: 'hss-empty-hint' }, t('empty.noneHint')),
        ));
      } else if (filteredGroups.length === 0) {
        children.push(h('div', { key: 'filtered', className: 'hss-empty' },
          t('empty.filtered')));
      } else {
        filteredGroups.forEach((group) => {
          const groupLabel = group.kind === 'agent'
            ? t('group.main')
            : translate(t, 'group.profile', { name: group.label });
          children.push(h('section', {
            key: group.key, className: 'hss-group',
            'aria-label': translate(t, 'aria.group', { label: groupLabel }),
          },
            h('div', { className: 'hss-group-head' },
              h('span', { className: 'hss-group-label' }, groupLabel),
              h('span', { className: 'hss-group-count' },
                translate(t, 'a11y.skillCount', { count: group.skills.length })),
              h('span', { className: 'hss-group-path' }, group.path),
              h('button', {
                type: 'button', className: 'hss-group-select',
                'aria-label': translate(t, 'a11y.selectGroup', { label: groupLabel }),
                onClick: () => {
                  const ids = group.skills.map((skill) => skill.id);
                  const allPicked = ids.length > 0 && ids.every((id) => selectedIds.includes(id));
                  if (allPicked) removeFromSelection(ids);
                  else addToSelection(ids);
                },
              }, t('btn.selectGroup')),
            ),
            h('ul', { className: 'hss-list' },
              group.skills.map((skill) => {
                const expanded = expandedId === skill.id;
                const picked = selectedIds.includes(skill.id);
                const row = [
                  h('input', {
                    key: 'check', type: 'checkbox', className: 'hss-check',
                    checked: picked,
                    'aria-label': translate(t, 'a11y.selectSkill', { name: skill.sourceName }),
                    onChange: (event) => selectSkill(skill.id, event.target.checked),
                  }),
                  h('div', { key: 'main', className: 'hss-item-main' },
                    h('div', { className: 'hss-item-name' },
                      skill.displayName || skill.sourceName),
                    skill.description
                      ? h('div', { className: 'hss-item-desc' }, skill.description)
                      : null,
                    h('div', { className: 'hss-item-meta' },
                      h('span', null, t('meta.instance') + ': ' + skill.instancePath),
                      h('span', null, translate(t, 'meta.files', { count: skill.files })),
                      h('span', null, formatBytes(skill.bytes)),
                      skill.renamed
                        ? h('span', null, translate(t, 'meta.renamed', { name: skill.dshName }))
                        : null,
                    ),
                  ),
                  h('div', { key: 'actions', className: 'hss-item-actions' },
                    statusBadge(skill),
                    h('button', {
                      type: 'button', className: 'hss-btn hss-btn-more',
                      'aria-label': translate(t, 'aria.moreActions', { name: skill.sourceName }),
                      'aria-expanded': expanded ? 'true' : 'false',
                      'aria-controls': 'hss-actions-' + skill.id,
                      onClick: () => toggleActions(skill.id),
                    }, h(IconMore), expanded ? t('btn.less') : t('btn.more')),
                  ),
                ];
                if (expanded) {
                  // Inline, so the panel is never clipped or mispositioned.
                  row.push(h('div', {
                    key: 'panel', id: 'hss-actions-' + skill.id,
                    className: 'hss-action-panel', role: 'group',
                    'aria-label': translate(t, 'a11y.actions', { name: skill.sourceName }),
                  },
                    h('button', {
                      type: 'button', className: 'hss-action-item',
                      onClick: () => {
                        setDialogError(null);
                        setDialogSkill(skill);
                      },
                    },
                      h('span', { className: 'hss-action-title' }, t('btn.openImport')),
                      h('span', { className: 'hss-action-hint' }, t('btn.openImportHint')),
                    ),
                    skill.renamed
                      ? h('div', { className: 'hss-action-note' },
                        translate(t, 'meta.renamed', { name: skill.dshName }))
                      : null,
                  ));
                }
                return h('li', { key: skill.id, className: 'hss-item' }, row);
              }),
            ),
          ));
        });
      }

      if (snapshot && snapshot.containers && snapshot.containers.length > 0) {
        children.push(h('div', { key: 'containers', className: 'hss-containers' },
          h('div', { className: 'hss-group-label' }, t('container.title')),
          h('p', { className: 'hss-item-desc' }, t('container.desc')),
          h('div', { className: 'hss-container-list' },
            snapshot.containers.map((c) => h('span', { key: c.key }, c.name))),
        ));
      }

      if (dialogSkill) {
        children.push(h(ImportDialog, {
          key: 'dialog',
          t,
          skill: dialogSkill,
          targets: projectTargets,
          busy,
          error: dialogError,
          projectPath: resolvedProjectPath,
          onSelectProject: setProjectPath,
          onPickDirectory: pickProjectDirectory,
          picking,
          pickError,
          onClose: () => {
            setDialogSkill(null);
            setDialogError(null);
            setPickError(null);
          },
          normalizeName,
          onToggleNormalize: setNormalizeName,
          onConfirm: (target) => runImport(dialogSkill, target),
        }));
      }

      if (batchOpen) {
        children.push(h(BatchImportDialog, {
          key: 'batch-dialog',
          t,
          count: batchCount,
          targets: projectTargets,
          phase: batchPhase,
          progress: batchProgress,
          report: batchReport,
          error: batchError,
          projectPath: resolvedProjectPath,
          onSelectProject: setProjectPath,
          onPickDirectory: pickProjectDirectory,
          picking,
          pickError,
          onClose: closeBatch,
          onRetry: retryFailed,
          onConfirm: (target) => {
            batchTargetRef.current = target;
            runBatch(selectedSkills, target);
          },
        }));
      }

      if (conflict) {
        children.push(h(ConflictDialog, {
          key: 'conflict-dialog',
          t,
          names: conflict.names,
          mode: conflict.mode,
          targetPath: conflict.targetPath,
          busy,
          error: dialogError,
          onClose: () => {
            setConflict(null);
            setDialogError(null);
          },
          onResolve: (resolved) => {
            setConflict(null);
            setDialogError(null);
            if (conflict.mode === 'single') {
              runImport(conflict.skills[0], conflict.target, resolved);
            } else {
              runBatch(conflict.skills, conflict.target, resolved);
            }
          },
        }));
      }

      return h('div', { className: 'hss-root' }, children);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // A throwing apply would take the whole slot entry down, so a failed
        // dictionary registration must not propagate.
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, DICT);
          } catch {
            return () => {};
          }
        });

        // `settings.section` renders its entries with only `{ close }`, so the
        // component resolves its own translator instead of reading `props.t`.
        // Subscribing to the locale snapshot keeps copy correct after a
        // language switch without relying on the shell to re-register.
        const subscribe = (callback) => ctx.locale.subscribe(callback);
        const getSnapshot = () => ctx.locale.getSnapshot();

        // The host folder picker lives on the optional `uiWorkspace` service.
        // Capture it once; the accessor dereferences at call time so a late
        // service mount still works. Soft-injected so its absence cannot keep
        // this plugin inactive.
        let pickDirectoryImpl = null;
        try {
          ctx.inject(['uiWorkspace'], (child) => {
            const service = child.uiWorkspace;
            if (service && typeof service.pickDirectory === 'function') {
              pickDirectoryImpl = () => service.pickDirectory();
            }
          });
        } catch {
          pickDirectoryImpl = null;
        }

        const requestDirectory = async () => {
          if (!pickDirectoryImpl) return null;
          const picked = await pickDirectoryImpl();
          if (typeof picked === 'string') return picked;
          if (picked && typeof picked.path === 'string') return picked.path;
          return null;
        };

        function Section(props) {
          useSyncExternalStore(subscribe, getSnapshot);
          return h(HermesSkillsSection, {
            t: ctx.locale.bind(NS),
            close: props ? props.close : undefined,
            // Forward the renderer standard hooks this section reads.
            useWorkspaces: props ? props.useWorkspaces : undefined,
            onPickDirectory: pickDirectoryImpl ? requestDirectory : null,
          });
        }

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'hermes-skills-sync',
          order: 26,
          label: () => ctx.locale.bind(NS)('meta.title'),
          locale: NS,
        }, Section));
      },
    };
  },
});

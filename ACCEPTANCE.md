# Hermes Skills Sync — 沙箱验收 + 安装报告

**被测插件**：`hermes-skills-sync` v1.0.0
**代码位置**：`<workspace>/hermes-skills-sync/hermes-skills-sync/`
**被测 DSH 版本**：0.2.1-rc.3（当前运行版本）
**验收结论**：**通过**。插件在隔离沙箱内安装、启动、扫描、导入全部正常，
未导致 DSH 崩溃，未污染真实 profile。

## 〇、已安装到真实 web profile（2026-10-26 19:26）

用户确认后执行 `plugin_manager install_bundle`，结果 `application: applied`，无 warnings。

| 项目 | 实测 |
|---|---|
| 依赖链接 | `link:<plugin-dir>` |
| 配置合成 | `--dump-config` 含 `id: hermes-skills-sync`（空 config） |
| Host API | `GET /api/hermes-skills-sync/snapshot` → 200，1 实例 / 266 skill / 239 ms |
| 设置页注册 | `settings.section` occupants 含 `id: hermes-skills-sync, order: 26, active: true` |
| Client bundle | boot graph 含本插件；`plugins/??hermes-skills-sync/client.js` → HTTP 200 / 38386 B |
| 进程健康 | PID 700358（端口 3080）安装后持续存活，无 uncaught/TypeError |
| 显示元数据 | `locale/zh.json` 标题「Hermes 技能同步」；`icon.svg` 899 B 有效 |
| 配置备份 | `~/.dsh/profiles/web/.hss-backup-20261026-192618/`（package.json + cordis.patch.yml） |

**回滚方式**：
```bash
dsh plugin --profile web remove hermes-skills-sync
# 或从备份恢复：
cp ~/.dsh/profiles/web/.hss-backup-20261026-192618/{package.json,cordis.patch.yml} ~/.dsh/profiles/web/
```

### 使用前必须知道的一件事

真实 web profile 中 **`skill-filesystem` 与 `tool-skill` 均为 `disabled: true`**
（当前会话的 skill 由 `openviking-skills` 提供）。本插件把 skill 写入
`$DSH_HOME/skills/`（即 `skill-filesystem` 的 `user-dsh` 根，rank 400），
因此**在启用这两个 provider 之前，导入的 skill 不会出现在 DSH 技能列表里**。
这是宿主默认配置，插件本身不修改它。

## 一、沙箱隔离方案

| 隔离维度 | 真实环境 | 沙箱 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | `/tmp/hss-sandbox/dshhome` |
| `HOME` | `<user>` | `/tmp/hss-sandbox/home` |
| profile | `web`, `headless` | `hssweb`, `hsshead`, `hss-test` |
| Hermes 源 | `~/.hermes` | 经 `DSH_HERMES_HOME` 指向真实安装（**只读**） |

沙箱 profile 必须用 `dsh plugin --profile add` 创建；`web` 是 shipped 名称，
不能作为 `--from-default-profile` 的目标，故用 `hssweb` 命名。

## 二、验收用例与结果

### 安装与兼容（需求 6：不崩溃）

| # | 用例 | 判据 | 结果 |
|---|---|---|---|
| P1 | bundle 安装 | `dsh plugin --profile hssweb add` 成功 | ✅ |
| P2 | 配置合成 | `--dump-config` 出现 `id: hermes-skills-sync` | ✅ |
| P3 | **web profile 启动** | 进程存活 17s+，日志无 uncaught/TypeError | ✅ |
| P4 | 无 `did not activate` 告警 | 插件正常激活 | ✅ |
| P5 | Client bundle 服务 | `/plugins/??hermes-skills-sync/client.js` → HTTP 200，37 KB | ✅ |
| P6 | boot graph 注册 | index HTML 的 client graph 含本插件条目 | ✅ |
| P7 | 真实 profile 零污染 | `~/.dsh/skills` 不存在；`~/.dsh/profiles` 仍为 headless/web | ✅ |

### 发现与识别（需求 1、2、3）

| # | 用例 | 实测结果 | 结果 |
|---|---|---|---|
| P8 | 识别本机 Hermes | 1 个实例：`<user>/.hermes`（`default` 来源） | ✅ |
| P9 | 区分主 agent 与 Profile | `main`=74、`novelist`=43、`opc`=68、`quant-engine`=81，共 **266** | ✅ |
| P10 | 名称与功能描述 | 266 个 skill 全部解析出 description（含中文、YAML 块标量、`>` 折叠） | ✅ |
| P11 | 分类目录识别 | 10 个分类容器（`creative`/`github`/`mcp`…）不误判为 skill | ✅ |
| P12 | 扫描性能 | 266 skill / 4 分组 **120–220 ms** | ✅ |
| P13 | 多路径识别能力 | 单元测试构造两个 Hermes home（`~/.hermes` + `~/.config/hermes`）均被发现 | ✅ |

### 导入（需求 4：两级操作）

| # | 用例 | 实测结果 | 结果 |
|---|---|---|---|
| P14 | 导入为**全局** | `~/.dsh/skills/brainstorming/`，9 个文件完整复制 | ✅ |
| P15 | 导入为全局（中文名） | `量化引擎` → `skill-b0b100bb`，SKILL.md `name:` 同步改写 | ✅ |
| P16 | 导入至**指定项目** | `<projectRoot>/.dsh/skills/amazon-scraper/` | ✅ |
| P17 | DSH 命名合规 | 导入目录名均匹配 `^[a-z0-9]+(-[a-z0-9]+)*$` | ✅ |
| P18 | 端到端被 DSH 加载 | headless agent 实际回答出 `brainstorming` 与 `skill-b0b100bb` | ✅ |
| P19 | 冲突处理 | 二次导入返回 `error.conflict`；`overwrite` 正确替换 | ✅ |
| P20 | 失败原子性 | 源不存在返回结构化失败，**不留半成品临时目录** | ✅ |

### 单元测试

| 文件 | 覆盖 | 结果 |
|---|---|---|
| `test-host.mjs` | 多实例发现、主/Profile 分离、分类目录、frontmatter（含块标量）、名称映射、全局/项目导入、冲突、失败原子性、越界写入 | **34/34 通过** |
| `test-client.mjs` | bundle 形状、inject 声明、slot 注册、locale 注册、组件渲染、CSS 纯 token、响应式断点、底部抽屉、API 接线、无障碍标签 | **25/25 通过** |

运行：`cd hermes-skills-sync && npm test`

## 三、过程中发现并修复的真实缺陷

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| D1 | `ctx.workspaceRegistry?.list?.()` 抛错 | Cordis 对未声明属性**抛异常**而非返回 undefined，`?.` 无效；API 500 | 改为 try/catch 探测，缺失时降级为"仅全局导入" |
| D2 | 客户端依赖 `props.t` | `settings.section` 实际只传 `{ close }`，`props.t` 为 undefined → **组件渲染崩溃、整块设置页空白** | 组件内部 `ctx.locale.bind(NS)` 自解析，并用 `useSyncExternalStore` 订阅 locale 快照 |
| D3 | `locale.register` 可能抛错 | 重复注册会抛，整个 `apply` 失败导致 slot 不注册 | 包在 try/catch 中，失败时返回空 disposer |
| D4 | 硬依赖 `workspaceRegistry` | headless 等无该服务的 profile 会让插件 pending | 从 `inject` 移除，改为运行时探测 |

### 用户实机反馈后修复（v1.0.1）

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| D5 | 无 Profile 筛选 | 无法按 Hermes profile 过滤，266 个 skill 混在一起 | 新增 `<select>` 筛选器，选项由快照中的 group 动态生成（全部 Profile / 主 agent / novelist / opc / quant-engine） |
| D6 | **「更多」点击无反应** | 菜单用 `position: absolute` + `getBoundingClientRect()` 视口坐标，在设置面板滚动容器内被裁剪/错位，用户看不到任何变化 | 改为**行内展开**：操作面板作为 `flex-basis: 100%` 的行内子元素渲染，不再依赖浮层定位；`<li>` 改 `flex-wrap: wrap` 容纳整行面板 |
| D7 | 主 agent 分组徽章错误显示 "Profile" | 两个分支写了同一文案 `t('meta.profile')` | 移除冗余徽章，分组标题直接表达归属（`主 agent` / `Profile：<名>`） |

**D6 的教训**：在插件 UI 里做浮层菜单，不能假设 `position: absolute` + 视口坐标可用 —— 设置面板内容列是有 `overflow` 的滚动容器，浮层会被裁掉。行内展开既规避了定位问题，也天然适配窄屏，比 portal 方案更稳。

## 三之二、v1.0.1 交互验收（无头模拟点击）

测试脚手架升级为**可交互**：per-component hook 状态 + 重渲染，能真实模拟点击并断言 DOM 变化。

| 断言 | 结果 |
|---|---|
| 每行渲染「更多」按钮，且 `aria-expanded="false"` | ✅ |
| 点击「更多」→ 行内操作面板展开 | ✅ |
| 展开后按钮翻为 `aria-expanded="true"` | ✅ |
| 面板提供「导入到 DSH」并说明「复制完整 skill」 | ✅ |
| 点击该动作 → 导入弹窗出现 | ✅ |
| 弹窗为 `role="dialog" aria-modal="true"` | ✅ |
| 弹窗恰好提供两个目标：全局 / 指定项目 | ✅ |
| 选「指定项目」→ 列出已注册项目及路径 | ✅ |
| CSS 中不含 `position: absolute` 的操作面板、不含 `.hss-menu` | ✅ |
| Profile 筛选控件存在、有 aria-label、含"全部"选项 | ✅ |

**Client 51 项、Host 34 项全部通过。**

## 三之三、v1.1.0 批量多选导入

266 个 skill 逐个点不现实，故新增批量能力。

### 交互设计

| 能力 | 实现 |
|---|---|
| 单条勾选 | 每行左侧 `<input type="checkbox">`，带 `aria-label`（"选择 {name} 以便批量导入"） |
| 组内全选 | 每个分组标题右侧「全选本组」链接按钮 |
| 当前结果全选 | 工具栏「全选」，作用于**当前筛选后的可见集合**（与搜索 / Profile 筛选叠加） |
| 选择栏 | 选中后出现在列表上方：`已选 N 个` + 隐藏项提示 + 清空 + 批量导入 |
| 目标选择 | 复用二级弹窗语义：**导入为 DSH 全局 skills** / **导入至 DSH 指定项目** |
| 进度反馈 | `role="progressbar"` + `aria-valuenow`，按 8 个一批推进，不冻结 UI |
| 结果报告 | 完成态汇总「新增 x / 替换 y / 失败 z」，失败项列表（最多 20 条）|
| 失败重试 | 仅对失败项重试，沿用上次目标 |
| 选择清理 | 成功的自动移出选择，失败的保留，便于直接重试 |

### 并发与安全

- **Host 批量端点** `POST /import-batch`：单次上限 **500** 项，服务端并发 **4**；每项独立复制，单项失败不中断整批。
- **原子性**：沿用「临时目录 → rename」策略，混合批处理后无残留 staging 目录（测试断言）。
- **冲突策略**：批量固定 `overwrite`，报告中区分「新增 / 替换」并提示"已存在的同名 skill 会被替换"。

### 关键工程决策：Host 与 Client 的更新节奏不一致

实测发现 `/import-batch` 在已运行的进程中返回 **404** —— **Host 模块只在进程启动时加载，Client bundle 才会热更新**。所以刚更新的插件会遇到「新 Client + 旧 Host」。

因此 Client 实现了**降级路径**：捕获 404 后退化为「并发 4 的单条 `/import`」，并组装成与批量端点相同的报告结构。

- **不需要重启**：批量导入立即可用
- **重启后自动加速**：走单次请求的服务端并发路径

已验证降级路径真实可用：3 个 skill 并发导入临时项目，中文名（`中国宏观消费市场数据采集` → `skill-ad9940d2`、`李大霄战略` → `skill-be4b5c0b`）正确重命名且目录合规。

### 测试覆盖

Client **75 项** / Host **46 项**，其中批量相关：

- 每行复选框存在、有 aria-label、初始未选
- 每组「全选本组」存在
- 勾选后选择栏出现并显示正确计数
- 工具栏全选选中所有可见项
- 批量导入按钮打开弹窗，标题含数量
- 确认后调用 `/import-batch`，载荷含全部选中项与目标 scope
- 完成后显示汇总、成功项移出选择、行显示「已导入」
- **404 时降级为单条导入且仍产出汇总**
- Host：三项全成功 / 重复导入报替换 / 单项失败不中断 / 失败留原因码 / 无残留 staging / 项目目标可用

## 三之四、v1.2.0 修复「指定项目无列表」

### 症状
选择「导入至 DSH 指定项目」时永远显示「尚未注册任何项目」，无法选任何项目。

### 根因（两层）

| 层 | 问题 |
|---|---|
| **Host** | `workspaceRegistry` 曾被从 `inject` 移除（为了消除 headless 的 pending 警告）。Cordis 读取**未声明的服务会直接抛异常**，而 `listProjectTargets` 的 try/catch 把这个异常吞成了空数组 —— 于是真实存在的 **6 个工作区全部丢失** |
| **更新节奏** | 即使修复 Host，**Host 模块只在进程启动时加载**，运行中的进程仍返回空；而 Client bundle 会热更新。修复后用户仍会看到空列表，直到重启 |

### 修复

1. **Host**：`inject = ['webServer', 'workspaceRegistry']`。`Workspace` 实体字段确认为 `{ id, path, title, sessionIds, createdAt, updatedAt }`，映射时补充 `sessions` 计数；无 `path`、相对路径、空标题均有正确降级。保留 try/catch 作为「registry 无 `list()`」的防御。
2. **Client（关键）**：改用渲染器为每个 slot 提供的标准 hook `useWorkspaces`（类型 `SnapshotSelectorHook<WorkspaceSnapshot>`，`WorkspaceView` 用 `workspaceId`）。Client 直接读本地工作区投影，**不依赖 Host 是否重启**；Host 列表仅作兜底。
3. **兜底能力**：项目步骤新增「选择其他目录…」，通过软注入的 `uiWorkspace.pickDirectory()` 调起宿主目录选择器。**即使注册表为空也不是死胡同**。
4. 空状态文案从「请先在 DSH 中打开一个项目」改为「尚未注册项目，但你仍可以直接选择目录」。

### 实测数据（本机真实工作区）

| 标题 | 路径 | 会话数 |
|---|---|---|
| 示例工作区 | `<workspace>` | 16 |
| 示例写作 | `<workspace>/写作` | — |
| 示例项目 | `<workspace>/电子工程/Ai台灯` | — |
| 示例插件目录 | `<workspace>/hermes-skills-sync` | — |
| 示例用户 | `<user>` | — |
| 示例资讯项目 | `<workspace>/每日资讯采集与证券分析` | — |

### 测试

Host **54** 项 / Client **96** 项。新增覆盖：

- Workspace 实体字段映射、丢弃无 path / 相对路径、空标题回退为路径、会话计数
- `inject` 确实声明了 `workspaceRegistry`
- registry 无 `list()` / 访问抛异常时都降级为空数组而不崩
- 有工作区时列出标题、路径、注册数、会话数，且**不显示空状态文案**
- 空注册表时显示兜底文案并**仍提供目录选择器**
- 目录选择器：点击会请求宿主、选中后展示路径、确认按钮从 disabled 变 enabled、请求体携带该路径
- **Host 报空时 Client 仍能显示工作区**（模拟未重启的真实情形）

## 三之五、v1.3.0 保持原名 + 冲突处理

### 需求
导入时**不得修改 skill 名称**；目标已存在同名 skill 时，提示用户选择**覆盖或重命名**。

### 先验证 DSH 到底校验什么（决定性实验）

构造三个 skill 放进 `$DSH_HOME/skills/`，用 headless 会话问 agent 实际看到了哪些：

| 用例 | 目录名 | frontmatter `name:` | 结果 |
|---|---|---|---|
| A | `中文目录测试` | `zh-dir-test` | ✅ **被加载** |
| B | `valid-dir` | `中文名称` | ❌ **被静默丢弃** |
| C | `wrong-folder` | `actual-name` | ✅ 被加载（目录名与声明名可不同） |

对应源码 `dsh-skill-filesystem/lib/index.js:688`：

```js
if (!isSkillName(name)) {
  ctx.logger.warn(`skill file ${path} ignored: invalid skill name "${name}"`);
  return;   // 整个 skill 被丢弃
}
```

**结论**：DSH 只校验 SKILL.md 的 frontmatter `name:`，**从不校验目录名**。所以「目录保持原名」完全可行（中文目录名没问题），只有 `name:` 字段受 kebab-case 约束。

### 实现

| 行为 | 实现 |
|---|---|
| **目录名 = 原名，绝不改名** | `folderNameFor()` 仅替换路径分隔符/控制字符、给前导 `.` 加前缀，其余原样保留（中文、空格、括号全部不变） |
| frontmatter 兼容 | 仅当 `name:` 不合法时，**可选地只改写这一行**；原值以 `# original-name: …` 注释保留 |
| 用户可见性 | 导入对话框明示「目录名（保持原名）：量化引擎」，并对不合法项显示警告 + 开关 + 加载结果预测 |
| **冲突提示** | 导入前调用 `POST /conflicts`；命中则弹出冲突对话框：**覆盖 / 重命名（可输入新名）/ 跳过**，绝不静默覆盖 |
| 批量冲突 | 批量同样先检测；命中选择整批策略：**全部覆盖 / 全部重命名（自动追加 -2/-3）/ 全部跳过** |

### 沙箱端到端验证（新 Host 代码）

```
导入 量化引擎 → 目录: 量化引擎/          frontmatter name: skill-b0b100bb  willLoad=true
/conflicts   → {量化引擎: exists=true, 李大霄战略: exists=false}
rename 我的量化引擎 → 目录: 量化引擎/ + 我的量化引擎/
```

再对沙箱全局目录跑 headless：磁盘上是 `量化引擎`、`李大霄战略`、`brainstorming` 三个中文/原名目录，
agent 实际加载出 `brainstorming`、`skill-b0b100bb`、`skill-be4b5c0b` —— **中文目录 + 兼容化 frontmatter 可正常加载**。

### ⚠ 一个必须知情的取舍

DSH 的技能目录用 frontmatter `name:` 作为标识符，**不读取 `display_name`**。因此：

- **纯中文名 skill**（`量化引擎` 等 16 个）：磁盘目录保持 `量化引擎`，但 DSH 技能列表里显示的是 `skill-b0b100bb`。
- 若选择「不改写 frontmatter」，DSH 会**完全忽略**该 skill（不会出现在任何列表里）。

默认开启兼容化（skill 可用），可关闭以获取逐字节一致的副本。两者都在导入对话框中明确展示。

### 测试

Host **72** 项 / Client **118** 项。新增覆盖：目录名保持中文原名、路径分隔符替换、空名与隐藏名兜底、声明名合法性判定、仅改写 name 并保留原值注释、opt-out 保持字节一致并如实报告 `willLoad=false`、冲突检测（存在/不存在/根目录缺失）、rename 保留原目录、skip 不动原目录、冲突对话框三选项、重命名默认值与校验、请求体携带 `onConflict`/`renameTo`/`normalizeDeclaredName`/原始 `sourceName`。

## 四、设计要点

- **响应式**：`<768px` 列表行纵向堆叠 + 弹窗变底部抽屉；`768–1100px` 描述放宽到 3 行；
  `≥1100px` 常规列表。768 阈值确保 1280px 屏 200% 缩放（≈640 CSS px）落在卡片形态，
  不产生横向滚动条。触控目标 ≥28–30px。
- **主题**：17 个 `--dsw-alias-*` token，**逐个与主题包 107 个真实 token 比对，0 缺失**；
  无硬编码色值（测试断言）；明暗主题由宿主 `data-ds-dark-theme` 切换，插件自适应。
- **无障碍**：`role="dialog"` + `aria-modal`、焦点陷阱、Escape 关闭、焦点归还触发元素、
  `aria-haspopup`/`aria-expanded`、搜索框 `aria-label`、状态用 `role="status"`/`alert`。
- **中文名策略**：纯 CJK 名走确定性哈希 slug（`skill-<sha256前8位>`），并用
  `display_name` 保留原名；导入前在 UI 明示"将导入为 xxx"。

## 五、已知限制（需用户知悉）

1. **`skill-filesystem` 在 web profile 中默认 `disabled: true`**。本插件写入的
   `$DSH_HOME/skills/` 正是其 `user-dsh` 根（rank 400），但**需启用该 provider 行**
   DSH 才会加载这些 skill。P18 通过 `--patch` 临时启用完成验证。这是宿主默认配置，
   非本插件缺陷。
2. `projectTargets` 依赖 `workspaceRegistry`；缺失时降级为仅全局导入（不崩溃）。
3. **视觉未在运行中的浏览器实机验证**：Client inspect 的 `Theme.listTokens` 已可查询，
   但本会话未在页面上实际点击操作。已完成的是：bundle 被正确服务 + 25 项无头渲染断言
   + 真实 token 比对。安装后建议在设置页目视确认。
4. 弹窗使用 `position: fixed` 覆盖层；若未来设置面板祖先元素引入 `transform`/`filter`，
   固定定位会相对该祖先，需改为 portal。

## 六、安装方式（用户确认后再执行）

```bash
dsh plugin --profile web add "<workspace>/hermes-skills-sync/hermes-skills-sync"
```

安装后：设置 → **Hermes 技能同步**。若要让导入的 skill 被 DSH 真正加载，
需在自己的 patch 层启用 `skill-filesystem`（插件不改宿主配置）。

## 七、复现沙箱

```bash
SB=/tmp/hss-sandbox
rm -rf "$SB" && mkdir -p "$SB/home" "$SB/dshhome"
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR \
  DSH_HOME="$SB/dshhome" HOME="$SB/home" \
  dsh --profile hssweb --from-default-profile web --dump-config
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR \
  DSH_HOME="$SB/dshhome" HOME="$SB/home" \
  dsh plugin --profile hssweb add "<workspace>/hermes-skills-sync/hermes-skills-sync"
env -u DSH_HOME -u DSH_PROFILE -u DSH_PROFILE_DIR \
  DSH_HOME="$SB/dshhome" HOME="$SB/home" DSH_HERMES_HOME="$HOME/.hermes" \
  timeout 45 dsh --profile hssweb --port 3099 --no-open
curl -s http://127.0.0.1:3099/api/hermes-skills-sync/snapshot
```

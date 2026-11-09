# Hermes Skills 同步器 — 前端技术方案

> 版本 v1.0 ｜ 状态：技术方案（**未安装、未实现**）
> 目标运行时：DeepSeek Harness `0.2.1-rc.3` ｜ 插件形态：Cordis bundle（Host + Client）
> 文档日期：2026-10-26

---

## 0. 事实基线与核验方式

本方案的**每一个 API 名称**都来自下列两个来源之一，文中逐处标注：

| 来源 | 获取方式 | 用途 |
|---|---|---|
| **A — 运行时 Inspect** | `cordis_inspect_query`（`Service` / `Event` / `Config`） | Host Service 方法签名、Remote 契约 |
| **B — 已装包源码** | `node_modules/@deepseek-ai/*/lib/**`（含 `*.d.ts`） | Client 侧 API、slot key、主题 token 真实名 |

> ### ⚠️ 核验缺口声明（必须先补）
>
> **Client 侧 Inspect 通道在本机全程不可用**：`cordis_inspect_query` 对 `Slots.listSubTree`、`Theme.listTokens`、`Builtin.listBuiltins` 三者均失败，
> 错误信息先为 `Client inspect query ... timed out after 10000ms`，重试后变为
> **`Client inspect query Slots.listSubTree has no connected Harness page. Open or reconnect the Harness page, then retry.`**
> 直接原因是 Web GUI `http://127.0.0.1:3080` 返回 **HTTP 401**（浏览器无已认证会话），而 Host 进程 `node .../dsh --profile web` 正常运行。
>
> 因此本方案中所有 **Client 侧**事实（slot key 列表、`--dsw-alias-*` token 名、locale API、remote 调用签名）**改由来源 B 从已装包的构建产物中提取**，而非 Inspect。来源 A 的 Host 侧结果全部实测成功。
>
> **待补动作**：打开 `http://127.0.0.1:3080` 完成登录后，重跑
> `cordis_inspect_query { platform: "client", provider: "Slots", method: "listSubTree" }` 与
> `{ platform: "client", provider: "Theme", method: "listTokens" }`，
> 用实况 slot 树校验 §5.1 的 slot 选择、用实况 token 清单校验 §5.4 的 token 集。
> 在此之前，§5 的 Client 侧结论均为**源码级推定**，须经实况复核后才能进入实现。

---

## 1. 文件清单与职责

插件包目录：`<workspace>/hermes-skills-sync/hermes-skills-sync/`

| 文件 | 半 | 职责 | 本方案状态 |
|---|---|---|---|
| `package.json` | 双 | Bundle 清单：`dsh.bundle.patch` → patch，`dsh.client` 段声明 `platform`/`immediately`/`inject`，`exports` 含 `./client` | 已复制，待改 |
| `cordis.patch.yml` | Host | Loader patch：插入 1 行 Host 插件 + 依赖行 | 已复制，待改 |
| `index.js` | Host | `export function apply(ctx, config)`：发现 Hermes 实例、注册 Remote 服务 | 已复制，待写 |
| `client.js` | Client | `window.__ModuleLoader__.load()`：注册 React 组件进 slot | 已复制，待写 |
| `locale/en.json` | 双 | Host/Client 展示元数据（`meta.title` / `meta.description`） | 已复制，待改 |
| `locale/zh.json` | 双 | 中文文案（`ctx.locale.register` 的字典） | 待建 |
| `icon.svg` | 双 | 插件图标（原创，64×64） | 已复制，待改 |

> 模板 6 个文件已从
> `.../dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/`
> 逐个用 read 工具读取后 `cp` 到工作区，并用 `cmp` 验证与模板**逐字节相同**。

### 1.1 建议的模块拆分（实现阶段）

模板只有 2 个 JS 文件。实现规模上去后建议在包内拆分（`package.json` 的 `exports` / `files` 同步扩展）：

```
hermes-skills-sync/
├── index.js              # Host 入口：apply(ctx, config)
├── hermes/discover.js    # 纯函数：目录遍历 + frontmatter 解析 + 分类
├── hermes/frontmatter.js # YAML frontmatter 解析（不引第三方 YAML 依赖）
├── hermes/slug.js        # 确定性 slug 规则（中文 → pinyin）
├── hermes/remote.js      # @Remote 服务类（TypertRemoteService 子类）
├── client.js             # Client 入口：ModuleLoader.load
├── client/Tree.jsx       # 左侧来源树
├── client/SkillList.jsx  # 右侧 skill 列表（虚拟化）
├── client/ScanDialog.jsx # 扫描进度 + 导入对话框（焦点陷阱）
├── client/theme.css      # 仅 var(--dsw-alias-*) 引用
```

---

## 2. 插件清单与 patch

### 2.1 `package.json`

基于已复制的模板改动三处：包名、`dsh.client.inject` 列表、`exports`/`files`。

```json
{
  "name": "hermes-skills-sync",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["slots"]
    }
  }
}
```

**`dsh.client.inject` 的取值依据**：模板原文为 `["@deepseek-ai/dsh-client-ui-conversation"]`，那是因为模板要挂 `conversation.composer.dock`。本插件改为挂 `main` / `sidebar.panellist`（见 §5.1），**不再依赖 conversation 包**。而 `slots` 是必需的服务注入——`references/ui-plugin.md` 明确写 "`templates/decoration/client.js` registers a lazy factory into `conversation.composer.dock` through `ctx.slots.inject` and `ctx.slots.register`"，且模板 `client.js` 的工厂体第一行就是 `inject: ['slots']`。

> `dsh.client.inject` 条目只影响激活顺序，不会加载 Harness Client 包（`practices.md` §UI 明确允许）。本方案**不引入** `@deepseek-ai/dsh-client-ui-primitives` 等任何 Harness Client 包。

### 2.2 `cordis.patch.yml`

Loader patch 方言来自 `cordis-composition-reference` skill。插入一行 Host 插件：

```yaml
- insert:
    - id: hermes-skills-sync
      name: 'hermes-skills-sync'
```

若 Host 侧需要 `skills` / `workspaceRegistry` / `fs` 服务，用 `inject` 声明而非硬依赖（`practices.md` §Performance 第 4 条 / §Principles 第 4 条：可选服务放 `inject`，插件在缺少该服务的 profile 里保持不激活而不是抛错）：

```yaml
- insert:
    - id: hermes-skills-sync
      name: 'hermes-skills-sync'
      inject:
        - skills
        - workspaceRegistry
```

### 2.3 `locale/en.json` / `locale/zh.json`

`locale/en.json` 的 `meta` 段是插件在插件管理页显示的标题与描述（模板原文只含 `title`/`description` 两键）。中文文案走 Client locale service 的**字典**机制（`ctx.locale.register(NS, { zh, en })`），与 `meta` 是两条独立通道：

```json
// locale/en.json —— 插件管理页展示元数据
{
  "meta": {
    "title": "Hermes Skills Sync",
    "description": "Discover Hermes agent skills on this machine and import them into DSH's native skill registry."
  }
}
```

Client 字典（写在 `client.js` 内，与 `dsh-client-ui-plugin-manager` 的做法一致——它在 `client.js` 内定义 `const zh = {...}` / `const en = {...}` 两个对象，再 `ctx.locale.register(NS, { zh, en })`）。

---

## 3. Host 半：`index.js`

### 3.1 入口与职责

```js
export function apply(ctx, config) {
  // 1) 发现 Hermes 实例（配置 + 磁盘探测）
  // 2) 注册 @Remote 服务，供 Client 调用
  // 3) 可选：注册一个 SkillProvider（Provider 模式，见 §3.6）
}
```

Host 侧**只做**触及文件系统、权限与真实状态的判断；Client 永远不推断导入结果（IA §6.1）。

### 3.2 Host 侧扫描实现 —— 本机实测结构

实测命令与结论（本机 `~/.hermes`）：

| 探测项 | 实测结果 | 证据 |
|---|---|---|
| 主 agent skills 根 | `~/.hermes/skills/`（57 个非隐藏目录） | `ls ~/.hermes/skills/` |
| Profile skills 根 | `~/.hermes/profiles/{novelist,opc,quant-engine}/skills/` | `ls ~/.hermes/profiles/` |
| `~/.config/hermes` | **存在**，但只有 `feishu/` 子目录，**无 `skills/`** | `ls ~/.config/hermes/` |
| `/opt/hermes`、`/usr/local/hermes` | **不存在** | `[ -d ]` 检查 |
| PATH 中的 `hermes` | `~/.local/bin/hermes` → shell 脚本 → `exec ~/.hermes/hermes-agent/.hermes/bin/hermes "$@"` | `cat ~/.local/bin/hermes` |
| 顶层真实 skill（有 `SKILL.md`） | **39** 个 | `find -maxdepth 2 -name SKILL.md` |
| 顶层目录总数 | **61**（含 `.archive` 等隐藏目录），**57** 非隐藏 | `find -maxdepth 1 -type d` |
| 分类目录（无 `SKILL.md`） | **18** 个（10 个含嵌套 skill + 8 个叶子目录） | `for d in */; do [ ! -f "$d/SKILL.md" ]`（排除 `.` 开头） |
| 嵌套 skill 总数 | **74** 个（`find -name SKILL.md -not -path '*/.*'`） | 递归 |
| 嵌套深度 | 至少 **3 层**：`autonomous-ai-agents/hermes-agent/SKILL.md` | `find -maxdepth 3` |
| `.zip` 形态 | `profiles/novelist/skills/铁蛋作家.zip`、`novelist-writer（刚刚构建好时）.zip` | `ls profiles/novelist/skills/` |
| 隐藏元数据 | `.archive` `.bundled_manifest` `.curator_ledger.jsonl` `.curator_state` `.curator_suppressed` `.usage.json` `.usage.json.lock` | `find -maxdepth 1 -type f` |

**三种 skill 形态**（实测确认，直接决定分类算法）：

| 形态 | 判定依据 | 实测样例 | 处理 |
|---|---|---|---|
| **目录型** | 目录内含 `SKILL.md` | `brainstorming/SKILL.md` | 正常解析 |
| **分类目录** | 目录内**无** `SKILL.md`，但有子目录含 `SKILL.md` | `github/` → `github-auth/`、`github-code-review/` | 作为**分组**，标题取 `DESCRIPTION.md` 首行 |
| **单文件型** | `*.md` 文件（非 `SKILL.md`） | Hermes 中**当前未发现**；DSH 侧支持（`dsh-skill-filesystem` 的 `discoverRoot` 认 `entry.type === "file" && entry.name.endsWith(".md")`） | 按 DSH 规则兼容 |
| **压缩包型** | `*.zip` | `铁蛋作家.zip` | 标为 `unsupported`，**不产生导入按钮** |

**⚠️ 分类目录必须再分两类**（实测得出，IA 文档未区分，直接影响 UI 正确性）：

| 类别 | 判定 | 实测 | UI 语义 |
|---|---|---|---|
| **嵌套分类目录** | 无 `SKILL.md`，但有子目录含 `SKILL.md` | **10** 个：`autonomous-ai-agents`(3) `creative`(6) `devops`(4) `github`(7) `mcp`(2) `mlops`(1) `productivity`(3) `research`(2) `self-discipline`(1) `software-development`(2) | 分组，可展开、可导入其子 skill |
| **叶子分类目录** | 无 `SKILL.md`，无子 skill，仅有 `DESCRIPTION.md` 或散落资源 | **8** 个：`apple` `email` `media` `note-taking` `smart-home` `social-media` `web`（均为 `DESCRIPTION.md`）+ `rockchip-tvbox-linux-flash`（仅 `references/`） | **分组标题可读，但组内无可导入 skill** |

> 若把这 8 个叶子目录当成"普通 skill"渲染，用户点进去会看到一个**空列表**（IA §0 约束 C 的原话）。
> 正确处理：**不产生可勾选的 skill 行**，但**可以**作为只读分组展示其 `DESCRIPTION.md` 标题
> （例如 `apple` 的 "Apple / macOS skills — tools that interact with the Mac desktop (Finder, native apps) or system features (accessibility, screenshots)."），
> 并标注"此分组当前无独立 skill"。

### 3.3 frontmatter 解析（实测样例）

实测 `~/.hermes/skills/brainstorming/SKILL.md`：

```yaml
---
name: brainstorming
description: "在任何创造性工作之前必须使用此技能——创建功能、构建组件、添加功能或修改行为。在实现之前先探索用户意图、需求和设计。"
version: "1.0.0"
license: MIT
metadata:
  hermes:
    tags: [design, planning]
---
```

实测 `~/.hermes/skills/github/github-code-review/SKILL.md`：

```yaml
---
name: github-code-review
description: "Review PRs: diffs, inline comments via gh or REST."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  ...
---
```

**与 DSH 的一致性约束**（`dsh-skill-filesystem/lib/index.js` 的 `parseSkillFile`，行 667+）：

```js
const name = stringField(parsed.data, "name");
const description = stringField(parsed.data, "description");
if (name === void 0 || description === void 0) {
  ctx.logger.warn(`skill file ${path} ignored: frontmatter requires name and description`);
  return;                                   // 两者必须同时存在
}
if (!isSkillName(name)) {
  ctx.logger.warn(`skill file ${path} ignored: invalid skill name "${name}"`);
  return;                                   // 必须匹配 SKILL_NAME 正则
}
```

`isSkillName` 的正则在 `dsh-skill/lib/index.js:17`：

```js
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
```

→ **本机 15 个中文名 skill 无法直接导入**（主目录 7 个：`量化引擎`、`李大霄战略`、`财经资讯采集分析选股`、`通达信金融数据专家`、`全能金融爬虫`、`中国宏观消费市场数据采集`、`蒸馏版量化交易系统`；`novelist` 1 个：`铁蛋作家`；`quant-engine` 7 个同主目录）。必须 slug 化。

**`parseSkillFile` 未导出**（`grep` 确认 `dsh-skill-filesystem/lib/index.js` 无 `export { parseSkillFile }`），因此**不能直接复用**。可行路径有两条：

1. **自实现解析**（推荐）：Host 半写一个 ~60 行的 frontmatter 解析器，只取 `name` / `description` / `version` / `metadata.hermes.tags`，不引 YAML 依赖（手写最小解析：取首行 `---` 到下一个 `---` 之间的键值对，支持引号值与 `key: [a, b]` 内联数组）。
2. **调用 `ctx.skills.get()`**：把 Hermes 目录注册为 Provider（§3.6），由 DSH 自己解析。**但这要求 name 合法**，中文名在 Provider 层就被 `isSkillName` 拒绝、根本进不了目录 → 无法用于"发现并提示需改名"。所以 Provider 模式**不能替代**扫描器。

→ 结论：**扫描器自实现解析**，并与 `parseSkillFile` 的判定规则保持一致（name+description 必须同时存在、name 必须匹配 `SKILL_NAME`），但**不因 name 非法而丢弃**，而是标记 `needsRename` 并继续（IA 约束 B）。

### 3.4 扫描发现算法伪代码

```pseudo
function discoverInstances(config, fs) -> HermesInstance[]
  roots := []
  # 1. 配置显式指定
  for each p in config.paths:  roots.push({ id: hash(p), path: p, origin: "config" })
  # 2. 固定候选路径
  HOME := os.homedir()
  for p in [HOME+"/.hermes", HOME+"/.config/hermes", "/opt/hermes", "/usr/local/hermes"]:
      roots.push({ id: hash(p), path: p, origin: "wellknown" })
  # 3. PATH 中的 hermes 可执行文件 → 反推 home
  for dir in PATH.split(":"):
      exe := dir + "/hermes"
      if fs.isExecutable(exe):
          # 实测：~/.local/bin/hermes 是 shell 脚本，内容形如
          #   #!/bin/sh
          #   exec <user>/.hermes/hermes-agent/.hermes/bin/hermes "$@"
          # → 正则提取真实安装根
          real := readText(exe)
          if m := real.match(/hermes-agent\/(?:\.hermes\/bin\/)?hermes/):
              roots.push({ id: hash(dir), path: dirOf(m[0]), origin: "path" })
  # 4. 去重 + 存在性过滤（按 realpath 去重，避免同一实例被算两次）
  return uniqueBy(realpath(roots)).filter(exists)


function scanInstance(instance, fs) -> HermesScanResult
  scopes := []
  # 主 agent
  scopes.push(scanScope({ id:"main", label:"Main agent",
                           dir: instance.path + "/skills", kind:"main" }))
  # profiles
  for each p in listDir(instance.path + "/profiles"):     # 排除 . 开头条目
      if p.type == "directory":
          scopes.push(scanScope({ id: p.name, label: p.name,
                                   dir: instance.path + "/profiles/" + p.name + "/skills",
                                   kind:"profile" }))
  return { instance, scopes }


function scanScope(scope, fs) -> HermesScopeResult
  entries := listDir(scope.dir)
  skills := [] ; groups := [] ; unsupported := []
  for e in entries:
      if e.name startsWith ".":  continue            # .archive .curator_* .usage.json .bundled_manifest
      if e.name endsWith ".zip":  unsupported.push({name, reason:"archive"}); continue
      if e.type == "file" and e.name endsWith ".md":
          # 单文件型 skill（DSH 规则兼容；Hermes 当前无此形态）
          skills.push(parseSkillFile(e.path, scope, flatName = basename(e.name,".md")))
          continue
      if e.type != "directory": continue

      # —— 分类目录判定 ——
      childEntries := listDir(e.path)
      hasSkillMd := childEntries.any(c => c.name == "SKILL.md")
      if hasSkillMd:
          skills.push(parseSkillFile(e.path + "/SKILL.md", scope, flatName = e.name))
          continue
      # 无 SKILL.md → 可能是分类目录：递归找
      nested := []
      for c in childEntries:
          if c.name startsWith ".": continue
          if c.type == "directory" and exists(c.path + "/SKILL.md"):
              nested.push(parseSkillFile(c.path + "/SKILL.md", scope, flatName = c.name))
      if nested.length > 0:
          # 是嵌套分类目录（group）—— 可展开，其子 skill 可导入
          desc := readDescription(e.path + "/DESCRIPTION.md")   # 可选，缺失则用目录名
          groups.push({ name: e.name, title: firstLine(desc) ?? e.name,
                        kind: "group", skills: nested })
      else:
          # 叶子分类目录：只有 DESCRIPTION.md / references/ 等，无可导入 skill
          # → 只读分组展示，不产生可勾选的 skill 行
          desc := readDescription(e.path + "/DESCRIPTION.md")
          if desc != null:
              groups.push({ name: e.name, title: firstLine(desc) ?? e.name,
                            kind: "leaf-group", skills: [] })
          else:
              unsupported.push({ name: e.name, reason: "no-skill" })
  return { scope, skills: flat(skills + groups.skills), groups, unsupported }


function parseSkillFile(path, scope, flatName) -> HermesSkill
  raw := readText(path)                       # frontmatter 解析失败 → 返回 partial
  fm := parseFrontmatter(raw)                 # {name?, description?, version?, tags?}
  declared := fm.name
  # —— 名称规则 ——
  # ① 声明名合法 → 用它
  # ② 声明名非法但扁平名合法 → 用扁平名，标 needsRename
  # ③ 两者都非法（中文）→ slugify(flatName)，标 needsRename
  # 注意 IA 规定：目录名与声明名不一致时以 frontmatter 为准
  #   （实测：self-discipline/iron-rules-self-discipline 声明名 self-improvement）
  dshName := isSkillName(declared) ? declared
          : isSkillName(flatName)  ? flatName
          : slugify(flatName)
  needsRename := dshName !== declared
  description := fm.description ?? firstNonEmptyLine(raw.body)   # 缺失时回退首行
  return {
    id: scope.id + "/" + relativePath(path, scope.dir),
    flatName,                 # 相对路径，用于扁平化展示与冲突检测
    declaredName: declared ?? null,
    dshName,
    description,
    version: fm.version ?? null,
    tags: fm.tags ?? [],
    path,                     # 绝对路径
    needsRename,
    nameValid: isSkillName(declared),
    fileCount, totalBytes     # 递归统计
  }
```

**关键设计点**：

1. **扁平化**：`dsh-skill-filesystem` 的 `discoverRoot`（行 584+）只枚举**一层**：`entry.type === "directory"` → `<dir>/SKILL.md`；`entry.type === "file" && endsWith(".md")` → 该文件。**嵌套 `**/SKILL.md` 不被发现**。所以 `github/github-auth/SKILL.md` 导入后必须落到 `<target>/github-auth/SKILL.md`（IA 约束 A）。
2. **分类目录 ≠ skill**：18 个顶层目录没有 `SKILL.md`，其中 10 个含嵌套 skill、8 个是叶子目录（见 §3.2 的两类细分）。叶子目录**只读展示**、不产生可勾选行。
3. **隐藏条目一律排除**：任何 `.` 开头的目录或文件。
4. **`SKILL.md` 缺失且无 `DESCRIPTION.md`** 的目录（如 `rockchip-tvbox-linux-flash/` 只含 `references/`）→ `unsupported`，不产生导入按钮。
5. **符号链接**：`dsh-skill-filesystem` 读取时走 `realpath`（行 700+ 的 `readSkillText` → `realpath(path)`）。扫描器同样应对 skill 目录做 `realpath`，避免导入时复制出嵌套软链。

### 3.4.1 算法实测验证

上述伪代码已用等价实现（本机 Python 复刻，仅 `os.listdir` 替代 `ctx.fs.listDir`）在本机 `~/.hermes` 上跑通，结果：

| 作用域 | skill 数 | 嵌套分类组 | 叶子分类组 | unsupported | 需改名 | 缺描述 |
|---|---|---|---|---|---|---|
| `main`（`~/.hermes/skills`） | 39 | 10 | 8 | 8 | **8** | 0 |
| `novelist` | 19 | 7 | — | 10 | **1** | 0 |
| `opc` | 40 | 10 | — | 10 | 0 | 0 |
| `quant-engine` | 31 | 13 | — | 13 | **7** | 0 |

> `main` 的 39 = 顶层 39 个带 `SKILL.md` 的目录；其余 35 个真 skill 藏在 10 个嵌套分类组里
> （`main` 递归总数 74 = 39 顶层 + 35 嵌套）。
>
> **需改名合计 16**：主 8 + novelist 1 + quant-engine 7（`quant-engine` 与主目录重复 7 个中文 skill）。
> 主目录的 8 个 = **7 个中文名**（`量化引擎` `李大霄战略` `财经资讯采集分析选股` `通达信金融数据专家`
> `全能金融爬虫` `中国宏观消费市场数据采集` `蒸馏版量化交易系统`）+ **1 个声明名含括号与中文**
> （目录 `hermes-novelist`，声明名 `hermes-novelist(九乂散人/九乂散人小说家agent)` —— 声明名非法但目录名合法，
> 故取目录名 `hermes-novelist`，与 PRD §0.1 的描述一致）。
> 注意 `self-discipline/iron-rules-self-discipline` 的 frontmatter `name` 是 `self-improvement`（**合法**），
> 按 IA「目录名与声明名不一致时以 frontmatter 为准」取 `self-improvement` —— **不计入需改名**。
>
> **缺描述 = 0**：说明 Hermes 侧每个 `SKILL.md` 都带 `description`，回退到首行的分支在本机不触发
> （但**必须保留**，因为 `parseSkillFile` 要求 name+description 同时存在）。

### 3.5 Host 侧文件访问：用 `ctx.fs`

**结论：用 `ctx.fs`（`dsh-fs-local` 后端）访问 `~/.hermes`，不要用 `node:fs`。**

`Service.listService { service: "fs" }` 的契约（来源 A）：

| 方法 | 签名 | 用途 |
|---|---|---|
| `resolve` | `resolve(path: string, opts?: { cwd?, signal? }): Promise<FsTarget>` | 路径 → 稳定 target |
| `listDir` | `listDir(target: FsTarget, signal?): Promise<FsDirEntry[]>` | 列直接子项，`FsDirEntry = { name, type: 'file'\|'directory'\|'other', target, version?, size? }` |
| `readText` | `readText(target: FsTarget, signal?): Promise<string>` | 读 UTF-8 全文 |
| `stat` | `stat(target: FsTarget, signal?): Promise<FsInfo \| undefined>` | `{ version, type, size? }`，不存在返回 `undefined` |
| `lstat` | `lstat(path: string, opts?: { cwd? }, signal?): Promise<FsPathInfo \| undefined>` | **不跟随符号链接**，用于识别 symlink |
| `writeText` | `writeText(target, content, expected?, signal?, sandboxPolicy?): Promise<FsWriteOutcome>` | 原子写 |
| `editText` | `editText(target, edit: { oldString, newString, replaceAll }, expected?, signal?, sandboxPolicy?): Promise<FsEditOutcome>` | 原子字面替换 |

`dsh-fs-local` 的类注释明确："Host-filesystem implementation of `ctx.fs`. Realpath-derived target identity makes aliases share stale guards"。且它覆写了 `processPathFromHostPath(hostPath)` → **宿主绝对路径可映射进该执行世界**。

**要点与限制**：

- `FsDirEntry.type` 只有 `'file' | 'directory' | 'other'` —— **没有 `symlink`**。识别软链必须用 `lstat`（返回 `type: 'symlink'`）。分类目录判定用 `listDir` 的 `type` 即可；软链目录会落在 `'other'` → 需要对 `'other'` 再用 `lstat` 确认。
- `dsh-fs-local` 的 `Config.cwd` 注释明确写着："Base directory for relative paths. Defaults to `process.cwd()`. … this is a resolution default, **NOT a containment boundary**"。→ 扫描 `~/.hermes` 时**必须传绝对路径**，不要依赖 cwd。
- `FsTarget.targetKey` 是 opaque 的，"consumers may pass this value to another OS capability, but must continue treating the target key as opaque"。→ 展示路径用 `target.displayPath`。
- `readText` 会做二进制拒绝；SKILL.md 一定是文本，安全。

### 3.6 Provider 模式（可选高级项）

`Service.listService { service: "skills" }` 给出：

```
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void
register(skill: SkillRegistration): () => void
list(options: SkillViewOptions = {}): Promise<SkillSummary[]>
snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>
get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>
```

`SkillProvider` 契约：

```ts
interface SkillProvider {
  readonly name: string;
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>;
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>;
}
```

注册即得零复制接入，但有两个硬约束：

1. Provider 的 `list` 必须**自己扁平化**（DSH 不发现嵌套 `**/SKILL.md`）；
2. Provider 的 `get` 走 `parseSkillFile`，**中文名会被 `isSkillName` 拒绝** → 中文 skill 在 Provider 模式下依然不可用。所以 Provider 模式是"零复制接入"，**不是**中文名的解决方案。

### 3.7 Host 侧 Remote 服务（Client 可调用）

**机制核验（来源 A + B）**：

- `Service.listService { service: "commands" }` 给出 Host 侧 `commands.register(definition)` 与 `@Remote async execute(agent, line, attachments, signal)`。
- `dsh-commands/lib/typert.remote-client.d.ts`（生成物）给出 **Client 侧**签名：

```ts
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$636f6d6d616e6473 {
    execute: (agentId: SessionId, line: string,
               submittedAttachments: readonly CommandSubmitAttachment[],
               signal?: AbortSignal) => Promise<RemoteResult<CommandExecution | undefined>>
    list: (agentId: SessionId) => Promise<RemoteResult<readonly CommandDescriptor[]>>
  }
  interface TypertRemoteMap {
    'commands/execute': (agentId, line, submittedAttachments, signal?) => Promise<RemoteResult<CommandExecution | undefined>>
    'commands/list': (agentId) => Promise<RemoteResult<readonly CommandDescriptor[]>>
  }
}
```

`RemoteResult<T>`（`dsh-typert-protocol/lib/types/types.d.ts:110`）：

```ts
export type RemoteResult<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure };
```

**关键结论（与任务要求的措辞有出入，必须说明）**：

> 任务描述里写的是 `ctx.remote.commands.execute()` 执行 session command。
> **实测**：这条 API 是 `dsh-commands` 自带的 `@Remote` 命名空间，签名是
> `ctx.remote.commands.execute(agentId, line, submittedAttachments, signal?)` ——
> **第一个参数是 `agentId: SessionId`，不是无参**。而且它的语义是「执行一个已注册的斜杠命令」，
> **不是「调用任意 Host 方法」**。

因此本插件的 Host 能力**不能**用 `ctx.remote.commands.execute` 表达。有两条合规路径：

#### 路径 A（推荐）：本插件自建 `@Remote` 命名空间

与 `dsh-commands` 完全同构（`dsh-commands/lib/index.js` 用 `import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"`，类方法上加 `@Remote` 装饰器）：

```js
// hermes-skills-sync/index.js
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export class HermesSkillsService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx)
    this.ctx = ctx
  }

  @Remote
  async listInstances(signal) { /* → HermesInstanceView[] */ }

  @Remote
  async scan(instanceId, signal) { /* → HermesScanResult */ }

  @Remote
  async preview(requests, signal) { /* → ImportPreview[] */ }

  @Remote
  async performImport(requests, strategy, signal) { /* → ImportResult[] */ }
}
```

Client 侧对应地得到 `ctx.remote.hermesSkills.listInstances(...)` 等（namespace 名由 Typert 生成器从服务名派生，与 `commands` → `ctx.remote.commands` 同规则）。

> ⚠️ **待核验项**：namespace 的确切派生规则（服务名 `hermesSkills` → `ctx.remote.hermesSkills`？还是 kebab-case `hermes-skills`？）需要用 `cordis_inspect_query { platform: "client", provider: "Builtin" }` 或 Typert 生成器源码确认。`dsh-commands` 的类名是 `CommandRuntime`，包名 `dsh-commands`，namespace 是 `commands` —— 看起来取自**服务的 `name` 常量**（`dsh-commands/lib/types/index.d.ts` 里 `export declare const name = "commands"`）。本插件应同样导出 `export const name = 'hermesSkills'`，并用 `ctx.register` 挂载。

#### 路径 B：复用 `ctx.remote.commands.execute` 走斜杠命令

若不想自建 Remote 命名空间，可把扫描/导入注册为**斜杠命令**（`ctx.commands.register({ name, description, handler })`），Client 用：

```js
const result = await ctx.remote.commands.execute(sessionId, '/hermes-scan', [])
if (!result.ok) return `${result.error.message} (${result.error.code})`
if (result.value === undefined) return 'unknown command: /hermes-scan'
```

这是**已实测存在于本机 Client 代码**的调用形态（`dsh-client-ui-plan/lib/client.js:704` 与 `dsh-client-ui-commands/lib/client.js:1718`）。**代价**：命令返回值只有 `CommandResult = { kind: 'success', text? } | { kind: 'error', text }` —— **只能传字符串**，结构化扫描结果必须 JSON 编码进 `text`，且命令生命周期会写 `command/run` / `command/done` 到 session 日志（`Service.listService { service: "commands" }` 的 `execute` 文档明说 "A resolved command's lifecycle is logged"）。

> **裁决**：**路径 A 为主**（结构化数据、无日志噪音、语义干净），**路径 B 作为兜底**（若 Typert 命名空间派生规则核验失败，或需要「用户可手动敲 `/hermes-scan`」的能力）。

### 3.8 复用既有 Host 服务（不重复造轮子）

| 既有服务（来源 A 核验） | 方法 | 复用方式 |
|---|---|---|
| `skills` | `list(options)` / `snapshot(options)` / `get(name, options)` | 判断"DSH 侧是否已有同名 skill"，**不要自己扫 `~/.dsh/skills/`** |
| `skills` | `registerProvider(create)` | 可选：Provider 模式接入 |
| `workspaceRegistry` | `list(): Workspace[]` / `create(path, title?)` | 项目（workspace）列表与注册 |
| `fs` | `resolve` / `listDir` / `readText` / `stat` / `lstat` / `writeText` / `editText` | 扫描 + 导入写盘 |
| `workspaceController` | `@Remote('create') create(request)` | Client 可直接调（生成命名空间 `ctx.remote.workspace`） |
| `directoryPickerController` | `@Remote('pick') pick(signal)` | 目录选择器 |
| `commands` | `register(definition)` / `@Remote execute(...)` | 路径 B 的命令通道 |
| `timer` | `timeout` / `interval` / `debounce` | 扫描节流 |

> 注意 `workspaceFiles` 的 Remote 方法全部以 `workspaceFileScope` 为首参（`read(workspaceFileScope, path, range, signal)`），是**工作区相对**的，不适合读 `~/.hermes`。`ctx.fs` 才是对的。

---

## 4. Host → Client 通道

### 4.1 `ctx.remote` 的事件订阅

`dsh-client-ui-plugin-manager/lib/client.js`（已装包实测）展示了 Host 事件在 Client 的订阅形态：

```js
const disposers = [
  ctx.remote.$on("plugin-manager/changed", refresh),
  ctx.remote.$on("plugin-manager/install-log", (chunk) => { controller.appendLog(chunk); }),
  ctx.remote.$on("plugin-manager/install-state", (progress) => { controller.installProgress(progress); }),
  ctx.on("connection/reset", refresh)
]
return () => { for (const dispose of disposers) dispose() }
```

→ 本插件的扫描进度事件建议：`hermes-skills/scan-progress`、`hermes-skills/import-progress`。

### 4.2 Host 侧事件发射

`Service.listService { service: "claudeCodeMods" }` 给出流式 Remote 的范式：`@Remote({ mode: 'stream' }) watchBand(agent, signal): AsyncIterable<SurfaceSnapshot>`。同样的模式可用于扫描进度：

```js
@Remote({ mode: 'stream' })
async *watchScan(instanceId, signal) {
  // 逐帧 yield { phase, current, total, message }
}
```

Client 侧对应 `ctx.remote.hermesSkills.watchScan(instanceId, signal)`，返回 `AsyncIterable`。

---

## 5. Client 半：`client.js`

### 5.1 slot 选择

**候选 slot 的实测结论（来源 B，从已装包的 `SlotMap` 声明中提取的真实 key）**：

| slot key | 声明位置 | 语义 | 适配度 |
|---|---|---|---|
| `main` | `dsh-client-ui-plugin-manager` 实际注册于此 | 主区域面板（Plugin Manager 页就挂在这里） | ✅ **主选** |
| `sidebar.panellist` | 同上 | 侧边栏面板列表项 | ✅ **次选**（入口按钮） |
| `sidebar.panellist.actions` | 同上 | 面板项的操作区 | ⚠️ 仅放小图标按钮 |
| `shell.overlay` | 同上（`plugin-manager.refresh-toast`） | 全局浮层 | ❌ 不适合管理列表（IA §1.2 已否决叠加式浮层做主界面） |
| `conversation.composer.dock` | 模板默认 | 输入框下方 | ❌ 与本插件语义不符 |
| `plugins.item` / `plugins.tab` | 插件管理页内部 | 插件页条目 | ❌ 那是 DSH 插件自己的页，不是 Hermes skill |

**裁决**：`main`（主面板）+ `sidebar.panellist`（入口）。`main` 是 Plugin Manager 页已经在用的位置，宿主已有完整的 AppFrame 布局（侧边栏 + 主区 + `shell.overlay`），**不需要**自己再造外壳。

**`root` 绝对不能注册**（`dsh-client-ui-renderer/lib/types/client/registry.d.ts:32-37` 原文警告）：

> DO NOT register here. This is a single slot, so a second entry does not sit beside the frame — it shadows it … the page would render your component alone, with every seat the frame declares gone. … register into `shell.overlay` instead.

### 5.2 slot 注册代码

**注册 API（来源 B，`dsh-client-ui-renderer/lib/types/client/registry.d.ts`）：**

```ts
class SlotRegistry extends Service {
  readonly register: SlotCore['register'];
  readonly registerFactory: RegisterFactory;
  inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void;
  entries(key): readonly StoredEntry[];
  entriesOfSlot(key): readonly StoredEntry[];
  snapshot(root?: string): LiveCompositionNode[];
  spec<K>(key: K): SlotSpec<SlotMap[K]> | undefined;
  subscribe(key, fn: () => void): () => void;
  getVersion(key): number;
  onEntryError(fn): () => void;
  installScope(scope, adapter): void;
  installLocale(face: LocaleFace): void;
}
```

> `register` **必须是原型方法**（不能是实例箭头函数）——注释解释：cordis service proxy 会在调用时把 `this.ctx` 绑定到**调用方**的 context，从而把 effect 与 unload 级联路由进调用方的 fiber。箭头属性会把 `this` 冻结在服务自身的 root ctx 上，**静默破坏**按插件卸载。

**注册形态（对齐 `dsh-client-ui-plugin-manager` 的实测写法，源码 `lib/client.js:4411-4486`）：**

```js
window.__ModuleLoader__.load({
  id: 'hermes-skills-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef, useSyncExternalStore } = React

    const NS = 'hermesSkills'
    const PANEL_ID = 'hermes-skills'

    function HermesSkillsPage(props) { /* 见 §5.5 */ }
    function HermesPanelIcon(props) { /* 侧边栏图标 */ }

    return {
      inject: ['slots'],
      apply(ctx) {
        // ① 文案字典（Client locale service）
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hermes-skills: dictionaries')
        const t = ctx.locale.bind(NS)

        // ② 主面板（实测 plugin-manager 的写法：inject 返回生成器）
        ctx.slots.inject('main', function* () {
          const handle = createNavigationStore()
          const instance = handle.create()
          const store = { ...handle, create: () => instance }
          yield ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            store,
            inject: () => face,
            children: {
              // 声明本面板要渲染的子 slot；宿主据此把子 slot 渲染进面板
              'hermes-skills.toolbar':   { kind: 'list',   scope: 'root' },
              'hermes-skills.filter':    { kind: 'list',   scope: 'root' },
              'hermes-skills.tree':      { kind: 'list',   scope: 'root' },
              'hermes-skills.rows':      { kind: 'list',   scope: 'root' },
              'hermes-skills.row.actions': { kind: 'keyed', scope: 'root' },
            },
          }, HermesSkillsPage)

          // 面板切换时的状态复位（实测 plugin-manager 同款）
          yield ctx.layout.panelInfo.subscribe(() => {
            if (ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) {
              instance.actions.setView({ kind: 'list' })
            }
          })

          // 跨模块导航反射（实测 plugin-manager 用 ctx.reflect.provide）
          // ReflectService.provide(name, value) → disposer；由当前 fiber 拥有，
          // fiber 卸载时自动注销（cordis/lib/types/reflect.d.ts）
          const disposeNavigation = ctx.reflect.provide('hermesSkillsNavigation', {
            openList: () => {
              ctx.layout.selectPanel(PANEL_ID)
              instance.actions.setView({ kind: 'list' })
            },
          })
          yield () => { disposeNavigation() }
        })

        // ③ 侧边栏入口（实测 plugin-manager 同款：label 用函数形式）
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, HermesPanelIcon))
      },
    }
  },
})
```

**实测要点**：

- `ctx.slots.inject(ownerKey, cb)`：cb 返回的注册在声明 collapse 时被 dispose，声明回来时重新注册（`registry.d.ts:97-110` 的 `inject` 文档）。cb **可以返回生成器**（plugin-manager 就用了 `function* () { yield ctx.slots.register(…) }`）。
- `label` 两种形态都合法：plugin-manager 用了**函数形式** `label: () => t("panel")`；而 `plugins.item` 的读取侧用 `resolveSlotLabel(entry.options.label)`（`configLedgerSource` 里 `label: resolveSlotLabel(entry.options.label) ?? ""`），说明 `label` 支持字符串或函数。
- `children` 用来**声明本面板要渲染的子 slot**（`{ kind: 'list' | 'keyed', scope: 'root' }`）。不声明就不会被渲染进面板。`kind: 'keyed'` 表示按 key 索引（plugin-manager 的 `plugins.bundle.config` / `plugins.row.config` 即此类）。
- `ctx.layout.selectPanel(PANEL_ID)` 是切换主面板的官方入口；`ctx.layout.panelInfo` 是一个可订阅的 observable（`subscribe()` + `getSnapshot().activePanelId`）。
- `ctx.reflect.provide(name, api)` 用于跨模块暴露操作（plugin-manager 的 `pluginNavigation` 即如此）。
- React **只从浏览器 module table 取**：`require('react')`、`require('react/jsx-runtime')`。不引 CDN、不装第二份 React。
- **禁止** `require('@deepseek-ai/dsh-client-ui-primitives')` 或任何其它 Harness Client 包（`practices.md` §UI 明令；理由：这些包不经通知即变化，plain-JS 插件没有类型检查，组件抛错会**清空整个 slot 条目**，控制台报 `slot entry crashed in '<slot>'`）。→ **自己写控件**，从 `dsh-client-ui-primitives` 的 `lib/index.js` / `lib/**/*.css` 复制 markup/CSS/行为到本插件，前缀改名，类名只引用 `--dsw-alias-*` token。必须保留的行为：Modal 的焦点管理与 Escape 处理、`role="switch"` + `aria-checked`、Tooltip 定位。

### 5.3 Client locale service（文案）

**API（来源 B，`dsh-client-locale/lib/types/client/index.d.ts` 的 `LocaleRuntime`）：**

```ts
class LocaleRuntime {
  getLocale(): LocaleSnapshot;                       // { active, locales, revision }
  resolveText(text: LocalizedText): string;          // 包级文本解析
  getSnapshot(): LocaleSnapshot;                     // uSES 源
  subscribe(fn: () => void): () => void;            // uSES 订阅
  setLocale(id: string): void;
  addLanguage(input: LanguageRegistration): () => void;
  register<N>(ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void;
  register(ns: string, locale: string, dict: LocaleDict): () => void;
  bind<N>(ns: N): TranslateNS<N>;
  bind(ns: string): Translate;
}
```

**用法**（对齐 plugin-manager 实测）：

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hermes-skills: dictionaries')
const t = ctx.locale.bind(NS)   // 稳定引用，可安全进 inject 面
```

`register` 的两个约束（来自类型文档）：
1. 键集必须是 `LocaleNamespaceMap` 声明的键联合 —— **缺一个或多一个都是编译错误**；
2. **每个已发布 locale 都必须提供**（双语平衡强制）。→ `zh` 与 `en` 的键集必须完全一致。

`bind` 返回的函数**按 namespace 稳定**（重复 bind 返回同一函数），可以进 `inject` 面而不破坏 memoization。

### 5.4 主题 token 用法（真实 token 名）

**核验**：`Theme.listTokens` 因 Client 不可用而无法执行（见 §0 缺口声明）。改从已装包 `dsh-client-ui-theme/lib/client.js` 提取，权威来源是主题样式表本身。

**实测：107 个 `--dsw-alias-*` token**（完整清单见 §5.4.1）。**前端 CSS 里实际被引用的有 55 个**。

**明暗覆盖实测（对样式表做出现次数统计）**：

| 类别 | 数量 | 说明 |
|---|---|---|
| 有 light + dark **成对**定义 | **104** | 自动跟随宿主切换，插件无需干预 |
| 仅 light 定义 | **3** | `--dsw-alias-onboarding-accent`、`--dsw-alias-settings-card-fill`、`--dsw-alias-settings-card-stroke` |
| 合计 | **107** | |

→ **本插件只使用有明暗成对定义的 token**（上表 104 个之内），避免在暗色下出现"浅色背景配深色文字"的错配。
上面 3 个单定义 token 属于 onboarding / settings 专用域，本插件不使用。

**暗色模式机制（实测）**：暗色不是 class 切换，而是 **`body[data-ds-dark-theme]`** 属性：

```css
body[data-ds-dark-theme] { --dsw-alias-bg-base: var(--dsw-static-neutral-bluish-950); ... }
```

→ 插件**不需要**自己实现暗色分支。直接引用 `--dsw-alias-*`，宿主在切换时自动改值。这是"token 是最低风险样式手段"的根本原因：**改名的 token 只降级外观，不会破坏渲染**。

**用法范式（React 内联 style，组件卸载即消失，符合"组件局部样式可渲染为 React 元素"的要求）：**

```js
const panelStyle = {
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 'var(--dsw-radius-md)',
}
const rowStyle = {
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 'var(--dsw-font-size-sm)',
}
```

> `--dsw-radius-*` / `--dsw-font-size-*` / `--dsw-elevation-*` 是同一 token 体系里的非 alias 家族（实测 CSS 中确有 `var(--dsw-radius-sm)`、`var(--dsw-elevation-soft)`、`var(--dsw-elevation-panel)`）。严格说 alias 家族是 107 个 `--dsw-alias-*`；使用前建议对 radius/font/elevation 家族再跑一次 token 核验。

**本插件的语义映射（建议）：**

| 用途 | token |
|---|---|
| 面板底色 | `--dsw-alias-bg-layer-1` |
| 行/卡片底 | `--dsw-alias-bg-layer-2` / `--dsw-alias-bg-layer-3` |
| 页面底 | `--dsw-alias-bg-base` |
| 主文本 | `--dsw-alias-label-primary` |
| 次要文本 | `--dsw-alias-label-secondary` / `--dsw-alias-label-tertiary` |
| 弱化文本 | `--dsw-alias-label-dimmed` / `--dsw-alias-label-caption` |
| 分隔线 | `--dsw-alias-border-l2` / `--dsw-alias-border-l3` |
| 主色 | `--dsw-alias-brand-primary` |
| 链接 | `--dsw-alias-link` |
| 悬停底 | `--dsw-alias-interactive-bg-hover` |
| 选中/激活底 | `--dsw-alias-interactive-bg-active` |
| 主按钮 | `--dsw-alias-button-primary-fill` / `--dsw-alias-button-primary-hover` |
| 幽灵按钮 | `--dsw-alias-button-ghost-active-fill` / `--dsw-alias-button-ghost-active-border` |
| 成功 | `--dsw-alias-state-success-primary` |
| 警告 | `--dsw-alias-state-warn-primary` / `--dsw-alias-state-warn-label` |
| 错误 | `--dsw-alias-state-error-primary` |
| 忙碌中 | `--dsw-alias-state-business-primary` |
| 空闲 | `--dsw-alias-state-idle-primary` |
| 遮罩 | `--dsw-alias-bg-mask-1` / `--dsw-alias-bg-mask-2` |
| 浮层 | `--dsw-alias-bg-overlay` |
| Toast | `--dsw-alias-toast-bg` / `--dsw-alias-toast-label` |
| Tooltip | `--dsw-alias-tooltip-bg` |
| 菜单组标题 | `--dsw-alias-menu-group-header-fill` |
| 菜单图标 | `--dsw-alias-menu-icon` |
| 滚动条 | `--dsw-alias-scrollbar-bg-l2` / `--dsw-alias-scrollbar-hover-l2` |
| 骨架屏 | `--dsw-alias-bg-skeleton` |

#### 5.4.1 完整 `--dsw-alias-*` token 清单（107 个，实测）

```
--dsw-alias-bg-base                    --dsw-alias-bg-overlay
--dsw-alias-bg-document-preview        --dsw-alias-bg-skeleton
--dsw-alias-bg-document-selection      --dsw-alias-border-inverted
--dsw-alias-bg-layer-1                 --dsw-alias-border-inverted2
--dsw-alias-bg-layer-2                 --dsw-alias-border-l1
--dsw-alias-bg-layer-3                 --dsw-alias-border-l2
--dsw-alias-bg-mask-1                  --dsw-alias-border-l2-darkmode-thin
--dsw-alias-bg-mask-2                  --dsw-alias-border-l3
--dsw-alias-bg-mask-3                  --dsw-alias-border-l4
--dsw-alias-bg-mask-drop               --dsw-alias-brand-primary
--dsw-alias-bg-mask-photo              --dsw-alias-brand-primary-invert
--dsw-alias-bg-module-platform         --dsw-alias-brand-primary-new-colorprimary-new-color
--dsw-alias-bg-multi-select            --dsw-alias-brand-text
--dsw-alias-button-contrast-fill       --dsw-alias-button-elevated-fill
--dsw-alias-button-floating-fill        --dsw-alias-button-floating-hover
--dsw-alias-button-ghost-active-border --dsw-alias-button-ghost-active-fill
--dsw-alias-button-ghost-active-hover   --dsw-alias-button-info-fill
--dsw-alias-button-info-hover           --dsw-alias-button-primary-dimmed
--dsw-alias-button-primary-fill         --dsw-alias-button-primary-hover
--dsw-alias-button-tool-bar-fill        --dsw-alias-button-tool-bar-fill-invisible
--dsw-alias-button-tool-bar-hover       --dsw-alias-code-diff-added
--dsw-alias-code-diff-deleted          --dsw-alias-file-diff-added-bg
--dsw-alias-file-diff-added-gutter     --dsw-alias-file-diff-added-marker
--dsw-alias-file-diff-deleted-bg       --dsw-alias-file-diff-deleted-gutter
--dsw-alias-file-diff-deleted-marker   --dsw-alias-interactive-bg-active
--dsw-alias-interactive-bg-hover        --dsw-alias-interactive-bg-hover-accent
--dsw-alias-interactive-bg-hover-danger --dsw-alias-interactive-bg-hover-solid
--dsw-alias-label-caption               --dsw-alias-label-deep-diving
--dsw-alias-label-deep-diving-shimmer  --dsw-alias-label-dimmed
--dsw-alias-label-document-preview      --dsw-alias-label-primary
--dsw-alias-label-primary-bluish        --dsw-alias-label-primary-dimmed
--dsw-alias-label-primary-foreground    --dsw-alias-label-primary-inverted
--dsw-alias-label-secondary             --dsw-alias-label-shimmer
--dsw-alias-label-tertiary              --dsw-alias-link
--dsw-alias-markdown-citation           --dsw-alias-markdown-code-block
--dsw-alias-markdown-code-block-banner  --dsw-alias-markdown-code-segment-selected
--dsw-alias-markdown-code-segment-unselected --dsw-alias-markdown-inline-code
--dsw-alias-markdown-placeholder        --dsw-alias-markdown-tag
--dsw-alias-menu-group-header-fill      --dsw-alias-menu-icon
--dsw-alias-onboarding-accent           --dsw-alias-onboarding-card-fill
--dsw-alias-onboarding-checkbox-border  --dsw-alias-onboarding-secondary-fill
--dsw-alias-scrollbar-bg-l1             --dsw-alias-scrollbar-bg-l2
--dsw-alias-scrollbar-hover-l1          --dsw-alias-scrollbar-hover-l2
--dsw-alias-settings-card-fill          --dsw-alias-settings-card-stroke
--dsw-alias-state-business-primary      --dsw-alias-state-business-tertiary
--dsw-alias-state-error-primary         --dsw-alias-state-error-secondary
--dsw-alias-state-idle-primary          --dsw-alias-state-success-primary
--dsw-alias-state-success-secondary     --dsw-alias-state-success-tertiary
--dsw-alias-state-warn-label            --dsw-alias-state-warn-primary
--dsw-alias-state-warn-secondary        --dsw-alias-state-warn-tertiary
--dsw-alias-switch-thumb                --dsw-alias-toast-bg
--dsw-alias-toast-label                 --dsw-alias-tooltip-bg
--dsw-alias-tooltip-key-bg              --dsw-alias-turn-trigger-bg
--dsw-alias-turn-trigger-bg-hover
```

---

## 6. Client UI 规格

### 6.1 布局（对齐 IA §1.3）

```
┌──────────────────────────────────────────────────────────────────────┐
│  Hermes Skills 同步器            [扫描 ⟳] [全局/项目 ▾] [已导入 ⧉]  │  ← 工具栏
├────────────────┬─────────────────────────────────────────────────────┤
│ 来源树 (240px) │  搜索 [__________] 状态[全部▾] 来源[全部▾] ☐全选    │  ← 过滤栏
│ ▾ 本机 Hermes  │  ┌───────────────────────────────────────────────┐  │
│    ▾ 主 agent  │  │ ▾ github/                          7 个 · 856K│  │  ← 二级折叠
│      57 skills │  │    ☐ github-auth        3 文件 · 12K   [导入] │  │
│    ▸ novelist  │  │    ☐ github-code-review 5 文件 · 48K   [导入] │  │
│    ▸ opc       │  │    ☐ github-issues      2 文件 · 8K  ●已导入 │  │
│    ▸ quant-…   │  └───────────────────────────────────────────────┘  │
│                │  ☐ brainstorming       9 文件 · 104K  [导入]       │
│                │  ☐ quant-engine/量化引擎  ⚠ 需改名                │
└────────────────┴─────────────────────────────────────────────────────┘
```

### 6.2 列表分页 / 虚拟化

规模：主 57 顶层 + 3 profile × ~30 ≈ **150 条**，每行还需展开二级分组（`github/` 7 条）。规模不大但**必须**做虚拟化或分页，理由：

1. 宿主自身提供了 `dsh-client-chunked-list` 包（实测存在于已装包目录）—— 说明宿主的列表惯例就是分块渲染；
2. 行内有展开/折叠、批量勾选、多状态徽标，DOM 节点数 = 行数 × 每行 ~10 个节点 → 150 行 = 1500 节点，且每次扫描重渲染会全量重建。

**建议**：自实现轻量虚拟滚动（不引第三方虚拟列表包），因为要引它就得 `require` 一个 Harness 外的包（违反"只用 module table 里的 React"的精神，且第三方包体积不可控）。

```js
function useVirtualWindow(items, rowHeight, containerRef, overscan = 6) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setViewportH(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [containerRef])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (el) setScrollTop(el.scrollTop)
  }, [containerRef])

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + viewportH) / rowHeight) + overscan)

  return {
    visible: items.slice(start, end),
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (items.length - end) * rowHeight),
    onScroll,
  }
}
```

**行高必须是固定值**（虚拟化前提）→ 二级分组折叠时行高不同 → **把折叠分组做成虚拟化之外的独立区块**，或用"变高虚拟化"（维护 prefix-sum offset）。建议：**虚拟化只作用于扁平的 skill 行；分组标题行作为分组头单独渲染**，即"按 group 分段虚拟化"。

**分页备选**：若扫描结果规模可能远超 150（用户装了 10 个 profile），加一个"每页 100 条 + 翻页"的降级模式。宿主已有 `dsh-chunked-list` 包说明这是常见需求。

### 6.3 响应式

**断点**：768 / 1024（IA §1.4）。

**实现方式**：优先用 **CSS media query**（纯表现层，无需 JS 测量）。但本插件是 React + 内联 style，**内联 style 无法写 media query** → 需要在组件内插入一个 `<style>` 标签承载本插件的 CSS（用 `ctx.effect` 管理其生命周期，卸载即移除）。

```js
ctx.effect(() => {
  const style = document.createElement('style')
  style.dataset.plugin = 'hermes-skills-sync'
  style.textContent = `
    .hss-root { display: grid; grid-template-columns: 240px 1fr; }
    @media (max-width: 1023px) {
      .hss-root { grid-template-columns: 40px 1fr; }
      .hss-tree { position: fixed; ... }   /* 抽屉 */
    }
    @media (max-width: 767px) {
      .hss-root { grid-template-columns: 1fr; }
    }
  `
  document.head.appendChild(style)
  return () => style.remove()
}, 'hermes-skills: styles')
```

> 样式作用域用**本插件前缀**的类名（`.hss-*`），不污染宿主。`document.head` 注入 vs `document.body` 追加：`practices.md` 明令"不要 `append` 第二个应用到 `document.body`"，head 里的 `<style>` 是宿主自身的做法（`dsh-client-ui-theme/lib/client.js` 就是 `tag.dataset.plugin = PLUGIN_ID; document.head.appendChild(tag)`）。

**ResizeObserver 备选**：只在需要测量元素尺寸时用（如判断是否进入窄屏以切换抽屉行为）。上面的 `useVirtualWindow` 已经用 ResizeObserver 测视口高。

**降级原则**（IA §1.4）：窄屏只减少"同时可见的信息"，不减少"可执行的操作"。所有在窄屏消失的操作必须以 sheet 形式提供。

### 6.4 菜单与模态：键盘可达性 / 焦点陷阱 / Escape / aria

**必须自实现**（不引 primitives 包），但要复制 primitives 的行为（`practices.md` §UI 要求保留 "Modal focus and Escape handling"、`role="switch"` + `aria-checked`、Tooltip 定位）。

**模态（导入对话框）焦点陷阱：**

```js
function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const previouslyFocused = document.activeElement

    const selector =
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),' +
      'select:not([disabled]),[tabindex]:not([tabindex="-1"])'

    // 初始聚焦到容器内第一个可聚焦元素
    const focusables = () => Array.from(node.querySelectorAll(selector))
    const first = focusables()[0]
    if (first) first.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault(); lastItem.focus()
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault(); firstItem.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus()
    }
  }, [ref, active, onClose])
}
```

**Escape 关闭的层级问题**：模态在 `main` slot 内，`shell.overlay` 里可能还有宿主自己的浮层。`e.stopPropagation()` 防止冒泡到宿主的全局 Escape 处理；`stopPropagation` 不足以阻止宿主的 `document` 级监听 → 还需要在打开模态时 `e.preventDefault()` 并 `stopImmediatePropagation`（若宿主在 capture 相位监听）。实现时需实测。

**aria 属性清单：**

| 元素 | 必需属性 |
|---|---|
| 模态容器 | `role="dialog"` `aria-modal="true"` `aria-labelledby=<titleId>` |
| 树 | `role="tree"` `aria-label` `aria-multiselectable="false"` |
| 树节点 | `role="treeitem"` `aria-selected` `aria-expanded`（有子节点时）`aria-level` |
| 列表 | `role="listbox"` `aria-multiselectable="true"` `aria-label` |
| 行 | `role="option"` `aria-selected` |
| 复选框 | `<input type="checkbox">` + `aria-label`（含 skill 名） |
| 开关 | `role="switch"` `aria-checked` |
| 搜索框 | `role="searchbox"` 或 `<input type="search">` + `aria-label` |
| 状态徽标 | `aria-label` 描述状态（不能只靠颜色） |
| 进度 | `role="progressbar"` `aria-valuenow` `aria-valuemin` `aria-valuemax` `aria-label` |
| 扫描中/错误提示 | `role="status"` / `role="alert"`（`aria-live="polite"` / `"assertive"`） |
| 图标按钮 | `aria-label`（图标本身 `aria-hidden="true"`） |

**键盘约定（树 + 列表）：**

| 键 | 行为 |
|---|---|
| `↑` / `↓` | 上/下移动焦点 |
| `←` / `→` | 树：折叠/展开；列表：无操作 |
| `Home` / `End` | 首/末行 |
| `PageUp` / `PageDown` | 翻页（10 行） |
| `Space` | 切换当前行勾选（列表）；展开/折叠（树） |
| `Enter` | 打开详情 / 执行导入 |
| `Ctrl/Cmd+A` | 全选当前作用域 |
| `Escape` | 关闭模态 / 清除焦点 |
| `Tab` | 在模态内循环（焦点陷阱） |

**虚拟化 + 焦点**：虚拟滚动会让焦点行滚出窗口而"丢失"。必须处理：焦点变化时确保目标行已渲染（`scrollIntoView`），并在 `aria-activedescendant` 模式下用容器级 `aria-activedescendant` 指向行 id —— 这也是虚拟列表的标准做法。

### 6.5 异步扫描状态管理

**状态机（IA §3.1）**：`idle → scanning → scanned → importing → done`，任意态可 `error`。

```js
const STATUS = {
  idle:      'idle',
  scanning:  'scanning',
  scanned:   'scanned',
  importing: 'importing',
  done:      'done',
  error:     'error',
}
```

**必须处理的三件事：**

1. **取消**：每次扫描创建新的 `AbortController`；重新扫描前 `controller.abort()`。Host 侧的 `listDir` / `readText` / `resolve` 全部接受 `signal`。
2. **并发去重**：同一实例重复点"扫描"应复用进行中的 promise，而不是并发跑两遍。
3. **乱序保护**：用单调递增的 request id 丢弃过期响应（用户连点"扫描"时先发的响应可能后到）。

```js
const scanSeq = useRef(0)

async function runScan(instanceId) {
  const seq = ++scanSeq.current
  abortRef.current?.abort()
  const controller = new AbortController()
  abortRef.current = controller
  setStatus(STATUS.scanning)
  setError(null)
  try {
    const result = await ctx.remote.hermesSkills.scan(instanceId, controller.signal)
    if (seq !== scanSeq.current) return          // 过期响应，丢弃
    setResult(result)
    setStatus(STATUS.scanned)
  } catch (err) {
    if (seq !== scanSeq.current) return
    if (controller.signal.aborted) return
    setError(String(err?.message ?? err))
    setStatus(STATUS.error)
  }
}
```

**Host 侧 `RemoteResult` 的处理**：Client 拿到的是 `RemoteResult<T>`，必须先判 `ok`：

```js
const res = await ctx.remote.hermesSkills.scan(instanceId, signal)
if (!res.ok) {
  setError(`${res.error.message} (${res.error.code})`)
  return
}
setResult(res.value)
```

（这个判空形态直接对齐 `dsh-client-ui-plan/lib/client.js:704` 的实测写法。）

---

## 7. 端到端调用链

```
┌─ Client (React) ─────────────────────────────────────────┐
│ HermesSkillsPanel                                       │
│  ├─ ctx.locale.bind('hermesSkills') → t(key)            │
│  ├─ ctx.remote.hermesSkills.scan(id, signal)            │
│  └─ ctx.remote.hermesSkills.performImport(reqs, strat) │
└───────────────────────────┬──────────────────────────────┘
                            │ WebSocket / RPC
┌─ Host (Node) ────────────▼──────────────────────────────┐
│ HermesSkillsService extends TypertRemoteService         │
│  @Remote scan()                                         │
│    ├─ ctx.fs.resolve/listDir/readText   → ~/.hermes     │
│    ├─ parseFrontmatter (自实现)                          │
│    ├─ isSkillName 判定 → needsRename                    │
│    └─ ctx.skills.list() → 已有同名检测                   │
│  @Remote performImport()                                │
│    ├─ slug 校验                                          │
│    ├─ ctx.fs.writeText 写 <target>/<slug>/SKILL.md      │
│    └─ ctx.skills 缓存失效                               │
└──────────────────────────────────────────────────────────┘
```

---

## 8. 未决项与风险

| # | 项 | 状态 | 解除条件 |
|---|---|---|---|
| 1 | Client Inspect 通道超时（GUI 401） | 🔴 阻塞验证 | 打开 `http://127.0.0.1:3080` 登录后重跑 `Slots.listSubTree` + `Theme.listTokens` |
| 2 | Typert Remote namespace 派生规则（`hermesSkills` → `ctx.remote.hermesSkills`?） | 🟡 待核验 | 查 Typert 生成器源码或跑一次 Client Inspect |
| 3 | `--dsw-radius-*` / `--dsw-font-size-*` / `--dsw-elevation-*` 是否属"允许的 token 家族" | 🟡 待核验 | 同上，用实况 token 清单核对 |
| 4 | `ctx.remote.commands.execute` 的 `agentId` 参数在本插件场景如何取得（面板可能不在某个 session 上下文） | 🟡 待核验 | 若走路径 A 则不需要；若走路径 B 需确认 session 来源 |
| 5 | `ctx.fs` 对 `~/.hermes` 的写入是否受 sandbox policy 约束 | 🟡 待核验 | `dsh-fs-local` 的 `writeText` 有 `sandboxPolicy?` 参数；当前 profile `danger-full-access`，但插件不应依赖这一点 |
| 6 | Hermes 的 `HERMES_HOME` 环境变量覆盖 | 🟢 已由 PRD 覆盖 | 扫描器读 `process.env.HERMES_HOME` 作为首选根 |
| 7 | 中文 → pinyin slug 的依赖来源（`pinyin` 包） | 🟡 待决 | 决定：引第三方包 vs 自带映射表 vs 保留原名并让用户手填 |
| 8 | `dsh-skill-filesystem` 当前未挂载（PRD §0） | 🟢 已知 | 导入后需确认 DSH 侧能发现（端到端验收项） |

---

## 9. 验收清单（实现后逐条核验）

**架构 / 骨架**
- [ ] `package.json` 含 `dsh.bundle.patch` → `cordis.patch.yml`，`dsh.client` 段声明 `platform: "web"` / `immediately` / `inject`，`exports` 含 `"./client"`
- [ ] `cordis.patch.yml` 插入行 id 与包名一致
- [ ] `index.js` 导出 `export function apply(ctx, config)`
- [ ] `client.js` 通过 `window.__ModuleLoader__.load({ id: <包名>, factory(require) })` 注册，工厂体无副作用
- [ ] **未** `require` 任何 `@deepseek-ai/dsh-client-*` 包
- [ ] React 来自 `require('react')` / `require('react/jsx-runtime')`

**Host 扫描**
- [ ] 扫描 `~/.hermes/skills` 得 57 顶层非隐藏目录，其中 **18** 个正确识别为**分类目录**（无 `SKILL.md`）
- [ ] 递归发现产出 74 个真 skill（实测基线），每个被扁平化为唯一 `dshName`
- [ ] 分类目录的 `DESCRIPTION.md` 首行被读为分组标题
- [ ] 中文名 skill 进入 `needsRename`，显示确定性 slug 映射且可编辑
- [ ] `铁蛋作家.zip` 识别为 `archive` → `unsupported`，不产生导入按钮
- [ ] 所有 `.` 开头条目不出现在任何列表
- [ ] `~/.config/hermes` / `/opt/hermes` / `/usr/local/hermes` / PATH 中的 `hermes` 均被探测（不存在则静默跳过）
- [ ] `HERMES_HOME` 覆盖生效
- [ ] 单实例失败只影响该实例，其余照常可用

**Client UI**
- [ ] 列表虚拟化生效（150 条规模下 DOM 节点数不随行数线性增长）
- [ ] 768 / 1024 断点降级：窄屏所有操作仍可达
- [ ] 模态焦点陷阱 + Escape 关闭 + 关闭后焦点归还触发元素
- [ ] 树 `role="tree"` / `aria-expanded`，列表 `role="listbox"` / `aria-selected`，开关 `role="switch"` + `aria-checked`
- [ ] 图标按钮均有 `aria-label`，状态不只用颜色表达
- [ ] 全部文案经 `ctx.locale.bind(NS)`，`zh` / `en` 键集完全一致

**样式**
- [ ] 样式只引用 `--dsw-alias-*`（及经核验的同族 token），无字面色值（图标除外）
- [ ] 明暗两态均正常（宿主切 `body[data-ds-dark-theme]` 时自动跟随）
- [ ] 插件样式作用域限定在 `.hss-*` 前缀类

**导入**
- [ ] 项目列表来自 `ctx.workspaceRegistry.list()`，非文件系统猜测
- [ ] 导入写入 `~/.dsh/skills/<slug>/`（目录不存在时自动创建）
- [ ] 项目导入写入 `<ws.path>/.dsh/skills/<slug>/`，并提示 rank 100 覆盖全局
- [ ] 导入后 `ctx.skills.list()` 能看到新 skill（端到端）
- [ ] 批量导入逐条更新状态，汇总显示"12 个中 9 个成功"

---

## 附录 A：本文引用的 API 来源清单

| API | 来源 | 取得方式 |
|---|---|---|
| `commands.register` / `commands.execute` (Host) | A | `Service.listService { service: "commands" }` |
| `ctx.remote.commands.execute(agentId, line, attachments, signal?)` | B | `dsh-commands/lib/typert.remote-client.d.ts` |
| `ctx.remote.commands.list(agentId)` | B | 同上 |
| `RemoteResult<T>` | B | `dsh-typert-protocol/lib/types/types.d.ts:110` |
| `fs.resolve/listDir/readText/stat/lstat/writeText/editText` | A | `Service.listService { service: "fs" }` |
| `FsTarget` / `FsDirEntry` / `FsInfo` / `FsPathInfo` | A | 同上 `referencedTypes` |
| `skills.registerProvider/list/snapshot/get` | A | `Service.listService { service: "skills" }` |
| `SkillProvider` / `SkillSummary` / `SkillCandidate` / `SkillDefinition` | A | 同上 `referencedTypes` |
| `workspaceRegistry.list/create` | A | `Service.listService { service: "workspaceRegistry" }`（catalog） |
| `workspaceController.create` | A | `Service.listService { service: "workspaceController" }` |
| `directoryPickerController.pick` | A | `Service.listService { service: "directoryPickerController" }` |
| `pluginManager.listPlugins/listBundles` | A | `Service.listService { service: "pluginManager" }` |
| `Remote` 装饰器 / `TypertRemoteService` | B | `dsh-typert-protocol/lib/types/index.d.ts:121-147` |
| `ctx.slots.register/inject/entries/subscribe/getVersion` | B | `dsh-client-ui-renderer/lib/types/client/registry.d.ts` |
| slot key 全集（`main` / `sidebar.panellist` / `shell.overlay` / …） | B | 各 `dsh-client-ui-*/lib/types/client/**/slots.d.ts` |
| `ctx.locale.register/bind/getSnapshot/subscribe` | B | `dsh-client-locale/lib/types/client/index.d.ts` |
| `--dsw-alias-*` 107 个 token + `body[data-ds-dark-theme]` | B | `dsh-client-ui-theme/lib/client.js` |
| slot 注册 / locale 注册 / remote 调用的**用法范式** | B | `dsh-client-ui-plugin-manager/lib/client.js`、`dsh-client-ui-plan/lib/client.js:704` |
| `ctx.layout.selectPanel` / `ctx.layout.panelInfo`（subscribe + getSnapshot().activePanelId） | B | `dsh-client-ui-layout/lib/types/client/service.d.ts`（`ILayout`）、`dsh-client-ui-plugin-manager/lib/client.js:4461,4467` |
| `ctx.reflect.provide(name, value)` → disposer | B | `cordis/lib/types/reflect.d.ts`（`ReflectService.provide`） |
| `ctx.slots` 注册选项：`{ name, key, id, order, label, locale, store, inject, children }` | B | 同上 `:4417,4483` |
| `children` 声明语法 `{ kind: 'list' \| 'keyed', scope: 'root' }` | B | 同上 `:4423-4460` |
| `resolveSlotLabel(entry.options.label)`（label 支持字符串或函数） | B | 同上 `:56` |
| `SKILL_NAME` 正则 / `parseSkillFile` 判定 / `discoverRoot` 扁平化 | B | `dsh-skill/lib/index.js:17`、`dsh-skill-filesystem/lib/index.js:584,667` |
| `LocalFileSystem` 行为（realpath、cwd 非边界、覆写 `processPathFromHostPath`） | B | `dsh-fs-local/lib/types/index.d.ts` |

## 附录 B：本机 Hermes 实测数据

```
~/.hermes/skills/                     顶层 61 个目录（57 非隐藏），39 个含 SKILL.md
~/.hermes/skills/                     18 个分类目录 = 10 个含嵌套 skill + 8 个叶子目录
~/.hermes/profiles/                   novelist, opc, quant-engine
~/.hermes/profiles/novelist/skills/   含 铁蛋作家/ 与 铁蛋作家.zip、novelist-writer（刚刚构建好时）.zip
~/.config/hermes/                     存在，仅 feishu/，无 skills/
/opt/hermes                           不存在
/usr/local/hermes                     不存在
PATH 中 hermes                        ~/.local/bin/hermes → exec ~/.hermes/hermes-agent/.hermes/bin/hermes
递归 SKILL.md 总数                    74（find -name SKILL.md -not -path '*/.*'）
嵌套分类组（含 skill 数）             autonomous-ai-agents(3) creative(6) devops(4) github(7)
                                      mcp(2) mlops(1) productivity(3) research(2)
                                      self-discipline(1) software-development(2)
叶子分类目录（无 skill）              apple email media note-taking smart-home social-media web
                                      （均仅含 DESCRIPTION.md）+ rockchip-tvbox-linux-flash（仅 references/）
隐藏元数据                            .archive .bundled_manifest .curator_ledger.jsonl .curator_state
                                      .curator_suppressed .usage.json .usage.json.lock
主目录需改名 8 个                     量化引擎 李大霄战略 财经资讯采集分析选股 通达信金融数据专家
                                      全能金融爬虫 中国宏观消费市场数据采集 蒸馏版量化交易系统
                                      hermes-novelist（声明名含括号+中文，目录名合法）
```

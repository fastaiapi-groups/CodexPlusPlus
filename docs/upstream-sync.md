# 官方上游同步与 FastAiApi 定制维护

维护约定建立于 2026-11-11。后续用户说「更新同步」「同步官网」「合并上游」，默认执行本文流程。目标是持续吸收上游改进，同时保留 FastAiApi 功能、现有用户数据和自有发布通道。

## 仓库与分支

| 名称 | 身份 | 使用规则 |
| --- | --- | --- |
| `origin` | `git@github.com:BigPizzaV3/CodexPlusPlus.git`，官方上游 | fetch、对比、merge 来源，禁止推送 |
| `fastai` | `git@github.com:fastaiapi-groups/CodexPlusPlus.git`，用户仓库 | 自有代码与发布历史的保存位置 |
| `main` | 自有集成主线，跟踪 `fastai/main` | 日常定制、验证后的同步最终进入这里 |
| `codex/sync-upstream-<日期>-<短SHA>` | 单次临时同步分支 | 从自有 main 创建；保留普通 merge 提交；验证后快进 main |
| `backup/pre-upstream-<日期>-<短SHA>` | 同步前本地备份分支 | 固定旧 main；不自动删除、不自动推送 |

保留现有 remote 名称，不互换 origin/fastai。工作区中另有本地 `fastai` 分支，它不是 `fastai/main`，不能凭名称把它当成最新主线。

采用普通 merge 保留共同祖先，Git 下次能识别已经合过的提交。不要反复复制源码、下载压缩包覆盖、squash 整个上游或 rebase 已发布 main；这些会丢失同步关系或增加后续重复冲突。最终推送（按当次交付范围）使用 `git push fastai main:main`，不用裸 `git push` 或 `git push --all`。

## 减少冲突的代码组织

1. 定制优先留在已有独立目录：前端 `src/fastaiapi/`、Rust `fastaiapi_*.rs`、`integrations/fastaiapi/`。前端入口、Tauri 注册、核心配置生成等共享文件只放必要接入点；不要把平台业务继续堆入 `App.tsx`。
2. 平台差异集中到已有平台适配层，New API/SubAPI、路线、支付、媒体协议共用清晰接口。复用上游组件与能力，避免复制一整套上游页面或核心模块。
3. 定制提交尽量一项行为一组提交，功能和格式化分开；不为了同步统一引号、换行、目录或大范围命名。必要的共享接入在保护清单中记录，方便下次定位。
4. 自有更新源、公钥、安装器和品牌配置独立维护；不把官方版本号、官方更新源、官方发布工作流原样套到自有发行。依赖清单、锁文件、构建配置确需改动时说明原因并一起验证，不能一律保留旧文件。
5. 上游提供同等功能后，先对照定制验收项判断行为、数据格式和迁移兼容，再用上游实现替代重复代码。仅名字相同不算等价；未确认前保留原能力。
6. 后续可按实际冲突热点小步抽取接口；本方案不授权现在进行大重构。每次同步单独记录可减少的差异，再在独立改动中处理。

不设置全仓库 `merge=ours`、自动保留本地文件的合并驱动或自动 ours/theirs。`rerere` 可在确有重复冲突时经审查后局部启用，仍需逐段复核复用结果，不能把自动解冲突当成验收。

## 每次同步的执行顺序

### 1. 保护现场，更新引用

先读根 `AGENTS.md`、本文、[定制清单](fastai-customizations.md) 和上次同步记录。检查 `git status --short`、当前分支、所有 worktree、remote 和 main 跟踪关系。存在未提交改动时不自动 stash、提交用户改动或覆盖文件；先说明需要保护的现场。正在 merge/rebase 时先处理现有任务。

在干净的自有 main 上执行：

```sh
git fetch --no-tags fastai main
git fetch --no-tags origin main
git rev-list --left-right --count main...fastai/main
git merge-base main origin/main
```

检查每条命令成功后再继续。main 落后且无本地独有提交时可 `git merge --ff-only fastai/main`；存在分叉先审查并处理自有分支差异，不把它混入上游冲突。没有共同祖先、远程地址不符或 fetch 失败就停止合并，不能使用 `--allow-unrelated-histories` 或把旧缓存描述为最新上游。

fetch 默认不拉标签，避免上游版本标签和自有发行标签混用。用户指定版本时需核实目标 tag/commit 来源并固定 SHA；没有指定时以本次 fetch 成功后的 `origin/main` 为目标，不在合并中途追逐移动的分支头。

### 2. 固定本轮基线，盘点重叠

记录以下值：

```sh
git rev-parse main
git rev-parse fastai/main
git rev-parse origin/main
git merge-base main origin/main
git log --oneline main..origin/main
git log --oneline origin/main..main
git diff --stat main...origin/main
git diff --name-status main...origin/main
git diff --name-status origin/main...main
```

最后两条分别是相对共同祖先的上游侧和自有侧改动。取路径交集作为重点审查列表，仍需检查跨文件调用、命令注册、数据格式、更新工作流等没有文本重叠的影响。不能仅凭提交标题判断哪些功能属于定制；必须对照清单、实际 diff 和测试。

将清单中尚未登记的新功能补齐。为基线 main 建立唯一的本地 `backup/pre-upstream-*` 分支，再从该 main 建立唯一的 `codex/sync-upstream-*` 分支，使用上面已记录的完整上游 SHA：

若跨越多个版本或共享入口变化很大，先把目标之前的上游版本提交排成批次，核验每个批次 SHA 在目标上游历史上且前后为祖先关系，再从旧到新逐批普通 merge、验证、提交。第一批须覆盖共同祖先之后的连续历史，不随意挑功能 cherry-pick。中间批次留在同步分支，最终目标完成后再进入 main；若只能完成部分批次，明确报告进度，不能称已同步到最新。每批复用同一份保护清单并记录已验证的上游 SHA。

```sh
git merge --no-ff --no-commit <已固定的上游完整SHA>
```

命令中的占位符必须替换成已核验值。若上游 SHA 已是 main 祖先，则无需重复 merge；说明已同步，并按实际需要验证。备份引用只保护 Git 提交，不保护运行时状态；涉及数据迁移时，还要按现有安全流程保存可恢复状态，备份不进入 Git，不打印凭据。

### 3. 按行为解决冲突

用 `git diff --name-only --diff-filter=U` 列出冲突，逐文件查看 base、本地、上游三方内容和调用方。每项记录「上游目的 / 定制目的 / 兼容实现 / 验证证据」。

- 上游新增和修复应尽量接收，平台定制通过独立模块或薄接入保留。
- 共享配置生成必须保留 per-model 窗口与旧 per-profile 行为，也接收上游必要的路径、安全和协议修复。
- App 入口与命令注册两边都可能新增能力，必须合并注册、事件和样式依赖，不能只保留一个版本。
- 定制文件被上游移动或删除时，判断新的接入位置，不以重新放回旧文件代替功能可用。
- 更新源、公钥、平台身份、凭据隔离、安装路径是重点保护项；审查上游 release 工作流在 fork 中的触发条件，防止误发布。
- 不确定的产品取舍影响现有定制时，保留现场，向用户说明具体差异后再决定，不猜测移除功能。

解决后只暂存核对过的文件，不使用无差别 `git add .`。检查 `git diff --cached` 及相对同步前 main 的总差异，即便 Git 自动合并也要审查。

### 4. 验证、构建与启动

验证命令及范围以当时代码、清单和既有项目规范为准；不安装未知依赖、不另起 Rust 工具链。常用入口：

```sh
cargo test -p codex-plus-core
cargo test -p codex-plus-data
```

在 `apps/codex-plus-manager/` 内执行 `npm run check` 和 `npm test`，按受影响范围补充已有 Tauri、注入层、媒体技能及发布升级检查。涉及注入分片时先读汇编脚本，再运行 `node scripts/assemble-renderer-inject.mjs` 并审查生成物。检查 `git diff --check`、无未解冲突和无遗漏冲突标记，完成定制清单逐项核对。

最后必须在仓库根运行已审查的 `node scripts/relaunch-local.mjs`，使用固定 `dist/local-build/Codex++.app`，保留 Info.plist、LSEnvironment 和 state；不新建任务 bundle。脚本会构建、签名、启动并清理历史构建；核对真实进程及签名状态，不能仅凭命令退出就宣称界面功能通过。

离线测试优先，不自动进行真实充值、注册、发布或付费生成。Windows/Linux 未实测、钥匙串授权阻塞、真实接口未验证等须在报告中明确记录，不能用 macOS 成功替代全平台通过。关键回归失败或构建启动未完成时不得宣称同步交付完成。

### 5. 留存记录，进入自有 main

每轮在 `docs/upstream-sync/` 新建 `<日期>-<上游短SHA>.md`，同日多轮加序号。至少记录：

- 同步前自有 SHA、远程 fastai SHA、共同祖先、目标上游完整 SHA；
- 上游版本/主要变化、与定制重叠的文件；
- 每个冲突及语义兼容决策、保留/替代的定制项；
- 实际执行的测试与结果、固定 App 构建启动结果、未验收项；
- 本地备份分支、同步分支、是否已合入/推送及后续事项。

同步记录与保护清单随合并一起提交，例如 `merge: sync origin/main <短SHA> and preserve FastAiApi customizations`。提交后检查 `git merge-base --is-ancestor <上游SHA> HEAD` 成功，确认本轮上游历史确实进入集成结果。

切回 main 前确认工作区干净。main 仍在预期基线时执行 `git merge --ff-only <同步分支>`，保持上游 merge 提交；如果 main 在期间有新提交，则重新集成并验证，不能强行移动 main。默认不建 PR。按当次范围需要推送时显式 `git push fastai main:main`；被拒绝时重新 fetch、核对，禁止强推。最终反馈目标 SHA、定制保留情况、验证和推送状态。

## 失败恢复

- 合并尚未提交：确认现场后 `git merge --abort`，保留备份和调查记录，不使用 `reset --hard`、`clean -fd`。
- 已提交但未合入：main 保持不变，在同步分支修正或保留失败现场。
- 已合入或已推送：先确认具体同步 merge 提交和后续依赖，再用 `git revert -m 1 <同步merge提交>` 生成回退提交并重新验证，不重写发布历史。
- 代码回退不等于数据库、配置或凭据回退。迁移及运行时状态需单独评估，不能把旧状态直接覆盖到现有账号。

## 建立方案时的状态

2026-11-11 核对（写入本文前工作区干净）：

- 自有 main：`4ed1f862ff00ccf2c5fe68d48ff5e27906764359`，跟踪 `fastai/main`；本地 `fastai` 分支仍在 `f336e270`。
- 本次成功 fetch 的官方 main：`38033bf98325a32bbb80842441e2e0e2b3c9d7bd`，近期发布提交为 `v2.6.2`。
- 共同祖先：`230abc3f24068f9193e7f1b9592772ac3b1f5849`；双方独有提交分别为自有 38、上游 1131。
- 相对共同祖先，上游变动 1310 个路径、自有变动 171 个路径，两侧重叠 20 个路径。这是审查范围，不是实际冲突数。重叠入口含 `App.tsx`、Tauri `lib.rs`/`main.rs`、core `lib.rs`/`relay_config.rs`。

首次同步建议按上游版本分批验证，尤其先核对共享入口、配置及版本/更新链路。本次任务建立维护方案与定制清单，不执行上游代码合并、不更改发布通道，也不把 fetch 当作已完成同步。后续首次执行时必须重新 fetch 并计算共同祖先，不能把此处快照作为永久基线。

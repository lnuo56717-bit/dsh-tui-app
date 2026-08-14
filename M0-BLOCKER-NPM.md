# M0 停机报告：锁定提交的 rc.5 包未发布到 npm

状态：**BLOCKED — 等待上游裁决/发布**  
核对日期：2026-08-14  
dsh 锁定提交：`47f943859bef60e4160492346772ded9b24f765a`

## 触发规则

任务书 `dsh-tui_任务书_v1.1.md`：

- 第 93 行：out-of-tree 插件依赖锁死到确切 rc 版本。
- 第 135 行：M0 必须逐包核实 npm 可装性。
- 第 164 行：npm 包缺失必须停机上报，不得自行绕过。
- 第 166 行：全程锁死提交 `47f9438`，升级适配另立任务。
- 第 168 行：本机 dsh 检出只读，禁止在其中写入。

## 锁定源码版本证据

以下 manifest 均从 `D:\deepseek-harness` 的锁定提交通过 `git show 47f9438:<path>` 读取，没有读取工作树改动：

| 源码路径 | 包 | manifest 版本 |
|---|---|---|
| `packages/bundle/base/package.json:2-4` | `@deepseek-ai/dsh-base` | `0.1.0-rc.5` |
| `packages/boot/cmdline/package.json:2-4` | `@deepseek-ai/dsh-cmdline` | `0.1.0-rc.5` |
| `packages/core/session/package.json:2-4` | `@deepseek-ai/dsh-session` | `0.1.0-rc.5` |
| `packages/core/agent/package.json:2-4` | `@deepseek-ai/dsh-agent` | `0.1.0-rc.5` |
| `packages/interaction/user-approval/package.json:2-4` | `@deepseek-ai/dsh-user-approval` | `0.1.0-rc.5` |
| `packages/interaction/commands/package.json:2-4` | `@deepseek-ai/dsh-commands` | `0.1.0-rc.5` |
| `packages/session/session-projection/package.json:2-4` | `@deepseek-ai/dsh-session-projection` | `0.1.0-rc.5` |

本机 `dsh --version` 也报告 `0.1.0-rc.5`，但它由 `D:\deepseek-harness\apps\cli\lib\bin.js` 的本地源码构建启动，不证明 npm artifact 存在。

## npm registry 原始失败

执行只读 metadata 查询：

```text
npm view @deepseek-ai/dsh-base@0.1.0-rc.5 dependencies --json
```

registry 返回：

```text
npm error code E404
npm error 404 No match found for version 0.1.0-rc.5
npm error 404 The requested resource '@deepseek-ai/dsh-base@0.1.0-rc.5' could not be found or you do not have permission to access it.
```

## 已发布版本交叉核对

对以下七个直接关键包执行 `npm view <name> versions --json`，结果一致：都存在 `0.1.0-rc.2`、`0.1.0-rc.3`、`0.1.0-rc.6`，都缺少 `0.1.0-rc.5`。

- `@deepseek-ai/dsh-base`
- `@deepseek-ai/dsh-cmdline`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-agent`
- `@deepseek-ai/dsh-user-approval`
- `@deepseek-ai/dsh-commands`
- `@deepseek-ai/dsh-session-projection`

`@deepseek-ai/dsh-base@0.1.0-rc.6` 存在，但 registry metadata 没有 `gitHead`，无法证明 rc.6 artifact 与锁定提交逐文件一致。直接改用 rc.6 会违反任务书的锁提交/升级守则。

## 需要人审裁决

### A（建议）：上游补发锁定提交对应的 `0.1.0-rc.5` 全套包

维持现有任务书、ADR-2 和 AC-7，不引入本地路径依赖。

### B：上游提供 rc.6 与锁定提交等价的可验证证据，并发布 v1.2 改锁版本

需要至少给出发布 provenance、tag/commit 映射或 artifact 校验依据；这属于任务书升级，当前执行者不能自行认定。

### C：任务书正式改为本地源码/文件依赖开发

会牺牲 out-of-tree npm 可复现性，并需明确如何在“本机 dsh 检出只读”的约束下构建、测试和安装；属于 ADR-2 分叉。

## 停机范围

- v1.1 的 transcript 数据面裁决已接受，但尚未进入实现。
- 未创建 `INTERFACES.md`、`EVENT-SPEC.md`、`UX-SPEC.md` 或 `SPIKE.md` 的不完整版本。
- 未运行 Ink spike，未下载 npm tarball，未安装或重装 dsh。
- 未修改 `D:\deepseek-harness`，也未触碰其中另一参赛者的文件。
- 独立工作区仅新增本停机报告；此前的 transcript 停机报告保留作审计记录。

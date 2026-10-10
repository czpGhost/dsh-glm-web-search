# dsh-glm-web-search

<p align="center">
  <b>把你已有的 Z.AI（GLM）套餐额度，变成 DeepSeek Harness 的搜索、读取与视觉能力。</b><br>
  用现有 Z.AI 账号登录即可 —— 无需 API Key，无需另外计费。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-glm-web-search"><img src="https://img.shields.io/npm/v/dsh-glm-web-search?label=npm&color=CB3837" alt="npm"></a>
  <a href="https://www.npmjs.com/package/dsh-glm-web-search"><img src="https://img.shields.io/npm/l/dsh-glm-web-search?label=license" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/dependencies-0-success" alt="Dependencies">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-glm-web-search">npm</a> ·
  <a href="https://github.com/czpGhost/dsh-glm-web-search">GitHub</a> ·
  <a href="README.md">English</a>
</p>

```bash
dsh plugin --profile desktop add dsh-glm-web-search
```

## 为什么做这个项目

DeepSeek Harness 的 `web_search` / `web_fetch` 默认走官方后端，需要额外准备 API Key 和独立计费。
但很多人手上已经有 Z.AI 的套餐额度 —— 那份额度本来就能跑 `web_search_prime` 和 `webReader`，
只是没人把它接到 harness 上。

这个插件做的就是这件事：**一次邮箱登录，把你的订阅额度变成 harness 的搜索与读取能力**。
安装即生效，模型看到的工具名字和参数都不变，只是背后的服务换成了 Z.AI。

## 功能特性

| 能力 | 说明 |
|---|---|
| **网页搜索** | 替换官方 `web_search` 后端，由 `web_search_prime` 提供结果 |
| **网页读取** | 替换官方 `web_fetch` 后端，由 `webReader` 提取正文 |
| **视觉理解** | 新增 `zai_vision` 工具，可直接读图、OCR、看图问答 |
| **零依赖** | 没有 `node_modules`，没有 `dependencies`，也没有 `peerDependencies` |
| **状态栏** | `/dsh-glm-status` 一行展示令牌时效、套餐到期与剩余额度 |

## 安装

### 在插件管理器里安装

打开 **插件 → 添加插件**，输入包名，点 **安装**：

```text
dsh-glm-web-search
```

安装源保持 **npm** 即可；官方源慢的话可以切到 **中国大陆镜像源**（npmmirror），
两边提供的是同一个包。装完请重启 harness —— 插件代码在启动时载入，不重启不会生效。

### 命令行安装

```bash
dsh plugin --profile desktop add dsh-glm-web-search
```

### 从本仓库安装

本地开发，或需要锁定某个提交时：

```bash
dsh plugin --profile desktop add github:czpGhost/dsh-glm-web-search
dsh plugin --profile desktop add /absolute/path/to/dsh-glm-web-search
```

本项目不含任何构建脚本，所以 pnpm 不会要求你授权执行安装脚本。

### 然后登录一次

```text
/dsh-glm-web-search login
```

浏览器会自动打开授权页，同意后令牌自动落盘。之后 `web_search` 和 `web_fetch` 就走 Z.AI 了。

## 使用

```text
/dsh-glm-web-search login     # 登录（打开浏览器，授权后自动保存）
/dsh-glm-web-search logout    # 登出，清除本地凭据
/dsh-glm-web-search status    # 查看令牌、套餐与额度

/dsh-glm-login     /dsh-glm-logout     /dsh-glm-status    # 等价别名
```

每个子命令都注册了独立别名，因为命令菜单是按**名字**匹配的 ——
输入 `/dsh-glm-log` 时才会同时提示 `login` 和 `logout`。

### 升级

插件管理器不会自动更新已安装的插件。先卸载旧版，再装新版：

```bash
dsh plugin --profile desktop remove dsh-glm-web-search
dsh plugin --profile desktop add dsh-glm-web-search
```

然后重启。你的登录凭据存放在包目录之外，升级不会丢失。

## 截图

`/dsh-glm-status`：

```text
  ▸ token 30m · Start Plan · GLM-5.3 2.95M left · resets 2h 57m

      account  you@example.com
               token valid 30m

      plan     ZCode Start Plan [active] · ends 10-12 23:59 (3d 2h)
      quota    GLM-5.3        ██████████  98%  2.95M/3M   resets 2h 57m
      quota    GLM-5.3-Flash  ██████████ full      resets 2h 57m
      cycle    daily grant, refills at 00:00 Asia/Shanghai
```

额度条画的是**剩余量**。如果画已用量，一个全新账号会显示成空条 —— 读起来正好是反的。

## 配置

| 字段 | 默认值 | 用途 |
|---|---|---|
| `origin` | `https://zcode.z.ai` | 网关地址 |
| `model` | 未设置（实时解析） | 运行搜索/读取的模型 |
| `appVersion` | 自动探测 | 向网关声明的客户端版本 |
| `jwtEnv` | `ZAI_JWT` | 凭据引用名 |
| `tokenPath` | `$DSH_HOME/dsh-glm-web-search/token.json` | 本地令牌文件 |
| `vision` | `true` | 是否注册 `zai_vision` |
| `timeoutMs` | `90000` | 单次请求超时 |

凭据解析顺序：托管记录 → `$ZAI_JWT` → 本地令牌文件。
无界面环境可设 `ZAI_BROWSER_OPEN=0`，URL 仍会打印出来供手动打开。

## 两点须知

**搜索结果有上限。** 一次 `web_search` 上游最多返回 10 条，harness 的 `dsh-tool-web` 再把
`sources[]` 截到 **8 条**（并置 `truncated: true`）。一次调用可带最多 4 个查询并发执行，
合并后仍套用 8 条上限。

**它完全没有依赖树。** `src/` 只通过注入的服务访问 harness（`ctx.web`、`ctx.tools`、
`ctx.commands`），除 Node 内置模块外不引用自身目录树以外的任何东西 —— 所以既没有
`node_modules`，也没有 `dependencies`，更没有 `peerDependencies`。这不只是干净：
声明 `@deepseek-ai/dsh-*` 的 peer 会让 harness 的安装预检拿你的范围去比对运行时版本，
不匹配就**直接拒绝整个安装**。

更隐蔽的是同一个 harness 包出现第二份副本：版本相同、文件逐字节相同，照样会坏 ——
两份文件就是两个**模块实例**，而模块级 `Symbol()` 在两者之间并不相等。
`@deepseek-ai/dsh-tools` 的内部调度器正是这样建键的
（`const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler")`），
于是 `@deepseek-ai/dsh-agent-loop` 通过 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 取到
`undefined`，整轮以 `Cannot read properties of undefined (reading 'prepare')` 失败。
`Symbol.for()` 的键存在全局注册表里，跨副本共用 —— `schemastery` 用的就是它，
所以它可以安全地出现两份，而 `dsh-tools` 不行。

## 路线图

- [x] 搜索 / 读取 / 视觉三项能力
- [x] 邮箱 OAuth 登录，无需 API Key
- [x] 状态栏与额度显示
- [x] 已发布到 [npm](https://www.npmjs.com/package/dsh-glm-web-search)
- [ ] 完整截图与演示 GIF
- [ ] 英文文档完善（欢迎 PR）

## 常见问题

**需要付费套餐吗？**
不需要。免费账号自带的体验套餐就能跑搜索和读取；视觉能力用的 Flash 模型也在同一份套餐里。

**凭据存在哪里？**
`$DSH_HOME/dsh-glm-web-search/token.json` —— 单个文件，不依赖任何环境变量。
删掉它或执行 `logout` 即可在本机撤销。

**为什么只返回 8 条结果？**
那是 harness 自己的上限，不是 Z.AI 的。上游返回 10 条，`dsh-tool-web` 按
`searchMaxResults`（默认 8）截断。需要更多就在那个插件的配置里调大。

**无界面环境能用吗？**
可以。设 `ZAI_BROWSER_OPEN=0`，`login` 会打印出授权 URL 而不是打开浏览器。

**Z.AI 更新客户端后会不会失效？**
有可能 —— 网关会校验客户端指纹，新的 ZCode 版本可能需要同步更新身份常量。
这里是一行改动，不涉及重构。

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=czpGhost/dsh-glm-web-search&type=timeline&legend=top-left)](https://www.star-history.com/?repos=czpGhost%2Fdsh-glm-web-search&type=timeline&legend=top-left)

## 免责声明

本项目仅用于技术分享与学习交流，请遵守相关服务条款与法律法规，自行承担使用风险。

## License

[MIT](LICENSE)

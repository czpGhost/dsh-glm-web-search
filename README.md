# dsh-glm-web-search

<p align="center">
  <b>Use your Z.AI (GLM) subscription as DeepSeek Harness's search, fetch and vision backend.</b><br>
  Sign in with the Z.AI account you already have — no API key, no separate billing.
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
  <a href="README-CN.md">中文文档</a>
</p>

```bash
dsh plugin --profile desktop add dsh-glm-web-search
```

## Why this exists

DeepSeek Harness ships its own `web_search` / `web_fetch` backends, which means another API key
and another bill. But plenty of people already pay for a Z.AI plan — and that quota can already
run `web_search_prime` and `webReader` server-side. Nobody had wired it up.

This plugin does exactly that. **One email login turns your existing subscription into the
harness's search and fetch capability.** Installing it is enough; the tool names and arguments
the model sees do not change, only the service behind them.

## Features

| Capability | What it does |
|---|---|
| **Web search** | Replaces the official `web_search` backend with `web_search_prime` |
| **Web reader** | Replaces the official `web_fetch` backend with `webReader` |
| **Vision** | Adds a `zai_vision` tool for image description, OCR and visual Q&A |
| **Zero dependencies** | No `node_modules`, no `dependencies`, no `peerDependencies` |
| **Status line** | `/dsh-glm-status` shows token age, plan expiry and remaining quota |

## Install

### From the Plugin Manager

Open **Plugins → Add plugin**, type the package name, and press **Install**:

```text
dsh-glm-web-search
```

Leave the install source on **npm** — or switch it to **Mainland China mirror** (npmmirror) if the
official registry is slow; both serve the same tarball. Restart the harness afterwards: plugin code
is loaded at startup, so a freshly installed plugin is not active until then.

### From the command line

```bash
dsh plugin --profile desktop add dsh-glm-web-search
```

### From this repository

For a local checkout, or to pin an exact commit:

```bash
dsh plugin --profile desktop add github:czpGhost/dsh-glm-web-search
dsh plugin --profile desktop add /absolute/path/to/dsh-glm-web-search
```

Nothing here runs a build script, so pnpm never asks you to allowlist one.

### Then sign in once

```text
/dsh-glm-web-search login
```

Your browser opens the authorization page; the token is stored automatically on approval.
From then on `web_search` and `web_fetch` resolve to Z.AI.

## Usage

```text
/dsh-glm-web-search login     # sign in (opens your browser)
/dsh-glm-web-search logout    # sign out, forget the local credential
/dsh-glm-web-search status    # token, plan and quota

/dsh-glm-login     /dsh-glm-logout     /dsh-glm-status    # equivalent aliases
```

Each subcommand is also a standalone command because the menu matches on a command's **name**:
typing `/dsh-glm-log` is what surfaces both `login` and `logout`.

### Upgrading

The Plugin Manager does not auto-update installed plugins. Remove the old version first, then add
the new one:

```bash
dsh plugin --profile desktop remove dsh-glm-web-search
dsh plugin --profile desktop add dsh-glm-web-search
```

Then restart. Your credential lives outside the package, so it survives an upgrade.

## Screenshot

`/dsh-glm-status`:

```text
  ▸ token 30m · Start Plan · GLM-5.3 2.95M left · resets 2h 57m

      account  you@example.com
               token valid 30m

      plan     ZCode Start Plan [active] · ends 10-12 23:59 (3d 2h)
      quota    GLM-5.3        ██████████  98%  2.95M/3M   resets 2h 57m
      quota    GLM-5.3-Flash  ██████████ full      resets 2h 57m
      cycle    daily grant, refills at 00:00 Asia/Shanghai
```

The quota bar draws **remaining**, not used. Drawn as used, a brand-new account would render as
an empty bar — which reads as "exhausted", exactly backwards.

## Configuration

| Field | Default | Purpose |
|---|---|---|
| `origin` | `https://zcode.z.ai` | Gateway origin |
| `model` | unset (resolved live) | Model that runs search and fetch |
| `appVersion` | probed | Client version advertised to the gateway |
| `jwtEnv` | `ZAI_JWT` | Credential reference |
| `tokenPath` | `$DSH_HOME/dsh-glm-web-search/token.json` | Local token file |
| `vision` | `true` | Register the `zai_vision` tool |
| `timeoutMs` | `90000` | Per-request deadline |

Credential order: managed record → `$ZAI_JWT` → the local token file.
On a headless host, set `ZAI_BROWSER_OPEN=0`; the URL is still printed so you can open it yourself.

## Two things worth knowing

**Search results are capped.** Upstream returns at most 10 sources per `web_search` call, and the
harness's `dsh-tool-web` then truncates `sources[]` to **8** (setting `truncated: true`). One call
may carry up to 4 queries, run concurrently; the merged result still hits the 8-source cap.

**It has no dependency tree at all.** `src/` reaches the harness only through injected services
(`ctx.web`, `ctx.tools`, `ctx.commands`), and imports nothing outside its own tree except Node
builtins — so there is no `node_modules`, no `dependencies`, and no `peerDependencies`. That matters
beyond tidiness: declaring a `@deepseek-ai/dsh-*` peer makes the harness's install preflight compare
your range against the runtime version and **reject the whole installation** when they disagree.

The subtler hazard is a second copy of a stateful harness package. Same version, byte-identical
files, and it still breaks: two files mean two *module instances*, and a module-local
`Symbol()` differs between them. `@deepseek-ai/dsh-tools` keys its internal scheduler on exactly
that (`const TOOL_RUNTIME_SCHEDULER = Symbol("@deepseek-ai/dsh-tools.scheduler")`), so
`@deepseek-ai/dsh-agent-loop` reaching through `ctx.tools[TOOL_RUNTIME_SCHEDULER]` finds
`undefined` and the turn dies with `Cannot read properties of undefined (reading 'prepare')`.
`Symbol.for()` keys live in a global registry and survive duplication — `schemastery` uses one,
which is why it is safe to appear twice and `dsh-tools` is not.

## Roadmap

- [x] Search, fetch and vision
- [x] Email OAuth login, no API key
- [x] Status line with quota
- [x] Published on [npm](https://www.npmjs.com/package/dsh-glm-web-search)
- [ ] Real screenshots and a demo GIF
- [ ] Documentation polish (PRs welcome)

## FAQ

**Do I need a paid Z.AI plan?**
No. A free account gets an experience plan that already covers search and fetch. Vision needs the
Flash model, which the same plan includes.

**Where is my credential stored?**
`$DSH_HOME/dsh-glm-web-search/token.json` — one file, no environment variables required. Delete it
or run `logout` to revoke locally.

**Why do I only get 8 results?**
That is the harness's own cap, not Z.AI's. Upstream returns 10; `dsh-tool-web` trims to
`searchMaxResults` (default 8). Raise it in that plugin's config if you need more.

**Does this work headless?**
Yes. Set `ZAI_BROWSER_OPEN=0` and `login` prints the URL instead of opening a browser.

**Will it break when Z.AI ships a new client?**
Possibly — the gateway fingerprints the client, so a new ZCode build can invalidate the identity
constants. That is a one-line fix here, not a redesign.

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=czpGhost/dsh-glm-web-search&type=timeline&legend=top-left)](https://www.star-history.com/?repos=czpGhost%2Fdsh-glm-web-search&type=timeline&legend=top-left)

## Disclaimer

This project is for technical sharing and learning purposes only. Please comply with the relevant
terms of service and applicable laws, and use it at your own risk.

## License

[MIT](LICENSE)

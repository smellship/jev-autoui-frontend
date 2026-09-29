# UI 测试平台 · 前端

Vue 3 + Vite + Element Plus + Monaco 的单页应用，只认后端 `/api/v1`（REST + SSE），
不 import 内核代码，也不碰数据库。

## 跑起来

前置：后端 `ui_backend` 已在 `http://127.0.0.1:8770` 跑着（开发期用内核桩即可）。

```bash
npm install
npm run dev          # http://localhost:5273
```

开发服务器把 `/api` 代理到后端，目标地址可用环境变量覆盖：

```bash
VITE_API_TARGET=http://<后端主机>:8770 npm run dev
```

其他命令：

```bash
npm run typecheck    # vue-tsc --noEmit
npm run build        # 产物在 dist/（构建即做类型检查）
npm run preview      # 本地预览构建产物
```

## 构建产物怎么托管

业务代码一律用相对路径 `/api/v1/...`，所以「同源托管」是最省事的部署方式：

- **A · 后端托管**：把 `dist/` 拷到 `ui_backend/frontend/dist`，后端起服务时会自动挂到 `/`。
  注意：后端目前只做静态挂载，没有 history fallback，刷 `/cases/sc-0001-01` 这类深链接会 404，
  需要后端补一条「非 /api 且非静态文件 → index.html」的兜底路由。
- **B · 前置网关**：nginx 托管 `dist/` 并配 `try_files $uri $uri/ /index.html;`，把 `/api` 反代到后端。
  这条路不依赖后端改动，深链接天然可用。

## 鉴权与产物访问

- 登录后 token 放在 `localStorage["ui_web_token"]`，axios 请求拦截器统一加 `Authorization: Bearer`。
  401 会清 token 并跳登录（带 `?next=` 回跳）—— 但只认 `unauthorized / token_invalid / account_disabled`
  这几种"会话失效"；登录输错密码、设置页填错原密码（`bad_credentials` / `bad_password`）只是本次业务失败，不会把人踢下线。
- **SSE**：浏览器原生 `EventSource` 不能带请求头，所以 `src/api/sse.ts` 用 `fetch` 读流、自己切帧
  （`event: status|trace|done`，从 offset 0 重放，断线重连由调用方决定）。
- **产物**：截图/快照/报告都要带 token，`<img>`/`<a>` 带不了，因此先取 blob 再转 object URL
  （`src/utils/artifact.ts`）。报告在当前页弹窗里用 iframe 预览（`sandbox="allow-same-origin"`，
  禁脚本），想看原样交互可以点「新标签打开」——注意这次 `window.open` 必须同步发起，
  await 之后调用会被浏览器弹窗拦截。

## 页面导览

| 路由 | 页面 | 要点 |
| --- | --- | --- |
| `/login` | 登录 | 账号密码 → `/auth/login` |
| `/cases` | 用例管理 | 场景树 + 场景下的用例表；新建场景/用例（用例 id 由后端按场景分配，创建即 v1） |
| `/scenarios/:id` | 场景 | 场景信息、用例增删（整场景串跑已并入「场景管理」） |
| `/scenes` | 场景管理 | 套件平铺列表（编号 su-0001、用例数、最近批次与通过/中止汇总）；行内改名 / 复制 / 删除；「临时串跑」进即席页 |
| `/scenes/:id` | 套件编辑器 | 左侧用例池（节点树 + 搜名/编号 + 跨场景）→ 右侧有序清单（上移/下移/移除、未保存提示、保存清单）；「开始串跑」先自动保存再起批次，批次进度卡轮询 `/batches/{code}`（停止批次 / 关闭） |
| `/scenes/new` | 临时串跑 | 同款编辑器但不落套件：直接 `POST /batches`；「存为套件」可把当前清单转成正式套件 |
| `/cases/:id` | 用例详情 | 自然语言框 + Monaco（同一份内容，不分模式）+ 右侧「快捷插入」+ 运行区（步骤结果 / 决策日志 / 产物清单 / 历史运行）+ 版本抽屉；「导入老脚本」把 midscene.js 转成 YAML 灌进编辑器 |
| `/runs` | 运行记录 | 台账筛选（状态/模式/环境/日期）、页内搜索、导出 CSV、报告与重出；批次成员挂 `批次 b-…` 标记可反查 |
| `/envs` | 环境管理 | 环境配置、密钥（只写，可删单个键）、页清单、探针 |
| `/settings` | 用户/设置 | 账号信息（昵称可改、账号只读、密码只显示"已设置"）、本人改密码；管理员多一块用户管理（新建 / 改昵称 / 停用·启用 / 设为·取消管理员 / 重置密码，自己那一行的停用与权限按钮禁用） |

用例详情页几个约定：

- 编辑内容与已保存 YAML 不一致时标记「未保存」，离开路由和切用例都会拦一次。
- 保存先过服务端校验（`PUT /cases/{id}`），422 时按 `detail.errors[].line` 给 Monaco 打标记；
  409 `version_conflict` 会弹「用我的覆盖 / 放弃我的」，不会静默丢改动。
- 运行前若有未保存改动会问一次；`?run=<id>` 支持深链接到某次运行。
- Jev 决策日志按 `plan_step` 分步骤折叠（只有 `step` 的旧产物/内核桩按 `step` 兜底分组），
  每行能看到操作、目标（含 idx）、置信度、动作结果、点击阶梯、耗时，以及当时喂给模型的快照。
- 右侧「快捷插入」把片段写进编辑器（不自动保存）：
  唯一字段（标题 / 优先级 / 标签 / 负责人 / 环境 / 账号密码）**已有就跳到那一行并选中值**，没有才追加到末尾 —— 避免造出重复键被校验打回；
  可重复的（新增步骤 `goal + checks` 骨架、新增断言）**一律追加到末尾**，追加的缩进跟文档里 `steps:` 现有的写法对齐。
- TestPlan 不在旁边常驻：编译结果收在运行按钮那行最右侧的「TestPlan（编译结果 · N 步）」按钮里，点开是弹窗（可切原始 JSON）。
- 「导入老脚本」弹窗把 midscene.js 整段粘进来 → `POST /cases/{id}/imports`（本地离线转换，不落库）→
  编辑器换上 YAML 并自动校验一次；编辑器上方的导入报告面板给出 步数/断言数（显式·前瞻·兜底）、
  收进 vars 的输入值，以及「待人工」行（认不出的调用不静默丢）——有「待人工」时面板变警示色。

## 与后端的契约（前端依赖的部分）

- 统一错误体 `{ code, message, detail }`；前端识别 `version_conflict`(409)、`lint_failed`(422)、
  `env_unconfigured`、`env_in_use`、`scenario_not_empty` 等码做专门提示。
- 串跑：发起收 202 批次 brief（`POST /batches` 直接传有序 `case_ids`；套件走 `POST /suites/{id}/run`），
  进度轮询 `GET /batches/{code}`（`done` + `counts{passed,failed,aborted,…}`），停止 POST `/batches/{code}/stop`
  （已终态再停 409 `batch_not_active`）；套件存清单 `PUT /suites/{id}/cases` 遇到已删用例引用 409 `suite_has_missing`（先「移除这些引用」）。
  失败默认继续跑完剩余用例，批次汇总里单独计数。
- 列表统一 `?page=&size=`，返回 `{ items, total, page, size }`。
- 运行产物：根目录 `plan.json / summary.json / trace.jsonl / actions.json / report.html / screenshots/ / snapshots/`，
  计划模式下每步还有 `steps/<dir>/…`；前端两套布局都兼容。
- 密钥只写不读：接口只回 `{ key, set }`，页面不回显值；用例里用 `${{secret.键名}}` 引用。
  键名不能含空白和 `= { } ,`（逗号用于 `--secret-keys` 列表拼接），中文键名可以。
- 用户：`PATCH /auth/me` 改昵称、`PUT /auth/password` 改本人密码（要先核对原密码）；
  `/users…` 一律**仅管理员**，非管理员 403 且页面不渲染管理卡片；自己那一行不能停用、不能改自己的权限（后端 409 `self_guard`）。
  管理员重置他人密码后，对方需自行到设置页改密；密码全程不回显（后端只存 PBKDF2 哈希）。

## 已知边界

- Monaco 整包引入，`CaseDetailView` 的 chunk 约 3.3 MB（构建有告警）。内网工具，先不管。
- 报告预览是静态沙箱（无脚本）；内核报告本身也不含脚本。
- 新建用例对话框只收集名称/优先级/模板，正文仍要在详情页写。

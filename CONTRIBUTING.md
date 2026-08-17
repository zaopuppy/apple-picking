# Contributing to Apple Picking

感谢你愿意参与 Apple Picking 的开发。本文件面向准备修改代码、玩法、地图、联机协议、界面或资源的贡献者。

提交改动前，请先阅读项目 [README](README.md)。较大的玩法、协议、地图格式或资源管线变更，建议先通过 Issue 或 Discussion 说明目标、玩家可见行为、兼容性影响和验证方式，避免实现方向已经分叉后再返工。

## 开发环境

需要准备：

- Node.js 20.19+ 或 22.12+；
- npm；
- 本机安装的 Google Chrome，Playwright 测试会使用稳定版 Chrome；
- 支持 WebGL 的桌面环境。

首次检出仓库后运行：

```bash
npm ci
npm run dev
```

常规贡献流程是 fork 仓库、从最新默认分支创建主题分支，再通过 Pull Request 合并：

```bash
git checkout -b net/describe-the-change
```

一个分支只处理一个主题。不要把无关格式化、生成文件或个人调试配置混入功能提交。

开发进程默认提供以下入口：

| 入口 | 地址 | 用途 |
| --- | --- | --- |
| 本地模式 | <http://127.0.0.1:5188/> | 同键盘本地游戏 |
| 在线模式 | <http://127.0.0.1:5188/online.html> | 双浏览器权威联机 |
| 地图编辑器 | <http://127.0.0.1:5188/editor.html> | 地图编辑与验证 |
| 房间健康检查 | <http://127.0.0.1:5190/healthz> | 房间数和服务状态 |

Vite 和多人房间服务默认监听 `0.0.0.0`，因此也可从受信任局域网访问。多人服务支持以下环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APPLE_PICKING_SERVER_HOST` | `0.0.0.0` | Socket.IO/HTTP 监听地址 |
| `APPLE_PICKING_SERVER_PORT` | `5190` | Socket.IO/HTTP 监听端口 |

如果修改多人服务端口，还需要同步修改 [vite.config.ts](vite.config.ts) 中开发和预览环境的 `/socket.io` 代理目标，否则网页仍会连接到 `5190`。

本项目是无 SSL 的演示项目。开发环境使用 HTTP/WebSocket；不要在贡献中加入未经讨论的证书、账号或公网部署方案。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | 本地游戏入口 |
| `src/core/` | 输入、固定循环和渲染器基础设施 |
| `src/game/` | 确定性规则、地图、checkpoint 和共享类型 |
| `src/net/` | 联机协议、插值和客户端预测回放 |
| `src/online/` | 联机大厅、会话和在线页面入口 |
| `src/render/` | Three.js 场景、角色和资源表现 |
| `src/systems/` | HUD、音频、VFX 和浏览器系统桥接 |
| `src/entities/` | 可复用实体代码 |
| `src/utils/` | 无业务所有权的通用工具 |
| `server/` | Socket.IO 网关、房间生命周期和权威模拟 |
| `tests/` | Playwright 规则、浏览器、视觉和联机测试 |
| `scripts/` | 画布检查与资源维护脚本 |
| `docs/` | 设计决策、实施报告和资源说明 |
| `public/assets/` | 浏览器运行时使用的整理后资源 |

主要数据流是：

```text
设备输入 -> GameDriver -> GameSimulation -> snapshot/events -> Three.js/HUD/audio
```

本地模式由 `LocalGameDriver` 直接推进模拟。在线模式由服务端推进权威 `GameSimulation`，客户端使用 `SimulationCheckpoint` 恢复状态、重放未确认输入，并只把预测用于表现；计分、碰撞结果、事件和胜负仍以服务端为准。

## 关键架构约束

### 确定性规则

- `GameSimulation` 必须保持独立于 DOM、Three.js、Web Audio 和浏览器存储。
- 玩法以固定 60 tick/s 推进，不要把规则绑定到渲染帧率或墙上时钟。
- 所有玩法随机数都必须通过种子随机数生成器；不要在规则层使用 `Math.random()`。
- 新增可变规则状态时，同时更新 `SimulationCheckpoint` 的导出、恢复和逐 tick 等价测试。
- 渲染、HUD 和音频只能消费 snapshot 或 event，不应反向拥有玩法状态。
- 明确保持规则更新顺序；捕获、投递、碰撞和胜负的先后变化必须写回归测试并在 PR 中说明。

### 多人联机

- 服务端只接受输入意图，不接受客户端提交的位置、分数、命中、冷却或胜负。
- 每个连接只能控制其席位拥有的角色，协议解析后仍要在房间层检查所有权。
- 一次性动作使用输入边沿；重放远端 held input 时不要重复触发边沿。
- 音效、VFX、计分和胜负只由去重后的权威事件确认，预测模拟产生的事件不能直接提交。
- 修改消息结构、确定性规则或 checkpoint 时，需要同步评估并更新 `PROTOCOL_VERSION`、`BUILD_VERSION`、服务端、客户端、测试和联机架构文档。
- 继续保留 250 ms 输入过期保护、15 秒重连窗口和全量状态恢复语义，除非变更本身就是在重新设计这些规则。

### 地图与资源

- 地图格式变更需要更新版本、解析、迁移、校验、深拷贝和编辑器回归测试。
- 在线房间使用服务端发布的地图；浏览器 `localStorage` 不能覆盖在线权威地图。
- 不要提交来源不明的资源或完整第三方素材包。
- 新增或替换资源时，先更新 [资源许可台账](docs/ASSET_LICENSES.md)，再检查文件大小、三角面、材质、纹理、动画和运行时降级路径。
- `assets/` 用于本地源包且已忽略；仓库只提交运行时真正需要的 `public/assets/` 产物。

## 编码规范

- 使用 TypeScript strict 模式，不绕过 `noUnusedLocals`、`noUnusedParameters` 或 switch 完整性检查。
- 使用两个空格缩进、单引号、分号；多行结构保留尾逗号。
- 类和导出类型使用 `PascalCase`，函数和变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。
- 在高频 update/render 路径中避免无必要的对象创建、DOM 查询和资源加载。
- 把修复放在拥有该行为的模块中，不要在表现层复制规则作为补丁。
- 仓库没有配置自动格式化器或 linter；请匹配相邻代码风格，并以 `npm run build` 作为严格类型门槛。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时启动 Vite 与多人服务 |
| `npm run dev:web` | 只启动 Vite |
| `npm run dev:server` | 以 watch 模式启动多人服务 |
| `npm run build` | 严格 TypeScript 检查并生成 `dist/` |
| `npm run preview` | 启动生产构建预览和多人服务 |
| `npm run server` | 只启动多人服务 |
| `npm test` | 运行完整 Playwright 套件 |
| `npm run verify:visual` | 运行画布、HUD 和响应式检查 |
| `npm run inspect:canvas` | 采集画布像素、截图和渲染预算 |
| `npm run prepare:kaykit-characters` | 从本地 KayKit 源包生成运行时角色 GLB |

`npm run inspect:canvas` 不负责启动网页服务器。先在另一个终端运行 `npm run dev:web`，确认 `5188` 可访问，再执行检查命令。

测试使用单 worker 是有意设计：并行的无头 WebGL 上下文会争抢 GPU，使游戏时间与墙上时间漂移，并造成网络和视觉用例假失败。不要仅为了缩短测试时间而删除这一限制。

## 测试要求

每个玩法规则或玩家可见 bug 都应添加回归测试。根据改动范围选择以下测试，并在提交 PR 前运行完整构建：

| 改动范围 | 最低验证 |
| --- | --- |
| 确定性规则、碰撞、计分 | `tests/game-rules.spec.ts`、`tests/server-simulation.spec.ts` |
| checkpoint、预测、协议 | `tests/network-smoothing.spec.ts`、`tests/multiplayer.spec.ts`、`tests/server-simulation.spec.ts` |
| 键盘输入 | `tests/input-controls.spec.ts`，至少保留一条真实键盘路径 |
| 地图格式或编辑器 | `tests/map-editor.spec.ts`，覆盖迁移和 roundtrip |
| HUD、布局、相机或渲染 | `tests/visual.spec.ts`、`npm run verify:visual` |
| 性能或画布问题 | 生产构建、`npm run inspect:canvas`、控制台错误检查和变更前后指标 |
| 多人房间生命周期 | `tests/multiplayer.spec.ts`，覆盖双标签、所有权、收敛和重连 |

推荐的提交前检查：

```bash
npm run build
npm test
```

如果修改画面、HUD、资源或响应式布局，还要运行：

```bash
npm run verify:visual
npm run dev:web
# 在另一个终端执行
npm run inspect:canvas
```

不要提交 `dist/`、`test-results/`、`playwright-report/` 或 `artifacts/` 中的临时 QA 产物。

## 提交与 Pull Request

保持提交聚焦，使用简短、祈使语气的主题，并可带作用域。例如：

```text
game: require active apple delivery
net: replay authoritative checkpoints
render: reduce island shadow cost
docs: add contributor guide
```

Pull Request 应包含：

- 改动解决的问题和玩家可见行为；
- 主要实现与架构取舍；
- 实际运行过的命令及结果；
- 规则顺序、协议、checkpoint、地图格式和兼容性影响；
- 画面或 HUD 变化的桌面与窄屏截图；
- 性能变化的基线和修改后指标；
- 已知风险、未覆盖场景和后续工作；
- 关联的 Issue 或设计文档。

提交前确认：

- [ ] 改动位于正确的所有权模块，没有在 UI 或渲染层复制规则；
- [ ] 新增规则、协议或可见 bug 有回归测试；
- [ ] `npm run build` 通过；
- [ ] 与改动相关的 Playwright 测试通过；
- [ ] 文档、版本、许可台账和截图已按需更新；
- [ ] 没有提交生成目录、密钥、token、源素材包或无关改动。

## 文档维护

- 玩家入口、操作方式和常用命令更新到 [README](README.md)。
- 贡献流程和开发约束更新到本文件。
- 架构决策、方案权衡和阶段实施结果放在 `docs/`。
- 外部资产的来源、许可证和修改记录放在 `docs/ASSET_LICENSES.md`。

文档应描述仓库当前行为。功能、协议或命令已经改变时，应在同一个 PR 中同步更新文档，不要留下仅描述计划但与实现不一致的说明。

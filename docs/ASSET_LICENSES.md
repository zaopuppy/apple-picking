# 外部资产许可台账

- 项目：Apple Picking
- 建立日期：2026-08-15
- 许可策略：默认只接收来源可追溯的 CC0 素材

## 使用规则

1. 只从作者官网或作者维护的官方资产页获取素材。
2. 素材进入运行目录前，必须记录名称、作者、来源、许可证、获取日期、修改方式和最终路径。
3. 仓库只保存游戏实际使用的文件，不提交完整素材包或未使用变体。
4. 外部模型只负责视觉表现；碰撞体、状态机和位移规则继续由项目代码维护。
5. 若素材被移除，其台账记录保留，并把状态改为“已撤回”，便于追溯历史提交。
6. CC-BY 素材需要单独确认署名方案；CC-BY-NC、来源不明或无法定位原始授权页面的素材不得进入项目。

## 已采用资产

| 状态 | 资产名称 | 作者/来源 | 许可证 | 获取日期 | 修改说明 | 项目路径 | 使用位置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 使用中 | Interface Sounds 1.0：`pluck_001`、`confirmation_002`、`confirmation_003`、`confirmation_004`、`bong_001` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 1.0 | 2026-08-15 | 转为 44.1 kHz、16-bit 单声道 WAV；按游戏事件重命名；运行时统一音量并轻微改变播放速率 | `public/assets/audio/kenney/` | 开始拾取、拾取完成、交付、回合结束 |
| 使用中 | Impact Sounds 1.0：`impactWood_light_002`、`impactWood_light_004`、`impactSoft_heavy_001`、`impactPunch_medium_002`、`impactPunch_heavy_002` | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 1.0 | 2026-08-15 | 转为 44.1 kHz、16-bit 单声道 WAV；按游戏事件重命名；运行时统一音量并轻微改变播放速率 | `public/assets/audio/kenney/` | 苹果落地、飞扑、双 guard 碰撞、抓到 kid |

原始许可证副本保存在：

- `public/assets/audio/kenney/LICENSE-interface-sounds.txt`
- `public/assets/audio/kenney/LICENSE-impact-sounds.txt`

## 接入检查清单

- [ ] 官方来源页面可以访问并明确说明许可证
- [ ] 下载包中的许可证与来源页没有冲突
- [ ] 只保留实际使用的文件
- [ ] 文件名、路径、大小写适合静态托管
- [ ] 音频已检查格式、时长、响度和循环属性
- [ ] 模型已检查尺寸、轴向、原点、包围盒和手机画面轮廓
- [ ] 模型已记录三角面、mesh、material、texture 和动画片段数量
- [ ] 外部视觉与模拟层碰撞代理保持分离
- [ ] 构建、浏览器加载、桌面和手机检查通过
- [ ] 撤回开关或原有效果回退路径可用

## 当前基线

基线场景：`heavy-carry`，固定截图状态，2026-08-15 采集。

| 视口 | Draw calls | 三角面 | Geometries | Textures | 色彩熵 | 边缘密度 | 明度对比 | 主色占比 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop 1280 × 720, DPR 1 | 61 | 4,638 | 57 | 3 | 1.43 | 0.221 | 104.7 | 0.826 |
| Mobile 390 × 664, DPR 2 | 61 | 4,638 | 57 | 3 | 1.58 | 0.245 | 85.1 | 0.791 |

基线截图和 JSON 由 `npm run inspect:canvas` 生成在 `artifacts/stage0-baseline/`，属于本地 QA 产物，不提交仓库。

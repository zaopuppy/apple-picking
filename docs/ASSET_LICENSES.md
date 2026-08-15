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
| 使用中 | Forest Nature Pack 1.0 FREE：`Tree_1_A_Color1`、`Tree_2_B_Color1`、`Tree_3_C_Color1` | [KayKit Forest Nature Pack](https://kaylousberg.itch.io/kaykit-forest)，Kay Lousberg | CC0 1.0 | 2026-08-15 | 只保留 3 个 glTF 模型及共享图集；图集由 1024 × 1024 降采样至 256 × 256；运行时按变体实例化并共享材质 | `public/assets/models/kaykit-forest/` | 果园内部 3 组既有树障碍的视觉网格；不参与碰撞 |

原始许可证副本保存在：

- `public/assets/audio/kenney/LICENSE-interface-sounds.txt`
- `public/assets/audio/kenney/LICENSE-impact-sounds.txt`
- `public/assets/models/kaykit-forest/LICENSE.txt`

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

## 阶段 2 资产结果

- 3 个模型、3 个二进制缓冲、1 张共享 256 × 256 图集及许可证合计约 125 KB；
- 运行时为 3 个 InstancedMesh、9 个树实例、9,750 个树木三角面；
- `heavy-carry` 实测桌面与手机均为 62 draw calls、13,236 三角面、60 geometries、4 textures；
- `?trees=procedural` 可强制恢复原有程序化树木，加载失败时也会自动保留原树木；
- 障碍位置、碰撞代理、地图路线、相机和游戏规则均未修改。

## 当前基线

基线场景：`heavy-carry`，固定截图状态，2026-08-15 采集。

| 视口 | Draw calls | 三角面 | Geometries | Textures | 色彩熵 | 边缘密度 | 明度对比 | 主色占比 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop 1280 × 720, DPR 1 | 61 | 4,638 | 57 | 3 | 1.43 | 0.221 | 104.7 | 0.826 |
| Mobile 390 × 664, DPR 2 | 61 | 4,638 | 57 | 3 | 1.58 | 0.245 | 85.1 | 0.791 |

基线截图和 JSON 由 `npm run inspect:canvas` 生成在 `artifacts/stage0-baseline/`，属于本地 QA 产物，不提交仓库。

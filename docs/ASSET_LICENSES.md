# 外部资产许可台账

- 项目：Apple Picking
- 建立日期：2026-08-15
- 许可策略：优先使用来源可追溯的 CC0 素材；CC-BY 素材必须保留作者、来源和许可证署名

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
| 使用中 | Interface Sounds 1.0：`pluck_001`、`confirmation_002`、`confirmation_003`、`confirmation_004`、`bong_001` | [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) | CC0 1.0 | 2026-08-15 | 转为单声道 MP3、按游戏事件重命名，并合入单请求 JSON 音效包；运行时统一音量并轻微改变播放速率 | `public/assets/audio/kenney/` | 开始拾取、拾取完成、交付、回合结束 |
| 使用中 | Impact Sounds 1.0：`impactWood_light_002`、`impactWood_light_004`、`impactSoft_heavy_001`、`impactPunch_medium_002`、`impactPunch_heavy_002` | [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 1.0 | 2026-08-15 | 转为单声道 MP3、按游戏事件重命名，并合入单请求 JSON 音效包；运行时统一音量并轻微改变播放速率 | `public/assets/audio/kenney/` | 苹果落地、飞扑、双 guard 碰撞、抓到 kid |
| 已替换 | Forest Nature Pack 1.0 FREE：`Tree_1_A_Color1`、`Tree_2_B_Color1`、`Tree_3_C_Color1` | [KayKit Forest Nature Pack](https://kaylousberg.itch.io/kaykit-forest)，Kay Lousberg | CC0 1.0 | 2026-08-15 | 保留旧运行时文件作为历史资产；游戏不再加载 | `public/assets/models/kaykit-forest/` | 历史果园树木视觉 |
| 使用中 | Adventurers Character Pack 2.0 FREE：`Knight`、`Rogue`、`Rig_Medium` 动画 | [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers)，Kay Lousberg | CC0 1.0 | 2026-08-15 | 分别整理为 `Knight_Guard.glb` 与 `Rogue_Kid.glb`；只合入使用中的 5/4 个动画；两张图集由 1024 × 1024 降采样至 256 × 256；保留 Knight 原生头盔和面罩 | `public/assets/models/kaykit-adventurers/` | guard1、guard2 与 kid 的视觉和动作；碰撞、负重、苹果堆和状态逻辑保持独立 |
| 使用中 | FREE DOWNLOAD Low poly nature pack：`Cut_0`、`Full_Grow001_2`、`Full_Grow003_7`、`MidGrow005_13`、`APPLE__20` | [Gostbento / Sketchfab](https://sketchfab.com/3d-models/free-download-low-poly-nature-pack-cb45d4926fcb4807bc93126b59325cf8) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 2026-08-15 | 运行时从单个 GLB 提取树桩、阔叶树、松树、樱花树和苹果；树桩缩放到 `0.46` 高，苹果为可读性保留 `0.78` 的风格化高度；障碍按品种实例化 | `public/assets/models/animal-crossing/free_download_low_poly_nature_pack.glb` | 开放果园的树桩与少量大树、可拾取苹果；圆形碰撞代理由地图数据独立维护 |
| 使用中 | Medieval Builder Pack 1.0：小屋、建筑/城墙道具与精选六边形地块 | [KayKit Medieval Builder Pack](https://kaylousberg.itch.io/kaykit-medieval-builder-pack)，Kay Lousberg | CC0 1.0 | 2026-08-16 | 保留独立 `house.glb`，另从对象与六边形地块中精选 24 个候选资源；运行时实例化地块并按语义地标缩放、落地和居中，不提交完整源包 | `public/assets/models/kaykit-medieval/` | 默认地图的房屋，以及三套可玩世界试验场；碰撞代理仍由地图数据独立维护 |

原始许可证副本保存在：

- `public/assets/audio/kenney/LICENSE-interface-sounds.txt`
- `public/assets/audio/kenney/LICENSE-impact-sounds.txt`
- `public/assets/models/kaykit-forest/LICENSE.txt`
- `public/assets/models/kaykit-adventurers/LICENSE.txt`
- `public/assets/models/animal-crossing/LICENSE.txt`
- `public/assets/models/kaykit-medieval/LICENSE.txt`

## 开放乡野地图与 Nature Pack 定稿

- 默认“果园村口”地图为 72 × 54，包含 2 个语义地标、86 个树桩、7 棵大树和 6 个苹果；所有角色、苹果和投递区都通过 1 单位导航网格验证可达；
- 四种树木合计 21,648 个实例化三角面，6 个苹果合计 1,152 个三角面，2 个程序化地标合计 1,208 个三角面；程序化房屋、围栏和池塘属于项目自制几何，不新增外部资产许可；
- 单个 6,762,476 bytes GLB 由缓存加载器只请求一次，程序化树和苹果会一直保留到导入成功；`?trees=procedural&fruit=procedural` 可强制检查完整回退；
- 地图树木使用独立的圆形 XZ 碰撞代理。视觉模型、树种和缩放不会把 GLB 网格直接带入确定性模拟；
- 独立编辑器位于 `/editor.html`，支持房屋小院、池塘、视觉地表、确定性随机候选、画笔、撤销/重做、本地图库和 JSON 导入导出。

## 接入检查清单

- [x] 官方来源页面可以访问并明确说明许可证
- [x] 下载包中的许可证与来源页没有冲突
- [x] 只保留实际使用的文件
- [x] 文件名、路径、大小写适合静态托管
- [x] 音频已检查格式、时长、响度和循环属性
- [x] 模型已检查尺寸、轴向、原点、包围盒和手机画面轮廓
- [x] 模型已记录三角面、mesh、material、texture 和动画片段数量
- [x] 外部视觉与模拟层碰撞代理保持分离
- [x] 构建、浏览器加载、桌面和手机检查通过
- [x] 已定稿角色的加载失败会显式记录，不会静默切回已删除的旧模型

## KayKit Medieval 小屋接入

- 只从 226 个源 GLB 中采用自由摆放的 `Models/objects/gltf/house.gltf.glb`，不提交完整 14 MB 素材包；运行文件为 73,308 bytes；
- 源模型为 Y-up，原始包围盒约 1.687 × 0.914 × 1.656，包含 5 meshes、1,666 triangles、5 materials、0 textures；加载器将模型在 XZ 平面居中、底部落到地面，并将整体宽度限制在房屋小院宽度对应的 5.5–6.2 左右；
- 导入成功后只隐藏程序化小屋本体，继续保留项目原有院落地面、外圈围栏和灌木；房屋和院落仍共用地图中的矩形阻挡区，模型网格不参与确定性碰撞；
- 模型请求或解析失败时继续显示程序化小屋，诊断字段会记录失败；`?landmarks=procedural` 可强制检查回退；
- 编辑器的“房屋小院”工具、随机生成器和地图 JSON 结构没有新增资产专用字段，所以旧地图会自动获得新小屋视觉，并保持可导入导出。

## KayKit 世界试验场

- 完整发布源包的 226 个 GLB：objects 30、hex 128、square 68，总计 3,965,144 bytes；`public/assets/models/kaykit-medieval/catalog.json` 是运行时和后续编辑器共用的文件目录；
- 默认 `/` 进入林间村落，另外两套候选通过 `?world=medieval&layout=riverside|fortified` 进入；`?world=classic` 运行本地编辑器保存的 v5 地图，并兼容迁移 v1–v4；
- 单张地图按语义使用目录中的相关模型，不把全部变体同时加载。完整资源库用于主题生成、自动铺地和后续编辑器资产面板；
- 六边形地面按模型原始尖顶朝向无缝实例化；道路先使用宽沙土地块表达活动带，正式自动拼路延后到语义编辑器阶段；
- KayKit 建筑只放进 `homestead` 的不可进入矩形，水面只覆盖 `pond` 的不可进入椭圆，城墙位于竞技场夹紧边界；模型网格不直接进入确定性模拟；
- 世界资源加载失败时完整保留程序化地面、路径、围栏和地标；诊断字段记录世界模式、候选、实例数、资产请求与失败原因；
- 迁移设计、迭代状态和多投递区 v5 预留记录在 `docs/2026-08-16_kaykit-world-migration.md`。

## 阶段 2 资产结果

- 3 个自包含 GLB 及许可证合计约 147 KB；运行时只产生 3 个模型请求；
- 运行时为 3 个 InstancedMesh、9 个树实例、9,750 个树木三角面；
- `heavy-carry` 实测桌面与手机均为 62 draw calls、13,236 三角面、60 geometries、4 textures；
- `?trees=procedural` 可强制恢复原有程序化树木，加载失败时也会自动保留原树木；
- 障碍位置、碰撞代理、地图路线、相机和游戏规则均未修改。

## 阶段 3 资产结果

- 最终角色文件约 564 KB，包含 7 meshes、8,645 triangles、1 material、1 texture 和 5 个动画；
- guard1 使用 `Idle_A` / `Running_A` 表达待机与追赶，`Jump_Full_Short` 表达飞扑，`Jump_Land` 配合状态进度表达爬起，`Hit_A` 仅用于双 guard 碰撞后的受控状态；
- 保留头部、左右手和背部挂点，并叠加蓝色帽子、阵营环、飞扑高亮和受控标记；
- guard2 与 kid 继续使用程序化角色，作为风格和可读性对照；
- 单角色原型期曾保留程序化 guard 作为对照；角色方向确认后，该临时回退已删除；
- `guard-pounce` / `guard-recover` 实测桌面和手机最多 63 draw calls、21,577 triangles、71 geometries、6 textures；
- 模拟层的角色半径、碰撞、位移、飞扑和爬起计时均未修改。

## 阶段 4 资产结果

- 未引入新的外部文件或许可证；guard2 复用阶段 3 已验收的 Ranger GLB 和 CC0 记录；
- 两名 guard 合计 14 meshes、17,290 triangles、2 个可独立变色的 materials，并共享 1 个逻辑纹理资产；模型只发起一次网络请求；
- guard1 使用蓝色七边形帽顶、矩形帽檐、斜带和状态环，guard2 使用绿色七边形帽顶、圆形帽檐、反向斜带和状态环；
- 两名 guard 分别持有动画混合器，可独立播放 `Idle_A`、`Running_A`、`Jump_Full_Short`、`Jump_Land` 和 `Hit_A`，不会串动画；
- Ranger GLB 已成为两名 guard 的正式运行时依赖；程序化 guard 和逐角色查询参数回退已删除，加载失败会在角色诊断中标记为 `failed`；
- 正常桌面/手机实测为 63 draw calls、29,782 triangles、75 geometries、7 textures；受控状态峰值为 69 draw calls、29,998 triangles、77 geometries、7 textures；
- kid 继续使用程序化角色，以完整保留拾取、负重姿态、苹果堆、滴汗和被抓等关键状态；
- 模拟层的角色半径、碰撞、位移、飞扑和爬起计时均未修改。

以上阶段 3–4 的 Ranger 内容为历史实施记录，现已由下面的角色定稿替代。

## Knight / Rogue 角色定稿

- guard1 与 guard2 改用 `Knight_Guard.glb`：保留 Knight 原生头盔和面罩，删除旧 Ranger 上额外叠加的帽顶和帽檐；蓝/绿披风、反向斜带和状态环继续区分两名 guard；
- kid 改用 `Rogue_Kid.glb`：`Idle_A` 提供待机动作并叠加轻微呼吸，`Running_A` 根据负重降低播放速度，`PickUp` 表达拾取，`Hit_A` 表达被抓后的短暂受击；
- 程序化 kid 身体已删除，但背包、负重膨胀、身体前倾、重载摇摆、苹果堆、满载三个苹果时的滴汗和状态环仍由状态驱动；
- `Knight_Guard.glb` 为 458,152 bytes、9 meshes、5,800 triangles、1 个 256 × 256 图集和 5 个动画；`Rogue_Kid.glb` 为 503,252 bytes、7 meshes、7,562 triangles、1 个 256 × 256 图集和 4 个动画；
- 三名角色合计 25 meshes、19,162 triangles、5 个运行时材质和 2 个逻辑纹理；两名 guard 共享 Knight 的 geometry、texture 和骨骼数据，只发起一次 Knight 请求；
- `heavy-carry` 实测桌面与 390 × 664 手机均为 62 draw calls、31,164 triangles、57 geometries、9 textures；`picking` 手机状态峰值为 67 draw calls、31,436 triangles、60 geometries、9 textures；
- GLB 通过 glTF Validator，无 error；源包固有的 skinned-mesh 层级 warning 保留，Three.js 实际动画、缩放、阴影和材质检查通过；
- 本地完整源包位于被忽略的 `assets/`，可用 `npm run prepare:kaykit-characters` 重建运行时文件；仓库不提交未使用角色、道具或动画；
- `Ranger_Guard.glb` 和旧程序化 kid 代码已删除；Knight 或 Rogue 加载失败时分别标记为 `failed`，不保留查询参数回退分支；
- 模拟层的角色半径、角色/苹果碰撞、移动、飞扑和爬起计时均未修改。

## 当前基线

基线场景：默认“林间集市”倒计时画面，2026-08-15 采集。该表保留为旧密林版本的历史对照；开放乡野版本的当前硬性预算由自动测试持续检查。

| 视口 | Draw calls | 三角面 | Geometries | Textures | 色彩熵 | 边缘密度 | 明度对比 | 主色占比 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop 1280 × 720, DPR 1 | 49 | 81,468 | 57 | 12 | 3.54 | 0.416 | 165.5 | 0.475 |
| Mobile 390 × 664, DPR 2 | 49 | 81,468 | 57 | 12 | 2.62 | 0.271 | 165.5 | 0.406 |

开放乡野“果园村口”于 2026-08-16 重新采集：接入 Medieval 小屋前，桌面和 390 × 664 窄屏均为 74 draw calls、44,724 三角面、77 geometries、12 textures；接入后均为 70 draw calls、46,270 三角面、82 geometries、12 textures。小屋用 1,546 个额外三角面换掉 4 个 draw calls，仍低于 150 draw calls、300,000 三角面、200 geometries 和 40 textures 的移动端预算。

基线截图和 JSON 由 `npm run inspect:canvas` 生成在 `artifacts/canvas-inspection/`，属于本地 QA 产物，不提交仓库。

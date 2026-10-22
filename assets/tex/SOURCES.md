# 贴图来源

全部取自用户 OneDrive 材质库 `TextureLibrary/polyhaven/`（库交接报告标注：Poly Haven，CC0 公共领域）。
原图 4K，本目录为缩小后的 JPG（q85），只用法线（nor_gl）与 ARM（AO/粗糙度/金属度）。库内 polyhaven 资产**没有漫反射/颜色贴图**，所以颜色仍由 `src/main.js` 里按原帧描述的程序贴图提供。

| 文件 | 原资产 | 用在 |
|---|---|---|
| large_floor_tiles_02_*_1024.jpg | polyhaven/large_floor_tiles_02 | 地面（每张 3×3 砖，铺成 0.6 m 一块） |
| painted_plaster_wall_*_512.jpg | polyhaven/painted_plaster_wall | 上墙 |
| fine_grained_wood_*_512.jpg | polyhaven/fine_grained_wood | 木墙裙、家具木面 |
| poly_wool_herringbone_*_512.jpg | polyhaven/poly_wool_herringbone | 沙发/椅垫 |
| floral_jacquard_*_512.jpg | polyhaven/floral_jacquard | 窗帘 |

未使用：`v2v_reference/`、`cinematic_ref/`（Pexels/Unsplash/采购图，是 V2V 参考照片，不是可平铺贴图，授权也不统一，不放进游戏）。

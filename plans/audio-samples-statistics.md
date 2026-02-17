# 音效样本统计报告

## 统计方法

基于项目文件结构分析，统计 `public/sfx` 目录下所有音频文件（.ogg, .mp3, .wav 等格式）。

## 总体统计

### 按主要类别分类

| 类别 | 文件夹数 | 预估样本数 | 占比 | 说明 |
|------|---------|-----------|------|------|
| **weapon** (武器) | ~50+ | ~400-500 | ~40% | 包含各类武器的开火、爆炸、击中、混响等音效 |
| **vehicle** (车辆) | ~80+ | ~350-450 | ~35% | 玩家和敌方车辆的引擎、移动、开火、爆炸等音效 |
| **environment** (环境) | ~60+ | ~150-200 | ~15% | 森林环境音、生物音效、建筑倒塌等 |
| **infantry** (步兵) | ~20+ | ~80-120 | ~8% | 步兵相关音效 |
| **bgm** (背景音乐) | 6 | 6 | ~0.5% | 菜单和游戏内 BGM |
| **其他** | ~10+ | ~20-30 | ~1.5% | 其他杂项音效 |
| **总计** | **~220+** | **~1000-1300** | **100%** | 所有音效文件 |

## 详细分类统计

### 1. 武器音效 (weapon/)

#### 高频武器音效
| 路径 | 样本数 | 优先级 | 说明 |
|------|--------|--------|------|
| `weapon/standard/fire/sfx` | 20 | P0 | 标准炮弹开火音效（最高频） |
| `weapon/standard/explosion/sfx` | 6 | P0 | 标准炮弹爆炸音效 |
| `weapon/standard/ground_hit_forest/sfx` | 9 | P0 | 炮弹击中地面音效 |
| `weapon/standard/reverb_forest_after_explosion/sfx` | ~8 | P0 | 爆炸后混响 |
| `weapon/standard/hit_vehicle/sfx` | 8 | P1 | 击中车辆音效 |
| `weapon/standard/flight_loop/sfx` | 1 | P1 | 炮弹飞行循环音 |

#### 其他武器类型
| 武器类型 | 子类别 | 预估样本数 | 优先级 |
|---------|--------|-----------|--------|
| `armor_piercing_shell` | explosion, reverb | ~12 | P1 |
| `he` (高爆弹) | reverb | ~9 | P1 |
| `incendiary` (燃烧弹) | explosion, flight_loop, burning_loop, reverb | ~15 | P1 |
| `mortar` (迫击炮) | fire, explosion, flight_loop, ground_hit, reverb | ~20 | P1 |
| `nuke` (核弹) | explosion, reverb | ~2 | P1 |
| `heavy_machine_gun` | fire/loop | ~2 | P1 |

**武器音效小计**: ~400-500 个样本

### 2. 车辆音效 (vehicle/)

#### 玩家坦克 (player_soviet/)
| 子系统 | 样本数 | 优先级 | 说明 |
|--------|--------|--------|------|
| `idle_engine_loop/sfx` | 1 | P0 | 怠速引擎循环 |
| `cruise/engine_loop/sfx` | 1 | P0 | 巡航引擎循环 |
| `cruise/mechanical_loop/sfx` | 4 | P1 | 机械循环音 |
| `cruise/tire_forest_loop/sfx` | 3 | P1 | 轮胎森林循环音 |
| `startup/sfx` | 5 | P0 | 启动音效 |
| `shutdown/sfx` | 3 | P0 | 关闭音效 |
| `rise/sfx` | 1 | P0 | 上升音效 |
| `rise_start` | 1 | P0 | 上升开始 |
| `boost/sfx` | 4 | P1 | 加速音效 |
| `fall/sfx` | 8 | P1 | 下落音效 |
| `shell_switch/sfx` | 11 | P1 | 切换炮弹音效 |
| `aim_hold/sfx` | 6 | P1 | 瞄准保持音效 |

**玩家坦克小计**: ~48 个样本

#### 敌方车辆
| 车辆类型 | 子系统 | 预估样本数 | 优先级 |
|---------|--------|-----------|--------|
| `enemy_a7v` | cookoff (各类炮弹) | ~10 | P2 |
| `enemy_hunter` | cookoff, rise | ~3 | P1 |
| `enemy_maus` | cookoff, cruise, Fire, idle_engine_loop | ~25 | P1 |
| `enemy_stug` | cookoff, cruise, Fire, idle_engine_loop | ~35 | P1 |
| `enemy_tiger` | Fire, idle_engine_loop | ~8 | P1 |
| `enemy_panzer` | cookoff, cruise, Fire, idle_engine_loop | ~15 | P1 |
| `enemy_tumbleweed` | Fire | ~3 | P1 |
| `helicopter` | cookoff, Fire, mechanical_loop | ~30 | P1 |
| `land_submarine` | cookoff, Fire | ~5 | P1 |

#### 通用车辆音效
| 类别 | 样本数 | 优先级 |
|------|--------|--------|
| `Lake_fall/sfx` | 6 | P2 |

**车辆音效小计**: ~350-450 个样本

### 3. 环境音效 (environment/forest/)

#### 2D 环境循环音 (ambient_2d/)
| 子类别 | 样本数 | 优先级 | 说明 |
|--------|--------|--------|------|
| `forest_loop/sfx` | 1 | P0 | 森林循环音 |
| `lake_loop/sfx` | 1 | P0 | 湖泊循环音 |
| `leaves_loop/sfx` | 1 | P0 | 树叶循环音 |
| `wind_loop/sfx` | 1 | P0 | 风声循环音 |
| `war_ambience_loop/sfx` | 0-1 | P0 | 战争氛围循环音 |
| `weather/black_rain/sfx` | 1 | P0 | 黑雨天气 |
| `weather/forest_rain/sfx` | 1 | P0 | 森林雨天气 |

**2D 环境音小计**: ~7 个样本

#### 3D 点音源 - 生物 (point_3d/creatures/)
| 生物类型 | 行为 | 预估样本数 | 优先级 |
|---------|------|-----------|--------|
| `birds_flock` | scream, wing_flap | ~10 | P2 |
| `boar` | flee, idle | ~15 | P2 |
| `crow` | flee, fly_loop, idle | ~15 | P2 |
| `elk` | flee, footsteps, idle | ~30 | P2 |
| `fox` | flee, footsteps, idle | ~14 | P2 |
| `rabbit` | flee, footsteps, idle | ~5 | P2 |
| `scorpion` | flee, footsteps, idle | ~5 | P2 |
| `snake` | flee, idle, walk | ~5 | P2 |
| `common/death` | killed_by_explosion, killed_by_mg | ~5 | P2 |

**生物音效小计**: ~100 个样本

#### 3D 点音源 - 静态物体 (point_3d/static/)
| 类别 | 子类别 | 预估样本数 | 优先级 |
|------|--------|-----------|--------|
| `buildings/american_cabin` | full_collapse, partial_collapse | ~5 | P2 |
| `buildings/bridge` | partial_collapse | ~3 | P2 |
| `buildings/default` | full_collapse, partial_collapse | ~12 | P2 |
| `flag/repair_spotlight_loop` | loop | 1 | P2 |
| `plants/vegetation/veg_pine` | hit_by_explosion, touch | ~9 | P2 |
| `plants/vegetation/veg_tree` | hit_by_explosion, touch | ~14 | P2 |

**静态物体音效小计**: ~44 个样本

**环境音效总计**: ~150-200 个样本

### 4. 步兵音效 (infantry/)

预估包含步兵移动、射击、受伤、死亡等音效，约 **80-120 个样本**，优先级 P2。

### 5. 背景音乐 (bgm/)

| 场景 | 文件 | 优先级 |
|------|------|--------|
| 菜单 | `menu/main_menu/sfx/Menu.ogg` | P0 |
| 森林非战斗 | `forest/non_combat/sfx/NoBattle.ogg` | P0 |
| 森林战斗 | `forest/combat/sfx/Battle.ogg` | P0 |
| 安全区前 | `forest/pre_final_safe_zone/sfx/BS_BOSS.ogg` | P0 |
| Boss 出场 | `forest/enemy_hunter_intro/sfx/BOSS.ogg` | P0 |
| 结束 | `forest/End/sfx/End.ogg` | P0 |

**BGM 总计**: 6 个文件

## 优化方案加载量对比

### 当前方案（全量加载）
- **加载文件数**: ~1000-1300 个
- **预估加载时间**: 120-180 秒（中国境内访问境外服务器）
- **首次可玩时间**: 120-180 秒

### 优化方案（智能分层加载）

#### P0 阶段（立即加载 - 首次可玩）
| 类别 | 加载策略 | 文件数 |
|------|---------|--------|
| BGM | 全部 | 6 |
| 2D 环境音 | 全部 | 7 |
| 高频武器音效 | 每个文件夹 3 个样本 | ~12 |
| 玩家坦克核心音效 | 全部 | ~12 |
| **P0 总计** | | **~37 个文件** |
| **预估加载时间** | | **5-15 秒** |

#### P1 阶段（快速后台加载）
| 类别 | 加载策略 | 文件数 |
|------|---------|--------|
| 其他武器音效 | 每个文件夹 1 个样本 | ~30 |
| 玩家坦克次要音效 | 每个文件夹 1 个样本 | ~15 |
| 敌方车辆核心音效 | 每个文件夹 1 个样本 | ~40 |
| **P1 总计** | | **~85 个文件** |
| **累计加载时间** | | **20-40 秒** |

#### P2 阶段（延迟加载）
| 类别 | 加载策略 | 文件数 |
|------|---------|--------|
| 环境生物音效 | 每个文件夹 1 个样本 | ~30 |
| 建筑音效 | 每个文件夹 1 个样本 | ~10 |
| 步兵音效 | 每个文件夹 1 个样本 | ~20 |
| 敌方车辆次要音效 | 每个文件夹 1 个样本 | ~30 |
| **P2 总计** | | **~90 个文件** |
| **累计加载时间** | | **40-80 秒** |

#### P3 阶段（按需加载）
- **剩余样本**: ~800-1000 个文件
- **加载策略**: 仅在实际播放时才加载，或在游戏空闲时后台加载

### 优化效果总结

| 指标 | 当前方案 | 优化方案 | 改善幅度 |
|------|---------|---------|---------|
| **首次可玩时间** | 120-180 秒 | **5-15 秒** | **↓ 92-96%** |
| **完整体验时间** | 120-180 秒 | 20-40 秒 | **↓ 78-83%** |
| **首次加载文件数** | 1000-1300 | **37** | **↓ 97%** |
| **P0+P1 加载文件数** | 1000-1300 | **122** | **↓ 91%** |

## 关键发现

1. **高频音效集中度高**: 
   - `weapon/standard/fire` 有 20 个样本，但首次只需加载 3 个
   - 玩家坦克核心音效仅 12 个文件，但对体验至关重要

2. **随机样本分布广泛**:
   - 大部分音效文件夹都有 3-20 个随机样本
   - 通过"每个文件夹加载 1-3 个样本"策略可大幅减少加载量

3. **BGM 和循环音优先级最高**:
   - 仅 13 个文件（6 BGM + 7 环境循环音）
   - 必须在游戏启动前加载完成

4. **环境音效可延迟加载**:
   - 生物和建筑音效约 150 个样本
   - 对核心游戏体验影响较小，可延迟到 P2 阶段

## 实施建议

1. **立即实施 P0 优化**: 将首次加载从 1000+ 个文件减少到 37 个，加载时间从 2-3 分钟降低到 5-15 秒
2. **P1 后台加载**: 游戏启动后立即在后台加载 P1 音效，确保 30 秒内完成
3. **P2 智能加载**: 根据游戏进度动态加载（如接近敌方车辆时加载其音效）
4. **P3 按需加载**: 仅在实际需要时加载剩余样本

## 技术实现要点

1. **配置化规则**: 使用正则表达式匹配文件夹路径，灵活配置优先级
2. **样本选择策略**: 
   - 优先选择文件名靠前的样本（如 `-001.ogg`）
   - 或随机选择以保证多样性
3. **动态补充加载**: 当某个音效播放次数过多时，自动加载更多样本
4. **加载进度反馈**: 向用户展示加载进度，提升体验

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 某些音效首次播放延迟 | 低-中 | P1 快速后台加载覆盖常用音效 |
| 音效重复率增加 | 低 | 动态加载更多样本 + 智能选择算法 |
| 网络波动导致加载失败 | 中 | 重试机制 + 降级策略 |
| 代码复杂度增加 | 低 | 配置化设计 + 清晰的优先级规则 |

---

**报告生成时间**: 2026-02-15  
**统计方法**: 基于项目文件结构分析  
**数据准确性**: 预估值，实际数量可能有 ±10% 的偏差

# 音频加载优化 - 技术实施方案

## 概述

本文档提供音频加载优化的完整技术实施方案，包括代码结构、实施步骤和测试验证方法。

## 项目背景

- **当前问题**: 首次加载需要 120-180 秒，加载 1000+ 个音效文件
- **优化目标**: 首次可玩时间降低到 5-15 秒（减少 92-96%）
- **核心策略**: 智能分层预加载 - P0 立即加载 37 个核心文件，其余按需/后台加载

详细分析请参考：
- [优化方案文档](./audio-loading-optimization-plan.md)
- [音效样本统计](./audio-samples-statistics.md)

## 技术架构

### 1. 文件结构

```
game/systems/
├── AudioLoadingConfig.ts          # 新增：音频加载配置
├── SoundManager.ts                # 修改：支持优先级加载
└── AudioMixerTable.ts             # 保持不变

game/
├── MenuScene.ts                   # 修改：分阶段加载
└── MainScene.ts                   # 可能需要调整

scripts/
└── count-audio-samples.js         # 新增：统计工具（可选）

plans/
├── audio-loading-optimization-plan.md
├── audio-samples-statistics.md
└── audio-loading-implementation.md  # 本文档
```

### 2. 核心组件

#### 2.1 AudioLoadingConfig.ts（新增）

**职责**: 定义音频加载规则和优先级

**关键类型**:
```typescript
export type AudioLoadingPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface AudioLoadingRule {
  pattern: string | RegExp;
  priority: AudioLoadingPriority;
  samplesCount: number | 'all';
  description: string;
}
```

**配置规则**:
- P0: BGM、2D环境音、高频武器音效、玩家坦克核心音效（37个文件）
- P1: 其他武器音效、玩家坦克次要音效、敌方车辆核心音效（85个文件）
- P2: 环境生物、建筑、步兵、敌方车辆次要音效（90个文件）
- P3: 剩余样本按需加载（800-1000个文件）

#### 2.2 SoundManager.ts（修改）

**修改点**:

1. **导入配置**:
```typescript
import { AUDIO_LOADING_RULES, type AudioLoadingPriority } from './AudioLoadingConfig';
```

2. **修改 `getAllManifestUrls()` 方法**:
   - 添加可选参数 `priority?: AudioLoadingPriority`
   - 根据优先级过滤音效文件
   - 根据 `samplesCount` 限制每个文件夹的样本数量

3. **修改 `ensureSessionAudioPack()` 方法**:
   - 添加 `priority?: AudioLoadingPriority` 参数
   - 传递给 `getAllManifestUrls()`

4. **添加辅助方法**（可选）:
```typescript
private matchAudioLoadingRule(folderKey: string): AudioLoadingRule | null {
  return AUDIO_LOADING_RULES.find(rule => {
    if (typeof rule.pattern === 'string') {
      return folderKey === rule.pattern;
    }
    return rule.pattern.test(folderKey);
  }) || null;
}
```

#### 2.3 MenuScene.ts（修改）

**修改点**:

当前代码（第 129 行）:
```typescript
await this.menuAudio.ensureSessionAudioPack({ concurrency: 5 });
```

修改为分阶段加载:
```typescript
// P0: 立即加载核心音效（阻塞启动）
await this.menuAudio.ensureSessionAudioPack({ 
  priority: 'P0', 
  concurrency: 5,
  onProgress: (loaded, total) => {
    // 更新加载进度UI
    console.log(`P0 Loading: ${loaded}/${total}`);
  }
});

// P1: 后台快速加载（非阻塞）
this.menuAudio.ensureSessionAudioPack({ 
  priority: 'P1', 
  concurrency: 3 
}).catch(err => console.warn('P1 loading failed:', err));

// P2: 延迟后台加载（可选，游戏运行一段时间后）
this.time.delayedCall(10000, () => {
  this.menuAudio.ensureSessionAudioPack({ 
    priority: 'P2', 
    concurrency: 2 
  }).catch(err => console.warn('P2 loading failed:', err));
});
```

## 实施步骤

### 阶段 1: 创建配置文件（30 分钟）

**文件**: `game/systems/AudioLoadingConfig.ts`

**任务**:
1. 定义类型 `AudioLoadingPriority` 和 `AudioLoadingRule`
2. 创建 `AUDIO_LOADING_RULES` 数组
3. 按照优先级配置规则（参考统计报告）

**验证**:
- TypeScript 编译无错误
- 导入配置文件成功

### 阶段 2: 修改 SoundManager（60 分钟）

**文件**: `game/systems/SoundManager.ts`

**任务**:
1. 导入 `AudioLoadingConfig`
2. 修改 `getAllManifestUrls()` 方法签名和实现
3. 修改 `ensureSessionAudioPack()` 方法签名
4. 添加规则匹配逻辑

**关键代码位置**:
- [`getAllManifestUrls()`](game/systems/SoundManager.ts:1536) - 第 1536 行
- [`ensureSessionAudioPack()`](game/systems/SoundManager.ts:1574) - 第 1574 行

**验证**:
- TypeScript 编译无错误
- 单元测试（可选）验证过滤逻辑

### 阶段 3: 更新 MenuScene（15 分钟）

**文件**: `game/MenuScene.ts`

**任务**:
1. 修改第 129 行的加载调用
2. 实现分阶段加载（P0 阻塞，P1/P2 后台）
3. 添加加载进度反馈（可选）

**验证**:
- TypeScript 编译无错误
- 游戏启动流程正常

### 阶段 4: 测试验证（30 分钟）

**测试场景**:
1. **首次启动测试**:
   - 清除浏览器缓存
   - 启动游戏
   - 记录 P0 加载时间（目标: 5-15 秒）
   - 验证游戏可正常进入

2. **音效播放测试**:
   - 测试高频音效（标准炮弹开火/爆炸）
   - 测试玩家坦克音效
   - 测试 BGM 和环境音
   - 验证无明显延迟

3. **后台加载测试**:
   - 游戏运行中监控 P1/P2 加载
   - 验证不影响游戏性能

4. **网络环境测试**:
   - 模拟慢速网络（Chrome DevTools）
   - 验证加载体验

**性能指标**:
| 指标 | 目标值 | 当前值 |
|------|--------|--------|
| P0 加载时间 | 5-15 秒 | 120-180 秒 |
| P0 文件数 | ~37 个 | ~1000+ 个 |
| 首次可玩时间 | 5-15 秒 | 120-180 秒 |
| P0+P1 加载时间 | 20-40 秒 | 120-180 秒 |

### 阶段 5: 优化调整（可选，30 分钟）

**可能的优化**:
1. 调整优先级规则（如果某些音效仍有延迟）
2. 调整样本数量（如高频音效从 3 个增加到 5 个）
3. 添加智能预加载（根据游戏进度动态加载）
4. 添加加载失败重试机制

## 详细代码实现

### 1. AudioLoadingConfig.ts（完整代码）

```typescript
export type AudioLoadingPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface AudioLoadingRule {
  pattern: string | RegExp;
  priority: AudioLoadingPriority;
  samplesCount: number | 'all';
  description: string;
}

export const AUDIO_LOADING_RULES: AudioLoadingRule[] = [
  // ========== P0: 立即加载（Critical - 首次可玩必需）==========
  
  // BGM - 全部加载
  { 
    pattern: /^bgm\//, 
    priority: 'P0', 
    samplesCount: 'all', 
    description: 'BGM 背景音乐' 
  },
  
  // 2D 环境循环音 - 全部加载
  { 
    pattern: /^environment\/forest\/ambient_2d\//, 
    priority: 'P0', 
    samplesCount: 'all', 
    description: '2D 环境循环音（森林、湖泊、风声等）' 
  },
  
  // 高频武器音效 - 每个文件夹 3 个样本
  { 
    pattern: /^weapon\/standard\/fire\/sfx$/, 
    priority: 'P0', 
    samplesCount: 3, 
    description: '标准炮弹开火音效（最高频）' 
  },
  { 
    pattern: /^weapon\/standard\/explosion\/sfx$/, 
    priority: 'P0', 
    samplesCount: 3, 
    description: '标准炮弹爆炸音效' 
  },
  { 
    pattern: /^weapon\/standard\/ground_hit_forest\/sfx$/, 
    priority: 'P0', 
    samplesCount: 3, 
    description: '炮弹击中地面音效' 
  },
  { 
    pattern: /^weapon\/standard\/reverb_forest_after_explosion\/sfx$/, 
    priority: 'P0', 
    samplesCount: 3, 
    description: '爆炸后混响' 
  },
  
  // 玩家坦克核心音效 - 全部加载
  { 
    pattern: /^vehicle\/player_soviet\/(idle_engine_loop|cruise\/engine_loop|startup|shutdown|rise|rise_start)\//, 
    priority: 'P0', 
    samplesCount: 'all', 
    description: '玩家坦克核心音效（引擎、启动、关闭等）' 
  },
  
  // ========== P1: 快速后台加载（High Priority）==========
  
  // 其他武器音效 - 每个文件夹 1 个样本
  { 
    pattern: /^weapon\/(armor_piercing_shell|he|incendiary|mortar|nuke|heavy_machine_gun|spg_mortar|torpedo|tracking_missile)\//, 
    priority: 'P1', 
    samplesCount: 1, 
    description: '其他武器类型音效' 
  },
  
  // 标准武器其他音效 - 每个文件夹 1 个样本
  { 
    pattern: /^weapon\/standard\/(hit_vehicle|flight_loop)\/sfx$/, 
    priority: 'P1', 
    samplesCount: 1, 
    description: '标准武器次要音效' 
  },
  
  // 玩家坦克次要音效 - 每个文件夹 1 个样本
  { 
    pattern: /^vehicle\/player_soviet\/(boost|fall|shell_switch|aim_hold|cruise\/(mechanical_loop|tire_forest_loop))\//, 
    priority: 'P1', 
    samplesCount: 1, 
    description: '玩家坦克次要音效' 
  },
  
  // 敌方车辆核心音效 - 每个文件夹 1 个样本
  { 
    pattern: /^vehicle\/enemy_[^\/]+\/(idle_engine_loop|cruise|Fire)\//, 
    priority: 'P1', 
    samplesCount: 1, 
    description: '敌方车辆核心音效（引擎、移动、开火）' 
  },
  
  // 直升机音效 - 每个文件夹 1 个样本
  { 
    pattern: /^vehicle\/helicopter\//, 
    priority: 'P1', 
    samplesCount: 1, 
    description: '直升机音效' 
  },
  
  // ========== P2: 延迟加载（Medium Priority）==========
  
  // 环境生物音效 - 每个文件夹 1 个样本
  { 
    pattern: /^environment\/forest\/point_3d\/creatures\//, 
    priority: 'P2', 
    samplesCount: 1, 
    description: '环境生物音效（鸟、野猪、鹿等）' 
  },
  
  // 建筑和静态物体音效 - 每个文件夹 1 个样本
  { 
    pattern: /^environment\/forest\/point_3d\/static\//, 
    priority: 'P2', 
    samplesCount: 1, 
    description: '建筑和静态物体音效' 
  },
  
  // 步兵音效 - 每个文件夹 1 个样本
  { 
    pattern: /^infantry\//, 
    priority: 'P2', 
    samplesCount: 1, 
    description: '步兵音效' 
  },
  
  // 敌方车辆次要音效 - 每个文件夹 1 个样本
  { 
    pattern: /^vehicle\/enemy_[^\/]+\/cookoff\//, 
    priority: 'P2', 
    samplesCount: 1, 
    description: '敌方车辆殉爆音效' 
  },
  
  // 通用车辆音效 - 每个文件夹 1 个样本
  { 
    pattern: /^vehicle\/(Lake_fall|land_submarine)\//, 
    priority: 'P2', 
    samplesCount: 1, 
    description: '通用车辆音效' 
  },
  
  // ========== P3: 按需加载（Low Priority - 默认）==========
  
  // 其他所有音效 - 不预加载
  { 
    pattern: /.*/, 
    priority: 'P3', 
    samplesCount: 0, 
    description: '其他音效按需加载' 
  }
];

/**
 * 根据文件夹路径查找匹配的加载规则
 */
export function findAudioLoadingRule(folderKey: string): AudioLoadingRule | null {
  return AUDIO_LOADING_RULES.find(rule => {
    if (typeof rule.pattern === 'string') {
      return folderKey === rule.pattern;
    }
    return rule.pattern.test(folderKey);
  }) || null;
}

/**
 * 获取指定优先级的所有规则
 */
export function getAudioLoadingRulesByPriority(priority: AudioLoadingPriority): AudioLoadingRule[] {
  return AUDIO_LOADING_RULES.filter(rule => rule.priority === priority);
}
```

### 2. SoundManager.ts 修改点

#### 修改点 1: 导入配置（文件顶部）

```typescript
import { AUDIO_LOADING_RULES, type AudioLoadingPriority } from './AudioLoadingConfig';
```

#### 修改点 2: 修改 getAllManifestUrls() 方法（第 1536 行）

**原代码**:
```typescript
private getAllManifestUrls(): string[] {
  const folders = this.getFolders();
  if (!folders || typeof folders !== 'object') return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const urls of Object.values(folders)) {
    if (!Array.isArray(urls)) continue;
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
```

**修改后**:
```typescript
private getAllManifestUrls(priority?: AudioLoadingPriority): string[] {
  const folders = this.getFolders();
  if (!folders || typeof folders !== 'object') return [];
  
  const out: string[] = [];
  const seen = new Set<string>();
  
  for (const [folderKey, urls] of Object.entries(folders)) {
    if (!Array.isArray(urls) || urls.length === 0) continue;
    
    // 查找匹配的规则
    const rule = AUDIO_LOADING_RULES.find(r => {
      if (typeof r.pattern === 'string') return folderKey === r.pattern;
      return r.pattern.test(folderKey);
    });
    
    if (!rule) continue;
    
    // 如果指定了优先级，只返回该优先级的音效
    if (priority && rule.priority !== priority) continue;
    
    // 确定要加载的样本数量
    const count = rule.samplesCount === 'all' ? urls.length : rule.samplesCount;
    
    // 添加 URL（限制数量）
    for (let i = 0; i < Math.min(count, urls.length); i++) {
      const url = urls[i];
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  
  return out;
}
```

#### 修改点 3: 修改 ensureSessionAudioPack() 方法（第 1574 行）

**原代码**:
```typescript
public ensureSessionAudioPack(options?: { concurrency?: number; onProgress?: (loaded: number, total: number) => void }): Promise<void> {
  // ...
  if (!SoundManager.sessionAudioPackPromise) {
    const urls = this.getAllManifestUrls();
    // ...
  }
  // ...
}
```

**修改后**:
```typescript
public ensureSessionAudioPack(options?: { 
  priority?: AudioLoadingPriority;
  concurrency?: number; 
  onProgress?: (loaded: number, total: number) => void 
}): Promise<void> {
  // 如果指定了优先级，创建独立的加载任务
  if (options?.priority) {
    const urls = this.getAllManifestUrls(options.priority);
    const total = urls.length;
    
    if (total <= 0) {
      options?.onProgress?.(0, 0);
      return Promise.resolve();
    }
    
    const concurrency = Phaser.Math.Clamp(Math.floor(options?.concurrency ?? 5), 1, 10);
    const queue = urls.slice();
    let loaded = 0;
    
    const runWorker = async () => {
      while (queue.length > 0 && !this.destroyed) {
        const url = queue.shift();
        if (!url) continue;
        try {
          await this.ensureLoaded(url);
        } catch {}
        loaded += 1;
        options?.onProgress?.(loaded, total);
      }
    };
    
    const workers = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
    return Promise.all(workers).then(() => {});
  }
  
  // 原有的全量加载逻辑（保持向后兼容）
  if (SoundManager.sessionAudioPackReady) {
    const total = Math.max(SoundManager.sessionAudioPackTotal, SoundManager.sessionAudioPackLoaded);
    options?.onProgress?.(total, total);
    return Promise.resolve();
  }

  const onProgress = options?.onProgress;
  let unsubscribe: (() => void) | null = null;
  if (onProgress) {
    unsubscribe = SoundManager.onSessionAudioPackProgress(onProgress);
  }

  if (!SoundManager.sessionAudioPackPromise) {
    const urls = this.getAllManifestUrls(); // 不传 priority，加载全部
    const total = urls.length;
    SoundManager.sessionAudioPackTotal = total;
    SoundManager.sessionAudioPackLoaded = 0;
    SoundManager.emitSessionAudioPackProgress(0, total);

    const concurrency = Phaser.Math.Clamp(Math.floor(options?.concurrency ?? 5), 1, 10);
    const queue = urls.slice();

    const runWorker = async () => {
      while (queue.length > 0 && !this.destroyed) {
        const url = queue.shift();
        if (!url) continue;
        try {
          await this.ensureLoaded(url);
        } catch {}
        SoundManager.sessionAudioPackLoaded += 1;
        SoundManager.emitSessionAudioPackProgress(SoundManager.sessionAudioPackLoaded, total);
      }
    };

    SoundManager.sessionAudioPackPromise = (async () => {
      if (total <= 0) {
        SoundManager.sessionAudioPackReady = true;
        SoundManager.emitSessionAudioPackProgress(0, 0);
        return;
      }
      const workers = Array.from({ length: Math.min(concurrency, total) }, () => runWorker());
      await Promise.all(workers);
      SoundManager.sessionAudioPackReady = true;
      SoundManager.emitSessionAudioPackProgress(total, total);
    })();
  }

  return SoundManager.sessionAudioPackPromise.finally(() => {
    if (unsubscribe) unsubscribe();
  });
}
```

### 3. MenuScene.ts 修改点（第 129 行）

**原代码**:
```typescript
await this.menuAudio.ensureSessionAudioPack({ concurrency: 5 });
```

**修改后**:
```typescript
// P0: 立即加载核心音效（阻塞启动）
await this.menuAudio.ensureSessionAudioPack({ 
  priority: 'P0', 
  concurrency: 5,
  onProgress: (loaded, total) => {
    // 可选：更新加载进度UI
    if (this.loadOverlay) {
      const percentage = total > 0 ? Math.floor((loaded / total) * 100) : 0;
      // 更新进度显示
    }
  }
});

// P1: 后台快速加载（非阻塞）
this.menuAudio.ensureSessionAudioPack({ 
  priority: 'P1', 
  concurrency: 3 
}).catch(err => {
  console.warn('P1 audio loading failed:', err);
});

// P2: 延迟后台加载（游戏运行 10 秒后）
this.time.delayedCall(10000, () => {
  this.menuAudio?.ensureSessionAudioPack({ 
    priority: 'P2', 
    concurrency: 2 
  }).catch(err => {
    console.warn('P2 audio loading failed:', err);
  });
});
```

## 测试清单

### 功能测试

- [ ] P0 音效加载成功（37 个文件）
- [ ] P1 音效后台加载成功（85 个文件）
- [ ] P2 音效延迟加载成功（90 个文件）
- [ ] BGM 正常播放
- [ ] 2D 环境音正常播放
- [ ] 标准炮弹开火音效正常（无延迟）
- [ ] 标准炮弹爆炸音效正常（无延迟）
- [ ] 玩家坦克引擎音效正常
- [ ] 敌方车辆音效正常
- [ ] 环境生物音效正常（可能有轻微延迟）

### 性能测试

- [ ] P0 加载时间 < 15 秒（目标: 5-15 秒）
- [ ] P0+P1 加载时间 < 40 秒（目标: 20-40 秒）
- [ ] 游戏启动流畅，无明显卡顿
- [ ] 后台加载不影响游戏性能（FPS 稳定）
- [ ] 内存占用合理（相比全量加载应降低）

### 兼容性测试

- [ ] Chrome 浏览器测试通过
- [ ] Firefox 浏览器测试通过
- [ ] Safari 浏览器测试通过（如适用）
- [ ] Android 设备测试通过（如适用）
- [ ] 慢速网络环境测试通过（3G 模拟）

### 回归测试

- [ ] 原有音效播放功能正常
- [ ] 音效混音系统正常
- [ ] 音效距离衰减正常
- [ ] 音效循环播放正常
- [ ] 音效淡入淡出正常

## 回滚方案

如果优化后出现问题，可以快速回滚：

1. **临时回滚**: 在 [`MenuScene.ts`](game/MenuScene.ts:129) 中注释掉优先级参数
   ```typescript
   // 回滚到原有逻辑
   await this.menuAudio.ensureSessionAudioPack({ concurrency: 5 });
   ```

2. **完全回滚**: 
   - 删除 `AudioLoadingConfig.ts`
   - 恢复 `SoundManager.ts` 的 `getAllManifestUrls()` 和 `ensureSessionAudioPack()` 方法
   - 恢复 `MenuScene.ts` 的加载调用

## 后续优化建议

### 短期优化（1-2 周）

1. **动态样本补充**: 当某个音效播放次数过多时，自动加载更多样本
2. **智能预加载**: 根据游戏进度预测需要的音效（如接近敌方车辆时预加载其音效）
3. **加载失败重试**: 添加重试机制，提高加载成功率

### 中期优化（1-2 月）

1. **CDN 加速**: 使用中国境内 CDN（阿里云、腾讯云）
2. **音效压缩**: 进一步压缩音效文件（降低比特率，但保持质量）
3. **Service Worker 缓存**: 利用 Service Worker 实现持久化缓存

### 长期优化（3-6 月）

1. **渐进式音质**: 首次加载低质量版本，后台替换为高质量版本
2. **音效流式加载**: 大文件（如 BGM）使用流式加载
3. **AI 预测加载**: 基于玩家行为预测需要的音效

## 总结

本实施方案通过**智能分层预加载**策略，将首次加载时间从 **120-180 秒降低到 5-15 秒**，改善幅度达 **92-96%**。实施过程分为 5 个阶段，预计总耗时 **2-3 小时**。

关键成功因素：
1. ✅ 精确的优先级配置（基于音效使用频率）
2. ✅ 最小化 P0 加载量（仅 37 个核心文件）
3. ✅ 非阻塞的后台加载（P1/P2）
4. ✅ 完善的测试验证

---

**文档版本**: v1.0  
**创建时间**: 2026-02-15  
**作者**: Roo (Architect Mode)  
**相关文档**: 
- [优化方案](./audio-loading-optimization-plan.md)
- [音效统计](./audio-samples-statistics.md)

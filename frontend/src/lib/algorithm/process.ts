// 主处理逻辑 - 数据+规则混合模式（唯一模式，无模式开关、无纯规则回退）
import { Note, Hand, Finger, Fingering, Part, FingeringResult, FingeringResultEntry, ProgressCallback, WorkerConfig, WorkerResult } from './types';
import { DynaQSolver } from './dynaQ';
import { actionSpace } from './mdp';
import { GroupPriors, hotStartQ, nnArgmaxAction, TAU } from './fusion';

/**
 * 自适应计算预算：热启动后收敛大幅加快，按段落复杂度分配 episodes
 */
function adaptiveEpisodes(groupCount: number): number {
  if (groupCount <= 20) return 400;  // 简单
  if (groupCount <= 40) return 600;  // 中等
  return 800;                        // 复杂
}

/**
 * 检测设备并返回Worker数量
 */
function getWorkerCount(): number {
  // 非浏览器环境（如 Node.js 测试）统一单线程
  if (typeof Worker === 'undefined' || typeof navigator === 'undefined') return 1;

  // 检测是否为移动设备
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // 获取CPU核心数
  const cores = navigator.hardwareConcurrency || 4;

  // 移动设备统一使用单线程
  if (isMobile) return 1;

  // 根据核心数决定Worker数量
  if (cores >= 8) return 4;  // 高端PC
  if (cores >= 4) return 2;  // 中端PC
  return 1;  // 低端PC
}

/**
 * 创建Worker配置
 */
function createWorkerConfigs(workerCount: number, totalEpisodes: number, priors?: GroupPriors[]): WorkerConfig[] {
  const episodesPerWorker = Math.floor(totalEpisodes / workerCount);

  return Array.from({ length: workerCount }, (_, i) => ({
    seed: Date.now() + i * 1000,
    episodes: episodesPerWorker,
    planningSteps: 10,
    learningRate: 0.99,
    explorationRate: 0.8,
    priors
  }));
}

/**
 * 合并Q表（简单平均）
 */
function mergeQTables(qTables: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  const allKeys = new Set<string>();
  
  // 收集所有键
  for (const qTable of qTables) {
    for (const key of qTable.keys()) {
      allKeys.add(key);
    }
  }
  
  // 对每个键计算平均值
  for (const key of allKeys) {
    const values = qTables.map(q => q.get(key) || 0);
    const avg = values.reduce((a, b) => a + b) / values.length;
    merged.set(key, avg);
  }
  
  return merged;
}

/**
 * 从合并的Q表中提取策略
 */
function extractPolicyFromQTable(
  qTable: Map<string, number>,
  hand: Hand,
  allNotes: Note[][],
  part: Part,
  priors?: GroupPriors[]
): Fingering[] {
  const policy: Fingering[] = [];

  let state = {
    index: 0,
    fingering: [] as Fingering,
    nextNotes: allNotes[0],
    part
  };

  while (state.index < allNotes.length) {
    const actions = actionSpace(hand, state, allNotes, priors);

    let bestAction: Fingering;

    if (actions.length === 0) {
      // 如果没有可用动作，使用默认指法
      const notes = allNotes[state.index];
      bestAction = notes.map((note, i) => ({
        pitch: note.pitch,
        finger: Math.min(i + 1, 5) as Finger
      }));
    } else {
      // 选择Q值最大的动作
      bestAction = actions[0];
      let bestValue = getQValue(qTable, state, bestAction, hand, priors);

      for (const action of actions) {
        const value = getQValue(qTable, state, action, hand, priors);
        if (value > bestValue) {
          bestValue = value;
          bestAction = action;
        }
      }

      // 保守采纳：NN 主选择与 RL 最优 Q 边际 < 0.1τ 时回退 NN 主选择
      const nnAction = nnArgmaxAction(actions, priors?.[state.index]);
      if (nnAction && nnAction !== bestAction) {
        const nnValue = getQValue(qTable, state, nnAction, hand, priors);
        if (bestValue - nnValue < 0.1 * TAU) {
          bestAction = nnAction;
        }
      }
    }

    policy.push(bestAction);

    state = {
      index: state.index + 1,
      fingering: bestAction,
      nextNotes: state.index + 1 < allNotes.length ? allNotes[state.index + 1] : [],
      part
    };
  }

  return policy;
}

/**
 * 获取Q值（含热启动：未访问的 (s,a) 返回 τ·logP + γ·R_phys）
 */
function getQValue(
  qTable: Map<string, number>,
  state: any,
  action: Fingering,
  hand: Hand,
  priors?: GroupPriors[]
): number {
  const key = stateActionKey(state, action);
  const existing = qTable.get(key);
  if (existing !== undefined) return existing;
  if (priors) {
    return hotStartQ(hand, state, action, priors[state.index]);
  }
  return 0;
}

/**
 * 生成状态-动作键
 */
function stateActionKey(state: any, action: Fingering): string {
  const stateStr = `${state.index}_${fingeringToString(state.fingering)}`;
  const actionStr = fingeringToString(action);
  return `${stateStr}|${actionStr}`;
}

/**
 * 指法转字符串
 */
function fingeringToString(fingering: Fingering): string {
  return fingering.map(entry => `${entry.pitch}:${entry.finger}`).join(',');
}

/**
 * 并行训练（使用Web Workers）
 */
async function parallelTrain(
  notes: Note[][],
  hand: Hand,
  part: Part,
  priors?: GroupPriors[],
  progressCallback?: ProgressCallback
): Promise<Fingering[]> {
  // 检测Worker数量
  const workerCount = getWorkerCount();
  const totalEpisodes = adaptiveEpisodes(notes.length);
  console.log(`Using ${workerCount} worker(s), ${totalEpisodes} episodes (adaptive budget, ${notes.length} groups)`);

  // 如果只有1个Worker，直接使用单线程
  if (workerCount === 1) {
    const solver = new DynaQSolver({
      nEpisodes: totalEpisodes,
      maxEpisodeLength: 100,
      learningRate: 0.99,
      explorationRate: 0.8,
      planningSteps: 10,
      randomSeed: Date.now(),
      priors
    });

    return solver.solve(hand, notes, part, (episode, total) => {
      if (progressCallback) {
        progressCallback((episode / total) * 100);
      }
    });
  }

  // 多Worker并行训练
  const workerConfigs = createWorkerConfigs(workerCount, totalEpisodes, priors);
  
  // 创建Workers
  const workerPromises = workerConfigs.map((config, index) => {
    return new Promise<Map<string, number>>((resolve, reject) => {
      let worker: Worker | null = null;
      let useFallback = false;

      try {
        // 尝试创建真正的Web Worker
        worker = new Worker(
          new URL('../../workers/dynaQ.worker.ts', import.meta.url),
          { type: 'module' }
        );

        console.log(`Worker ${index + 1}/${workerCount} created successfully`);

        // 设置消息监听
        worker.onmessage = (e: MessageEvent) => {
          const { type, qTable, error, progress } = e.data;

          if (type === 'complete') {
            console.log(`Worker ${index + 1} completed training`);
            if (worker) worker.terminate();
            
            // 将数组转换回Map
            const qTableMap = new Map<string, number>(qTable || []);
            resolve(qTableMap);
            
          } else if (type === 'error') {
            console.error(`Worker ${index + 1} error:`, error);
            if (worker) worker.terminate();
            reject(new Error(error));
            
          } else if (type === 'progress' && progressCallback) {
            // 计算总体进度
            const overallProgress = ((index + (progress || 0) / 100) / workerCount) * 100;
            progressCallback(overallProgress);
          }
        };

        // 设置错误监听
        worker.onerror = (err: ErrorEvent) => {
          console.error(`Worker ${index + 1} error event:`, err.message);
          if (worker) worker.terminate();
          reject(new Error(err.message));
        };

        // 发送训练任务
        worker.postMessage({
          type: 'train',
          notes,
          hand,
          part,
          config
        });

      } catch (err) {
        // Worker创建失败，使用单线程fallback
        console.warn(`Worker ${index + 1} creation failed, using single-threaded fallback:`, err);
        useFallback = true;
      }

      // 单线程fallback
      if (useFallback) {
        const solver = new DynaQSolver({
          nEpisodes: config.episodes,
          maxEpisodeLength: 100,
          learningRate: config.learningRate,
          explorationRate: config.explorationRate,
          planningSteps: config.planningSteps,
          randomSeed: config.seed,
          priors: config.priors
        });

        try {
          solver.solve(hand, notes, part, (episode, total) => {
            if (progressCallback) {
              const overallProgress = ((index + episode / total) / workerCount) * 100;
              progressCallback(overallProgress);
            }
          });

          const qTable = solver.getQTable();
          resolve(qTable);
        } catch (error) {
          reject(error);
        }
      }
    });
  });

  // 等待所有Workers完成
  const qTables = await Promise.all(workerPromises);

  // 合并Q表
  console.log(`Merging ${qTables.length} Q-tables...`);
  const mergedQTable = mergeQTables(qTables);

  // 提取策略（热启动 + 保守采纳）
  return extractPolicyFromQTable(mergedQTable, hand, notes, part, priors);
}

/**
 * 分段范围计算
 */
function splitedRange(notes: Note[][], hand: Hand): number[][] {
  const ranges: number[][] = [];
  let start = 0;
  const maxSegmentSize = 50; // 每段最多50个音符组

  while (start < notes.length) {
    const end = Math.min(start + maxSegmentSize, notes.length);
    ranges.push([start, end]);
    start = end;
  }

  return ranges;
}

/**
 * 带进度追踪的分段处理
 */
function runSplitWithProgress(
  notes: Note[][],
  hand: Hand,
  readRange: number[][],
  totalSegments: number,
  completedSegments: { value: number },
  priors?: GroupPriors[],
  progressCallback?: ProgressCallback
): Promise<Fingering[]> {
  return new Promise(async (resolve, reject) => {
    try {
      const resultFingering: Fingering[] = new Array(notes.length);

      for (let index = 0; index < readRange.length; index++) {
        const [start, end] = readRange[index];
        const rangeLen = readRange.length;

        // 确定部分类型
        let part: Part;
        if (rangeLen === 1) {
          part = Part.WholePart;
        } else if (index === 0) {
          part = Part.FirstPart;
        } else if (index === rangeLen - 1) {
          part = Part.LastPart;
        } else {
          part = Part.MiddlePart;
        }

        // 使用并行训练（先验切片与段落对齐）
        const segmentNotes = notes.slice(start, end);
        const segmentPriors = priors ? priors.slice(start, end) : undefined;
        const policy = await parallelTrain(segmentNotes, hand, part, segmentPriors, (segmentProgress) => {
          // 计算总体进度
          const baseProgress = (completedSegments.value / totalSegments) * 100;
          const segmentWeight = (1 / totalSegments) * 100;
          const totalProgress = baseProgress + (segmentProgress / 100) * segmentWeight;
          
          if (progressCallback) {
            progressCallback(totalProgress);
          }
        });

        // 保存结果
        for (let i = 0; i < policy.length; i++) {
          resultFingering[start + i] = policy[i];
        }

        console.log(`Completed: part ${index + 1}/${rangeLen}, length ${segmentNotes.length}`);

        // 更新进度
        completedSegments.value += 1;
        const progressPct = (completedSegments.value / totalSegments) * 100;

        if (progressCallback) {
          try {
            progressCallback(progressPct);
          } catch (e) {
            console.warn('Progress callback failed:', e);
          }
        }
      }

      resolve(resultFingering);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 主指法生成函数
 */
export async function generateFingering(
  notesRh: Note[][],
  notesLh: Note[][],
  priorsRh?: GroupPriors[],
  priorsLh?: GroupPriors[],
  progressCallback?: ProgressCallback
): Promise<FingeringResult> {
  console.log('generateFingering called with:', {
    rhLength: notesRh.length,
    lhLength: notesLh.length,
    rhPriors: priorsRh?.length ?? 0,
    lhPriors: priorsLh?.length ?? 0
  });

  // 处理空手的情况
  if (notesRh.length === 0 && notesLh.length === 0) {
    console.warn('Both hands are empty!');
    return { rightHand: [], leftHand: [] };
  }

  // 计算总分段数
  const readRangeRh = notesRh.length > 0 ? splitedRange(notesRh, Hand.RightHand) : [];
  const readRangeLh = notesLh.length > 0 ? splitedRange(notesLh, Hand.LeftHand) : [];
  const totalSegments = readRangeRh.length + readRangeLh.length;
  const completedSegments = { value: 0 };

  let rhResult: Fingering[] = [];
  let lhResult: Fingering[] = [];

  if (notesRh.length > 0) {
    console.log('Right hand processing started...');
    rhResult = await runSplitWithProgress(
      notesRh,
      Hand.RightHand,
      readRangeRh,
      totalSegments,
      completedSegments,
      priorsRh,
      progressCallback
    );
  } else {
    console.log('Right hand is empty, skipping...');
  }

  if (notesLh.length > 0) {
    console.log('Left hand processing started...');
    lhResult = await runSplitWithProgress(
      notesLh,
      Hand.LeftHand,
      readRangeLh,
      totalSegments,
      completedSegments,
      priorsLh,
      progressCallback
    );
  } else {
    console.log('Left hand is empty, skipping...');
  }

  // 转换为输出格式
  const result = {
    rightHand: rhResult.length > 0 ? convertToFingeringEntries(rhResult) : [],
    leftHand: lhResult.length > 0 ? convertToFingeringEntries(lhResult) : []
  };

  console.log('generateFingering result:', {
    rhCount: result.rightHand.length,
    lhCount: result.leftHand.length
  });

  return result;
}

/**
 * 转换为指法条目格式
 */
function convertToFingeringEntries(
  fingerings: Fingering[]
): FingeringResultEntry[] {
  if (!Array.isArray(fingerings)) {
    throw new Error(`fingerings must be an array, got ${typeof fingerings}`);
  }

  const entries: FingeringResultEntry[] = [];
  let globalPosition = 0;

  for (let i = 0; i < fingerings.length; i++) {
    const fingering = fingerings[i];

    if (!Array.isArray(fingering)) {
      console.error(`Invalid fingering at index ${i} (not an array):`, fingering);
      continue;
    }

    // 按pitch排序，确保顺序正确
    const sortedFingering = [...fingering].sort((a, b) => a.pitch - b.pitch);

    for (let j = 0; j < sortedFingering.length; j++) {
      const entry = sortedFingering[j];

      if (!entry || typeof entry.pitch !== 'number' || typeof entry.finger !== 'number') {
        console.error(`Invalid fingering entry at [${i}][${j}]:`, entry);
        continue;
      }

      entries.push({
        pitch: entry.pitch,
        finger: entry.finger,
        position: globalPosition
      });
      globalPosition++;
    }
  }

  return entries;
}

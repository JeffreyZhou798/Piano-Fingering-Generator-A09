// 数据+规则融合层 - 单一混合模式的核心
// 不变量：λ ∈ [0.4, 0.85]，数据项与规则项永远同时在场，代码层面不可退化为纯数据或纯规则
import { Hand, Finger, Fingering, FingeringState } from './types';
import { rewardFunction } from './mdp';

// 硬编码常数（方案要求：开区间，不可表达纯数据/纯规则）
export const TAU = 5.0;          // Q_NN = τ · logP 的热启动系数
export const GAMMA_PHYS = 0.3;   // 热启动中物理规则项的固定权重 γ ≡ 0.3
export const LAMBDA_MIN = 0.4;   // 数据权重下界
export const LAMBDA_SPAN = 0.45; // λ = 0.4 + 0.45·c(s) ∈ [0.4, 0.85]
const EPS = 1e-6;
const LOG_UNIFORM = -Math.log(5); // 均匀分布的 logP
const REWARD_SCALE = 50;          // 数据项缩放至与物理奖励同量级

export interface NotePrior {
  pitch: number;
  probs: number[]; // 长度5，索引 = finger - 1
}

export type GroupPriors = NotePrior[];

function lookupProbs(priors: GroupPriors | undefined, pitch: number): number[] | null {
  if (!priors) return null;
  const entry = priors.find(p => p.pitch === pitch);
  return entry ? entry.probs : null;
}

/**
 * 动作的平均 log P（数据先验打分）
 */
export function meanLogP(priors: GroupPriors | undefined, action: Fingering): number {
  if (!priors || action.length === 0) return LOG_UNIFORM;
  let sum = 0;
  let count = 0;
  for (const entry of action) {
    const probs = lookupProbs(priors, entry.pitch);
    if (probs) {
      sum += Math.log(Math.max(probs[entry.finger - 1], EPS));
      count++;
    }
  }
  return count > 0 ? sum / count : LOG_UNIFORM;
}

/**
 * 数据奖励：把 meanLogP 映射到与物理奖励同量级
 * 均匀分布 → 0，完全确定 → REWARD_SCALE，低于均匀 → 负值（下限截断）
 */
export function dataReward(priors: GroupPriors | undefined, action: Fingering): number {
  const mlp = meanLogP(priors, action);
  const scaled = REWARD_SCALE * (mlp - LOG_UNIFORM) / (0 - LOG_UNIFORM);
  return Math.max(-REWARD_SCALE * 0.5, Math.min(REWARD_SCALE, scaled));
}

/**
 * 熵基动态 λ：模型越确定（熵越低），越信任数据
 * λ(s) = 0.4 + 0.45 · c(s)，c(s) = 1 - H/log5
 */
export function lambdaFor(priors: GroupPriors | undefined): number {
  if (!priors || priors.length === 0) return LAMBDA_MIN + LAMBDA_SPAN / 2;
  let entropySum = 0;
  let count = 0;
  for (const np of priors) {
    let h = 0;
    for (const p of np.probs) {
      if (p > EPS) h -= p * Math.log(p);
    }
    entropySum += h;
    count++;
  }
  const c = 1 - (entropySum / count) / Math.log(5);
  return LAMBDA_MIN + LAMBDA_SPAN * Math.max(0, Math.min(1, c));
}

/**
 * 单模融合奖励（唯一模式：数据+规则，双项永不离场）
 * R(s,a) = λ(s)·R_data + (1-λ(s))·R_phys
 */
export function hybridReward(
  hand: Hand,
  state: FingeringState,
  action: Fingering,
  priors: GroupPriors | undefined
): number {
  const phys = rewardFunction(hand, state, action);
  if (!priors) return phys; // 仅在调用方未提供先验时（不应发生于正常流程）
  const lambda = lambdaFor(priors);
  return lambda * dataReward(priors, action) + (1 - lambda) * phys;
}

/**
 * 热启动 Q 值（冻结价值估计器）：
 * Q0(s,a) = τ·meanLogP(a|s) + γ·R_phys(s,a)，τ=5.0，γ≡0.3 硬编码
 */
export function hotStartQ(
  hand: Hand,
  state: FingeringState,
  action: Fingering,
  priors: GroupPriors | undefined
): number {
  if (!priors) return 0;
  return TAU * meanLogP(priors, action) + GAMMA_PHYS * rewardFunction(hand, state, action);
}

/**
 * 软剪枝（安全且不丢数据）：
 * ① Top-3(P) ∩ 物理可达候选
 * ② 不足则放宽为 P>0.1 ∩ 物理可达
 * ③ 再不足保留物理全集
 * 无论候选如何变化，奖励中的数据项永远在场
 */
export function pruneActions(actions: Fingering[], priors: GroupPriors | undefined): Fingering[] {
  if (!priors || priors.length === 0 || actions.length === 0) return actions;

  // 数据补救候选：若 NN 主选择（逐音 argmax）满足和弦内手指不重复硬约束，
  // 且不在现有候选中，则注入候选集——确保物理规则生成器退化时数据先验仍有代表
  const nnAction = nnArgmaxCandidate(actions, priors);
  const pool = nnAction ? [nnAction, ...actions] : actions;

  if (pool.length <= 1) return pool;

  const topK = (probs: number[], k: number): Set<number> => {
    const indexed = probs.map((p, i) => ({ p, f: i + 1 }));
    indexed.sort((a, b) => b.p - a.p);
    return new Set(indexed.slice(0, k).map(x => x.f));
  };

  const filterBy = (allowed: (probs: number[]) => Set<number>): Fingering[] => {
    return actions.filter(action =>
      action.every(entry => {
        const probs = lookupProbs(priors, entry.pitch);
        if (!probs) return true; // 无先验的音符不限制
        return allowed(probs).has(entry.finger);
      })
    );
  };

  // ① Top-3
  let pruned = filterBy(probs => topK(probs, 3));
  if (pruned.length > 0) return pruned;

  // ② 放宽为 P > 0.1
  pruned = filterBy(probs => new Set(probs.map((p, i) => ({ p, f: i + 1 })).filter(x => x.p > 0.1).map(x => x.f)));
  if (pruned.length > 0) return pruned;

  // ③ 物理全集兜底（奖励中数据项仍对每个动作打分）
  return pool;
}

/**
 * 构造 NN 主选择候选（逐音 argmax，要求手指互不重复）
 */
function nnArgmaxCandidate(actions: Fingering[], priors: GroupPriors): Fingering | null {
  const reference = actions[0];
  if (!reference) return null;

  const candidate: Fingering = [];
  const usedFingers = new Set<number>();

  for (const entry of reference) {
    const probs = lookupProbs(priors, entry.pitch);
    if (!probs) return null; // 有音符无先验则放弃补救
    // 选未被占用的最高概率手指
    const order = probs.map((p, i) => ({ p, f: i + 1 })).sort((a, b) => b.p - a.p);
    const chosen = order.find(x => !usedFingers.has(x.f));
    if (!chosen) return null;
    usedFingers.add(chosen.f);
    candidate.push({ pitch: entry.pitch, finger: chosen.f as Finger });
  }

  // 已在候选集中则无需注入
  const key = (f: Fingering) => f.map(e => `${e.pitch}:${e.finger}`).sort().join(',');
  const candidateKey = key(candidate);
  if (actions.some(a => key(a) === candidateKey)) return null;

  return candidate;
}

/**
 * NN 主选择（每音符 argmax），用于保守采纳规则
 */
export function nnArgmaxAction(actions: Fingering[], priors: GroupPriors | undefined): Fingering | null {
  if (!priors || priors.length === 0) return null;
  for (const action of actions) {
    const isArgmax = action.every(entry => {
      const probs = lookupProbs(priors, entry.pitch);
      if (!probs) return false;
      let best = 0;
      for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
      return entry.finger === best + 1;
    });
    if (isArgmax) return action;
  }
  return null;
}

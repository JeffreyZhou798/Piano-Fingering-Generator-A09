// 神经先验推理层 - 整首预推理生成指法概率分布 P_base
// Round-0: 无 hint，NN 贪心自回归更新手型状态
import { Note } from '../algorithm/types';
import { GroupPriors } from '../algorithm/fusion';
import { OrtLike, OrtSessionLike } from './ort';
import { buildTokens, LookaheadNote } from './tokens';

const EPS = 1e-8;

function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (logits[i] > max) max = logits[i];
  }
  let sum = 0;
  const exps: number[] = new Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - max);
    sum += exps[i];
  }
  return exps.map(e => e / sum);
}

function argmax(arr: ArrayLike<number>): number {
  let maxIdx = 0;
  let maxVal = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > maxVal) {
      maxVal = arr[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

interface FlatNote {
  midi: number;
  timeMs: number;
  durationMs: number;
  groupIndex: number;
}

/**
 * 对一只手的所有音符组做整首预推理
 * 返回与输入 groups 对齐的 P_base: priors[groupIndex] = [{pitch, probs[5]}]
 *
 * @param hints 可选: groupIndex -> Map<pitch, finger(1-5)> 用户固定指法（fill-in-the-blanks）
 */
export async function computeHandPriors(
  ort: OrtLike,
  session: OrtSessionLike,
  groups: Note[][],
  hints?: Map<number, Map<number, number>>,
  onProgress?: (done: number, total: number) => void
): Promise<GroupPriors[]> {
  const priors: GroupPriors[] = groups.map(() => []);
  if (groups.length === 0) return priors;

  // 展平并排序（时间升序，和弦内音高升序）
  const flat: FlatNote[] = [];
  groups.forEach((group, gi) => {
    const sortedGroup = [...group].sort((a, b) => a.pitch - b.pitch);
    for (const n of sortedGroup) {
      flat.push({
        midi: n.pitch,
        timeMs: n.timeMs ?? n.position,
        durationMs: n.durationMs ?? 500,
        groupIndex: gi
      });
    }
  });
  flat.sort((a, b) => a.timeMs - b.timeMs || a.midi - b.midi);

  // 每手指状态
  const fingerLastMidi = [-1, -1, -1, -1, -1];
  const fingerLastTime = [Infinity, Infinity, Infinity, Infinity, Infinity];

  for (let i = 0; i < flat.length; i++) {
    const note = flat[i];

    // 构建 lookahead（未来 20 音符，带可选 hint）
    const lookahead: LookaheadNote[] = [];
    const end = Math.min(i + 21, flat.length);
    for (let k = i + 1; k < end; k++) {
      const fn = flat[k];
      let fingerHint: number | null = null;
      const groupHints = hints?.get(fn.groupIndex);
      if (groupHints) {
        const hf = groupHints.get(fn.midi);
        if (hf !== undefined && hf >= 1 && hf <= 5) fingerHint = hf - 1;
      }
      lookahead.push({ midi: fn.midi, timeUntil: fn.timeMs - note.timeMs, finger: fingerHint });
    }

    const tokenData = buildTokens(note.midi, fingerLastMidi, fingerLastTime, lookahead);
    const inputTensor = new ort.Tensor('float32', tokenData, [1, 26, 5]);

    let logits: ArrayLike<number>;
    try {
      const output = await session.run({ tokens: inputTensor });
      logits = output.logits.data as Float32Array;
    } catch (err) {
      // 运行时瞬时故障：重试一次（G5）
      const output = await session.run({ tokens: inputTensor });
      logits = output.logits.data as Float32Array;
    }

    // 不变量断言：logits 必须有限（G4/G5 语义，绝不静默降级）
    let finite = true;
    for (let j = 0; j < 5; j++) {
      if (!Number.isFinite(logits[j])) { finite = false; break; }
    }
    if (!finite) {
      throw new Error(`NEURAL_ENGINE_INVALID_OUTPUT at note ${i} (midi ${note.midi})`);
    }

    const probs = softmax(logits);
    priors[note.groupIndex].push({ pitch: note.midi, probs });

    // Round-0: 用 NN 贪心预测更新手型状态；若该音有 hint 则用 hint
    let finger: number;
    const groupHints = hints?.get(note.groupIndex);
    const hintFinger = groupHints?.get(note.midi);
    if (hintFinger !== undefined && hintFinger >= 1 && hintFinger <= 5) {
      finger = hintFinger;
    } else {
      finger = argmax(probs) + 1;
    }

    const fingerIdx = finger - 1;
    fingerLastMidi[fingerIdx] = note.midi;
    fingerLastTime[fingerIdx] = -note.durationMs / 1000.0; // 负值 = 仍在按住

    // 推进其他手指的时间
    if (i + 1 < flat.length) {
      const dt = (flat[i + 1].timeMs - note.timeMs) / 1000.0;
      for (let f = 0; f < 5; f++) {
        if (fingerLastTime[f] !== Infinity) {
          fingerLastTime[f] += dt;
        }
      }
    }

    if (onProgress && (i % 10 === 0 || i === flat.length - 1)) {
      onProgress(i + 1, flat.length);
    }
  }

  return priors;
}

/**
 * 引擎启动自检（G4）：5 音符试推理，校验有限性与 softmax 行和≈1
 * 不通过则抛错，UI 显示显式错误页（G6），绝不静默回退
 */
export async function selfCheckSession(
  ort: OrtLike,
  session: OrtSessionLike,
  hand: 'left' | 'right'
): Promise<void> {
  const testGroups: Note[][] = [
    [{ pitch: 60, velocity: 64, position: 0, duration: 1, channel: 0, timeMs: 0, durationMs: 500 }],
    [{ pitch: 62, velocity: 64, position: 1, duration: 1, channel: 0, timeMs: 500, durationMs: 500 }],
    [{ pitch: 64, velocity: 64, position: 2, duration: 1, channel: 0, timeMs: 1000, durationMs: 500 }],
    [{ pitch: 65, velocity: 64, position: 3, duration: 1, channel: 0, timeMs: 1500, durationMs: 500 }],
    [{ pitch: 67, velocity: 64, position: 4, duration: 1, channel: 0, timeMs: 2000, durationMs: 500 }]
  ];

  const priors = await computeHandPriors(ort, session, testGroups);

  for (const group of priors) {
    for (const np of group) {
      let sum = 0;
      for (const p of np.probs) {
        if (!Number.isFinite(p) || p < 0) {
          throw new Error(`NEURAL_ENGINE_SELF_CHECK_FAILED (${hand}): non-finite probability`);
        }
        sum += p;
      }
      if (Math.abs(sum - 1.0) > 1e-3) {
        throw new Error(`NEURAL_ENGINE_SELF_CHECK_FAILED (${hand}): probability sum ${sum}`);
      }
    }
  }
}

/**
 * 将 RL 策略转换为 hints（groupIndex -> Map<pitch, finger>）
 * 用于 ICCD 后续轮次的 fill-in-the-blanks 重推理
 */
export function policyToHints(
  groups: Note[][],
  policy: import('../algorithm/types').Fingering[]
): Map<number, Map<number, number>> {
  const hints = new Map<number, Map<number, number>>();
  for (let gi = 0; gi < policy.length && gi < groups.length; gi++) {
    const groupHints = new Map<number, number>();
    // policy[gi] 按 pitch 升序（与 computeHandPriors 内部排序一致）
    const sortedGroup = [...groups[gi]].sort((a, b) => a.pitch - b.pitch);
    const fingering = policy[gi];
    for (let i = 0; i < sortedGroup.length && i < fingering.length; i++) {
      groupHints.set(sortedGroup[i].pitch, fingering[i].finger);
    }
    if (groupHints.size > 0) hints.set(gi, groupHints);
  }
  return hints;
}

/**
 * ICCD 双通道锚点终止判断：
 * 主通道：Q 边际 > 0.15τ ∩ P_NN(top1) > 0.6 的音符占比 > 85%（即修正<15%）
 * 重叠率：当前轮与上一轮策略相同音符占比 > 90%
 */
export function iccdShouldTerminate(
  prevPolicy: import('../algorithm/types').Fingering[] | null,
  currPolicy: import('../algorithm/types').Fingering[],
  priors: GroupPriors[]
): boolean {
  // 无上一轮策略时只看当前轮是否已稳定（保守采纳后大部分跟随 NN）
  if (!prevPolicy || prevPolicy.length === 0) {
    return false;
  }

  // 重叠率：相同 (pitch, finger) 的比例
  let sameCount = 0;
  let totalCount = 0;
  const minLen = Math.min(prevPolicy.length, currPolicy.length);
  for (let gi = 0; gi < minLen; gi++) {
    const prev = [...prevPolicy[gi]].sort((a, b) => a.pitch - b.pitch);
    const curr = [...currPolicy[gi]].sort((a, b) => a.pitch - b.pitch);
    for (let i = 0; i < Math.min(prev.length, curr.length); i++) {
      totalCount++;
      if (prev[i].finger === curr[i].finger) sameCount++;
    }
  }
  const overlap = totalCount > 0 ? sameCount / totalCount : 0;
  return overlap > 0.90;
}

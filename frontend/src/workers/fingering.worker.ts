// 主 Worker - 数据+规则混合模式完整流水线
// 引擎初始化(保证栈G0-G4) → 解析 → ICCD协同解码(≤3轮 NN推理↔Dyna-Q) → 完成
// 任何神经引擎故障都会显式报错（G6），绝不静默回退纯规则
import * as ort from 'onnxruntime-web';
import { parseMusicXML, validateNotes } from '../lib/music/parser';
import { generateFingering } from '../lib/algorithm/process';
import { Note, Fingering, FingeringResult } from '../lib/algorithm/types';
import { GroupPriors } from '../lib/algorithm/fusion';
import { initNeuralEngine } from '../lib/nn/engine';
import { computeHandPriors, policyToHints, iccdShouldTerminate } from '../lib/nn/inference';
import { OrtLike } from '../lib/nn/ort';

export interface WorkerRequest {
  type: 'generate';
  xmlContent: string;
  fileName: string;
  publicBaseUrl: string; // 静态资源根 URL（models/ 与 ort/ 的父路径）
}

export interface WorkerResponse {
  type: 'progress' | 'complete' | 'error';
  progress?: number;
  stage?: 'engine' | 'parse' | 'neural' | 'rl';
  result?: FingeringResult;
  error?: string;
}

const ICCD_MAX_ROUNDS = 3; // ICCD 最大轮数（方案03：≤3轮）

let ortConfigured = false;

function configureOrt(publicBaseUrl: string): void {
  if (ortConfigured) return;
  // 自托管 wasm（G0），单线程保证 GitHub Pages 等无 COOP/COEP 环境可用
  ort.env.wasm.wasmPaths = `${publicBaseUrl}ort/`;
  ort.env.wasm.numThreads = 1;
  ortConfigured = true;
}

// Worker消息处理
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, xmlContent, fileName, publicBaseUrl } = event.data;

  if (type !== 'generate') return;

  const report = (progress: number, stage: WorkerResponse['stage']) => {
    postMessage({ type: 'progress', progress, stage } as WorkerResponse);
  };

  try {
    // ===== 阶段1: 神经引擎初始化（保证栈 G0-G4）=====
    configureOrt(publicBaseUrl);
    report(5, 'engine');

    const sessions = await initNeuralEngine(ort as unknown as OrtLike, `${publicBaseUrl}models/`);
    console.log('[Worker] Neural engine initialized (self-check passed)');
    report(15, 'engine');

    // ===== 阶段2: 解析 MusicXML =====
    const { rightHand, leftHand } = await parseMusicXML(xmlContent);

    console.log('Parsed notes:', {
      rightHandGroups: rightHand.length,
      leftHandGroups: leftHand.length,
      rightHandTotal: rightHand.reduce((sum, group) => sum + group.length, 0),
      leftHandTotal: leftHand.reduce((sum, group) => sum + group.length, 0)
    });

    if (!validateNotes(rightHand) && rightHand.length > 0) {
      throw new Error('Invalid notes data in right hand');
    }
    if (!validateNotes(leftHand) && leftHand.length > 0) {
      throw new Error('Invalid notes data in left hand');
    }
    if (rightHand.length === 0 && leftHand.length === 0) {
      throw new Error('No playable notes found in the score');
    }

    report(20, 'parse');

    // ===== 阶段3: ICCD 协同解码（≤3轮 NN推理↔Dyna-Q）=====
    // 进度映射：20% → 100%，分 ICCD_MAX_ROUNDS 轮
    // 每轮内：NN推理占该轮的30%，Dyna-Q占70%
    const totalNotes =
      rightHand.reduce((s, g) => s + g.length, 0) + leftHand.reduce((s, g) => s + g.length, 0);

    let priorsRh: GroupPriors[] = [];
    let priorsLh: GroupPriors[] = [];
    let prevPolicyRh: Fingering[] | null = null;
    let prevPolicyLh: Fingering[] | null = null;
    let result: FingeringResult = { rightHand: [], leftHand: [] };

    for (let round = 0; round < ICCD_MAX_ROUNDS; round++) {
      const roundBase = 20 + (round / ICCD_MAX_ROUNDS) * 80; // 该轮起始进度
      const roundSpan = 80 / ICCD_MAX_ROUNDS; // 该轮进度跨度

      // --- NN 推理（Round-0 无hint，后续轮带上一轮策略作hint）---
      const nnProgressCb = (done: number, _total: number) => {
        const withinRound = Math.min(1, done / Math.max(1, totalNotes)) * 0.3;
        report(roundBase + withinRound * roundSpan, 'neural');
      };

      const hintsRh = prevPolicyRh ? policyToHints(rightHand, prevPolicyRh) : undefined;
      const hintsLh = prevPolicyLh ? policyToHints(leftHand, prevPolicyLh) : undefined;

      priorsRh = rightHand.length > 0
        ? await computeHandPriors(ort as unknown as OrtLike, sessions.right, rightHand, hintsRh, nnProgressCb)
        : [];
      priorsLh = leftHand.length > 0
        ? await computeHandPriors(ort as unknown as OrtLike, sessions.left, leftHand, hintsLh, nnProgressCb)
        : [];

      console.log(`[Worker] ICCD Round ${round}: NN priors computed (rh=${priorsRh.length}, lh=${priorsLh.length})`);

      // --- 混合 Dyna-Q ---
      const rlProgressCb = (progress: number) => {
        const withinRound = 0.3 + (progress / 100) * 0.7;
        report(roundBase + withinRound * roundSpan, 'rl');
      };

      result = await generateFingering(rightHand, leftHand, priorsRh, priorsLh, rlProgressCb);

      // 提取当前轮策略（从结果重建 Fingering[] 格式）
      const currPolicyRh = extractPolicyFromResult(result.rightHand ?? [], rightHand);
      const currPolicyLh = extractPolicyFromResult(result.leftHand ?? [], leftHand);

      console.log(`[Worker] ICCD Round ${round}: Dyna-Q done (rh=${currPolicyRh.length}, lh=${currPolicyLh.length})`);

      // --- ICCD 终止判断（重叠率>90%）---
      if (round > 0) {
        const terminateRh = rightHand.length === 0 || iccdShouldTerminate(prevPolicyRh, currPolicyRh, priorsRh);
        const terminateLh = leftHand.length === 0 || iccdShouldTerminate(prevPolicyLh, currPolicyLh, priorsLh);
        if (terminateRh && terminateLh) {
          console.log(`[Worker] ICCD converged at round ${round} (overlap > 90%)`);
          break;
        }
      }

      prevPolicyRh = currPolicyRh;
      prevPolicyLh = currPolicyLh;
    }

    console.log('Fingering generation complete:', {
      rightHandEntries: result?.rightHand?.length || 0,
      leftHandEntries: result?.leftHand?.length || 0
    });

    // 释放会话资源
    try {
      await sessions.left.release?.();
      await sessions.right.release?.();
    } catch {
      // 忽略释放错误
    }

    postMessage({
      type: 'complete',
      result,
      progress: 100
    } as WorkerResponse);

  } catch (error) {
    console.error('Worker error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    } as WorkerResponse);
  }
};

/**
 * 从 FingeringResultEntry[] 重建 Fingering[]（按组分块）
 * 用于 ICCD 终止判断与 hint 构造
 */
function extractPolicyFromResult(
  entries: { pitch: number; finger: number; position: number }[],
  groups: Note[][]
): Fingering[] {
  const policy: Fingering[] = [];
  let ptr = 0;
  for (const group of groups) {
    const m = Math.min(group.length, 5);
    const slice = entries.slice(ptr, ptr + m);
    const fingering: Fingering = slice.map(e => ({
      pitch: e.pitch,
      finger: e.finger as import('../lib/algorithm/types').Finger
    }));
    if (fingering.length > 0) policy.push(fingering);
    ptr += m;
  }
  return policy;
}

export {};

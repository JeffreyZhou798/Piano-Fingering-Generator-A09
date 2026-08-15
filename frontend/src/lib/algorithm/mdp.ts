// MDP定义 - 翻译自 src/mdp.jl
import {
  Note,
  Hand,
  Finger,
  Fingering,
  FingeringState,
  Part
} from './types';
import {
  SINGLE_FINGER_STRENGTH,
  keyDistance,
  chordRange,
  handMoveDistance,
  allStretchRate,
  stretchRate,
  assignFingering,
  buildFingering,
  isSameNotes
} from './const';
import { get1to1Fingering, is1to1Cross, crossDistance } from './fingering';
import { pruneActions } from './fusion';

/**
 * 奖励函数 - 核心算法
 */
export function rewardFunction(
  hand: Hand,
  s: FingeringState,
  a: Fingering
): number {
  const fingeringSp = a;
  const fingeringS = s.fingering;
  const numS = fingeringS.length;
  const numSp = fingeringSp.length;

  const notesSp = fingeringSp.map(f => ({ pitch: f.pitch, velocity: 64, position: 0, duration: 0, channel: 0 } as Note));
  const notesS = fingeringS.map(f => ({ pitch: f.pitch, velocity: 64, position: 0, duration: 0, channel: 0 } as Note));

  const notesSduration = numS !== 0 ? notesS[0].duration : 0;

  // 手指力量奖励
  const fingerReward = fingeringSp
    .reduce((sum, f) => sum + SINGLE_FINGER_STRENGTH[f.finger - 1], 0);

  let reward = 0;

  // 初始指法奖励
  if (s.index === 0 || notesSduration >= 15120) {
    reward = numSp === 1 ? 50 : 50 * (1 - allStretchRate(hand, fingeringSp));
  }
  // 前一个指法与下一个指法相同
  else if (fingeringsEqual(fingeringS, fingeringSp)) {
    reward = 50;
  }
  // 1音到1音
  else if (numS === 1 && numSp === 1) {
    const possibleFingerings = get1to1Fingering(hand, fingeringS, notesSp[0]);
    
    if (possibleFingerings.some(f => fingeringsEqual(f, fingeringSp))) {
      const nfpS = { note: notesS[0], finger: fingeringS[0].finger };
      const nfpSp = { note: notesSp[0], finger: fingeringSp[0].finger };

      if (is1to1Cross(hand, nfpS, nfpSp)) {
        const cd = crossDistance(nfpS, nfpSp);
        reward = 20 + 2.5 * (4 - cd);
      } else {
        const sr = stretchRate(hand, nfpS, nfpSp);

        if (sr === 0 || (
          Math.ceil(keyDistance(notesS[0], notesSp[0])) === 1 &&
          Math.abs(fingeringS[0].finger - fingeringSp[0].finger) === 1
        )) {
          return 50;
        } else if (sr > 0) {
          const absSr = Math.abs(sr);
          reward = 40 + 10 * (1 - Math.pow(absSr, 2));
        }
      }
    } else {
      reward = 20 - handMoveDistance(hand, fingeringS, fingeringSp) / 2;
    }
  }
  // N音到N音
  else {
    const rangeS = chordRange(notesS);
    const rangeSp = chordRange(notesSp);
    const revNum = noteFingerReverseOrderNum(hand, fingeringS, fingeringSp);

    let sameFingerNum = 0;
    let sameNoteNum = 0;

    if (revNum === 0) {
      sameFingerNum = sameFingerButDifferentNoteNum(fingeringS, fingeringSp);
      sameNoteNum = sameNoteButDifferentFingerNum(fingeringS, fingeringSp);
    }

    let discount = 1;
    if (!(rangeS >= 6 && rangeSp >= 6)) {
      discount = 1 - (sameFingerNum + sameNoteNum + revNum) / (numS + numSp);
    }

    // 1到N, N到N
    if (numSp > 1) {
      const moveDis = handMoveDistance(hand, fingeringS, fingeringSp);
      const strRate = allStretchRate(hand, fingeringSp);

      if (rangeS >= 6 && rangeSp >= 6) {
        reward = 49 * (1 - strRate) + 1;
      } else if (moveDis > 5) {
        reward = (20 * (1 - strRate) + (45 - moveDis) / 4.5) * discount;
      } else {
        reward = (25 * (6 * (1 - Math.pow(strRate, 2.2)) + 4 * (5 - moveDis)) / 13) * discount;
      }
    }
    // N到1
    else {
      const moveDis = handMoveDistance(hand, fingeringS, fingeringSp);
      const cr = chordRangeBetween(fingeringS, fingeringSp);

      if (cr >= 7) {
        discount = 1;
      }

      reward = (50 - 1.2 * moveDis) * discount;

      if (moveDis >= 20) {
        return reward + 0.01 * fingerReward * 500;
      }
    }
  }

  return reward + 0.01 * fingerReward;
}

/**
 * 动作空间函数（数据+规则模式：可选神经先验软剪枝）
 * 软剪枝只缩小候选集，奖励中的数据项永远对每个候选打分，数据先验永不离场
 */
export function actionSpace(
  hand: Hand,
  s: FingeringState,
  allNotes: Note[][],
  priors?: import('./fusion').GroupPriors[]
): Fingering[] {
  const actions = rawActionSpace(hand, s, allNotes);
  if (!priors) return actions;
  return pruneActions(actions, priors[s.index]);
}

function rawActionSpace(
  hand: Hand,
  s: FingeringState,
  allNotes: Note[][]
): Fingering[] {
  if (s.index >= allNotes.length) {
    return [];
  }

  const notesSp = allNotes[s.index];
  const fingeringS = s.fingering;
  const numS = fingeringS.length;
  const numSp = notesSp.length;

  const notesS = fingeringS.map(f => ({ pitch: f.pitch, velocity: 64, position: 0, duration: 0, channel: 0 } as Note));
  const notesSduration = numS !== 0 ? notesS[0].duration : 0;

  // 第一个音符
  if (s.index === 0) {
    if (s.part === Part.FirstPart || s.part === Part.WholePart || notesSduration >= 15120) {
      return assignFingering(hand, notesSp);
    } else {
      // 只有单音时才使用F5，和弦时使用assignFingering
      if (numSp === 1) {
        return [buildFingering(hand, notesSp, [Finger.F5])];
      } else {
        return assignFingering(hand, notesSp);
      }
    }
  }
  // 最后一个音符
  else if (s.index === allNotes.length - 1 && 
           (s.part === Part.FirstPart || s.part === Part.MiddlePart)) {
    // 只有单音时才使用F5，和弦时使用assignFingering
    if (numSp === 1) {
      return [buildFingering(hand, notesSp, [Finger.F5])];
    } else {
      return assignFingering(hand, notesSp);
    }
  }
  // 1对1
  else if (numS === 1 && numSp === 1) {
    const actions = get1to1Fingering(hand, fingeringS, notesSp[0]);
    if (actions.length !== 0) {
      return actions;
    } else {
      return assignFingering(hand, notesSp);
    }
  }
  // 其他情况
  else {
    return assignFingering(hand, notesSp);
  }
}

// 辅助函数

function fingeringsEqual(f1: Fingering, f2: Fingering): boolean {
  if (f1.length !== f2.length) return false;
  
  for (let i = 0; i < f1.length; i++) {
    if (f1[i].pitch !== f2[i].pitch || f1[i].finger !== f2[i].finger) {
      return false;
    }
  }
  
  return true;
}

function sameFingerButDifferentNoteNum(
  preFingering: Fingering,
  nextFingering: Fingering
): number {
  const preFingers = preFingering.map(f => f.finger);
  const nextFingers = nextFingering.map(f => f.finger);
  const sameFingers = preFingers.filter(f => nextFingers.includes(f));

  let num = 0;
  for (const finger of sameFingers) {
    const preEntry = preFingering.find(f => f.finger === finger);
    const nextEntry = nextFingering.find(f => f.finger === finger);
    
    if (preEntry && nextEntry && preEntry.pitch !== nextEntry.pitch) {
      num++;
    }
  }

  return num;
}

function sameNoteButDifferentFingerNum(
  preFingering: Fingering,
  nextFingering: Fingering
): number {
  let num = 0;

  for (const entry of preFingering) {
    const nextEntry = nextFingering.find(f => f.pitch === entry.pitch);
    
    if (nextEntry && nextEntry.finger !== entry.finger) {
      num++;
    }
  }

  return num;
}

function noteFingerReverseOrderNum(
  hand: Hand,
  preFingering: Fingering,
  nextFingering: Fingering
): number {
  const mergeFingering = [...preFingering, ...nextFingering];
  mergeFingering.sort((a, b) => a.pitch - b.pitch);

  let num = 0;
  for (let i = 0; i < mergeFingering.length - 1; i++) {
    const f1 = mergeFingering[i].finger;
    const f2 = mergeFingering[i + 1].finger;

    if ((hand === Hand.RightHand && f1 > f2) || (hand === Hand.LeftHand && f2 > f1)) {
      num++;
    }
  }

  return num;
}

function chordRangeBetween(
  f1: Fingering,
  f2: Fingering
): number {
  const allPitches = [...f1.map(f => f.pitch), ...f2.map(f => f.pitch)];
  const allNotes = allPitches.map(pitch => ({ pitch, velocity: 64, position: 0, duration: 0, channel: 0 } as Note));
  allNotes.sort((a, b) => a.pitch - b.pitch);
  return chordRange(allNotes);
}

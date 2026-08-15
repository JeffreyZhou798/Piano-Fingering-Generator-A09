// 常量和辅助函数 - 翻译自 src/const.jl
import { Note, Hand, Finger, Fingering } from './types';

// 单指力量（按指号排序）
export const SINGLE_FINGER_STRENGTH = [2, 4, 5, 3, 1];

// 白键MIDI音符号
export const WHITE_KEYS = [
  21, 23, 24, 26, 28, 29, 31, 33, 35, 36, 38, 40, 41, 43, 45, 47, 48, 50, 52, 53, 55, 57, 59, 60, 62,
  64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84, 86, 88, 89, 91, 93, 95, 96, 98, 100, 101, 103, 105, 107, 108
];

// 黑键MIDI音符号
export const BLACK_KEYS = [
  22, 25, 27, 30, 32, 34, 37, 39, 42, 44, 46, 49, 51, 54, 56, 58, 61, 63, 66, 68, 70, 73, 75, 78, 80,
  82, 85, 87, 90, 92, 94, 97, 99, 102, 104, 106
];

// 最大手指距离矩阵
export const MAX_FINGER_DISTANCE = [
  [-1, 4, 5, 6, 7],
  [3, -1, 3, 4, 6],
  [2, -1, -1, 3, 4],
  [1.5, -1, -1, -1, 3],
  [-1, -1, -1, -1, -1]
];

/**
 * 获取音符在键盘上的相对位置
 */
export function relativePosition(note: Note): number {
  if (WHITE_KEYS.includes(note.pitch)) {
    return WHITE_KEYS.indexOf(note.pitch);
  } else {
    return WHITE_KEYS.indexOf(note.pitch + 1) - 0.5;
  }
}

/**
 * 计算两个键之间的距离
 */
export function keyDistance(startNote: Note, endNote: Note): number {
  return Math.abs(relativePosition(endNote) - relativePosition(startNote));
}

/**
 * 获取音符相对于A0的位置
 */
export function notePosition(note: Note): number {
  const a0 = { pitch: 21, velocity: 0, position: 0, duration: 0, channel: 0 };
  return keyDistance(a0, note) + 1;
}

/**
 * 计算和弦音域范围
 */
export function chordRange(notes: Note[]): number {
  if (notes.length === 0) return 0;
  
  const maxPitch = Math.max(...notes.map(n => n.pitch));
  const minPitch = Math.min(...notes.map(n => n.pitch));
  
  const maxNote = notes.find(n => n.pitch === maxPitch)!;
  const minNote = notes.find(n => n.pitch === minPitch)!;
  
  return keyDistance(maxNote, minNote) + 1;
}

/**
 * 自然手指距离
 */
export function natureDistance(finger1: Finger, finger2: Finger): number {
  return Math.abs(finger1 - finger2);
}

/**
 * 检查两个手指在键盘上是否过于狭窄
 */
export function narrowFingerCheck(
  p1: { note: Note; finger: Finger },
  p2: { note: Note; finger: Finger }
): boolean {
  return Math.ceil(keyDistance(p1.note, p2.note)) < Math.abs(p1.finger - p2.finger);
}

/**
 * 计算手部移动距离
 */
export function handMoveDistance(
  hand: Hand,
  f1: Fingering,
  f2: Fingering
): number {
  if (f1.length === 0 || f2.length === 0) return 0;

  const handPositionS = (pitch: number, finger: Finger): number => {
    const note: Note = { pitch, velocity: 64, position: 0, duration: 0, channel: 0 };
    return notePosition(note) + hand * (3 - finger);
  };

  const handPosition = (fingering: Fingering): number => {
    const first = fingering[0];
    const last = fingering[fingering.length - 1];
    return (handPositionS(first.pitch, first.finger) + handPositionS(last.pitch, last.finger)) / 2;
  };

  return Math.abs(handPosition(f1) - handPosition(f2));
}

/**
 * 检查下一个音符是否与当前指法相同
 */
export function isSameNotes(fingering: Fingering, notes: Note[]): boolean {
  const sortedNotes = [...notes].sort((a, b) => a.pitch - b.pitch);
  const fingeringPitches = fingering.map(f => f.pitch).sort((a, b) => a - b);
  
  if (sortedNotes.length !== fingeringPitches.length) return false;
  
  return sortedNotes.every((note, i) => note.pitch === fingeringPitches[i]);
}

/**
 * 构建指法映射
 */
export function buildFingering(
  hand: Hand,
  notes: Note[],
  fingers: Finger[]
): Fingering {
  if (notes.length !== fingers.length) {
    throw new Error('Notes and fingers count mismatch');
  }

  const sortedNotes = [...notes].sort((a, b) => a.pitch - b.pitch);
  const sortedFingers = hand === Hand.RightHand 
    ? [...fingers].sort((a, b) => a - b)
    : [...fingers].sort((a, b) => b - a);

  const fingering: Fingering = [];
  sortedNotes.forEach((note, i) => {
    fingering.push({ pitch: note.pitch, finger: sortedFingers[i] });
  });

  return fingering;
}

/**
 * 生成所有可能的指法组合
 */
function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 1) {
    for (const item of arr) {
      yield [item];
    }
    return;
  }

  for (let i = 0; i <= arr.length - k; i++) {
    for (const combo of combinations(arr.slice(i + 1), k - 1)) {
      yield [arr[i], ...combo];
    }
  }
}

/**
 * 为音符分配初始指法
 */
export function assignFingering(hand: Hand, notes: Note[]): Fingering[] {
  const notesNum = notes.length;
  
  if (notesNum === 0) {
    throw new Error('Wrong notes number: 0');
  }
  
  // 如果音符数量超过5，只取最高或最低的5个音符
  if (notesNum > 5) {
    console.warn(`Chord has ${notesNum} notes, truncating to 5`);
    const sortedNotes = [...notes].sort((a, b) => a.pitch - b.pitch);
    const selectedNotes = hand === Hand.RightHand 
      ? sortedNotes.slice(-5) // 右手取最高的5个
      : sortedNotes.slice(0, 5); // 左手取最低的5个
    return assignFingering(hand, selectedNotes);
  }

  const sortedNotes = [...notes].sort((a, b) => a.pitch - b.pitch);
  const result: Fingering[] = [];
  
  const allFingers = [Finger.F1, Finger.F2, Finger.F3, Finger.F4, Finger.F5];
  const fingerCombinations = Array.from(combinations(allFingers, notesNum));

  if (notesNum === 1) {
    return fingerCombinations.map(fingers => buildFingering(hand, sortedNotes, fingers));
  }

  for (const fingering of fingerCombinations) {
    let physicalPossible = true;

    // 检查物理可能性
    const fingerPairs = Array.from(combinations(fingering, 2));
    const notePairs = Array.from(combinations(sortedNotes, 2));

    for (let i = 0; i < fingerPairs.length; i++) {
      const [f1, f2] = fingerPairs[i];
      const [n1, n2] = notePairs[i];
      const keyDis = keyDistance(n1, n2);
      
      const [fi, fo] = hand === Hand.RightHand 
        ? [f1 - 1, f2 - 1]
        : [f2 - 1, f1 - 1];

      if (keyDis > MAX_FINGER_DISTANCE[fi][fo]) {
        physicalPossible = false;
        break;
      }
    }

    if (!physicalPossible) continue;

    // 检查手指是否过于狭窄
    let fingerCheck = true;
    const builtFingering = buildFingering(hand, sortedNotes, fingering);
    
    for (let i = 0; i < builtFingering.length - 1; i++) {
      const entry1 = builtFingering[i];
      const entry2 = builtFingering[i + 1];
      const note1 = sortedNotes.find(n => n.pitch === entry1.pitch)!;
      const note2 = sortedNotes.find(n => n.pitch === entry2.pitch)!;
      
      if (narrowFingerCheck(
        { note: note1, finger: entry1.finger },
        { note: note2, finger: entry2.finger }
      )) {
        fingerCheck = false;
        break;
      }
    }

    if (fingerCheck) {
      result.push(builtFingering);
    }
  }

  // 如果没有找到任何合适的指法，返回一个简单的默认指法
  if (result.length === 0) {
    console.warn(`No valid fingering found for ${notesNum} notes, using simple default`);
    // 简单地按顺序分配手指：1, 2, 3, 4, 5
    const defaultFingers = Array.from({ length: notesNum }, (_, i) => 
      (i + 1) as Finger
    );
    result.push(buildFingering(hand, sortedNotes, defaultFingers));
  }

  return result;
}

/**
 * 检查1对1指法是否需要手部移动
 */
export function is1to1NoMove(
  hand: Hand,
  startFingering: Fingering,
  nextNote: Note
): boolean {
  if (startFingering.length !== 1) {
    throw new Error('Wrong fingering number, fingering must have only 1 note');
  }

  const entry = startFingering[0];
  const startNote: Note = { pitch: entry.pitch, velocity: 64, position: 0, duration: 0, channel: 0 };
  const startFinger = entry.finger;
  const startNotePosition = relativePosition(startNote);
  const nextNotePosition = relativePosition(nextNote);

  let innerDistance = 0;
  let outerDistance = 0;

  if (startFinger === Finger.F1) {
    innerDistance = MAX_FINGER_DISTANCE[1][0];
    outerDistance = MAX_FINGER_DISTANCE[0][4];
  } else if (startFinger === Finger.F5) {
    innerDistance = MAX_FINGER_DISTANCE[0][4];
    outerDistance = 0;
  } else {
    innerDistance = MAX_FINGER_DISTANCE[0][startFinger - 1];
    outerDistance = MAX_FINGER_DISTANCE[startFinger - 1][4];
  }

  const [leftDistance, rightDistance] = hand === Hand.RightHand
    ? [innerDistance, outerDistance]
    : [outerDistance, innerDistance];

  const leftBound = startNotePosition - leftDistance;
  const rightBound = startNotePosition + rightDistance;

  return nextNotePosition >= leftBound && nextNotePosition <= rightBound;
}

/**
 * 计算拉伸率
 */
export function stretchRate(
  hand: Hand,
  nfp1: { note: Note; finger: Finger },
  nfp2: { note: Note; finger: Finger }
): number {
  let [p1, p2] = [nfp1, nfp2];
  
  if ((p1.note.pitch > p2.note.pitch && hand === Hand.RightHand) ||
      (p1.note.pitch < p2.note.pitch && hand === Hand.LeftHand)) {
    [p1, p2] = [p2, p1];
  }

  const natureDis = natureDistance(p1.finger, p2.finger);
  const fingerDis = keyDistance(p1.note, p2.note);
  const maxDis = MAX_FINGER_DISTANCE[p1.finger - 1][p2.finger - 1];

  const rate = fingerDis > natureDis
    ? (fingerDis - natureDis) / (maxDis - natureDis)
    : -(natureDis - fingerDis) / natureDis;

  return Math.round(rate * 100) / 100;
}

/**
 * 计算所有手指的平均拉伸率
 */
export function allStretchRate(hand: Hand, fingering: Fingering): number {
  const entries = fingering;
  const pairs = Array.from(combinations(entries, 2));
  
  if (pairs.length === 0) return 0;

  const sum = pairs.reduce((acc, [e1, e2]) => {
    const note1: Note = { pitch: e1.pitch, velocity: 64, position: 0, duration: 0, channel: 0 };
    const note2: Note = { pitch: e2.pitch, velocity: 64, position: 0, duration: 0, channel: 0 };
    const rate = Math.abs(stretchRate(
      hand,
      { note: note1, finger: e1.finger },
      { note: note2, finger: e2.finger }
    ));
    return acc + Math.pow(rate, 1.5);
  }, 0);

  return Math.round((sum / pairs.length) * 100) / 100;
}

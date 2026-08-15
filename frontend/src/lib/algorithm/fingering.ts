// 指法辅助函数 - 翻译自 src/const.jl 的指法相关函数
import { Note, Hand, Finger, Direct, Fingering } from './types';
import {
  WHITE_KEYS,
  BLACK_KEYS,
  MAX_FINGER_DISTANCE,
  keyDistance,
  relativePosition,
  narrowFingerCheck,
  buildFingering
} from './const';

/**
 * 获取1对1指法的所有可能性
 */
export function get1to1Fingering(
  hand: Hand,
  startFingering: Fingering,
  nextNote: Note
): Fingering[] {
  if (startFingering.length !== 1) {
    throw new Error('Start fingering must have exactly 1 note');
  }

  const entry = startFingering[0];
  const startNote: Note = { pitch: entry.pitch, velocity: 64, position: 0, duration: 0, channel: 0 };
  const startFinger = entry.finger;
  const distance = keyDistance(startNote, nextNote);
  
  let direct = Direct.Level;
  if (nextNote.pitch > startNote.pitch) {
    direct = Direct.Up;
  } else if (nextNote.pitch < startNote.pitch) {
    direct = Direct.Down;
  }

  const result: Fingering[] = [];

  // 同音
  if (direct === Direct.Level) {
    result.push([{ pitch: nextNote.pitch, finger: startFinger }]);
    return result;
  }

  // 计算所有可用指法（非交叉）
  if ((direct === Direct.Up && hand === Hand.RightHand) || 
      (direct === Direct.Down && hand === Hand.LeftHand)) {
    for (let i = 2; i <= 5; i++) {
      const finger = i as Finger;
      if (distance <= MAX_FINGER_DISTANCE[startFinger - 1][i - 1]) {
        if (startFinger !== Finger.F1 && 
            !narrowFingerCheck(
              { note: startNote, finger: startFinger },
              { note: nextNote, finger }
            ) || startFinger === Finger.F1) {
          result.push([{ pitch: nextNote.pitch, finger }]);
        }
      }
    }
  } else if (((direct === Direct.Up && hand === Hand.LeftHand) || 
              (direct === Direct.Down && hand === Hand.RightHand)) && 
             startFinger !== Finger.F1) {
    for (let i = 1; i <= 5; i++) {
      const finger = i as Finger;
      if (distance <= MAX_FINGER_DISTANCE[i - 1][startFinger - 1]) {
        if ((i !== 1 && !narrowFingerCheck(
              { note: startNote, finger: startFinger },
              { note: nextNote, finger }
            )) || i === 1) {
          result.push([{ pitch: nextNote.pitch, finger }]);
        }
      }
    }
  }

  // 计算所有可用的交叉指法
  if ((startFinger === Finger.F2 || startFinger === Finger.F3 || startFinger === Finger.F4) &&
      ((direct === Direct.Up && hand === Hand.RightHand) || 
       (direct === Direct.Down && hand === Hand.LeftHand)) &&
      !(WHITE_KEYS.includes(startNote.pitch) && BLACK_KEYS.includes(nextNote.pitch)) &&
      distance <= MAX_FINGER_DISTANCE[startFinger - 1][0]) {
    result.push([{ pitch: nextNote.pitch, finger: Finger.F1 }]);
  } else if (startFinger === Finger.F1 && 
             ((direct === Direct.Up && hand === Hand.LeftHand) || 
              (direct === Direct.Down && hand === Hand.RightHand))) {
    for (let i = 2; i <= 4; i++) {
      const finger = i as Finger;
      if (distance <= MAX_FINGER_DISTANCE[i - 1][0]) {
        result.push([{ pitch: nextNote.pitch, finger }]);
      }
    }
  }

  return result;
}

/**
 * 检查是否为交叉指法
 */
export function is1to1Cross(
  hand: Hand,
  startNfp: { note: Note; finger: Finger },
  endNfp: { note: Note; finger: Finger }
): boolean {
  const startNote = startNfp.note;
  const startFinger = startNfp.finger;
  const endNote = endNfp.note;
  const endFinger = endNfp.finger;

  const direct = endNote.pitch > startNote.pitch ? Direct.Up : Direct.Down;

  return (
    ((startFinger === Finger.F2 || startFinger === Finger.F3 || startFinger === Finger.F4) &&
     endFinger === Finger.F1 &&
     ((direct === Direct.Up && hand === Hand.RightHand) || 
      (direct === Direct.Down && hand === Hand.LeftHand))) ||
    (startFinger === Finger.F1 &&
     ((direct === Direct.Up && hand === Hand.LeftHand) || 
      (direct === Direct.Down && hand === Hand.RightHand)))
  );
}

/**
 * 获取交叉指法的移动距离
 */
export function crossDistance(
  startNfp: { note: Note; finger: Finger },
  endNfp: { note: Note; finger: Finger }
): number {
  const dis = keyDistance(startNfp.note, endNfp.note);
  const fingerStart = startNfp.finger;
  const fingerEnd = endNfp.finger;

  return fingerStart === Finger.F1 
    ? dis + fingerEnd - 1 
    : dis + fingerStart - 1;
}

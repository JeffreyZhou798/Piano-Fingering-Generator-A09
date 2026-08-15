// Transformer 输入 Token 构建器 - 26 tokens x 5 features
// Token 布局: [0-4] 各手指上一音符 | [5] 当前音符 | [6-25] 未来 20 音符(可带指法提示)

const BLACK_KEY_NOTES = new Set([1, 4, 6, 9, 11]); // A#, C#, D#, F#, G#

export function isBlackKey(midi: number): number {
  if (midi < 0) return -1.0;
  const keyIndex = midi - 21;
  return BLACK_KEY_NOTES.has(((keyIndex % 12) + 12) % 12) ? 1.0 : 0.0;
}

export function midiToPitchClass(midi: number): number {
  if (midi < 0) return -1.0;
  const pitchClass = ((midi - 21) % 12 + 12) % 12;
  return pitchClass / 11.0;
}

export interface LookaheadNote {
  midi: number;
  timeUntil: number; // ms
  finger: number | null; // 0-4, null = 未知
}

/**
 * 构建单音符预测的 26x5 输入 tokens
 * 返回 130 个 Float32 值（行优先）
 */
export function buildTokens(
  currentMidi: number,
  fingerLastMidi: number[],
  fingerLastTime: number[],
  lookaheadNotes: LookaheadNote[]
): Float32Array {
  const tokens = new Float32Array(26 * 5);

  // 默认 finger_hint = -1（未知）
  for (let i = 0; i < 26; i++) {
    tokens[i * 5 + 4] = -1.0;
  }

  const refMidiNorm = (currentMidi - 21) / 87.0;

  // Previous tokens (0-4): 每手指一个
  for (let f = 0; f < 5; f++) {
    const offset = f * 5;
    const midi = fingerLastMidi[f];

    if (midi >= 0) {
      const midiNorm = (midi - 21) / 87.0;
      tokens[offset + 0] = midiNorm - refMidiNorm;
    } else {
      tokens[offset + 0] = -1.0;
    }

    if (fingerLastTime[f] === Infinity) {
      tokens[offset + 1] = 1.0;
    } else {
      tokens[offset + 1] = Math.max(0.0, Math.min(fingerLastTime[f], 10.0)) / 10.0;
    }

    tokens[offset + 2] = midi >= 0 ? isBlackKey(midi) : -1.0;
    tokens[offset + 3] = 0.0; // token_type = previous
  }

  // Current token (index 5)
  const curOffset = 5 * 5;
  tokens[curOffset + 0] = midiToPitchClass(currentMidi);
  tokens[curOffset + 1] = 0.0;
  tokens[curOffset + 2] = isBlackKey(currentMidi);
  tokens[curOffset + 3] = 0.5; // token_type = current

  // Lookahead tokens (indices 6-25)
  for (let j = 0; j < 20; j++) {
    const tOffset = (6 + j) * 5;

    if (j < lookaheadNotes.length) {
      const ln = lookaheadNotes[j];
      const midi = ln.midi;

      if (midi >= 0) {
        const midiNorm = (midi - 21) / 87.0;
        tokens[tOffset + 0] = midiNorm - refMidiNorm;
      } else {
        tokens[tOffset + 0] = -1.0;
      }

      if (ln.timeUntil < 0) {
        tokens[tOffset + 1] = -1.0;
      } else {
        tokens[tOffset + 1] = Math.min(ln.timeUntil / 1000.0, 10.0) / 10.0;
      }

      tokens[tOffset + 2] = midi >= 0 ? isBlackKey(midi) : -1.0;
      tokens[tOffset + 3] = 1.0; // token_type = lookahead

      if (ln.finger !== null && ln.finger >= 0 && ln.finger <= 4) {
        tokens[tOffset + 4] = ln.finger / 4.0;
      } else {
        tokens[tOffset + 4] = -1.0;
      }
    } else {
      tokens[tOffset + 0] = -1.0;
      tokens[tOffset + 1] = -1.0;
      tokens[tOffset + 2] = -1.0;
      tokens[tOffset + 3] = -1.0;
      tokens[tOffset + 4] = -1.0;
    }
  }

  return tokens;
}

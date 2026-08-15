// MusicXML解析器
import { parseStringPromise } from 'xml2js';
import { Note } from '../algorithm/types';

interface MusicXMLNote {
  pitch?: Array<{
    step: string[];
    octave: string[];
    alter?: string[];
  }>;
  duration?: string[];
  voice?: string[];
  type?: string[];
  rest?: any;
  chord?: any;
  staff?: string[]; // Staff number (1 = right hand, 2 = left hand)
  tie?: any; // Tie element with type attribute
}

interface MusicXMLMeasure {
  note?: MusicXMLNote[];
  attributes?: Array<{
    divisions?: string[];
    key?: Array<{
      fifths: string[];
    }>;
    time?: Array<{
      beats: string[];
      'beat-type': string[];
    }>;
  }>;
}

interface MusicXMLPart {
  measure: MusicXMLMeasure[];
}

interface MusicXMLData {
  'score-partwise': {
    part: MusicXMLPart[];
  };
}

/**
 * 解析MusicXML内容
 */
export async function parseMusicXML(xmlContent: string): Promise<{
  rightHand: Note[][];
  leftHand: Note[][];
}> {
  try {
    const result = await parseStringPromise(xmlContent) as MusicXMLData;
    const parts = result['score-partwise'].part;

    if (!parts || parts.length === 0) {
      throw new Error('MusicXML must contain at least 1 part');
    }

    // 如果只有一个part，将其分为右手和左手
    if (parts.length === 1) {
      const allNotes = extractNotes(parts[0]);
      // 简单分割：高音部分给右手，低音部分给左手
      const { rightHand, leftHand } = splitByPitch(allNotes);
      return { rightHand, leftHand };
    }

    // 如果有多个parts，第一个是右手，第二个是左手
    const rightHand = extractNotes(parts[0]);
    const leftHand = extractNotes(parts[1]);

    return { rightHand, leftHand };
  } catch (error) {
    console.error('Failed to parse MusicXML:', error);
    throw new Error(`Invalid MusicXML format: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 从part中提取音符
 */
function extractNotes(part: MusicXMLPart): Note[][] {
  const noteGroups: Note[][] = [];
  let currentPosition = 0;
  let divisions = 1; // 默认divisions
  let staffCounts = { staff1: 0, staff2: 0, noStaff: 0 };

  for (const measure of part.measure) {
    // 更新divisions
    if (measure.attributes && measure.attributes[0].divisions) {
      divisions = parseInt(measure.attributes[0].divisions[0]);
    }

    if (!measure.note) continue;

    let currentGroup: Note[] = [];
    let isChord = false;

    for (const xmlNote of measure.note) {
      // 跳过休止符
      if (xmlNote.rest) {
        if (currentGroup.length > 0) {
          noteGroups.push([...currentGroup]);
          currentGroup = [];
        }
        
        // 更新位置
        if (xmlNote.duration) {
          currentPosition += parseInt(xmlNote.duration[0]);
        }
        continue;
      }

      // 检查是否为和弦的一部分
      isChord = xmlNote.chord !== undefined;

      if (!isChord && currentGroup.length > 0) {
        // 新的音符组开始
        noteGroups.push([...currentGroup]);
        currentGroup = [];
      }

      // 检查连音线 - 跳过tie stop和continue（只保留tie start和无tie的音符）
      const tieElement = xmlNote.tie;
      if (tieElement) {
        // xml2js: <tie type="stop"/> -> { '$': { type: 'stop' } }；多个tie元素则为数组
        const tieArr = Array.isArray(tieElement) ? tieElement : [tieElement];
        const hasStopOrContinue = tieArr.some(
          (t: any) => t?.$?.type === 'stop' || t?.$?.type === 'continue'
        );
        // 跳过tie stop和continue，只处理start和没有tie的音符
        if (hasStopOrContinue) {
          // 更新位置（仅对非和弦音符）
          if (!isChord && xmlNote.duration) {
            currentPosition += parseInt(xmlNote.duration[0]);
          }
          continue;
        }
      }

      // 提取音符信息
      if (xmlNote.pitch && xmlNote.pitch[0]) {
        const pitch = xmlNote.pitch[0];
        const midiPitch = pitchToMidi(
          pitch.step[0],
          parseInt(pitch.octave[0]),
          pitch.alter ? parseInt(pitch.alter[0]) : 0
        );

        const duration = xmlNote.duration ? parseInt(xmlNote.duration[0]) : divisions;

        // 提取staff信息（重要！用于区分左右手）
        const staff = xmlNote.staff ? parseInt(xmlNote.staff[0]) : 1;

        // 统计staff分布
        if (staff === 1) staffCounts.staff1++;
        else if (staff === 2) staffCounts.staff2++;
        else staffCounts.noStaff++;

        // 毫秒时间换算（假定 120 BPM，即每四分音符 500ms，供神经先验的时间特征使用）
        const safeDivisions = Math.max(1, divisions);
        const timeMs = (currentPosition / safeDivisions) * 500;
        const durationMs = (duration / safeDivisions) * 500;

        const note: Note = {
          pitch: midiPitch,
          velocity: 64, // 默认力度
          position: currentPosition,
          duration: duration,
          channel: staff - 1, // staff 1 = channel 0 (右手), staff 2 = channel 1 (左手)
          timeMs,
          durationMs
        };

        currentGroup.push(note);
      }

      // 更新位置（仅对非和弦音符）
      if (!isChord && xmlNote.duration) {
        currentPosition += parseInt(xmlNote.duration[0]);
      }
    }

    // 添加最后一组
    if (currentGroup.length > 0) {
      noteGroups.push(currentGroup);
    }
  }

  console.log(`[Parser] Extracted ${noteGroups.length} note groups. Staff distribution: staff1=${staffCounts.staff1}, staff2=${staffCounts.staff2}, noStaff=${staffCounts.noStaff}`);

  return noteGroups;
}

/**
 * 将音高转换为MIDI音符号
 */
function pitchToMidi(step: string, octave: number, alter: number): number {
  const stepValues: { [key: string]: number } = {
    'C': 0,
    'D': 2,
    'E': 4,
    'F': 5,
    'G': 7,
    'A': 9,
    'B': 11
  };

  const baseNote = stepValues[step];
  if (baseNote === undefined) {
    throw new Error(`Invalid note step: ${step}`);
  }

  // MIDI音符号 = (octave + 1) * 12 + baseNote + alter
  return (octave + 1) * 12 + baseNote + alter;
}

/**
 * 验证音符数据
 */
export function validateNotes(notes: Note[][]): boolean {
  if (notes.length === 0) {
    return false;
  }

  for (const group of notes) {
    if (group.length === 0) {
      return false;
    }

    for (const note of group) {
      if (note.pitch < 21 || note.pitch > 108) {
        console.warn(`Invalid MIDI pitch: ${note.pitch}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * 按staff/channel分割音符为右手和左手
 * channel 0 = 右手 (staff 1), channel 1 = 左手 (staff 2)
 */
function splitByPitch(notes: Note[][]): {
  rightHand: Note[][];
  leftHand: Note[][];
} {
  const rightHand: Note[][] = [];
  const leftHand: Note[][] = [];

  console.log(`[Parser] Splitting ${notes.length} note groups by staff/channel`);

  for (const group of notes) {
    const rightNotes: Note[] = [];
    const leftNotes: Note[] = [];

    for (const note of group) {
      // 按channel分割：0 = 右手, 1 = 左手
      if (note.channel === 0) {
        rightNotes.push(note);
      } else if (note.channel === 1) {
        leftNotes.push(note);
      } else {
        // 如果没有channel信息，按音高分割（fallback）
        if (note.pitch >= 60) {
          rightNotes.push({ ...note, channel: 0 });
        } else {
          leftNotes.push({ ...note, channel: 1 });
        }
      }
    }

    // 只添加非空的组
    if (rightNotes.length > 0) {
      rightHand.push(rightNotes);
    }
    if (leftNotes.length > 0) {
      leftHand.push(leftNotes);
    }
  }

  console.log(`[Parser] Split result: ${rightHand.length} right hand groups, ${leftHand.length} left hand groups`);

  // 如果一只手完全没有音符，返回空数组（不创建dummy notes）
  if (rightHand.length === 0) {
    console.warn('[Parser] Warning: No right hand notes found');
  }
  if (leftHand.length === 0) {
    console.warn('[Parser] Warning: No left hand notes found');
  }

  return { rightHand, leftHand };
}

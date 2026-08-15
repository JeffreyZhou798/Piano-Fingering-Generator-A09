// MusicXML写入器 - 将指法结果写回MusicXML
// 仅使用 getElementsByTagName 等标准 DOM API（浏览器与 xmldom 测试环境均兼容）
import { FingeringResult } from '../algorithm/types';

function childrenByTag(el: Element | Document, tag: string): Element[] {
  return Array.from(el.getElementsByTagName(tag));
}

function firstChildByTag(el: Element | Document, tag: string): Element | null {
  const list = el.getElementsByTagName(tag);
  return list.length > 0 ? list[0] : null;
}

/**
 * 将指法结果添加到MusicXML内容中
 */
export async function addFingeringToMusicXML(
  originalXmlContent: string,
  fingeringResult: FingeringResult
): Promise<string> {
  console.log('addFingeringToMusicXML called with:', {
    rightHandCount: fingeringResult.rightHand?.length || 0,
    leftHandCount: fingeringResult.leftHand?.length || 0
  });

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(originalXmlContent, 'text/xml');

  // 检查解析错误（浏览器解析失败会生成 parsererror 元素）
  if (firstChildByTag(xmlDoc, 'parsererror')) {
    throw new Error('Invalid MusicXML file');
  }

  // 获取所有part
  const parts = childrenByTag(xmlDoc, 'part');

  console.log('MusicXML parts found:', parts.length);

  if (parts.length === 0) {
    throw new Error('No parts found in MusicXML');
  }

  // 处理右手（第一个part）
  if (fingeringResult.rightHand && fingeringResult.rightHand.length > 0) {
    const rhPart = parts[0];
    addFingeringToPart(rhPart, fingeringResult.rightHand, 'right');
  }

  // 处理左手（第二个part，单part时按staff区分）
  if (fingeringResult.leftHand && fingeringResult.leftHand.length > 0) {
    const lhPartIndex = parts.length > 1 ? 1 : 0;
    const lhPart = parts[lhPartIndex];
    addFingeringToPart(lhPart, fingeringResult.leftHand, 'left');
  }

  // 序列化回XML字符串
  const serializer = new XMLSerializer();
  let xmlString = serializer.serializeToString(xmlDoc);

  // 添加XML声明（如果没有）
  if (!xmlString.startsWith('<?xml')) {
    xmlString = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlString;
  }

  console.log('MusicXML with fingering generated successfully');

  return xmlString;
}

/**
 * 为part添加指法标注
 */
function addFingeringToPart(
  part: Element,
  fingerings: Array<{ pitch: number; finger: number; position: number }>,
  hand: string
): void {
  // 目标staff编号：右手=1，左手=2
  const targetStaff = hand === 'right' ? '1' : '2';

  const measures = childrenByTag(part, 'measure');

  let fingeringIndex = 0;
  let notesProcessed = 0;
  let fingeringsAdded = 0;
  let notesSkipped = 0;
  let tieSkipped = 0;

  for (const measure of measures) {
    const notes = childrenByTag(measure, 'note');

    for (const note of notes) {
      // 跳过休止符
      if (firstChildByTag(note, 'rest')) {
        continue;
      }

      // 检查staff编号 - 只处理对应手的音符
      const staffElement = firstChildByTag(note, 'staff');
      const noteStaff = staffElement?.textContent || '1';

      if (noteStaff !== targetStaff) {
        notesSkipped++;
        continue;
      }

      // 跳过连音线的后续音符（tie stop和continue）
      const ties = childrenByTag(note, 'tie');
      let shouldSkip = false;
      for (const tie of ties) {
        const tieType = tie.getAttribute('type');
        if (tieType === 'stop' || tieType === 'continue') {
          shouldSkip = true;
          tieSkipped++;
          break;
        }
      }
      if (shouldSkip) {
        continue;
      }

      // 获取音高
      const pitchElement = firstChildByTag(note, 'pitch');
      if (!pitchElement) {
        continue;
      }

      const step = firstChildByTag(pitchElement, 'step')?.textContent || '';
      const octave = parseInt(firstChildByTag(pitchElement, 'octave')?.textContent || '0');
      const alter = parseInt(firstChildByTag(pitchElement, 'alter')?.textContent || '0');

      const midiPitch = calculateMidiPitch(step, octave, alter);
      notesProcessed++;

      // 查找对应的指法
      if (fingeringIndex < fingerings.length) {
        const fingering = fingerings[fingeringIndex];

        if (Math.abs(fingering.pitch - midiPitch) <= 1) {
          addFingeringToNote(note, fingering.finger);
          fingeringIndex++;
          fingeringsAdded++;
        } else {
          // 尝试在接下来的几个指法中查找匹配（处理和弦顺序问题）
          let found = false;
          const lookAhead = Math.min(10, fingerings.length - fingeringIndex);

          for (let offset = 1; offset < lookAhead; offset++) {
            const nextFingering = fingerings[fingeringIndex + offset];
            if (Math.abs(nextFingering.pitch - midiPitch) <= 1) {
              addFingeringToNote(note, nextFingering.finger);
              fingeringsAdded++;
              found = true;
              fingerings.splice(fingeringIndex + offset, 1);
              break;
            }
          }

          if (!found) {
            console.warn(`${hand} hand: No fingering match for pitch ${midiPitch} at note ${notesProcessed} (expected ${fingering.pitch})`);
            addFingeringToNote(note, fingering.finger);
            fingeringIndex++;
            fingeringsAdded++;
          }
        }
      } else {
        console.warn(`${hand} hand: Ran out of fingerings at note ${notesProcessed} (pitch ${midiPitch})`);
        addFingeringToNote(note, 3);
        fingeringsAdded++;
      }
    }
  }

  console.log(`${hand} hand: processed ${notesProcessed} notes (skipped ${notesSkipped} other staff, ${tieSkipped} tied), added ${fingeringsAdded} fingerings`);
}

/**
 * 为note添加指法标注
 */
function addFingeringToNote(note: Element, finger: number): void {
  const doc = note.ownerDocument;
  if (!doc) return;

  // 查找或创建notations元素
  let notations = firstChildByTag(note, 'notations');
  if (!notations) {
    notations = doc.createElement('notations');
    note.appendChild(notations);
  }

  // 查找或创建technical元素
  let technical = firstChildByTag(notations, 'technical');
  if (!technical) {
    technical = doc.createElement('technical');
    notations.appendChild(technical);
  }

  // 创建fingering元素
  const fingeringElement = doc.createElement('fingering');
  fingeringElement.textContent = finger.toString();
  technical.appendChild(fingeringElement);
}

/**
 * 计算MIDI音高
 */
function calculateMidiPitch(step: string, octave: number, alter: number = 0): number {
  const stepValues: { [key: string]: number } = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
  };

  const baseNote = stepValues[step] || 0;
  return (octave + 1) * 12 + baseNote + alter;
}

/**
 * 将MusicXML字符串转换为Blob（用于下载）
 */
export function createMusicXMLBlob(xmlContent: string): Blob {
  return new Blob([xmlContent], { type: 'application/vnd.recordare.musicxml+xml' });
}

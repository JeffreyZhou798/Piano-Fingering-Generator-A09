// 全流程自动化测试：解析 → 神经预推理 → 混合Dyna-Q → 回写 → 校验
// 运行: npx tsx scripts/test-pipeline.ts
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

// writer.ts 依赖浏览器 DOM API，测试环境用 xmldom 替代
(globalThis as any).DOMParser = DOMParser;
(globalThis as any).XMLSerializer = XMLSerializer;

import * as ortNode from 'onnxruntime-node';
import { parseMusicXML } from '../src/lib/music/parser';
import { generateFingering } from '../src/lib/algorithm/process';
import { computeHandPriors, selfCheckSession } from '../src/lib/nn/inference';
import { addFingeringToMusicXML } from '../src/lib/music/writer';
import { OrtLike, ModelSessions } from '../src/lib/nn/ort';

const EXAMPLES_DIR = path.resolve(__dirname, '../../CompositionExamples');
const MODELS_DIR = path.resolve(__dirname, '../public/models');
const OUTPUT_DIR = path.resolve(__dirname, 'output');

const TEST_FILES = [
  'simple_test.musicxml',
  'simple_test2.mxl',
  'S1_Bach_G_Major.musicxml',
  'S1_Bach_G_Major2.mxl',
  'S6_no_5.musicxml',
  'S6_no_5-2.mxl',
  'Waltz.musicxml',
  'Waltz2.mxl',
  'S8_wedding.musicxml',
  'S8_wedding2.mxl',
  'S9_turkish_march.musicxml',
  'S9_turkish_march2.mxl'
];

async function readScore(filePath: string): Promise<string> {
  const buf = fs.readFileSync(filePath);
  if (filePath.endsWith('.mxl')) {
    const zip = await JSZip.loadAsync(buf);
    const container = zip.file('META-INF/container.xml');
    if (container) {
      const containerXml = await container.async('string');
      const m = containerXml.match(/full-path="([^"]+)"/);
      if (m && zip.file(m[1])) return await zip.file(m[1])!.async('string');
    }
    const xmlFiles = Object.keys(zip.files).filter(n => n.endsWith('.xml') && !n.startsWith('META-INF/'));
    if (xmlFiles.length > 0) return await zip.file(xmlFiles[0])!.async('string');
    throw new Error('No MusicXML inside MXL');
  }
  return buf.toString('utf-8');
}

async function main() {
  console.log('========================================');
  console.log(' Hybrid Pipeline Test (Data + Rules)');
  console.log('========================================\n');

  const ort = ortNode as unknown as OrtLike;

  // 加载模型 + 自检（G4）
  console.log('[Setup] Loading ONNX models...');
  const leftBytes = fs.readFileSync(path.join(MODELS_DIR, 'fingering_transformer_left.onnx'));
  const rightBytes = fs.readFileSync(path.join(MODELS_DIR, 'fingering_transformer_right.onnx'));
  const sessions: ModelSessions = {
    left: await ort.InferenceSession.create(leftBytes, { executionProviders: ['cpu'] }),
    right: await ort.InferenceSession.create(rightBytes, { executionProviders: ['cpu'] })
  };
  await selfCheckSession(ort, sessions.left, 'left');
  await selfCheckSession(ort, sessions.right, 'right');
  console.log('[Setup] Self-check passed for both hands.\n');

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const fileName of TEST_FILES) {
    const filePath = path.join(EXAMPLES_DIR, fileName);
    console.log(`\n----- ${fileName} -----`);
    const t0 = Date.now();

    try {
      const xml = await readScore(filePath);
      const { rightHand, leftHand } = await parseMusicXML(xml);
      const rhNotes = rightHand.reduce((s, g) => s + g.length, 0);
      const lhNotes = leftHand.reduce((s, g) => s + g.length, 0);
      console.log(`  Parsed: RH ${rightHand.length} groups/${rhNotes} notes, LH ${leftHand.length} groups/${lhNotes} notes`);

      const tInfer = Date.now();
      const priorsRh = rightHand.length > 0 ? await computeHandPriors(ort, sessions.right, rightHand) : [];
      const priorsLh = leftHand.length > 0 ? await computeHandPriors(ort, sessions.left, leftHand) : [];
      console.log(`  NN inference: ${Date.now() - tInfer}ms`);

      const tRl = Date.now();
      const result = await generateFingering(rightHand, leftHand, priorsRh, priorsLh);
      console.log(`  Hybrid Dyna-Q: ${Date.now() - tRl}ms`);

      const rhOut = result.rightHand?.length ?? 0;
      const lhOut = result.leftHand?.length ?? 0;
      console.log(`  Fingering entries: RH ${rhOut}/${rhNotes}, LH ${lhOut}/${lhNotes}`);

      if (rhNotes > 0 && rhOut === 0) throw new Error('RH produced 0 fingerings');
      if (lhNotes > 0 && lhOut === 0) throw new Error('LH produced 0 fingerings');

      // 指法取值合法性
      for (const e of [...(result.rightHand ?? []), ...(result.leftHand ?? [])]) {
        if (e.finger < 1 || e.finger > 5) throw new Error(`Invalid finger ${e.finger}`);
      }

      // 质量指标：与 NN 主选择（argmax）的一致率
      const agreement = (entries: { pitch: number; finger: number }[], priors: import('../src/lib/algorithm/fusion').GroupPriors[]) => {
        const priorMap = new Map<number, number>();
        for (const g of priors) {
          for (const np of g) {
            let best = 0;
            for (let i = 1; i < np.probs.length; i++) if (np.probs[i] > np.probs[best]) best = i;
            priorMap.set(np.pitch, best + 1);
          }
        }
        let agree = 0, total = 0;
        for (const e of entries) {
          const nn = priorMap.get(e.pitch);
          if (nn !== undefined) { total++; if (nn === e.finger) agree++; }
        }
        return total > 0 ? (agree / total * 100).toFixed(1) : 'N/A';
      };
      console.log(`  NN-argmax agreement: RH ${agreement(result.rightHand ?? [], priorsRh)}%, LH ${agreement(result.leftHand ?? [], priorsLh)}%`);

      // 硬约束：同一音符组内手指不重复
      // entries 按组顺序展开（每组内按 pitch 升序），用顺序切片对齐
      const checkChordConflict = (groups: import('../src/lib/algorithm/types').Note[][], entries: { pitch: number; finger: number }[], label: string) => {
        let ptr = 0;
        for (let gi = 0; gi < groups.length; gi++) {
          const m = Math.min(groups[gi].length, 5); // >5 音和弦在动作生成时截断为 5
          const slice = entries.slice(ptr, ptr + m);
          if (slice.length < m) break; // 尾部对齐失败则由数量校验兜底
          const used = new Set<number>();
          for (const e of slice) {
            if (used.has(e.finger)) {
              throw new Error(`Chord finger conflict (${label}): finger ${e.finger} reused in group ${gi} [${slice.map(x => `${x.pitch}:${x.finger}`).join(',')}]`);
            }
            used.add(e.finger);
          }
          ptr += m;
        }
      };
      checkChordConflict(rightHand, result.rightHand ?? [], 'RH');
      checkChordConflict(leftHand, result.leftHand ?? [], 'LH');

      // 回写校验
      const outXml = await addFingeringToMusicXML(xml, result);
      const fingeringTagCount = (outXml.match(/<fingering>/g) || []).length;
      console.log(`  Output XML: ${fingeringTagCount} fingering tags`);

      const expectedMin = rhOut + lhOut;
      if (fingeringTagCount < expectedMin * 0.95) {
        throw new Error(`Fingering tags ${fingeringTagCount} << expected ${expectedMin}`);
      }

      const outPath = path.join(OUTPUT_DIR, fileName.replace(/\.(musicxml|mxl)$/i, '') + '_fingering.musicxml');
      fs.writeFileSync(outPath, outXml, 'utf-8');

      console.log(`  ✅ PASS in ${Date.now() - t0}ms`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${err instanceof Error ? err.message : err}`);
      failed++;
      failures.push(`${fileName}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n========================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(' Failures:');
    failures.forEach(f => console.log(`   - ${f}`));
  }
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

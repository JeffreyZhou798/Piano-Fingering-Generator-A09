// 浏览器端神经引擎加载 - 保证栈 G0-G6
// G0: 权重 vendor 在 public/models/ 随 CDN 分发
// G1/G2: IndexedDB 字节缓存（二次秒开、可离线）
// G3: 会话创建失败重试
// G4: 启动自检（在 inference.ts 的 selfCheckSession）
// G6: 彻底失败 → 显式报错（绝不静默回退纯规则）
import { OrtLike, OrtSessionLike, ModelSessions } from './ort';
import { selfCheckSession } from './inference';

const MODEL_CACHE_STORE = 'models';
const MODEL_CACHE_VERSION = 'v1';

async function openModelDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('PianoFingeringModelDB', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MODEL_CACHE_STORE)) {
        request.result.createObjectStore(MODEL_CACHE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getCachedModel(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openModelDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readonly');
      const req = tx.objectStore(MODEL_CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result?.bytes ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCachedModel(key: string, bytes: ArrayBuffer): Promise<void> {
  try {
    const db = await openModelDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(MODEL_CACHE_STORE, 'readwrite');
      tx.objectStore(MODEL_CACHE_STORE).put({ bytes, timestamp: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 缓存失败不影响主流程
  }
}

/**
 * 加载模型字节：优先 IndexedDB（G2），否则 fetch + 重试并写入缓存（G1）
 */
export async function loadModelBytes(url: string, maxRetries = 2): Promise<ArrayBuffer> {
  const cacheKey = `${MODEL_CACHE_VERSION}:${url}`;

  const cached = await getCachedModel(cacheKey);
  if (cached && cached.byteLength > 1000) {
    console.log(`[Engine] Model loaded from IndexedDB cache: ${url}`);
    return cached;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength < 1000) throw new Error('Model file too small, likely corrupted');
      await setCachedModel(cacheKey, bytes);
      console.log(`[Engine] Model fetched and cached: ${url} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
      return bytes;
    } catch (err) {
      lastError = err;
      console.warn(`[Engine] Model fetch attempt ${attempt + 1} failed:`, err);
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  throw new Error(`NEURAL_ENGINE_MODEL_LOAD_FAILED: ${url} (${lastError})`);
}

/**
 * 创建推理会话（G3：失败重试一次）
 */
async function createSessionWithRetry(ort: OrtLike, bytes: ArrayBuffer): Promise<OrtSessionLike> {
  const options = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  };
  try {
    return await ort.InferenceSession.create(bytes, options);
  } catch (err) {
    console.warn('[Engine] Session creation failed, retrying once:', err);
    return await ort.InferenceSession.create(bytes, options);
  }
}

/**
 * 初始化神经引擎（完整保证栈入口）
 * 任何一步失败都抛出 NEURAL_ENGINE_* 错误，由 UI 显示显式错误页（G6）
 */
export async function initNeuralEngine(
  ort: OrtLike,
  modelBaseUrl: string,
  onStatus?: (status: string) => void
): Promise<ModelSessions> {
  onStatus?.('loading-models');
  const [leftBytes, rightBytes] = await Promise.all([
    loadModelBytes(`${modelBaseUrl}fingering_transformer_left.onnx`),
    loadModelBytes(`${modelBaseUrl}fingering_transformer_right.onnx`)
  ]);

  onStatus?.('creating-sessions');
  const [left, right] = await Promise.all([
    createSessionWithRetry(ort, leftBytes),
    createSessionWithRetry(ort, rightBytes)
  ]);

  onStatus?.('self-check');
  await selfCheckSession(ort, left, 'left');
  await selfCheckSession(ort, right, 'right');
  console.log('[Engine] Self-check passed for both hands. Neural engine ready.');

  return { left, right };
}

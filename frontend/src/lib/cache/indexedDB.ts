// IndexedDB缓存层
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { FingeringResult } from '../algorithm/types';

interface FingeringDB extends DBSchema {
  fingerings: {
    key: string;
    value: {
      fileHash: string;
      fileName: string;
      result: FingeringResult;
      timestamp: number;
    };
  };
}

const DB_NAME = 'PianoFingeringDB';
const DB_VERSION = 1;
const STORE_NAME = 'fingerings';

let dbInstance: IDBPDatabase<FingeringDB> | null = null;

/**
 * 初始化数据库
 */
async function getDB(): Promise<IDBPDatabase<FingeringDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<FingeringDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileHash' });
      }
    },
  });

  return dbInstance;
}

/**
 * 计算文件哈希
 */
export async function calculateFileHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * 保存指法结果到缓存
 */
export async function saveFingeringToCache(
  fileHash: string,
  fileName: string,
  result: FingeringResult
): Promise<void> {
  try {
    const db = await getDB();
    await db.put(STORE_NAME, {
      fileHash,
      fileName,
      result,
      timestamp: Date.now()
    });
    console.log('Fingering saved to cache:', fileHash);
  } catch (error) {
    console.error('Failed to save to cache:', error);
    // 不抛出错误，缓存失败不应影响主流程
  }
}

/**
 * 从缓存中获取指法结果
 */
export async function getFingeringFromCache(
  fileHash: string
): Promise<FingeringResult | null> {
  try {
    const db = await getDB();
    const cached = await db.get(STORE_NAME, fileHash);
    
    if (cached) {
      console.log('Fingering loaded from cache:', fileHash);
      return cached.result;
    }
    
    return null;
  } catch (error) {
    console.error('Failed to load from cache:', error);
    return null;
  }
}

/**
 * 清除过期缓存（超过30天）
 */
export async function clearExpiredCache(): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const allRecords = await store.getAll();
    
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    for (const record of allRecords) {
      if (record.timestamp < thirtyDaysAgo) {
        await store.delete(record.fileHash);
        console.log('Deleted expired cache:', record.fileHash);
      }
    }
    
    await tx.done;
  } catch (error) {
    console.error('Failed to clear expired cache:', error);
  }
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{
  count: number;
  totalSize: number;
}> {
  try {
    const db = await getDB();
    const allRecords = await db.getAll(STORE_NAME);
    
    const totalSize = allRecords.reduce((sum, record) => {
      const size = JSON.stringify(record).length;
      return sum + size;
    }, 0);
    
    return {
      count: allRecords.length,
      totalSize
    };
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    return { count: 0, totalSize: 0 };
  }
}

/**
 * 清除所有缓存
 */
export async function clearAllCache(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
    console.log('All cache cleared');
  } catch (error) {
    console.error('Failed to clear cache:', error);
  }
}

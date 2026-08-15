'use client';

import { useState, useEffect, useRef } from 'react';
import { FileUploader } from '@/components/FileUploader';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { getTranslations, type Language } from '@/lib/i18n';
import { readFileContent, createMXLBlob } from '@/lib/music/mxl';
import { addFingeringToMusicXML, createMusicXMLBlob } from '@/lib/music/writer';
import { calculateFileHash, getFingeringFromCache, saveFingeringToCache, clearExpiredCache } from '@/lib/cache/indexedDB';
import type { WorkerRequest, WorkerResponse } from '@/workers/fingering.worker';
import type { FingeringResult } from '@/lib/algorithm/types';

export default function Home() {
  const [language, setLanguage] = useState<Language>('en');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'engine' | 'parse' | 'neural' | 'rl' | undefined>(undefined);
  const [result, setResult] = useState<FingeringResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [originalXmlContent, setOriginalXmlContent] = useState<string>('');
  const workerRef = useRef<Worker | null>(null);

  const t = getTranslations(language);

  useEffect(() => {
    const savedLang = localStorage.getItem('piano-fingering-lang') as Language;
    if (savedLang && ['zh', 'en', 'ja'].includes(savedLang)) {
      setLanguage(savedLang);
    } else {
      setLanguage('en');
    }
    clearExpiredCache().catch(console.error);
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('piano-fingering-lang', lang);
  };

  const handleFileUpload = async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setProgress(0);
    setFileName(file.name);

    try {
      console.log('🎹 ===== 开始处理文件 =====');
      console.log('📄 文件名:', file.name);
      console.log('📦 文件大小:', (file.size / 1024).toFixed(2), 'KB');
      
      setProgress(5);
      const xmlContent = await readFileContent(file);
      setOriginalXmlContent(xmlContent);

      const fileHash = await calculateFileHash(xmlContent);
      console.log('🔑 文件哈希:', fileHash.substring(0, 16) + '...');
      
      const cached = await getFingeringFromCache(fileHash);
      
      if (cached) {
        console.log('💾 使用缓存结果（如需重新计算，请清除缓存）');
        console.log('⚠️ 要清除缓存，请在控制台运行:');
        console.log('   indexedDB.deleteDatabase("PianoFingeringDB").then(() => location.reload())');
        console.log('⚠️ 或者点击页面上的"清除缓存（调试用）"按钮');
        setResult(cached);
        setProgress(100);
        setIsProcessing(false);
        return;
      }
      
      console.log('🚀 开始新的指法生成（数据+规则混合模式：Transformer + Dyna-Q）...');

      workerRef.current = new Worker(
        new URL('../workers/fingering.worker.ts', import.meta.url)
      );

      workerRef.current.onmessage = async (event: MessageEvent<WorkerResponse>) => {
        const { type, progress: workerProgress, stage: workerStage, result: workerResult, error: workerError } = event.data;

        if (type === 'progress' && workerProgress !== undefined) {
          setProgress(workerProgress);
          if (workerStage) setStage(workerStage);
          if (workerProgress % 10 === 0) {
            console.log(`📊 进度: ${workerProgress.toFixed(1)}%`);
          }
        } else if (type === 'complete' && workerResult) {
          console.log('✅ 指法生成完成！');
          console.log('📈 结果统计:');
          console.log('   右手音符:', workerResult.rightHand?.length || 0);
          console.log('   左手音符:', workerResult.leftHand?.length || 0);
          
          setResult(workerResult);
          setProgress(100);
          setIsProcessing(false);
          await saveFingeringToCache(fileHash, file.name, workerResult);
          console.log('💾 结果已保存到缓存');

          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
        } else if (type === 'error') {
          console.error('❌ 处理失败:', workerError);
          setError(workerError || t.error);
          setIsProcessing(false);

          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
        }
      };

      workerRef.current.onerror = (error) => {
        console.error('Worker error:', error);
        setError(t.error);
        setIsProcessing(false);

        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
      };

      const request: WorkerRequest = {
        type: 'generate',
        xmlContent,
        fileName: file.name,
        publicBaseUrl: new URL('.', window.location.href).href
      };
      workerRef.current.postMessage(request);

    } catch (error) {
      console.error('Processing failed:', error);
      setError(error instanceof Error ? error.message : t.error);
      setIsProcessing(false);

      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    }
  };

  const handleDownload = async () => {
    if (!result || !originalXmlContent) return;

    try {
      const xmlWithFingering = await addFingeringToMusicXML(originalXmlContent, result);
      const baseName = fileName.replace(/\.(musicxml|mxl|xml)$/i, '');
      const isMxlInput = /\.mxl$/i.test(fileName);

      // 与输入格式保持一致：.mxl 输入 → .mxl 下载，否则 .musicxml
      const blob = isMxlInput
        ? await createMXLBlob(xmlWithFingering, `${baseName}.musicxml`)
        : createMusicXMLBlob(xmlWithFingering);
      const downloadName = isMxlInput
        ? `${baseName}_fingering.mxl`
        : `${baseName}_fingering.musicxml`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      setError(language === 'zh' ? '下载失败' : language === 'ja' ? 'ダウンロード失敗' : 'Download failed');
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="container mx-auto py-12 px-4">
        <div className="flex justify-end mb-8">
          <LanguageSwitcher 
            currentLang={language} 
            onLanguageChange={handleLanguageChange} 
          />
        </div>

        <header className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            {t.title}
          </h1>
          <p className="text-xl text-gray-600">
            {t.subtitle}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {language === 'zh' && '数据+规则混合驱动 · Transformer 神经网络 + Dyna-Q 强化学习 · 完全在浏览器运行 · 完全免费'}
            {language === 'en' && 'Data + Rules Hybrid · Transformer Neural Network + Dyna-Q RL · Runs entirely in browser · Completely Free'}
            {language === 'ja' && 'データ+ルールのハイブリッド駆動 · Transformer ニューラルネットワーク + Dyna-Q 強化学習 · ブラウザで完全に実行 · 完全無料'}
          </p>
          <p className="text-xs text-indigo-500 mt-1 font-medium">
            ⚡ {t.engineHybrid}
          </p>
          
          {/* 调试按钮 */}
          <div className="mt-4">
            <button
              onClick={async () => {
                try {
                  await indexedDB.deleteDatabase('PianoFingeringDB');
                  console.log('✅ 缓存已清除！页面将重新加载...');
                  alert(language === 'zh' ? '缓存已清除！页面将重新加载...' : language === 'ja' ? 'キャッシュをクリアしました！ページをリロードします...' : 'Cache cleared! Page will reload...');
                  window.location.reload();
                } catch (error) {
                  console.error('清除缓存失败:', error);
                  alert(language === 'zh' ? '清除缓存失败' : language === 'ja' ? 'キャッシュのクリアに失敗しました' : 'Failed to clear cache');
                }
              }}
              className="px-4 py-2 text-sm bg-yellow-100 text-yellow-800 rounded-lg hover:bg-yellow-200 transition-colors border border-yellow-300"
            >
              {language === 'zh' && '🗑️ 清除缓存（调试用）'}
              {language === 'en' && '🗑️ Clear Cache (Debug)'}
              {language === 'ja' && '🗑️ キャッシュをクリア（デバッグ用）'}
            </button>
          </div>
        </header>

        {!isProcessing && !result && (
          <FileUploader onFileUpload={handleFileUpload} translations={t} />
        )}

        {isProcessing && (
          <ProcessingStatus isProcessing={isProcessing} progress={progress} stage={stage} translations={t} />
        )}

        {error && (
          <div className="max-w-3xl mx-auto p-6">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium">
                {error.startsWith('NEURAL_ENGINE') ? t.errorEngine : error}
              </p>
              {error.startsWith('NEURAL_ENGINE') && (
                <p className="text-red-400 text-xs mt-2 font-mono break-all">{error}</p>
              )}
              <button
                onClick={() => {
                  setError(null);
                  setIsProcessing(false);
                  setResult(null);
                }}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                {t.retry}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="max-w-3xl mx-auto p-6">
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {language === 'zh' && '指法生成完成！'}
                {language === 'en' && 'Fingering Generated!'}
                {language === 'ja' && '運指生成完了！'}
              </h2>
              
              <div className="mb-4">
                <p className="text-gray-600">
                  {language === 'zh' && `右手音符: ${result.rightHand?.length || 0}`}
                  {language === 'en' && `Right hand notes: ${result.rightHand?.length || 0}`}
                  {language === 'ja' && `右手音符: ${result.rightHand?.length || 0}`}
                </p>
                <p className="text-gray-600">
                  {language === 'zh' && `左手音符: ${result.leftHand?.length || 0}`}
                  {language === 'en' && `Left hand notes: ${result.leftHand?.length || 0}`}
                  {language === 'ja' && `左手音符: ${result.leftHand?.length || 0}`}
                </p>
              </div>

              <button
                onClick={handleDownload}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                {language === 'zh' && '下载 MusicXML 文件'}
                {language === 'en' && 'Download MusicXML File'}
                {language === 'ja' && 'MusicXML ファイルをダウンロード'}
              </button>

              <button
                onClick={() => {
                  setResult(null);
                  setFileName('');
                  setOriginalXmlContent('');
                }}
                className="w-full mt-4 px-6 py-3 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >
                {language === 'zh' && '处理新文件'}
                {language === 'en' && 'Process New File'}
                {language === 'ja' && '新しいファイルを処理'}
              </button>
            </div>
          </div>
        )}

        <footer className="text-center mt-12 text-gray-500 text-sm">
          <p>
            {language === 'zh' && '神经符号混合指法引擎 · 数据驱动先验 + 物理规则约束'}
            {language === 'en' && 'Neuro-Symbolic Hybrid Fingering Engine · Data-Driven Priors + Physical Rule Constraints'}
            {language === 'ja' && 'ニューロシンボリック・ハイブリッド運指エンジン · データ駆動事前分布 + 物理ルール制約'}
          </p>
          <p className="mt-2">
            {language === 'zh' && 'Transformer + Dyna-Q 强化学习 · 完全在浏览器运行 · 隐私安全'}
            {language === 'en' && 'Transformer + Dyna-Q Reinforcement Learning · Runs entirely in browser · Privacy-friendly'}
            {language === 'ja' && 'Transformer + Dyna-Q 強化学習 · ブラウザで完全に実行 · プライバシー安全'}
          </p>
        </footer>
      </div>
    </main>
  );
}

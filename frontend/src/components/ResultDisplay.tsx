'use client';

import { useState } from 'react';
import { Download, FileMusic, CheckCircle, Activity } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface ResultDisplayProps {
  resultUrl: string;
  filename: string;
  translations: Translations;
}

export function ResultDisplay({ resultUrl, filename, translations: t }: ResultDisplayProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch(resultUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('下载失败:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="bg-green-50 border border-green-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle className="w-8 h-8 text-green-600" />
          <h3 className="text-xl font-semibold text-green-900">
            {t.resultTitle}
          </h3>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3 text-green-700">
            <FileMusic className="w-5 h-5" />
            <p className="font-medium">{filename}</p>
          </div>

          <p className="text-green-700">
            {t.resultDescription}
          </p>

          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className={`
              w-full flex items-center justify-center gap-2
              bg-green-600 text-white px-6 py-3 rounded-lg
              font-semibold hover:bg-green-700 transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isDownloading ? (
              <>
                <Activity className="w-5 h-5 animate-spin" />
                <span>{t.downloadingButton}</span>
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                <span>{t.downloadButton}</span>
              </>
            )}
          </button>

          <p className="text-xs text-green-600 mt-4">
            {t.resultHint}
          </p>
        </div>
      </div>
    </div>
  );
}

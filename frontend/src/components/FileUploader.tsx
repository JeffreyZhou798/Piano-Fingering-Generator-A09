'use client';

import { useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';
import type { Translations } from '@/lib/i18n';

interface FileUploaderProps {
  onFileUpload: (file: File) => void;
  translations: Translations;
}

export function FileUploader({ onFileUpload, translations: t }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleFile = (file: File) => {
    setError(null);
    
    // 验证文件类型 - 支持 .musicxml 和 .mxl
    if (!file.name.endsWith('.musicxml') && !file.name.endsWith('.mxl')) {
      setError(t.errorFileType);
      return;
    }

    // 验证文件大小（限制 10MB，因为 .mxl 可能较大）
    if (file.size > 10 * 1024 * 1024) {
      setError(t.errorFileSize);
      return;
    }

    onFileUpload(file);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-xl p-12 text-center transition-all
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'}
        `}
      >
        <input
          type="file"
          accept=".musicxml,.mxl"
          className="hidden"
          id="file-upload"
          onChange={handleFileInput}
        />
        
        <label
          htmlFor="file-upload"
          className="cursor-pointer"
        >
          <Upload className="w-16 h-16 mx-auto mb-4 text-gray-400" />
          <h3 className="text-xl font-semibold mb-2">
            {t.uploadTitle}
          </h3>
          <p className="text-gray-600 mb-4">
            {t.uploadDescription}
          </p>
          <p className="text-sm text-gray-500">
            {t.uploadHint}
          </p>
        </label>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-800">{error}</p>
        </div>
      )}
    </div>
  );
}

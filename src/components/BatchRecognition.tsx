import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

interface BatchResult {
  id: string;
  imageData: string;
  latex: string;
  isConfirmed: boolean;
}

interface BatchRecognitionProps {
  onClose: () => void;
  onUseFormula: (latex: string) => void;
  onCopyLatex: (latex: string) => void;
}

const BatchRecognition: React.FC<BatchRecognitionProps> = ({
  onClose,
  onUseFormula,
  onCopyLatex,
}) => {
  const [results, setResults] = useState<BatchResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif'],
          },
        ],
      });
      
      if (!selected) return;
      
      const files = Array.isArray(selected) ? selected : [selected];
      processFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : '选择文件失败');
    }
  };

  const processFiles = async (filePaths: string[]) => {
    setIsProcessing(true);
    setError(null);
    
    try {
      const allResults: BatchResult[] = [];
      
      for (const filePath of filePaths) {
        try {
          const binaryData = await readFile(filePath);
          const base64 = btoa(
            new Uint8Array(binaryData).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ''
            )
          );
          
          const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
          const dataUrl = `data:${mimeType};base64,${base64}`;
          
          const regions = await invoke<[string, string][]>('batch_recognize', {
            image_data: dataUrl,
          });
          
          for (const [regionId, regionData] of regions) {
            allResults.push({
              id: `${filePath}_${regionId}`,
              imageData: `data:image/png;base64,${regionData}`,
              latex: '',
              isConfirmed: false,
            });
          }
        } catch (e) {
          console.error(`Failed to process ${filePath}:`, e);
        }
      }
      
      setResults(allResults);
    } catch (e) {
      setError(e instanceof Error ? e.message : '处理图片失败');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => 
      f.type.startsWith('image/')
    );
    
    if (files.length === 0) {
      setError('请拖放图片文件');
      return;
    }
    
    setIsProcessing(true);
    setError(null);
    
    Promise.all(files.map(file => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    })).then(async (dataUrls) => {
      const allResults: BatchResult[] = [];
      
      for (const dataUrl of dataUrls) {
        try {
          const regions = await invoke<[string, string][]>('batch_recognize', {
            image_data: dataUrl,
          });
          
          for (const [regionId, regionData] of regions) {
            allResults.push({
              id: `${Date.now()}_${regionId}`,
              imageData: `data:image/png;base64,${regionData}`,
              latex: '',
              isConfirmed: false,
            });
          }
        } catch (e) {
          console.error('Failed to process image:', e);
        }
      }
      
      setResults(allResults);
    }).catch((e) => {
      setError(e instanceof Error ? e.message : '处理图片失败');
    }).finally(() => {
      setIsProcessing(false);
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const updateLatex = (id: string, latex: string) => {
    setResults(prev => prev.map(r => 
      r.id === id ? { ...r, latex } : r
    ));
  };

  const confirmResult = (id: string) => {
    setResults(prev => prev.map(r => 
      r.id === id ? { ...r, isConfirmed: true } : r
    ));
  };

  const removeResult = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const confirmedResults = results.filter(r => r.isConfirmed);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-800">批量识别</h2>
          <button
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col">
          {results.length === 0 ? (
            <div
              className="flex-1 flex flex-col items-center justify-center p-8 m-4 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-400 transition-colors cursor-pointer"
              onClick={handleFileSelect}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              {isProcessing ? (
                <div className="text-center">
                  <div className="text-5xl mb-4 animate-spin">⟳</div>
                  <div className="text-lg text-gray-600">正在处理图片...</div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-6xl mb-4">🖼️</div>
                  <div className="text-xl font-medium text-gray-700 mb-2">
                    点击或拖放图片到此处
                  </div>
                  <div className="text-sm text-gray-500">
                    支持 PNG、JPG、JPEG 格式的手写公式图片
                  </div>
                  <button
                    className="mt-6 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFileSelect();
                    }}
                  >
                    选择图片文件
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.map((result) => (
                  <div
                    key={result.id}
                    className={`p-4 border-2 rounded-xl transition-colors ${
                      result.isConfirmed 
                        ? 'border-green-400 bg-green-50' 
                        : 'border-gray-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={result.imageData}
                        alt="formula"
                        className="w-24 h-24 object-contain bg-white border border-gray-200 rounded-lg flex-shrink-0"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <textarea
                          className="w-full h-20 p-2 border border-gray-300 rounded-lg font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="识别的LaTeX代码..."
                          value={result.latex}
                          onChange={(e) => updateLatex(result.id, e.target.value)}
                          spellCheck={false}
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                          result.isConfirmed
                            ? 'bg-green-100 text-green-700 cursor-default'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                        onClick={() => confirmResult(result.id)}
                        disabled={!result.latex.trim() || result.isConfirmed}
                      >
                        {result.isConfirmed ? '✓ 已确认' : '确认'}
                      </button>
                      <button
                        className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                        onClick={() => onCopyLatex(result.latex)}
                        disabled={!result.latex.trim()}
                      >
                        📋
                      </button>
                      <button
                        className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
                        onClick={() => onUseFormula(result.latex)}
                        disabled={!result.latex.trim()}
                      >
                        ✏️
                      </button>
                      <button
                        className="px-3 py-2 bg-red-50 text-red-500 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors"
                        onClick={() => removeResult(result.id)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {error && (
          <div className="px-4 py-3 bg-red-50 border-t border-red-200 text-red-600 text-sm">
            ⚠️ {error}
          </div>
        )}
        
        <div className="p-4 border-t border-gray-200 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {results.length > 0 && (
              <>已确认 {confirmedResults.length} / {results.length} 条</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              onClick={() => setResults([])}
              disabled={results.length === 0}
            >
              清空
            </button>
            <button
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
              onClick={handleFileSelect}
              disabled={isProcessing}
            >
              添加图片
            </button>
            <button
              className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors font-medium"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchRecognition;

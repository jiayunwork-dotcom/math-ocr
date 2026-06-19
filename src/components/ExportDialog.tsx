import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { ExportOptions } from '../types';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  canvasData: string;
  defaultLatex: string;
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  isOpen,
  onClose,
  canvasData,
}) => {
  const [options, setOptions] = useState<ExportOptions>({
    width: 800,
    height: 600,
    background: '#ffffff',
  });
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    
    try {
      const filePath = await save({
        defaultPath: `formula_${Date.now()}.png`,
        filters: [
          {
            name: 'PNG Image',
            extensions: ['png'],
          },
        ],
      });
      
      if (!filePath) return;
      
      await invoke('export_png', {
        canvas_data: canvasData,
        width: options.width,
        height: options.height,
        background: options.background,
        output_path: filePath,
      });
      
      alert('导出成功！');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  };

  const presetSizes = [
    { label: '小 (400×300)', width: 400, height: 300 },
    { label: '中 (800×600)', width: 800, height: 600 },
    { label: '大 (1200×900)', width: 1200, height: 900 },
    { label: '高清 (1920×1080)', width: 1920, height: 1080 },
  ];

  const presetColors = [
    { label: '白色', value: '#ffffff' },
    { label: '透明', value: 'transparent' },
    { label: '浅灰', value: '#f3f4f6' },
    { label: '米黄', value: '#fef3c7' },
    { label: '浅蓝', value: '#dbeafe' },
    { label: '浅绿', value: '#dcfce7' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">导出为图片</h3>
        </div>
        
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              预设尺寸
            </label>
            <div className="grid grid-cols-2 gap-2">
              {presetSizes.map((preset) => (
                <button
                  key={preset.label}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    options.width === preset.width && options.height === preset.height
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setOptions({ ...options, width: preset.width, height: preset.height })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                宽度 (px)
              </label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={options.width}
                onChange={(e) => setOptions({ ...options, width: parseInt(e.target.value) || 0 })}
                min={100}
                max={4000}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                高度 (px)
              </label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={options.height}
                onChange={(e) => setOptions({ ...options, height: parseInt(e.target.value) || 0 })}
                min={100}
                max={4000}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              背景颜色
            </label>
            <div className="grid grid-cols-3 gap-2">
              {presetColors.map((color) => (
                <button
                  key={color.value}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors flex items-center gap-2 ${
                    options.background === color.value
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setOptions({ ...options, background: color.value })}
                >
                  <div 
                    className="w-4 h-4 rounded border border-gray-300"
                    style={{ 
                      backgroundColor: color.value === 'transparent' ? 'transparent' : color.value,
                      backgroundImage: color.value === 'transparent' ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                      backgroundSize: '8px 8px',
                      backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                    }}
                  />
                  {color.label}
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              自定义颜色
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="w-10 h-10 rounded border border-gray-300 cursor-pointer"
                value={options.background === 'transparent' ? '#ffffff' : options.background}
                onChange={(e) => setOptions({ ...options, background: e.target.value })}
              />
              <input
                type="text"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                value={options.background}
                onChange={(e) => setOptions({ ...options, background: e.target.value })}
                placeholder="#ffffff 或 transparent"
              />
            </div>
          </div>
          
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              ⚠️ {error}
            </div>
          )}
        </div>
        
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            onClick={onClose}
            disabled={isExporting}
          >
            取消
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <span className="animate-spin">⟳</span>
                导出中...
              </>
            ) : (
              <>
                📤 导出
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportDialog;

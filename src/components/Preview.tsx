import React, { useEffect, useRef, useState, useCallback } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { RecognizedSymbol } from '../types';
import { validateBrackets } from '../utils/latexGenerator';

interface PreviewProps {
  latex: string;
  onLatexChange: (latex: string) => void;
  symbols: RecognizedSymbol[];
  onSymbolClick: (symbol: RecognizedSymbol) => void;
  onSaveHistory: () => void;
  onExport: () => void;
  onCopyLatex: () => void;
  isRecognizing: boolean;
}

const Preview: React.FC<PreviewProps> = ({
  latex,
  onLatexChange,
  symbols,
  onSymbolClick,
  onSaveHistory,
  onExport,
  onCopyLatex,
  isRecognizing,
}) => {
  const renderRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const renderLatex = useCallback(() => {
    if (!renderRef.current) return;
    
    if (!latex.trim()) {
      renderRef.current.innerHTML = `
        <div class="flex items-center justify-center h-full text-gray-400">
          <div class="text-center">
            <div class="text-4xl mb-2">📝</div>
            <div>在左侧画布上书写数学公式</div>
            <div class="text-sm mt-1">识别结果将在此处显示</div>
          </div>
        </div>
      `;
      setRenderError(null);
      return;
    }
    
    try {
      const validation = validateBrackets(latex);
      
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
        strict: false,
      });
      
      renderRef.current.innerHTML = `
        <div class="flex items-center justify-center min-h-[100px] p-4">
          ${html}
        </div>
      `;
      
      if (!validation.valid) {
        setRenderError(validation.message || '括号可能不配对');
      } else {
        setRenderError(null);
      }
    } catch (e) {
      renderRef.current.innerHTML = `
        <div class="flex items-center justify-center h-full text-red-500">
          渲染失败: ${e instanceof Error ? e.message : '未知错误'}
        </div>
      `;
      setRenderError(e instanceof Error ? e.message : '渲染失败');
    }
  }, [latex]);

  useEffect(() => {
    renderLatex();
  }, [renderLatex]);

  const handleCopy = () => {
    onCopyLatex();
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="preview-container flex flex-col h-full bg-white border-l border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">识别结果</h2>
          <div className="flex items-center gap-2">
            {isRecognizing && (
              <span className="text-sm text-blue-600 flex items-center gap-1">
                <span className="animate-spin">⟳</span> 识别中...
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors flex items-center gap-1"
            onClick={onSaveHistory}
            disabled={!latex.trim()}
          >
            💾 保存
          </button>
          <button
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1 ${
              copySuccess 
                ? 'bg-green-500 text-white' 
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            onClick={handleCopy}
            disabled={!latex.trim()}
          >
            {copySuccess ? '✓ 已复制' : '📋 复制LaTeX'}
          </button>
          <button
            className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors flex items-center gap-1"
            onClick={onExport}
            disabled={!latex.trim()}
          >
            📤 导出图片
          </button>
        </div>
      </div>
      
      <div className="p-4 border-b border-gray-200">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          LaTeX 代码 (可编辑)
        </label>
        <textarea
          className="w-full h-24 p-3 border border-gray-300 rounded-md font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={latex}
          onChange={(e) => onLatexChange(e.target.value)}
          placeholder="识别的LaTeX代码将显示在这里..."
          spellCheck={false}
        />
        {renderError && (
          <div className="mt-2 text-sm text-amber-600 flex items-center gap-1">
            ⚠️ {renderError}
          </div>
        )}
      </div>
      
      <div className="flex-1 p-4 flex flex-col min-h-0">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          公式预览
        </label>
        <div 
          ref={renderRef}
          className="flex-1 min-h-[200px] border border-gray-200 rounded-lg bg-gray-50 overflow-auto"
        />
      </div>
      
      {symbols.length > 0 && (
        <div className="p-4 border-t border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            识别的符号 (点击修改)
          </label>
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {symbols.map((symbol) => {
              const candidate = symbol.candidates[symbol.selectedCandidate];
              return (
                <button
                  key={symbol.id}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-blue-100 text-gray-800 rounded-md text-sm font-mono transition-colors border border-gray-200 hover:border-blue-300"
                  onClick={() => onSymbolClick(symbol)}
                  title={`置信度: ${(candidate?.probability * 100).toFixed(1)}%`}
                >
                  <span className="font-medium">{candidate?.latex}</span>
                  <span className="ml-1 text-xs text-gray-500">
                    ({(candidate?.probability * 100).toFixed(0)}%)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

interface CandidateModalProps {
  symbol: RecognizedSymbol | null;
  onClose: () => void;
  onSelect: (symbolId: string, candidateIndex: number) => void;
}

export const CandidateModal: React.FC<CandidateModalProps> = ({
  symbol,
  onClose,
  onSelect,
}) => {
  if (!symbol) return null;
  
  const currentCandidate = symbol.candidates[symbol.selectedCandidate];
  
  const renderPreview = (latex: string) => {
    try {
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
        output: 'html',
        strict: false,
      });
    } catch {
      return latex;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">修改符号识别</h3>
          <p className="text-sm text-gray-500 mt-1">选择正确的符号类别</p>
        </div>
        
        <div className="p-4">
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <div className="text-sm text-gray-600 mb-1">当前识别</div>
            <div className="flex items-center gap-3">
              <div 
                className="text-2xl font-medium"
                dangerouslySetInnerHTML={{ __html: renderPreview(currentCandidate?.latex || '') }}
              />
              <div className="text-sm text-gray-500">
                {currentCandidate?.label} ({(currentCandidate?.probability * 100).toFixed(1)}%)
              </div>
            </div>
          </div>
          
          <div className="text-sm text-gray-600 mb-2">候选列表</div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {symbol.candidates.map((candidate, index) => (
              <button
                key={index}
                className={`w-full p-3 rounded-lg text-left flex items-center gap-3 transition-colors ${
                  index === symbol.selectedCandidate
                    ? 'bg-blue-100 border-2 border-blue-500'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
                onClick={() => onSelect(symbol.id, index)}
              >
                <div 
                  className="text-xl font-medium min-w-[60px] text-center"
                  dangerouslySetInnerHTML={{ __html: renderPreview(candidate.latex) }}
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-800">{candidate.label}</div>
                  <div className="text-xs text-gray-500 font-mono">{candidate.latex}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-blue-600">
                    {(candidate.probability * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-400">置信度</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-200 flex justify-end">
          <button
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};

export default Preview;

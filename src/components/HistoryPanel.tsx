import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FormulaHistory } from '../types';

interface HistoryPanelProps {
  onSelectFormula: (latex: string) => void;
  onCopyLatex: (latex: string) => void;
  onExport: (latex: string, thumbnail: string) => void;
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({
  onSelectFormula,
  onCopyLatex,
  onExport,
}) => {
  const [formulas, setFormulas] = useState<FormulaHistory[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const loadFormulas = async () => {
    setIsLoading(true);
    try {
      const result = await invoke<FormulaHistory[]>('get_formulas');
      setFormulas(result);
    } catch (e) {
      console.error('Failed to load formulas:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const searchFormulas = async (query: string) => {
    if (!query.trim()) {
      loadFormulas();
      return;
    }
    
    setIsLoading(true);
    try {
      const result = await invoke<FormulaHistory[]>('search_formulas', { query });
      setFormulas(result);
    } catch (e) {
      console.error('Failed to search formulas:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFormulas();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchFormulas(searchQuery);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleToggleFavorite = async (id: string) => {
    try {
      await invoke('toggle_favorite', { id });
      setFormulas(prev => prev.map(f => 
        f.id === id ? { ...f, isFavorite: !f.isFavorite } : f
      ));
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    
    try {
      await invoke('delete_formula', { id });
      setFormulas(prev => prev.filter(f => f.id !== id));
    } catch (e) {
      console.error('Failed to delete formula:', e);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredFormulas = showOnlyFavorites 
    ? formulas.filter(f => f.isFavorite)
    : formulas;

  return (
    <div className="history-panel h-full flex flex-col bg-white border-l border-gray-200">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">公式历史</h2>
        
        <div className="space-y-2">
          <div className="relative">
            <input
              type="text"
              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="搜索LaTeX内容..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              🔍
            </span>
          </div>
          
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlyFavorites}
              onChange={(e) => setShowOnlyFavorites(e.target.checked)}
              className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
            />
            仅显示收藏
          </label>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            <span className="animate-spin mr-2">⟳</span> 加载中...
          </div>
        ) : filteredFormulas.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <div className="text-3xl mb-2">📚</div>
            <div>{searchQuery ? '未找到匹配的公式' : '暂无历史记录'}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredFormulas.map((formula) => (
              <div
                key={formula.id}
                className="p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50/50 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div 
                    className="w-16 h-16 bg-gray-100 rounded border border-gray-200 flex-shrink-0 overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: formula.thumbnail ? `<img src="${formula.thumbnail}" class="w-full h-full object-contain" />` : '<div class="w-full h-full flex items-center justify-center text-gray-400">📐</div>' }}
                  />
                  
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-gray-800 truncate" title={formula.latex}>
                      {formula.latex}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDate(formula.createdAt)}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-1 mt-3 flex-wrap">
                  <button
                    className="px-2 py-1 text-xs font-medium bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition-colors"
                    onClick={() => onSelectFormula(formula.latex)}
                  >
                    ✏️ 使用
                  </button>
                  <button
                    className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                    onClick={() => onCopyLatex(formula.latex)}
                  >
                    📋 复制
                  </button>
                  <button
                    className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                    onClick={() => onExport(formula.latex, formula.thumbnail)}
                  >
                    📤 导出
                  </button>
                  <button
                    className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                      formula.isFavorite 
                        ? 'bg-yellow-100 text-yellow-700' 
                        : 'bg-gray-100 text-gray-600 hover:bg-yellow-50'
                    }`}
                    onClick={() => handleToggleFavorite(formula.id)}
                  >
                    {formula.isFavorite ? '⭐ 已收藏' : '☆ 收藏'}
                  </button>
                  <button
                    className="px-2 py-1 text-xs font-medium bg-red-50 text-red-600 rounded hover:bg-red-100 transition-colors ml-auto"
                    onClick={() => handleDelete(formula.id)}
                  >
                    🗑️ 删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="p-3 border-t border-gray-200 text-center text-sm text-gray-500">
        共 {filteredFormulas.length} 条记录
      </div>
    </div>
  );
};

export default HistoryPanel;

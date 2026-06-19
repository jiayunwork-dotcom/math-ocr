import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { FormulaTemplate, TEMPLATE_CATEGORIES } from '../types';

interface TemplateLibraryProps {
  onInsertTemplate: (template: FormulaTemplate) => void;
}

interface CategoryGroup {
  name: string;
  templates: FormulaTemplate[];
}

const CATEGORY_ICONS: Record<string, string> = {
  '基础运算': '➕',
  '微积分': '∫',
  '线性代数': '📊',
  '概率统计': '🎲',
  '集合逻辑': '🔢',
};

const TemplateLibrary: React.FC<TemplateLibraryProps> = ({ onInsertTemplate }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [templates, setTemplates] = useState<FormulaTemplate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set([...TEMPLATE_CATEGORIES])
  );
  const [manualExpandedCategories, setManualExpandedCategories] = useState<Set<string>>(
    new Set([...TEMPLATE_CATEGORIES])
  );
  const [isLoading, setIsLoading] = useState(false);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [draggedTemplate, setDraggedTemplate] = useState<FormulaTemplate | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const searchTimerRef = useRef<number | null>(null);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await invoke<FormulaTemplate[]>('get_templates');
      setTemplates(result);
    } catch (e) {
      console.error('Failed to load templates:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const searchTemplates = useCallback(async (query: string) => {
    if (!query.trim()) {
      loadTemplates();
      return;
    }
    setIsLoading(true);
    try {
      const result = await invoke<FormulaTemplate[]>('search_templates', { query });
      setTemplates(result);
    } catch (e) {
      console.error('Failed to search templates:', e);
    } finally {
      setIsLoading(false);
    }
  }, [loadTemplates]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    searchTimerRef.current = window.setTimeout(() => {
      searchTemplates(searchQuery);
    }, 200);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery, searchTemplates]);

  const groupedTemplates = useMemo<CategoryGroup[]>(() => {
    const groups: Record<string, FormulaTemplate[]> = {};
    for (const t of templates) {
      if (!groups[t.category]) {
        groups[t.category] = [];
      }
      groups[t.category].push(t);
    }
    return Object.entries(groups)
      .map(([name, items]) => ({
        name,
        templates: items.sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          if (b.useCount !== a.useCount) return b.useCount - a.useCount;
          return a.createdAt.localeCompare(b.createdAt);
        }),
      }))
      .sort((a, b) => {
        const aIdx = TEMPLATE_CATEGORIES.indexOf(a.name as any);
        const bIdx = TEMPLATE_CATEGORIES.indexOf(b.name as any);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [templates]);

  useEffect(() => {
    if (searchQuery.trim()) {
      const categoriesWithResults = new Set(groupedTemplates.map(g => g.name));
      setExpandedCategories(categoriesWithResults);
    } else {
      setExpandedCategories(new Set(manualExpandedCategories));
    }
  }, [searchQuery, groupedTemplates, manualExpandedCategories]);

  const toggleCategory = (category: string) => {
    const toggle = (prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    };
    setExpandedCategories(toggle);
    setManualExpandedCategories(toggle);
  };

  const handleTemplateClick = async (template: FormulaTemplate) => {
    try {
      await invoke('increment_template_use', { id: template.id });
      setTemplates(prev => prev.map(t => 
        t.id === template.id ? { ...t, useCount: t.useCount + 1 } : t
      ));
    } catch (e) {
      console.error('Failed to increment use count:', e);
    }
    onInsertTemplate(template);
  };

  const handleDeleteTemplate = async (template: FormulaTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    if (template.isBuiltin) return;
    if (!confirm(`确定要删除自定义模板"${template.name}"吗？`)) return;

    try {
      await invoke('delete_template', { id: template.id });
      setTemplates(prev => prev.filter(t => t.id !== template.id));
    } catch (e) {
      console.error('Failed to delete template:', e);
    }
  };

  const handleDragStart = (e: React.DragEvent, template: FormulaTemplate) => {
    setDraggedTemplate(template);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, category: string, index: number) => {
    e.preventDefault();
    if (!draggedTemplate || draggedTemplate.category !== category) return;
    setDragOverCategory(category);
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverCategory(null);
    setDragOverIndex(null);
  };

  const handleDrop = async (e: React.DragEvent, category: string) => {
    e.preventDefault();
    if (!draggedTemplate || draggedTemplate.category !== category || dragOverIndex === null) {
      setDraggedTemplate(null);
      setDragOverCategory(null);
      setDragOverIndex(null);
      return;
    }

    const categoryGroup = groupedTemplates.find(g => g.name === category);
    if (!categoryGroup) return;

    const items = [...categoryGroup.templates];
    const fromIdx = items.findIndex(t => t.id === draggedTemplate.id);
    const toIdx = dragOverIndex;

    if (fromIdx === -1 || fromIdx === toIdx) {
      setDraggedTemplate(null);
      setDragOverCategory(null);
      setDragOverIndex(null);
      return;
    }

    const [removed] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, removed);

    const orderedIds = items.map(t => t.id);
    try {
      await invoke('update_template_order', { category, orderedIds });
      setTemplates(prev => {
        const other = prev.filter(t => t.category !== category);
        const updated = items.map((t, idx) => ({ ...t, sortOrder: idx }));
        return [...other, ...updated];
      });
    } catch (e) {
      console.error('Failed to update order:', e);
    }

    setDraggedTemplate(null);
    setDragOverCategory(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedTemplate(null);
    setDragOverCategory(null);
    setDragOverIndex(null);
  };

  const renderKatexPreview = (latex: string) => {
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

  if (!isExpanded) {
    return (
      <div className="template-library-collapsed flex flex-col items-center py-4 bg-gradient-to-b from-indigo-50 to-white border-r border-gray-200 shadow-sm">
        <button
          className="p-3 rounded-xl bg-white border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 transition-all shadow-md hover:shadow-lg"
          onClick={() => setIsExpanded(true)}
          title="展开模板库"
        >
          <div className="text-2xl">📑</div>
          <div className="text-xs font-medium mt-1">模板库</div>
        </button>
      </div>
    );
  }

  return (
    <div className="template-library flex flex-col h-full w-[320px] min-w-[320px] bg-gradient-to-b from-indigo-50/50 to-white border-r border-gray-200 shadow-sm overflow-hidden">
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">📑</span>
            <h2 className="text-lg font-bold text-gray-800">模板库</h2>
          </div>
          <button
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            onClick={() => setIsExpanded(false)}
            title="收起模板库"
          >
            ◀
          </button>
        </div>

        <div className="relative">
          <input
            type="text"
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            placeholder="搜索模板名称或LaTeX..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
            🔍
          </span>
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              onClick={() => setSearchQuery('')}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-500">
            <span className="animate-spin mr-2">⟳</span> 加载中...
          </div>
        ) : groupedTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <div className="text-3xl mb-2">📭</div>
            <div>{searchQuery ? '未找到匹配的模板' : '暂无模板'}</div>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedTemplates.map((group) => (
              <div
                key={group.name}
                className="rounded-xl bg-white border border-gray-200 overflow-hidden shadow-sm"
              >
                <button
                  className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  onClick={() => toggleCategory(group.name)}
                >
                  <span className="text-lg">
                    {CATEGORY_ICONS[group.name] || '📁'}
                  </span>
                  <span className="flex-1 font-semibold text-gray-700">
                    {group.name}
                  </span>
                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
                    {group.templates.length}
                  </span>
                  <span
                    className={`text-gray-400 transition-transform duration-200 ${
                      expandedCategories.has(group.name) ? 'rotate-90' : ''
                    }`}
                  >
                    ▶
                  </span>
                </button>

                {expandedCategories.has(group.name) && (
                  <div
                    className="border-t border-gray-100 p-2 grid grid-cols-2 gap-2"
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, group.name)}
                  >
                    {group.templates.map((template, idx) => (
                      <div
                        key={template.id}
                        className={`
                          template-card relative group rounded-lg border-2 p-2 cursor-pointer
                          transition-all duration-200
                          ${
                            dragOverCategory === group.name && dragOverIndex === idx
                              ? 'border-indigo-500 bg-indigo-50 scale-105'
                              : 'border-transparent hover:border-indigo-200 hover:bg-indigo-50/50'
                          }
                          ${
                            draggedTemplate?.id === template.id
                              ? 'opacity-50'
                              : ''
                          }
                        `}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, template)}
                        onDragOver={(e) => handleDragOver(e, group.name, idx)}
                        onDragEnd={handleDragEnd}
                        onClick={() => handleTemplateClick(template)}
                        title={`${template.name}\n使用次数: ${template.useCount}`}
                      >
                        <div
                          className="h-12 flex items-center justify-center text-gray-800 overflow-hidden mb-2"
                          dangerouslySetInnerHTML={{
                            __html: `<div style="transform: scale(0.7); transform-origin: center;">${renderKatexPreview(
                              template.latex
                            )}</div>`,
                          }}
                        />

                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-700 truncate">
                              {template.name}
                            </div>
                            <div className="text-[10px] text-gray-400">
                              {template.useCount > 0 && `🔥 ${template.useCount}`}
                            </div>
                          </div>

                          {!template.isBuiltin && (
                            <button
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded transition-all"
                              onClick={(e) => handleDeleteTemplate(template, e)}
                              title="删除模板"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-gray-200 bg-white">
        <div className="text-xs text-gray-500 text-center">
          💡 点击模板快速插入 · 拖拽模板排序
        </div>
      </div>
    </div>
  );
};

export default TemplateLibrary;

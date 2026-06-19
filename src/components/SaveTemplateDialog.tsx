import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TEMPLATE_CATEGORIES } from '../types';

interface SaveTemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  defaultLatex: string;
  defaultThumbnail: string;
}

const SaveTemplateDialog: React.FC<SaveTemplateDialogProps> = ({
  isOpen,
  onClose,
  onSaved,
  defaultLatex,
  defaultThumbnail,
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(TEMPLATE_CATEGORIES[0]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadCategories();
      setName('');
      setCategory(TEMPLATE_CATEGORIES[0]);
      setNewCategoryName('');
      setIsNewCategory(false);
      setError('');
    }
  }, [isOpen]);

  const loadCategories = async () => {
    try {
      const result = await invoke<string[]>('get_template_categories');
      const builtin = [...TEMPLATE_CATEGORIES];
      const combined = Array.from(new Set([...builtin, ...result]));
      setCategories(combined);
    } catch (e) {
      console.error('Failed to load categories:', e);
      setCategories([...TEMPLATE_CATEGORIES]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('请输入模板名称');
      return;
    }

    const finalCategory = isNewCategory ? newCategoryName.trim() : category;
    if (!finalCategory) {
      setError('请选择或输入分类');
      return;
    }

    setIsSaving(true);
    try {
      await invoke('save_template', {
        name: name.trim(),
        category: finalCategory,
        latex: defaultLatex,
        thumbnail: defaultThumbnail,
      });
      onSaved();
      onClose();
    } catch (e) {
      console.error('Failed to save template:', e);
      setError('保存失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">保存为模板</h3>
          <p className="text-sm text-gray-500 mt-1">将当前公式保存到模板库以便快速复用</p>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              模板名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="例如：二次方程求根公式"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              分类 <span className="text-red-500">*</span>
            </label>

            {!isNewCategory ? (
              <div className="space-y-2">
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                  onClick={() => setIsNewCategory(true)}
                >
                  + 新建分类
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="输入新分类名称"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button
                  type="button"
                  className="text-sm text-gray-600 hover:text-gray-700 font-medium"
                  onClick={() => setIsNewCategory(false)}
                >
                  ← 选择已有分类
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              LaTeX 预览
            </label>
            <div className="p-3 bg-gray-50 rounded-md border border-gray-200">
              <code className="text-xs text-gray-600 break-all font-mono">
                {defaultLatex}
              </code>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 rounded-md border border-red-200 text-sm text-red-600">
              ⚠️ {error}
            </div>
          )}
        </form>

        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            onClick={onClose}
            disabled={isSaving}
          >
            取消
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? '保存中...' : '💾 保存模板'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveTemplateDialog;

import React, { useState, useEffect, useCallback } from 'react';
import katex from 'katex';
import { invoke } from '@tauri-apps/api/core';

interface MistakeRow {
  id: string;
  session_id: string;
  question_latex: string;
  recognized_latex: string;
  score: number;
  time_spent: number;
  knowledge_points: string;
  is_mistake: number;
  created_at: string;
}

interface MistakeBookProps {
  onClose: () => void;
  onRepractice: (latex: string) => void;
}

const MistakeBook: React.FC<MistakeBookProps> = ({ onClose, onRepractice }) => {
  const [mistakes, setMistakes] = useState<MistakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMistakes = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<MistakeRow[]>('get_mistakes');
      setMistakes(result);
    } catch (e) {
      console.error('Load mistakes error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMistakes();
  }, [loadMistakes]);

  const handleRepractice = async (mistake: MistakeRow) => {
    try {
      await invoke('remove_mistake', { id: mistake.id });
      onRepractice(mistake.question_latex);
    } catch (e) {
      console.error('Remove mistake error:', e);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await invoke('remove_mistake', { id });
      loadMistakes();
    } catch (e) {
      console.error('Remove mistake error:', e);
    }
  };

  const renderLatex = (latex: string) => {
    try {
      return katex.renderToString(latex, {
        throwOnError: false,
        displayMode: true,
        output: 'html',
        strict: false,
      });
    } catch {
      return latex;
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const getKPs = (kpJson: string): string[] => {
    try {
      return JSON.parse(kpJson);
    } catch {
      return [];
    }
  };

  return (
    <div className="mistake-book">
      <div className="mistake-book-header">
        <button className="practice-back-btn" onClick={onClose}>← 返回</button>
        <h2>📖 错题本</h2>
        <span className="mistake-count">共 {mistakes.length} 题</span>
      </div>

      <div className="mistake-book-list">
        {loading ? (
          <div className="mistake-book-loading">加载中...</div>
        ) : mistakes.length === 0 ? (
          <div className="mistake-book-empty">
            <div className="mistake-book-empty-icon">🎉</div>
            <div className="mistake-book-empty-text">暂无错题，继续保持！</div>
          </div>
        ) : (
          mistakes.map(mistake => (
            <div key={mistake.id} className="mistake-item">
              <div className="mistake-item-header">
                <span className="mistake-item-date">{formatDate(mistake.created_at)}</span>
                <span className="mistake-item-score">{Math.round(mistake.score)}分</span>
              </div>

              <div className="mistake-item-formulas">
                <div className="mistake-item-target">
                  <span className="mistake-item-label">正确答案：</span>
                  <span dangerouslySetInnerHTML={{ __html: renderLatex(mistake.question_latex) }} />
                </div>
                <div className="mistake-item-recognized">
                  <span className="mistake-item-label">你的书写：</span>
                  {mistake.recognized_latex ? (
                    <span dangerouslySetInnerHTML={{ __html: renderLatex(mistake.recognized_latex) }} />
                  ) : (
                    <span className="mistake-item-empty">未识别</span>
                  )}
                </div>
              </div>

              <div className="mistake-item-kps">
                {getKPs(mistake.knowledge_points).map((kp: string) => (
                  <span key={kp} className="practice-kp-tag">{kp}</span>
                ))}
              </div>

              <div className="mistake-item-actions">
                <button
                  className="mistake-repractice-btn"
                  onClick={() => handleRepractice(mistake)}
                >
                  🔄 重新练习
                </button>
                <button
                  className="mistake-remove-btn"
                  onClick={() => handleRemove(mistake.id)}
                >
                  ✅ 已掌握
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MistakeBook;

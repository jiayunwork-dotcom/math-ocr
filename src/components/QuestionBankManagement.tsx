import React, { useState, useEffect, useCallback } from 'react';
import katex from 'katex';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile, readTextFile } from '@tauri-apps/plugin-fs';
import { KnowledgePoint } from '../types';
import { ALL_KNOWLEDGE_POINTS } from '../utils/questionBank';

interface CustomBank {
  id: string;
  name: string;
  difficulty: string;
  description: string;
  question_count: number;
  share_code: string | null;
  created_at: string;
  updated_at: string;
}

interface KpStatItem {
  kp: string;
  correct: number;
  wrong: number;
}

interface BankStatistics {
  practice_count: number;
  avg_accuracy: number;
  avg_time: number;
  hardest_question_latex: string | null;
  hardest_question_error_count: number;
  last_practice_time: string | null;
  kp_distribution: KpStatItem[];
}

interface BankBriefStat {
  bank_id: string;
  practice_count: number;
  accuracy: number;
}

interface CustomQuestion {
  id: string;
  bank_id: string;
  latex: string;
  knowledge_points: string;
  time_limit: number;
  created_at: string;
}

interface QuestionBankManagementProps {
  onClose: () => void;
}

const DIFFICULTY_OPTIONS: { value: string; label: string }[] = [
  { value: 'beginner', label: '初级' },
  { value: 'intermediate', label: '中级' },
  { value: 'advanced', label: '高级' },
];

const validateLatex = (latex: string): string | null => {
  try {
    katex.renderToString(latex, { throwOnError: true, displayMode: true });
    return null;
  } catch (e: unknown) {
    if (e instanceof Error) return e.message;
    return 'LaTeX语法错误';
  }
};

const renderLatex = (latex: string) => {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true, output: 'html', strict: false });
  } catch {
    return latex;
  }
};

interface QuestionFormData {
  latex: string;
  knowledgePoints: KnowledgePoint[];
  timeLimit: number;
}

const emptyQuestionForm: QuestionFormData = {
  latex: '',
  knowledgePoints: [],
  timeLimit: 60,
};

const QuestionBankManagement: React.FC<QuestionBankManagementProps> = ({ onClose }) => {
  const [banks, setBanks] = useState<CustomBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [loading, setLoading] = useState(false);

  const [showCreateBank, setShowCreateBank] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [statsData, setStatsData] = useState<BankStatistics | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [briefStats, setBriefStats] = useState<Record<string, BankBriefStat>>({});

  const [shareCode, setShareCode] = useState<string | null>(null);
  const [importCode, setImportCode] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankDifficulty, setBankDifficulty] = useState('beginner');
  const [bankDescription, setBankDescription] = useState('');

  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<CustomQuestion | null>(null);
  const [questionForm, setQuestionForm] = useState<QuestionFormData>({ ...emptyQuestionForm });
  const [latexError, setLatexError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'bank' | 'question'; id: string; name: string } | null>(null);

  const selectedBank = banks.find(b => b.id === selectedBankId) || null;

  const loadBanks = useCallback(async () => {
    try {
      const result = await invoke<CustomBank[]>('get_custom_banks');
      setBanks(result);
    } catch (e) {
      console.error('Failed to load banks:', e);
    }
  }, []);

  const loadQuestions = useCallback(async (bankId: string) => {
    setLoading(true);
    try {
      const result = await invoke<CustomQuestion[]>('get_custom_questions', { bankId });
      setQuestions(result);
    } catch (e) {
      console.error('Failed to load questions:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBanks();
  }, [loadBanks]);

  const loadBriefStats = useCallback(async (bankIds: string[]) => {
    if (bankIds.length === 0) return;
    try {
      const result = await invoke<BankBriefStat[]>('get_banks_brief_stats', { bankIds });
      const statsMap: Record<string, BankBriefStat> = {};
      result.forEach(s => { statsMap[s.bank_id] = s; });
      setBriefStats(statsMap);
    } catch (e) {
      console.error('Failed to load brief stats:', e);
    }
  }, []);

  const loadStatistics = useCallback(async (bankId: string) => {
    setStatsLoading(true);
    try {
      const result = await invoke<BankStatistics>('get_bank_statistics', { bankId });
      setStatsData(result);
    } catch (e) {
      console.error('Failed to load statistics:', e);
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const toggleStats = () => {
    if (!selectedBankId) return;
    if (!showStats) {
      loadStatistics(selectedBankId);
    }
    setShowStats(!showStats);
  };

  const handleGenerateShareCode = async () => {
    if (!selectedBankId) return;
    try {
      const code = await invoke<string>('generate_share_code', { bankId: selectedBankId });
      setShareCode(code);
      await loadBanks();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleCopyShareCode = async () => {
    if (!shareCode) return;
    try {
      await navigator.clipboard.writeText(shareCode);
      alert('分享码已复制到剪贴板');
    } catch {
      alert('复制失败，请手动复制');
    }
  };

  const handleImportShareCode = async () => {
    const code = importCode.trim().toUpperCase();
    if (!code) { alert('请输入分享码'); return; }
    if (code.length !== 8) { alert('分享码为8位字母数字组合'); return; }

    setImportLoading(true);
    try {
      const newBank = await invoke<CustomBank>('import_bank_by_share_code', { shareCode: code });
      alert(`成功导入题库「${newBank.name}」！`);
      setImportCode('');
      await loadBanks();
      setSelectedBankId(newBank.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setImportLoading(false);
    }
  };

  useEffect(() => {
    if (banks.length > 0) {
      loadBriefStats(banks.map(b => b.id));
    }
  }, [banks, loadBriefStats]);

  useEffect(() => {
    if (selectedBank) {
      setShareCode(selectedBank.share_code);
    } else {
      setShareCode(null);
    }
  }, [selectedBank]);

  useEffect(() => {
    if (selectedBankId) {
      loadQuestions(selectedBankId);
    } else {
      setQuestions([]);
    }
    setShowStats(false);
    setStatsData(null);
  }, [selectedBankId, loadQuestions]);

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleCreateBank = async () => {
    if (!bankName.trim()) { alert('请输入题库名称'); return; }
    if (bankName.length > 20) { alert('题库名称不超过20个字符'); return; }
    try {
      await invoke('create_custom_bank', {
        name: bankName.trim(),
        difficulty: bankDifficulty,
        description: bankDescription,
      });
      setShowCreateBank(false);
      setBankName('');
      setBankDifficulty('beginner');
      setBankDescription('');
      await loadBanks();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteBank = async (bankId: string) => {
    try {
      await invoke('delete_custom_bank', { id: bankId });
      setConfirmDelete(null);
      if (selectedBankId === bankId) {
        setSelectedBankId(null);
        setQuestions([]);
      }
      await loadBanks();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLatexInput = (value: string) => {
    setQuestionForm(prev => ({ ...prev, latex: value }));
    if (value.trim()) {
      const err = validateLatex(value);
      setLatexError(err);
    } else {
      setLatexError(null);
    }
  };

  const handleKpToggle = (kp: KnowledgePoint) => {
    setQuestionForm(prev => {
      const exists = prev.knowledgePoints.includes(kp);
      return {
        ...prev,
        knowledgePoints: exists
          ? prev.knowledgePoints.filter(k => k !== kp)
          : [...prev.knowledgePoints, kp],
      };
    });
  };

  const handleSaveQuestion = async () => {
    if (!questionForm.latex.trim()) { alert('请输入LaTeX公式'); return; }
    const err = validateLatex(questionForm.latex);
    if (err) { alert('LaTeX语法错误，请修正后保存'); return; }
    if (questionForm.knowledgePoints.length === 0) { alert('请至少选择一个知识点'); return; }
    if (questionForm.timeLimit < 30 || questionForm.timeLimit > 300) { alert('限时必须在30-300秒之间'); return; }
    if (!Number.isInteger(questionForm.timeLimit)) { alert('限时必须为整数'); return; }

    try {
      if (editingQuestion) {
        await invoke('update_custom_question', {
          id: editingQuestion.id,
          latex: questionForm.latex,
          knowledgePoints: JSON.stringify(questionForm.knowledgePoints),
          timeLimit: questionForm.timeLimit,
        });
      } else if (selectedBankId) {
        await invoke('add_custom_question', {
          bankId: selectedBankId,
          latex: questionForm.latex,
          knowledgePoints: JSON.stringify(questionForm.knowledgePoints),
          timeLimit: questionForm.timeLimit,
        });
      }
      setShowQuestionForm(false);
      setEditingQuestion(null);
      setQuestionForm({ ...emptyQuestionForm });
      setLatexError(null);
      if (selectedBankId) {
        await loadQuestions(selectedBankId);
        await loadBanks();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleEditQuestion = (q: CustomQuestion) => {
    let kps: KnowledgePoint[] = [];
    try {
      kps = JSON.parse(q.knowledge_points);
    } catch { /* ignore */ }
    setEditingQuestion(q);
    setQuestionForm({
      latex: q.latex,
      knowledgePoints: kps,
      timeLimit: q.time_limit,
    });
    setLatexError(null);
    setShowQuestionForm(true);
  };

  const handleDeleteQuestion = async (questionId: string) => {
    try {
      await invoke('delete_custom_question', { id: questionId });
      setConfirmDelete(null);
      if (selectedBankId) {
        await loadQuestions(selectedBankId);
        await loadBanks();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExport = async () => {
    if (!selectedBank) return;
    const exportData = {
      bank: {
        name: selectedBank.name,
        difficulty: selectedBank.difficulty,
        description: selectedBank.description,
      },
      questions: questions.map(q => ({
        latex: q.latex,
        knowledge_points: q.knowledge_points,
        time_limit: q.time_limit,
      })),
    };

    try {
      const defaultName = `${selectedBank.name}.json`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'JSON文件', extensions: ['json'] }],
      });
      if (savePath) {
        const content = JSON.stringify(exportData, null, 2);
        const encoder = new TextEncoder();
        await writeFile(savePath, encoder.encode(content));
        alert('导出成功！');
      }
    } catch (e) {
      alert('导出失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleImport = async () => {
    if (!selectedBankId) return;
    try {
      const filePath = await open({
        filters: [{ name: 'JSON文件', extensions: ['json'] }],
        multiple: false,
      });
      if (!filePath) return;

      const content = await readTextFile(filePath as string);
      let data: { questions?: unknown[] };
      try {
        data = JSON.parse(content);
      } catch {
        alert('JSON格式不合法');
        return;
      }

      if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
        alert('JSON中没有有效的题目数据');
        return;
      }

      const questionsToImport: { latex: string; knowledge_points: string; time_limit: number }[] = [];
      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i] as Record<string, unknown>;
        const idx = i + 1;

        if (!q.latex || typeof q.latex !== 'string') {
          alert(`第${idx}条题目缺少latex字段或格式错误`);
          return;
        }

        const latexErr = validateLatex(q.latex as string);
        if (latexErr) {
          alert(`第${idx}条题目的LaTeX语法错误：${latexErr}`);
          return;
        }

        if (!q.knowledge_points || typeof q.knowledge_points !== 'string') {
          alert(`第${idx}条题目缺少knowledge_points字段或格式错误`);
          return;
        }

        let kpList: string[];
        try {
          kpList = JSON.parse(q.knowledge_points as string);
          if (!Array.isArray(kpList)) throw new Error();
        } catch {
          alert(`第${idx}条题目的knowledge_points格式错误，应为JSON数组字符串`);
          return;
        }

        const validKps = ALL_KNOWLEDGE_POINTS;
        for (const kp of kpList) {
          if (!validKps.includes(kp as KnowledgePoint)) {
            alert(`第${idx}条题目的知识点"${kp}"不在合法范围内`);
            return;
          }
        }

        if (typeof q.time_limit !== 'number' || !Number.isInteger(q.time_limit)) {
          alert(`第${idx}条题目的time_limit必须为整数`);
          return;
        }

        if (q.time_limit < 30 || q.time_limit > 300) {
          alert(`第${idx}条题目的限时必须在30-300秒之间`);
          return;
        }

        questionsToImport.push({
          latex: q.latex as string,
          knowledge_points: q.knowledge_points as string,
          time_limit: q.time_limit as number,
        });
      }

      const count = await invoke<number>('batch_add_custom_questions', {
        bankId: selectedBankId,
        questionsJson: JSON.stringify(questionsToImport),
      });
      alert(`成功导入${count}条题目！`);
      if (selectedBankId) {
        await loadQuestions(selectedBankId);
        await loadBanks();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const openAddQuestionForm = () => {
    setEditingQuestion(null);
    setQuestionForm({ ...emptyQuestionForm });
    setLatexError(null);
    setShowQuestionForm(true);
  };

  return (
    <div className="bank-management">
      <div className="bank-management-header">
        <h2>📚 题库管理</h2>
        <button className="practice-close-btn" onClick={onClose}>✕ 返回</button>
      </div>

      <div className="bank-management-body">
        <div className="bank-list-panel">
          <div className="bank-list-header">
            <h3>题库列表</h3>
            <button className="bank-add-btn" onClick={() => setShowCreateBank(true)}>+ 新建题库</button>
          </div>
          <div className="bank-import-section">
            <input
              type="text"
              className="bank-import-input"
              placeholder="输入8位分享码"
              value={importCode}
              onChange={e => setImportCode(e.target.value.toUpperCase())}
              maxLength={8}
              style={{ textTransform: 'uppercase' }}
            />
            <button
              className="bank-import-btn"
              onClick={handleImportShareCode}
              disabled={importLoading}
            >
              {importLoading ? '导入中...' : '导入'}
            </button>
          </div>
          <div className="bank-list-content">
            {banks.length === 0 ? (
              <div className="bank-list-empty">
                <div className="bank-list-empty-icon">📭</div>
                <div>暂无题库</div>
                <div style={{ fontSize: 12, color: '#9ca3af' }}>点击"新建题库"创建</div>
              </div>
            ) : (
              banks.map(bank => {
                const stat = briefStats[bank.id];
                const hasStats = stat && stat.practice_count > 0;
                return (
                  <div
                    key={bank.id}
                    className={`bank-list-item ${selectedBankId === bank.id ? 'active' : ''}`}
                    onClick={() => setSelectedBankId(bank.id)}
                  >
                    <div className="bank-list-item-name">{bank.name}</div>
                    <div className="bank-list-item-meta">
                      <span className="bank-difficulty-tag" data-diff={bank.difficulty}>
                        {bank.difficulty === 'beginner' ? '初级' : bank.difficulty === 'intermediate' ? '中级' : '高级'}
                      </span>
                      <span className="bank-count-tag">{bank.question_count}题</span>
                    </div>
                    <div className="bank-list-item-stats">
                      {hasStats ? (
                        <>已练习{stat.practice_count}次 | 正确率{Math.round(stat.accuracy * 100)}%</>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>未练习</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="bank-detail-panel">
          {!selectedBank ? (
            <div className="bank-detail-empty">
              <div className="bank-detail-empty-icon">📖</div>
              <div>请从左侧选择一个题库</div>
            </div>
          ) : (
            <>
              <div className="bank-detail-header">
                <div>
                  <h3>{selectedBank.name}</h3>
                  <div className="bank-detail-meta">
                    <span className="bank-difficulty-tag" data-diff={selectedBank.difficulty}>
                      {selectedBank.difficulty === 'beginner' ? '初级' : selectedBank.difficulty === 'intermediate' ? '中级' : '高级'}
                    </span>
                    <span className="bank-count-tag">{selectedBank.question_count}题</span>
                    {selectedBank.description && (
                      <span className="bank-desc-tag">{selectedBank.description}</span>
                    )}
                  </div>
                </div>
                <div className="bank-detail-actions">
                  <button className={`bank-action-btn stats ${showStats ? 'active' : ''}`} onClick={toggleStats}>📊 统计</button>
                  <button className="bank-action-btn add" onClick={openAddQuestionForm}>+ 添加题目</button>
                  <button className="bank-action-btn export" onClick={handleExport}>📥 导出JSON</button>
                  <button className="bank-action-btn import" onClick={handleImport}>📤 导入JSON</button>
                  <button className="bank-action-btn delete" onClick={() => setConfirmDelete({ type: 'bank', id: selectedBank.id, name: selectedBank.name })}>🗑 删除题库</button>
                </div>
              </div>

              {shareCode && (
                <div className="bank-share-code-row">
                  <span className="bank-share-code-label">分享码：</span>
                  <span className="bank-share-code-value">{shareCode}</span>
                  <button className="bank-share-copy-btn" onClick={handleCopyShareCode}>复制</button>
                </div>
              )}

              {!shareCode && (
                <div className="bank-share-code-row">
                  <button className="bank-action-btn share" onClick={handleGenerateShareCode}>🔗 生成分享码</button>
                </div>
              )}

              {showStats && (
                <div className="bank-stats-panel">
                  {statsLoading ? (
                    <div className="bank-stats-loading">加载中...</div>
                  ) : !statsData || statsData.practice_count === 0 ? (
                    <div className="bank-stats-empty">
                      <div className="bank-stats-empty-icon">📊</div>
                      <div>暂无练习数据</div>
                    </div>
                  ) : (
                    <>
                      <div className="bank-stats-grid">
                        <div className="bank-stat-card">
                          <div className="bank-stat-value">{statsData.practice_count}</div>
                          <div className="bank-stat-label">练习次数</div>
                        </div>
                        <div className="bank-stat-card">
                          <div className="bank-stat-value">{Math.round(statsData.avg_accuracy * 100)}%</div>
                          <div className="bank-stat-label">平均正确率</div>
                        </div>
                        <div className="bank-stat-card">
                          <div className="bank-stat-value">{statsData.avg_time.toFixed(1)}秒</div>
                          <div className="bank-stat-label">平均用时</div>
                        </div>
                        <div className="bank-stat-card">
                          <div className="bank-stat-value">{formatDate(statsData.last_practice_time)}</div>
                          <div className="bank-stat-label">最近练习</div>
                        </div>
                      </div>

                      {statsData.hardest_question_latex && (
                        <div className="bank-stats-hardest">
                          <div className="bank-stats-section-title">🏆 最难题目</div>
                          <div className="bank-hardest-question">
                            <div className="bank-hardest-latex" dangerouslySetInnerHTML={{ __html: renderLatex(statsData.hardest_question_latex) }} />
                            <div className="bank-hardest-meta">错误 {statsData.hardest_question_error_count} 次</div>
                          </div>
                        </div>
                      )}

                      {statsData.kp_distribution.length > 0 && (
                        <div className="bank-stats-kp">
                          <div className="bank-stats-section-title">📈 按知识点分布</div>
                          <div className="bank-kp-chart">
                            {statsData.kp_distribution.map(item => {
                              const total = item.correct + item.wrong;
                              const maxTotal = Math.max(...statsData.kp_distribution.map(d => d.correct + d.wrong));
                              const correctPct = maxTotal > 0 ? (item.correct / maxTotal) * 100 : 0;
                              const wrongPct = maxTotal > 0 ? (item.wrong / maxTotal) * 100 : 0;
                              return (
                                <div key={item.kp} className="bank-kp-row">
                                  <div className="bank-kp-label">{item.kp}</div>
                                  <div className="bank-kp-bar-wrapper">
                                    <div className="bank-kp-bars">
                                      <div
                                        className="bank-kp-bar bank-kp-bar-correct"
                                        style={{ width: `${correctPct}%` }}
                                      >
                                        {item.correct > 0 && <span className="bank-kp-bar-value">{item.correct}</span>}
                                      </div>
                                      <div
                                        className="bank-kp-bar bank-kp-bar-wrong"
                                        style={{ width: `${wrongPct}%` }}
                                      >
                                        {item.wrong > 0 && <span className="bank-kp-bar-value">{item.wrong}</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="bank-kp-total">共{total}次</div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="bank-kp-legend">
                            <span className="bank-kp-legend-item">
                              <span className="bank-kp-legend-dot bank-kp-legend-correct"></span>
                              答对
                            </span>
                            <span className="bank-kp-legend-item">
                              <span className="bank-kp-legend-dot bank-kp-legend-wrong"></span>
                              答错
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div className="bank-question-list">
                {loading ? (
                  <div className="bank-detail-empty">加载中...</div>
                ) : questions.length === 0 ? (
                  <div className="bank-detail-empty">
                    <div className="bank-detail-empty-icon">📝</div>
                    <div>暂无题目</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>点击"添加题目"开始创建</div>
                  </div>
                ) : (
                  questions.map((q, idx) => {
                    let kps: KnowledgePoint[] = [];
                    try { kps = JSON.parse(q.knowledge_points); } catch { /* ignore */ }
                    return (
                      <div key={q.id} className="bank-question-item">
                        <div className="bank-question-index">{idx + 1}</div>
                        <div className="bank-question-content">
                          <div className="bank-question-latex" dangerouslySetInnerHTML={{ __html: renderLatex(q.latex) }} />
                          <div className="bank-question-meta">
                            {kps.map(kp => (
                              <span key={kp} className="practice-kp-tag">{kp}</span>
                            ))}
                            <span className="bank-time-tag">⏱ {q.time_limit}秒</span>
                          </div>
                        </div>
                        <div className="bank-question-actions">
                          <button className="bank-question-edit-btn" onClick={() => handleEditQuestion(q)}>✏️</button>
                          <button className="bank-question-delete-btn" onClick={() => setConfirmDelete({ type: 'question', id: q.id, name: `第${idx + 1}题` })}>🗑</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showCreateBank && (
        <div className="bank-modal-overlay" onClick={() => setShowCreateBank(false)}>
          <div className="bank-modal" onClick={e => e.stopPropagation()}>
            <h3>新建题库</h3>
            <div className="bank-form-group">
              <label>题库名称 <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                type="text"
                maxLength={20}
                value={bankName}
                onChange={e => setBankName(e.target.value)}
                placeholder="不超过20个字符"
              />
              <div className="bank-form-hint">{bankName.length}/20</div>
            </div>
            <div className="bank-form-group">
              <label>难度等级 <span style={{ color: '#ef4444' }}>*</span></label>
              <div className="bank-form-difficulty">
                {DIFFICULTY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`bank-diff-option ${bankDifficulty === opt.value ? 'active' : ''}`}
                    onClick={() => setBankDifficulty(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="bank-form-group">
              <label>描述（可选）</label>
              <input
                type="text"
                maxLength={100}
                value={bankDescription}
                onChange={e => setBankDescription(e.target.value)}
                placeholder="不超过100个字符"
              />
              <div className="bank-form-hint">{bankDescription.length}/100</div>
            </div>
            <div className="bank-form-actions">
              <button className="bank-form-cancel" onClick={() => setShowCreateBank(false)}>取消</button>
              <button className="bank-form-confirm" onClick={handleCreateBank}>创建</button>
            </div>
          </div>
        </div>
      )}

      {showQuestionForm && (
        <div className="bank-modal-overlay" onClick={() => { setShowQuestionForm(false); setEditingQuestion(null); }}>
          <div className="bank-modal bank-modal-wide" onClick={e => e.stopPropagation()}>
            <h3>{editingQuestion ? '编辑题目' : '添加题目'}</h3>
            <div className="bank-form-group">
              <label>LaTeX公式 <span style={{ color: '#ef4444' }}>*</span></label>
              <textarea
                value={questionForm.latex}
                onChange={e => handleLatexInput(e.target.value)}
                placeholder="输入LaTeX公式，如 x^{2}+1"
                rows={3}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
              {questionForm.latex.trim() && !latexError && (
                <div className="bank-latex-preview" dangerouslySetInnerHTML={{ __html: renderLatex(questionForm.latex) }} />
              )}
              {latexError && (
                <div className="bank-latex-error">⚠️ {latexError}</div>
              )}
            </div>
            <div className="bank-form-group">
              <label>知识点 <span style={{ color: '#ef4444' }}>*</span>（至少选择一个）</label>
              <div className="bank-form-kps">
                {ALL_KNOWLEDGE_POINTS.map(kp => (
                  <button
                    key={kp}
                    className={`bank-kp-option ${questionForm.knowledgePoints.includes(kp) ? 'active' : ''}`}
                    onClick={() => handleKpToggle(kp)}
                  >
                    {kp}
                  </button>
                ))}
              </div>
            </div>
            <div className="bank-form-group">
              <label>每题限时（秒） <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                type="number"
                min={30}
                max={300}
                value={questionForm.timeLimit}
                onChange={e => setQuestionForm(prev => ({ ...prev, timeLimit: parseInt(e.target.value) || 0 }))}
              />
              <div className="bank-form-hint">必须在30到300之间的整数</div>
            </div>
            <div className="bank-form-actions">
              <button className="bank-form-cancel" onClick={() => { setShowQuestionForm(false); setEditingQuestion(null); }}>取消</button>
              <button
                className="bank-form-confirm"
                onClick={handleSaveQuestion}
                disabled={!!latexError || !questionForm.latex.trim() || questionForm.knowledgePoints.length === 0}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="bank-modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="bank-modal" onClick={e => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p style={{ margin: '16px 0', color: '#4b5563' }}>
              确定要删除{confirmDelete.type === 'bank' ? '题库' : '题目'}「{confirmDelete.name}」吗？
              {confirmDelete.type === 'bank' && '该题库下所有题目也将被删除。'}
            </p>
            <div className="bank-form-actions">
              <button className="bank-form-cancel" onClick={() => setConfirmDelete(null)}>取消</button>
              <button className="bank-form-confirm danger" onClick={() => {
                if (confirmDelete.type === 'bank') {
                  handleDeleteBank(confirmDelete.id);
                } else {
                  handleDeleteQuestion(confirmDelete.id);
                }
              }}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuestionBankManagement;

import React, { useState, useEffect, useCallback } from 'react';
import katex from 'katex';
import { invoke } from '@tauri-apps/api/core';
import { DifficultyLevel } from '../types';
import { DIFFICULTY_LABELS, ALL_KNOWLEDGE_POINTS } from '../utils/questionBank';

interface PracticeSessionRow {
  id: string;
  difficulty: string;
  total_score: number;
  accuracy: number;
  avg_time: number;
  fastest_time: number;
  slowest_time: number;
  fastest_question: string;
  slowest_question: string;
  completed_questions: number;
  total_questions: number;
  knowledge_point_scores: string;
  created_at: string;
}

interface PracticeAnswerRow {
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

interface PracticeHistoryProps {
  onClose: () => void;
  onRepractice?: (info: { latex: string; difficulty: DifficultyLevel; mistakeId: string }) => void;
}

const PracticeHistory: React.FC<PracticeHistoryProps> = ({ onClose, onRepractice: _onRepractice }) => {
  const [sessions, setSessions] = useState<PracticeSessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<PracticeSessionRow | null>(null);
  const [answers, setAnswers] = useState<PracticeAnswerRow[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<string>('desc');

  const loadSessions = useCallback(async () => {
    try {
      const result = await invoke<PracticeSessionRow[]>('get_practice_sessions', {
        difficultyFilter: difficultyFilter === 'all' ? null : difficultyFilter,
        sortOrder,
      });
      setSessions(result);
    } catch (e) {
      console.error('Load sessions error:', e);
    }
  }, [difficultyFilter, sortOrder]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadAnswers = useCallback(async (sessionId: string) => {
    try {
      const result = await invoke<PracticeAnswerRow[]>('get_practice_answers', { sessionId });
      setAnswers(result);
    } catch (e) {
      console.error('Load answers error:', e);
    }
  }, []);

  const handleSelectSession = (session: PracticeSessionRow) => {
    setSelectedSession(session);
    loadAnswers(session.id);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await invoke('delete_practice_session', { id });
      if (selectedSession?.id === id) {
        setSelectedSession(null);
        setAnswers([]);
      }
      loadSessions();
    } catch (e) {
      console.error('Delete session error:', e);
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
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  const getKPScores = (kpJson: string): Record<string, number> => {
    try {
      return JSON.parse(kpJson);
    } catch {
      return {};
    }
  };

  if (selectedSession) {
    const kpScores = getKPScores(selectedSession.knowledge_point_scores);
    const avgScore = selectedSession.completed_questions > 0
      ? selectedSession.total_score / selectedSession.completed_questions
      : 0;

    return (
      <div className="practice-history">
        <div className="practice-history-header">
          <button className="practice-back-btn" onClick={() => setSelectedSession(null)}>← 返回列表</button>
          <h2>练习详情</h2>
          <button className="practice-close-btn" onClick={onClose}>✕ 关闭</button>
        </div>

        <div className="practice-history-detail">
          <div className="report-summary">
            <div className="report-score-card">
              <div className="report-score-value">{Math.round(avgScore)}</div>
              <div className="report-score-label">平均分</div>
            </div>
            <div className="report-stat-grid">
              <div className="report-stat">
                <div className="report-stat-value">{DIFFICULTY_LABELS[selectedSession.difficulty as DifficultyLevel] || selectedSession.difficulty}</div>
                <div className="report-stat-label">难度</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{Math.round(selectedSession.accuracy)}%</div>
                <div className="report-stat-label">正确率</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{selectedSession.avg_time.toFixed(1)}s</div>
                <div className="report-stat-label">平均用时</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{selectedSession.completed_questions}/{selectedSession.total_questions}</div>
                <div className="report-stat-label">完成题数</div>
              </div>
            </div>
          </div>

          <div className="report-radar-section">
            <h3>知识点掌握雷达图</h3>
            <div className="radar-chart-container">
              <svg viewBox="0 0 300 300" className="radar-chart">
                {(() => {
                  const cx = 150, cy = 150, maxR = 110;
                  const points = ALL_KNOWLEDGE_POINTS;
                  const n = points.length;
                  const angleStep = (2 * Math.PI) / n;

                  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1.0];
                  const gridPaths = gridLevels.map(level => {
                    const pts = points.map((_, i) => {
                      const angle = i * angleStep - Math.PI / 2;
                      return `${cx + maxR * level * Math.cos(angle)},${cy + maxR * level * Math.sin(angle)}`;
                    });
                    return pts.join(' ');
                  });

                  const dataPts = points.map((kp, i) => {
                    const angle = i * angleStep - Math.PI / 2;
                    const val = (kpScores[kp] || 0) / 100;
                    return `${cx + maxR * val * Math.cos(angle)},${cy + maxR * val * Math.sin(angle)}`;
                  });

                  const axisLines = points.map((_, i) => {
                    const angle = i * angleStep - Math.PI / 2;
                    return { x1: cx, y1: cy, x2: cx + maxR * Math.cos(angle), y2: cy + maxR * Math.sin(angle) };
                  });

                  const labels = points.map((kp, i) => {
                    const angle = i * angleStep - Math.PI / 2;
                    const labelR = maxR + 25;
                    return { x: cx + labelR * Math.cos(angle), y: cy + labelR * Math.sin(angle), label: kp };
                  });

                  return (
                    <>
                      {gridPaths.map((path, i) => (
                        <polygon key={`grid-${i}`} points={path} fill="none" stroke="#e5e7eb" strokeWidth="1" />
                      ))}
                      {axisLines.map((line, i) => (
                        <line key={`axis-${i}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#d1d5db" strokeWidth="1" />
                      ))}
                      <polygon points={dataPts.join(' ')} fill="rgba(59,130,246,0.2)" stroke="#3b82f6" strokeWidth="2" />
                      {dataPts.map((pt, i) => {
                        const [x, y] = pt.split(',').map(Number);
                        return <circle key={`dot-${i}`} cx={x} cy={y} r="4" fill="#3b82f6" />;
                      })}
                      {labels.map((l, i) => (
                        <text key={`label-${i}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#374151" fontWeight="500">{l.label}</text>
                      ))}
                    </>
                  );
                })()}
              </svg>
            </div>
          </div>

          <div className="report-detail-list">
            <h3>答题详情</h3>
            {answers.map((answer, idx) => (
              <div key={answer.id} className={`report-detail-item ${answer.score >= 60 ? 'correct' : 'wrong'}`}>
                <div className="report-detail-header">
                  <span className="report-detail-index">第{idx + 1}题</span>
                  <span className={`report-detail-score ${answer.score >= 100 ? 'perfect' : answer.score >= 60 ? 'pass' : 'fail'}`}>
                    {Math.round(answer.score)}分
                  </span>
                  <span className="report-detail-time">{answer.time_spent.toFixed(1)}s</span>
                </div>
                <div className="report-detail-formulas">
                  <div className="report-detail-target">
                    <span className="report-detail-label">目标：</span>
                    <span dangerouslySetInnerHTML={{ __html: renderLatex(answer.question_latex) }} />
                  </div>
                  <div className="report-detail-recognized">
                    <span className="report-detail-label">识别：</span>
                    {answer.recognized_latex ? (
                      <span dangerouslySetInnerHTML={{ __html: renderLatex(answer.recognized_latex) }} />
                    ) : (
                      <span className="report-detail-empty">未识别</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="practice-history">
      <div className="practice-history-header">
        <button className="practice-back-btn" onClick={onClose}>← 返回</button>
        <h2>📊 练习历史</h2>
        <div style={{ width: 80 }} />
      </div>

      <div className="practice-history-filters">
        <select
          className="practice-filter-select"
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value)}
        >
          <option value="all">全部难度</option>
          <option value="beginner">初级</option>
          <option value="intermediate">中级</option>
          <option value="advanced">高级</option>
        </select>
        <select
          className="practice-filter-select"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        >
          <option value="desc">日期降序</option>
          <option value="asc">日期升序</option>
        </select>
      </div>

      <div className="practice-history-list">
        {sessions.length === 0 ? (
          <div className="practice-history-empty">暂无练习记录</div>
        ) : (
          sessions.map(session => {
            const avgScore = session.completed_questions > 0
              ? session.total_score / session.completed_questions
              : 0;
            return (
              <div key={session.id} className="practice-history-item" onClick={() => handleSelectSession(session)}>
                <div className="practice-history-item-header">
                  <span className="practice-history-date">{formatDate(session.created_at)}</span>
                  <span className={`practice-history-difficulty ${session.difficulty}`}>
                    {DIFFICULTY_LABELS[session.difficulty as DifficultyLevel] || session.difficulty}
                  </span>
                </div>
                <div className="practice-history-item-stats">
                  <span>平均分: <strong>{Math.round(avgScore)}</strong></span>
                  <span>正确率: <strong>{Math.round(session.accuracy)}%</strong></span>
                  <span>完成: <strong>{session.completed_questions}/{session.total_questions}</strong></span>
                </div>
                <button
                  className="practice-history-delete"
                  onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                >
                  🗑️
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default PracticeHistory;

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
  difficulty_history: string;
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

type HistoryTab = 'list' | 'curve';

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: '#22c55e',
  intermediate: '#3b82f6',
  advanced: '#a855f7',
  adaptive: '#f97316',
};

const PracticeHistory: React.FC<PracticeHistoryProps> = ({ onClose, onRepractice: _onRepractice }) => {
  const [sessions, setSessions] = useState<PracticeSessionRow[]>([]);
  const [selectedSession, setSelectedSession] = useState<PracticeSessionRow | null>(null);
  const [answers, setAnswers] = useState<PracticeAnswerRow[]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<string>('desc');
  const [activeTab, setActiveTab] = useState<HistoryTab>('list');

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

  const renderScoreTrendChart = () => {
    if (sessions.length === 0) return null;
    const sortedSessions = [...sessions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const padding = { left: 50, right: 30, top: 45, bottom: 40 };
    const svgW = 700;
    const svgH = 300;
    const w = svgW - padding.left - padding.right;
    const h = svgH - padding.top - padding.bottom;
    const n = sortedSessions.length;
    const xStep = w / Math.max(n - 1, 1);
    const maxScore = 2000;

    const yTicks = [0, 400, 800, 1200, 1600, 2000];

    const gridLines = yTicks.map(t => {
      const y = padding.top + h - (t / maxScore) * h;
      return (
        <line key={`grid-${t}`} x1={padding.left} y1={y} x2={svgW - padding.right} y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
      );
    });

    const yLabels = yTicks.map(t => {
      const y = padding.top + h - (t / maxScore) * h;
      return (
        <text key={`ylabel-${t}`} x={padding.left - 10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#9ca3af">{t}</text>
      );
    });

    const xLabels = [];
    const step = Math.max(1, Math.floor(n / 10));
    for (let i = 0; i < n; i += step) {
      const x = padding.left + (n === 1 ? w / 2 : i * xStep);
      xLabels.push(
        <text key={`xlabel-${i}`} x={x} y={svgH - padding.bottom + 18} textAnchor="middle" fontSize="10" fill="#9ca3af">#{i + 1}</text>
      );
    }

    const legendItems = [
      { label: '初级', color: DIFFICULTY_COLORS.beginner },
      { label: '中级', color: DIFFICULTY_COLORS.intermediate },
      { label: '高级', color: DIFFICULTY_COLORS.advanced },
      { label: '自适应', color: DIFFICULTY_COLORS.adaptive },
    ];

    const points = sortedSessions.map((s, i) => {
      const x = padding.left + (n === 1 ? w / 2 : i * xStep);
      const y = padding.top + h - (Math.min(s.total_score, maxScore) / maxScore) * h;
      const color = DIFFICULTY_COLORS[s.difficulty] || '#6b7280';
      return { x, y, color, id: s.id };
    });

    const lineSegments: React.ReactNode[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      lineSegments.push(
        <line
          key={`line-${i}`}
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.6"
        />
      );
    }

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH + 30}`} className="line-chart-svg">
        {gridLines}
        {yLabels}
        {xLabels}
        <text x={padding.left - 40} y={padding.top - 12} fontSize="11" fill="#9ca3af">总分</text>
        <text x={svgW - padding.right} y={svgH - padding.bottom + 18} textAnchor="end" fontSize="11" fill="#9ca3af">练习次数</text>
        {lineSegments}
        {points.map((p) => (
          <g key={`pt-${p.id}`}>
            <circle cx={p.x} cy={p.y} r="7" fill="#fff" stroke={p.color} strokeWidth="2.5" />
            <circle cx={p.x} cy={p.y} r="3.5" fill={p.color} />
          </g>
        ))}
        <g transform={`translate(${padding.left + 10}, ${svgH + 8})`}>
          {legendItems.map((item, i) => (
            <g key={item.label} transform={`translate(${i * 80}, 0)`}>
              <circle cx="0" cy="0" r="5" fill={item.color} />
              <text x="10" y="4" fontSize="11" fill="#6b7280">{item.label}</text>
            </g>
          ))}
        </g>
      </svg>
    );
  };

  const renderRadarComparison = () => {
    if (sessions.length === 0) return null;
    const sortedSessions = [...sessions].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const recentSessions = sortedSessions.slice(-5);
    if (recentSessions.length < 2) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
          需要至少2次练习才能进行对比
        </div>
      );
    }

    const earliest = recentSessions[0];
    const latest = recentSessions[recentSessions.length - 1];
    const earliestKP = getKPScores(earliest.knowledge_point_scores);
    const latestKP = getKPScores(latest.knowledge_point_scores);

    const cx = 170, cy = 160, maxR = 110;
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

    const earliestPts = points.map((kp, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const val = (earliestKP[kp] || 0) / 100;
      return `${cx + maxR * val * Math.cos(angle)},${cy + maxR * val * Math.sin(angle)}`;
    });

    const latestPts = points.map((kp, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const val = (latestKP[kp] || 0) / 100;
      return `${cx + maxR * val * Math.cos(angle)},${cy + maxR * val * Math.sin(angle)}`;
    });

    const axisLines = points.map((_, i) => {
      const angle = i * angleStep - Math.PI / 2;
      return { x1: cx, y1: cy, x2: cx + maxR * Math.cos(angle), y2: cy + maxR * Math.sin(angle) };
    });

    const labels = points.map((kp, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const labelR = maxR + 22;
      return { x: cx + labelR * Math.cos(angle), y: cy + labelR * Math.sin(angle), label: kp };
    });

    const earliestDate = new Date(earliest.created_at).toLocaleDateString('zh-CN');
    const latestDate = new Date(latest.created_at).toLocaleDateString('zh-CN');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <svg viewBox="0 0 340 350" className="radar-chart" style={{ width: 340, height: 350 }}>
          {gridPaths.map((path, i) => (
            <polygon key={`grid-${i}`} points={path} fill="none" stroke="#e5e7eb" strokeWidth="1" />
          ))}
          {axisLines.map((line, i) => (
            <line key={`axis-${i}`} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="#d1d5db" strokeWidth="1" />
          ))}
          <polygon points={earliestPts.join(' ')} fill="rgba(156,163,175,0.15)" stroke="#9ca3af" strokeWidth="2" strokeDasharray="5 3" />
          <polygon points={latestPts.join(' ')} fill="rgba(239,68,68,0.2)" stroke="#ef4444" strokeWidth="2" />
          {labels.map((l, i) => (
            <text key={`label-${i}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#374151" fontWeight="500">{l.label}</text>
          ))}
        </svg>
        <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 18, height: 2, background: '#9ca3af', borderTop: '2px dashed #9ca3af' }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>最早 ({earliestDate})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 18, height: 2, background: '#ef4444' }} />
            <span style={{ fontSize: 12, color: '#6b7280' }}>最近 ({latestDate})</span>
          </div>
        </div>
      </div>
    );
  };

  const getOverallStats = () => {
    const totalSessions = sessions.length;
    let totalTimeSeconds = 0;
    let totalAccuracySum = 0;
    const kpScores: Record<string, number[]> = {};
    ALL_KNOWLEDGE_POINTS.forEach(kp => { kpScores[kp] = []; });

    sessions.forEach(s => {
      totalTimeSeconds += s.avg_time * s.completed_questions;
      totalAccuracySum += s.accuracy;
      const kp = getKPScores(s.knowledge_point_scores);
      ALL_KNOWLEDGE_POINTS.forEach(kn => {
        if (kp[kn] !== undefined) {
          kpScores[kn].push(kp[kn]);
        }
      });
    });

    const totalTimeMinutes = totalTimeSeconds / 60;
    const avgAccuracy = sessions.length > 0 ? totalAccuracySum / sessions.length : 0;

    let bestKP: string | null = null;
    let worstKP: string | null = null;
    let bestAvg = -1;
    let worstAvg = 101;

    ALL_KNOWLEDGE_POINTS.forEach(kp => {
      const arr = kpScores[kp];
      if (arr.length > 0) {
        const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
        if (avg > bestAvg) { bestAvg = avg; bestKP = kp; }
        if (avg < worstAvg) { worstAvg = avg; worstKP = kp; }
      }
    });

    return { totalSessions, totalTimeMinutes, avgAccuracy, bestKP, worstKP };
  };

  const renderLearningCurve = () => {
    const stats = getOverallStats();
    return (
      <div className="learning-curve">
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
            <option value="adaptive">自适应</option>
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

        <div className="practice-history-detail">
          <div className="stats-summary">
            <div className="stat-card">
              <div className="stat-card-value">{stats.totalSessions}</div>
              <div className="stat-card-label">累计练习次数</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value">{stats.totalTimeMinutes.toFixed(1)}</div>
              <div className="stat-card-label">累计时长（分钟）</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-value">{Math.round(stats.avgAccuracy)}%</div>
              <div className="stat-card-label">平均正确率</div>
            </div>
            <div className="stat-card best">
              <div className="stat-card-value">{stats.bestKP || '-'}</div>
              <div className="stat-card-label">最擅长知识点</div>
            </div>
            <div className="stat-card worst">
              <div className="stat-card-value">{stats.worstKP || '-'}</div>
              <div className="stat-card-label">最薄弱知识点</div>
            </div>
          </div>

          <div className="report-radar-section">
            <h3>📈 得分趋势图</h3>
            <div className="radar-chart-container">
              {sessions.length > 0 ? renderScoreTrendChart() : (
                <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>暂无练习记录</div>
              )}
            </div>
          </div>

          <div className="report-radar-section">
            <h3>🎯 知识点雷达图对比 <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>（最近5次中最早 vs 最近）</span></h3>
            <div className="radar-chart-container">
              {sessions.length > 0 ? renderRadarComparison() : (
                <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>暂无练习记录</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (selectedSession) {
    const kpScores = getKPScores(selectedSession.knowledge_point_scores);
    const avgScore = selectedSession.completed_questions > 0
      ? selectedSession.total_score / selectedSession.completed_questions
      : 0;

    const diffLabel = DIFFICULTY_LABELS[selectedSession.difficulty as DifficultyLevel] ||
      (selectedSession.difficulty === 'adaptive' ? '自适应' : selectedSession.difficulty);

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
                <div className="report-stat-value">{diffLabel}</div>
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

  const currentTab = activeTab as string;

  if (activeTab === 'curve') {
    return (
      <div className="practice-history">
        <div className="practice-history-header">
          <button className="practice-back-btn" onClick={onClose}>← 返回</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <h2>📊 练习数据</h2>
            <div className="history-tabs">
              <button
                className={`history-tab ${currentTab === 'list' ? 'active' : ''}`}
                onClick={() => setActiveTab('list')}
              >
                练习历史
              </button>
              <button
                className={`history-tab ${currentTab === 'curve' ? 'active' : ''}`}
                onClick={() => setActiveTab('curve')}
              >
                学习曲线
              </button>
            </div>
          </div>
          <div style={{ width: 80 }} />
        </div>
        {renderLearningCurve()}
      </div>
    );
  }

  return (
    <div className="practice-history">
      <div className="practice-history-header">
        <button className="practice-back-btn" onClick={onClose}>← 返回</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h2>📊 练习数据</h2>
          <div className="history-tabs">
            <button
              className={`history-tab ${currentTab === 'list' ? 'active' : ''}`}
              onClick={() => setActiveTab('list')}
            >
              练习历史
            </button>
            <button
              className={`history-tab ${currentTab === 'curve' ? 'active' : ''}`}
              onClick={() => setActiveTab('curve')}
            >
              学习曲线
            </button>
          </div>
        </div>
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
          <option value="adaptive">自适应</option>
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
            const diffKey = session.difficulty;
            const diffClass = diffKey === 'adaptive' ? 'adaptive' : diffKey;
            return (
              <div key={session.id} className="practice-history-item" onClick={() => handleSelectSession(session)}>
                <div className="practice-history-item-header">
                  <span className="practice-history-date">{formatDate(session.created_at)}</span>
                  <span className={`practice-history-difficulty ${diffClass}`}>
                    {DIFFICULTY_LABELS[session.difficulty as DifficultyLevel] || (session.difficulty === 'adaptive' ? '自适应' : session.difficulty)}
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import katex from 'katex';
import { invoke } from '@tauri-apps/api/core';
import Canvas from './Canvas';
import { Stroke, DifficultyLevel, PracticeQuestion, KnowledgePoint } from '../types';
import { processStrokes } from '../utils/preprocessing';
import { recognizeStrokes } from '../utils/recognizer';
import { buildSyntaxTree } from '../utils/structure';
import { generateLatex } from '../utils/latexGenerator';
import { compareLatex } from '../utils/latexComparator';
import { getQuestions, DIFFICULTY_LABELS, DIFFICULTY_TIME_LIMITS, ALL_KNOWLEDGE_POINTS } from '../utils/questionBank';

interface PracticeModeProps {
  onClose: () => void;
  onViewHistory: () => void;
  onViewMistakes: () => void;
  singleQuestion?: string | null;
}

interface AnswerRecord {
  questionLatex: string;
  recognizedLatex: string;
  score: number;
  timeSpent: number;
  knowledgePoints: KnowledgePoint[];
}

const PracticeMode: React.FC<PracticeModeProps> = ({ onClose, onViewHistory, onViewMistakes, singleQuestion }) => {
  const [phase, setPhase] = useState<'setup' | 'practice' | 'report'>('setup');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedStrokes, setSelectedStrokes] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_sessionId, setSessionId] = useState('');
  const timerRef = useRef<number | null>(null);

  const currentQuestion = questions[currentIndex] || null;
  const timeLimit = currentQuestion ? DIFFICULTY_TIME_LIMITS[currentQuestion.difficulty] : 0;

  const startPractice = useCallback(() => {
    let qs: PracticeQuestion[];
    if (singleQuestion) {
      qs = [{
        id: `q_single_0_${Date.now()}`,
        latex: singleQuestion,
        difficulty: 'beginner' as DifficultyLevel,
        knowledgePoints: [] as KnowledgePoint[],
      }];
    } else {
      qs = getQuestions(difficulty);
    }
    setQuestions(qs);
    setCurrentIndex(0);
    setAnswers([]);
    setStrokes([]);
    setSelectedStrokes(new Set());
    setPhase('practice');
    setTimeLeft(DIFFICULTY_TIME_LIMITS[qs[0].difficulty]);
    setStartTime(Date.now());
  }, [difficulty, singleQuestion]);

  useEffect(() => {
    if (singleQuestion) {
      startPractice();
    }
  }, [singleQuestion]);

  useEffect(() => {
    if (phase !== 'practice' || !currentQuestion) return;

    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, currentIndex]);

  const handleTimeout = useCallback(() => {
    const q = questions[currentIndex];
    if (!q) return;

    const answer: AnswerRecord = {
      questionLatex: q.latex,
      recognizedLatex: '',
      score: 0,
      timeSpent: DIFFICULTY_TIME_LIMITS[q.difficulty],
      knowledgePoints: q.knowledgePoints,
    };

    setAnswers(prev => [...prev, answer]);
    moveToNext();
  }, [currentIndex, questions]);

  const moveToNext = useCallback(() => {
    setStrokes([]);
    setSelectedStrokes(new Set());

    if (currentIndex + 1 >= questions.length) {
      setPhase('report');
      return;
    }

    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    setTimeLeft(DIFFICULTY_TIME_LIMITS[questions[nextIndex].difficulty]);
    setStartTime(Date.now());
  }, [currentIndex, questions]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || strokes.length === 0) return;
    setIsSubmitting(true);

    if (timerRef.current) clearInterval(timerRef.current);

    const timeSpent = (Date.now() - startTime) / 1000;

    try {
      const processedStrokes = processStrokes(strokes);
      const recognizedSymbols = recognizeStrokes(processedStrokes);
      const tree = buildSyntaxTree(recognizedSymbols);
      const recognizedLatex = generateLatex(tree);

      const q = questions[currentIndex];
      const comparison = compareLatex(q.latex, recognizedLatex);

      const answer: AnswerRecord = {
        questionLatex: q.latex,
        recognizedLatex,
        score: comparison.score,
        timeSpent,
        knowledgePoints: q.knowledgePoints,
      };

      setAnswers(prev => [...prev, answer]);
      moveToNext();
    } catch (e) {
      console.error('Recognition error:', e);
      const q = questions[currentIndex];
      const answer: AnswerRecord = {
        questionLatex: q.latex,
        recognizedLatex: '',
        score: 0,
        timeSpent,
        knowledgePoints: q.knowledgePoints,
      };
      setAnswers(prev => [...prev, answer]);
      moveToNext();
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, strokes, startTime, questions, currentIndex, moveToNext]);

  const handleSaveSession = useCallback(async () => {
    if (answers.length === 0) return;

    const totalScore = answers.reduce((sum, a) => sum + a.score, 0);
    const accuracy = answers.filter(a => a.score >= 60).length / answers.length * 100;
    const avgTime = answers.reduce((sum, a) => sum + a.timeSpent, 0) / answers.length;
    const times = answers.map(a => a.timeSpent);
    const fastestTime = Math.min(...times);
    const slowestTime = Math.max(...times);
    const fastestIdx = times.indexOf(fastestTime);
    const slowestIdx = times.indexOf(slowestTime);
    const fastestQuestion = answers[fastestIdx]?.questionLatex || '';
    const slowestQuestion = answers[slowestIdx]?.questionLatex || '';

    const kpScores: Record<string, number[]> = {};
    ALL_KNOWLEDGE_POINTS.forEach(kp => { kpScores[kp] = []; });
    answers.forEach(a => {
      a.knowledgePoints.forEach(kp => {
        if (kpScores[kp]) {
          kpScores[kp].push(a.score);
        }
      });
    });

    const knowledgePointScores: Record<string, number> = {};
    ALL_KNOWLEDGE_POINTS.forEach(kp => {
      const scores = kpScores[kp];
      knowledgePointScores[kp] = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
    });

    try {
      const sid = await invoke<string>('save_practice_session', {
        difficulty: singleQuestion ? 'beginner' : difficulty,
        totalScore,
        accuracy,
        avgTime,
        fastestTime,
        slowestTime,
        fastestQuestion,
        slowestQuestion,
        completedQuestions: answers.length,
        totalQuestions: questions.length,
        knowledgePointScores: JSON.stringify(knowledgePointScores),
      });
      setSessionId(sid);

      for (const answer of answers) {
        await invoke('save_practice_answer', {
          sessionId: sid,
          questionLatex: answer.questionLatex,
          recognizedLatex: answer.recognizedLatex,
          score: answer.score,
          timeSpent: answer.timeSpent,
          knowledgePoints: JSON.stringify(answer.knowledgePoints),
          isMistake: answer.score < 60 ? 1 : 0,
        });
      }
    } catch (e) {
      console.error('Save session error:', e);
    }
  }, [answers, difficulty, questions.length, singleQuestion]);

  useEffect(() => {
    if (phase === 'report') {
      handleSaveSession();
    }
  }, [phase]);

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

  const totalScore = answers.reduce((sum, a) => sum + a.score, 0);
  const accuracy = answers.length > 0 ? answers.filter(a => a.score >= 60).length / answers.length * 100 : 0;
  const avgTime = answers.length > 0 ? answers.reduce((sum, a) => sum + a.timeSpent, 0) / answers.length : 0;
  const times = answers.map(a => a.timeSpent);
  const fastestTime = times.length > 0 ? Math.min(...times) : 0;
  const slowestTime = times.length > 0 ? Math.max(...times) : 0;

  const kpScores: Record<string, number[]> = {};
  ALL_KNOWLEDGE_POINTS.forEach(kp => { kpScores[kp] = []; });
  answers.forEach(a => {
    a.knowledgePoints.forEach(kp => {
      if (kpScores[kp]) kpScores[kp].push(a.score);
    });
  });
  const kpAverages: Record<string, number> = {};
  ALL_KNOWLEDGE_POINTS.forEach(kp => {
    const scores = kpScores[kp];
    kpAverages[kp] = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  });

  if (phase === 'setup') {
    return (
      <div className="practice-setup">
        <div className="practice-setup-header">
          <h2>📝 公式听写练习</h2>
          <button className="practice-close-btn" onClick={onClose}>✕ 返回</button>
        </div>

        <div className="practice-setup-content">
          <p className="practice-setup-desc">选择难度等级开始练习,系统会随机抽取题目,请在限定时间内手写出对应的数学公式。</p>

          <div className="difficulty-options">
            {(['beginner', 'intermediate', 'advanced'] as DifficultyLevel[]).map(level => (
              <button
                key={level}
                className={`difficulty-option ${difficulty === level ? 'active' : ''}`}
                onClick={() => setDifficulty(level)}
              >
                <div className="difficulty-label">{DIFFICULTY_LABELS[level]}</div>
                <div className="difficulty-time">每题 {DIFFICULTY_TIME_LIMITS[level]}秒</div>
                <div className="difficulty-desc">
                  {level === 'beginner' && '单个符号或简单表达式'}
                  {level === 'intermediate' && '包含分数或根号的表达式'}
                  {level === 'advanced' && '包含积分或矩阵的复合表达式'}
                </div>
              </button>
            ))}
          </div>

          <button className="practice-start-btn" onClick={startPractice}>
            🚀 开始练习
          </button>

          <div className="practice-setup-actions">
            <button className="practice-action-btn" onClick={onViewHistory}>📊 练习历史</button>
            <button className="practice-action-btn" onClick={onViewMistakes}>📖 错题本</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'report') {
    return (
      <div className="practice-report">
        <div className="practice-report-header">
          <h2>📊 练习报告</h2>
          <button className="practice-close-btn" onClick={onClose}>✕ 返回主页</button>
        </div>

        <div className="practice-report-content">
          <div className="report-summary">
            <div className="report-score-card">
              <div className="report-score-value">{Math.round(totalScore / Math.max(answers.length, 1))}</div>
              <div className="report-score-label">平均分</div>
            </div>
            <div className="report-stat-grid">
              <div className="report-stat">
                <div className="report-stat-value">{Math.round(accuracy)}%</div>
                <div className="report-stat-label">正确率</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{avgTime.toFixed(1)}s</div>
                <div className="report-stat-label">平均用时</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{fastestTime.toFixed(1)}s</div>
                <div className="report-stat-label">最快一题</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{slowestTime.toFixed(1)}s</div>
                <div className="report-stat-label">最慢一题</div>
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
                    const val = kpAverages[kp] / 100;
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
              <div key={idx} className={`report-detail-item ${answer.score >= 60 ? 'correct' : 'wrong'}`}>
                <div className="report-detail-header">
                  <span className="report-detail-index">第{idx + 1}题</span>
                  <span className={`report-detail-score ${answer.score >= 100 ? 'perfect' : answer.score >= 60 ? 'pass' : 'fail'}`}>
                    {Math.round(answer.score)}分
                  </span>
                  <span className="report-detail-time">{answer.timeSpent.toFixed(1)}s</span>
                </div>
                <div className="report-detail-formulas">
                  <div className="report-detail-target">
                    <span className="report-detail-label">目标：</span>
                    <span dangerouslySetInnerHTML={{ __html: renderLatex(answer.questionLatex) }} />
                  </div>
                  <div className="report-detail-recognized">
                    <span className="report-detail-label">识别：</span>
                    {answer.recognizedLatex ? (
                      <span dangerouslySetInnerHTML={{ __html: renderLatex(answer.recognizedLatex) }} />
                    ) : (
                      <span className="report-detail-empty">未识别</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="report-actions">
            <button className="practice-action-btn primary" onClick={() => { setPhase('setup'); setAnswers([]); }}>
              🔄 再来一次
            </button>
            <button className="practice-action-btn" onClick={onViewHistory}>📊 查看历史</button>
            <button className="practice-action-btn" onClick={onViewMistakes}>📖 错题本</button>
            <button className="practice-action-btn" onClick={onClose}>🏠 返回主页</button>
          </div>
        </div>
      </div>
    );
  }

  const progress = timeLimit > 0 ? (timeLeft / timeLimit) * 100 : 0;
  const isUrgent = timeLeft <= 10;

  return (
    <div className="practice-mode">
      <div className="practice-header">
        <div className="practice-header-left">
          <button className="practice-back-btn" onClick={() => {
            if (answers.length > 0) {
              setPhase('report');
            } else {
              onClose();
            }
          }}>← 退出</button>
          <span className="practice-difficulty-tag">
            {DIFFICULTY_LABELS[currentQuestion?.difficulty || difficulty]}
          </span>
          <span className="practice-progress-text">
            {currentIndex + 1} / {questions.length}
          </span>
        </div>
        <div className="practice-timer-container">
          <div className={`practice-timer-bar ${isUrgent ? 'urgent' : ''}`} style={{ width: `${progress}%` }} />
          <span className={`practice-timer-text ${isUrgent ? 'urgent' : ''}`}>
            {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
          </span>
        </div>
      </div>

      <div className="practice-body">
        <div className="practice-question-panel">
          <div className="practice-question-label">请书写以下公式：</div>
          <div className="practice-question-display" dangerouslySetInnerHTML={{ __html: renderLatex(currentQuestion?.latex || '') }} />
          <div className="practice-question-kps">
            {currentQuestion?.knowledgePoints.map(kp => (
              <span key={kp} className="practice-kp-tag">{kp}</span>
            ))}
          </div>
        </div>

        <div className="practice-canvas-panel">
          <Canvas
            strokes={strokes}
            onStrokesChange={setStrokes}
            selectedStrokes={selectedStrokes}
            onSelectionChange={setSelectedStrokes}
          />
          <div className="practice-submit-area">
            <button
              className="practice-submit-btn"
              onClick={handleSubmit}
              disabled={strokes.length === 0 || isSubmitting}
            >
              {isSubmitting ? '识别中...' : '✅ 提交'}
            </button>
            {answers.length > 0 && (
              <div className="practice-last-result">
                上一题：{Math.round(answers[answers.length - 1].score)}分
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PracticeMode;

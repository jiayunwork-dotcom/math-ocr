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

interface RepracticeInfo {
  latex: string;
  difficulty: DifficultyLevel;
  mistakeId: string;
}

interface PracticeModeProps {
  onClose: () => void;
  onViewHistory: () => void;
  onViewMistakes: () => void;
  repractice?: RepracticeInfo | null;
}

interface AnswerRecord {
  questionLatex: string;
  recognizedLatex: string;
  score: number;
  timeSpent: number;
  knowledgePoints: KnowledgePoint[];
}

const PracticeMode: React.FC<PracticeModeProps> = ({ onClose, onViewHistory, onViewMistakes, repractice }) => {
  const [phase, setPhase] = useState<'setup' | 'practice' | 'report'>('setup');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedStrokes, setSelectedStrokes] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_sessionId, setSessionId] = useState('');

  const currentQuestionRef = useRef<PracticeQuestion | null>(null);
  const startTimeRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const timedOutRef = useRef(false);

  const currentQuestion = questions[currentIndex] || null;
  currentQuestionRef.current = currentQuestion;
  const timeLimit = currentQuestion ? DIFFICULTY_TIME_LIMITS[currentQuestion.difficulty] : 0;

  const startPractice = useCallback(() => {
    let qs: PracticeQuestion[];
    if (repractice) {
      qs = [{
        id: `q_single_0_${Date.now()}`,
        latex: repractice.latex,
        difficulty: repractice.difficulty,
        knowledgePoints: detectKnowledgePoints(repractice.latex),
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
    timedOutRef.current = false;
    setTimeLeft(DIFFICULTY_TIME_LIMITS[qs[0].difficulty]);
    const now = Date.now();
    startTimeRef.current = now;
  }, [difficulty, repractice]);

  useEffect(() => {
    if (repractice) {
      startPractice();
    }
  }, [repractice]);

  useEffect(() => {
    if (phase !== 'practice' || !currentQuestion) return;

    timerRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, currentIndex]);

  useEffect(() => {
    if (phase !== 'practice' || timeLeft !== 0 || timedOutRef.current) return;

    timedOutRef.current = true;

    const q = currentQuestionRef.current;
    if (!q) return;

    if (timerRef.current) clearInterval(timerRef.current);

    const answer: AnswerRecord = {
      questionLatex: q.latex,
      recognizedLatex: '',
      score: 0,
      timeSpent: DIFFICULTY_TIME_LIMITS[q.difficulty],
      knowledgePoints: q.knowledgePoints,
    };

    setAnswers(prev => [...prev, answer]);

    setStrokes([]);
    setSelectedStrokes(new Set());

    const idx = questions.indexOf(q);
    if (idx + 1 >= questions.length) {
      setPhase('report');
      return;
    }

    const nextIndex = idx + 1;
    const nextQ = questions[nextIndex];
    setCurrentIndex(nextIndex);
    setTimeLeft(DIFFICULTY_TIME_LIMITS[nextQ.difficulty]);
    startTimeRef.current = Date.now();
    timedOutRef.current = false;
  }, [timeLeft, phase, questions]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || strokes.length === 0) return;
    setIsSubmitting(true);

    if (timerRef.current) clearInterval(timerRef.current);

    const q = currentQuestionRef.current;
    if (!q) {
      setIsSubmitting(false);
      return;
    }

    const timeSpent = (Date.now() - startTimeRef.current) / 1000;

    try {
      const processedStrokes = processStrokes(strokes);
      const recognizedSymbols = recognizeStrokes(processedStrokes);
      const tree = buildSyntaxTree(recognizedSymbols);
      const recognizedLatex = generateLatex(tree);

      const comparison = compareLatex(q.latex, recognizedLatex);

      const answer: AnswerRecord = {
        questionLatex: q.latex,
        recognizedLatex,
        score: comparison.score,
        timeSpent,
        knowledgePoints: q.knowledgePoints,
      };

      setAnswers(prev => [...prev, answer]);

      setStrokes([]);
      setSelectedStrokes(new Set());

      const idx = questions.indexOf(q);
      if (idx + 1 >= questions.length) {
        setPhase('report');
        return;
      }

      const nextIndex = idx + 1;
      const nextQ = questions[nextIndex];
      setCurrentIndex(nextIndex);
      setTimeLeft(DIFFICULTY_TIME_LIMITS[nextQ.difficulty]);
      startTimeRef.current = Date.now();
      timedOutRef.current = false;
    } catch (e) {
      console.error('Recognition error:', e);
      const answer: AnswerRecord = {
        questionLatex: q.latex,
        recognizedLatex: '',
        score: 0,
        timeSpent,
        knowledgePoints: q.knowledgePoints,
      };
      setAnswers(prev => [...prev, answer]);

      setStrokes([]);
      setSelectedStrokes(new Set());

      const idx2 = questions.indexOf(q);
      if (idx2 + 1 >= questions.length) {
        setPhase('report');
        return;
      }

      const nextIndex2 = idx2 + 1;
      const nextQ2 = questions[nextIndex2];
      setCurrentIndex(nextIndex2);
      setTimeLeft(DIFFICULTY_TIME_LIMITS[nextQ2.difficulty]);
      startTimeRef.current = Date.now();
      timedOutRef.current = false;
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, strokes, questions]);

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
        difficulty: repractice ? repractice.difficulty : difficulty,
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

      if (repractice && answers.length === 1 && answers[0].score >= 60) {
        try {
          await invoke('remove_mistake', { id: repractice.mistakeId });
        } catch (e) {
          console.error('Remove mistake after re-practice error:', e);
        }
      }
    } catch (e) {
      console.error('Save session error:', e);
    }
  }, [answers, difficulty, questions.length, repractice]);

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

function detectKnowledgePoints(latex: string): KnowledgePoint[] {
  const points: KnowledgePoint[] = [];
  if (latex.includes('^') || latex.includes('^{')) points.push('指数');
  if (latex.includes('\\frac')) points.push('分数');
  if (latex.includes('\\sqrt')) points.push('根号');
  if (latex.includes('\\int')) points.push('积分');
  if (latex.includes('pmatrix') || latex.includes('vmatrix') || latex.includes('bmatrix')) points.push('矩阵');
  if (latex.includes('\\left(') || latex.includes('\\right)') || latex.includes('\\left[') || latex.includes('\\right]') || /[()\[\]]/.test(latex)) points.push('括号');
  return points.length > 0 ? points : ['指数'];
}

export default PracticeMode;

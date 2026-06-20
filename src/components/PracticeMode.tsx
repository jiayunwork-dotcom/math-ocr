import React, { useState, useEffect, useCallback, useRef } from 'react';
import katex from 'katex';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import Canvas from './Canvas';
import { Stroke, DifficultyLevel, PracticeQuestion, KnowledgePoint, PracticeModeType, DIFFICULTY_RANK, RANK_TO_DIFFICULTY } from '../types';
import { processStrokes } from '../utils/preprocessing';
import { recognizeStrokes } from '../utils/recognizer';
import { buildSyntaxTree } from '../utils/structure';
import { generateLatex } from '../utils/latexGenerator';
import { compareLatex } from '../utils/latexComparator';
import { getQuestions, getSingleQuestionByDifficulty, DIFFICULTY_LABELS, DIFFICULTY_TIME_LIMITS, ALL_KNOWLEDGE_POINTS } from '../utils/questionBank';

interface RepracticeInfo {
  latex: string;
  difficulty: DifficultyLevel;
  mistakeId: string;
}

interface PracticeModeProps {
  onClose: () => void;
  onViewHistory: () => void;
  onViewMistakes: (knowledgePointFilter?: KnowledgePoint | null) => void;
  repractice?: RepracticeInfo | null;
}

interface AnswerRecord {
  questionLatex: string;
  recognizedLatex: string;
  score: number;
  timeSpent: number;
  knowledgePoints: KnowledgePoint[];
  difficulty: DifficultyLevel;
}

const ADAPTIVE_TOTAL_QUESTIONS = 20;
const FIXED_TOTAL_QUESTIONS = 15;

const PracticeMode: React.FC<PracticeModeProps> = ({ onClose, onViewHistory, onViewMistakes, repractice }) => {
  const [phase, setPhase] = useState<'setup' | 'practice' | 'report'>('setup');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');
  const [practiceModeType, setPracticeModeType] = useState<PracticeModeType>('fixed');
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedStrokes, setSelectedStrokes] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [_sessionId, setSessionId] = useState('');

  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState<DifficultyLevel>('intermediate');
  const [difficultyHistory, setDifficultyHistory] = useState<DifficultyLevel[]>([]);
  const [consecutiveHighScores, setConsecutiveHighScores] = useState(0);

  const [radarTooltip, setRadarTooltip] = useState<{ x: number; y: number; kp: KnowledgePoint } | null>(null);

  const reportContainerRef = useRef<HTMLDivElement>(null);

  const currentQuestionRef = useRef<PracticeQuestion | null>(null);
  const startTimeRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const timedOutRef = useRef(false);

  const currentQuestion = questions[currentIndex] || null;
  currentQuestionRef.current = currentQuestion;
  const effectiveDifficulty: DifficultyLevel = practiceModeType === 'adaptive' ? adaptiveDifficulty : difficulty;
  const timeLimit = currentQuestion ? DIFFICULTY_TIME_LIMITS[currentQuestion.difficulty] : 0;

  const getNextAdaptiveQuestion = useCallback((currentDiff: DifficultyLevel, lastScore: number | null, consecHigh: number): { question: PracticeQuestion; newDiff: DifficultyLevel; newConsecHigh: number } => {
    let newDiff = currentDiff;
    let newConsecHigh = consecHigh;

    if (lastScore !== null) {
      if (lastScore >= 80) {
        newConsecHigh = consecHigh + 1;
        if (newConsecHigh >= 2) {
          const rank = DIFFICULTY_RANK[currentDiff];
          if (rank < 3) {
            newDiff = RANK_TO_DIFFICULTY[rank + 1];
            newConsecHigh = 0;
          }
        }
      } else if (lastScore < 40) {
        newConsecHigh = 0;
        const rank = DIFFICULTY_RANK[currentDiff];
        if (rank > 1) {
          newDiff = RANK_TO_DIFFICULTY[rank - 1];
        }
      } else {
        newConsecHigh = 0;
      }
    }

    const question = getSingleQuestionByDifficulty(newDiff);
    return { question, newDiff, newConsecHigh };
  }, []);

  const startPractice = useCallback(() => {
    let qs: PracticeQuestion[];
    let initialDiff = difficulty;
    let newHist: DifficultyLevel[] = [];

    if (repractice) {
      qs = [{
        id: `q_single_0_${Date.now()}`,
        latex: repractice.latex,
        difficulty: repractice.difficulty,
        knowledgePoints: detectKnowledgePoints(repractice.latex),
      }];
    } else if (practiceModeType === 'adaptive') {
      initialDiff = 'intermediate';
      qs = [getSingleQuestionByDifficulty(initialDiff)];
      newHist = [initialDiff];
      setAdaptiveDifficulty(initialDiff);
      setDifficultyHistory(newHist);
      setConsecutiveHighScores(0);
    } else {
      qs = getQuestions(difficulty, FIXED_TOTAL_QUESTIONS);
    }
    setQuestions(qs);
    setCurrentIndex(0);
    setAnswers([]);
    setStrokes([]);
    setSelectedStrokes(new Set());
    setPhase('practice');
    timedOutRef.current = false;
    const firstDiff = qs[0]?.difficulty || initialDiff;
    setTimeLeft(DIFFICULTY_TIME_LIMITS[firstDiff]);
    const now = Date.now();
    startTimeRef.current = now;
  }, [difficulty, practiceModeType, repractice]);

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

  const advanceToNextQuestion = useCallback((answerScore: number) => {
    if (practiceModeType === 'adaptive') {
      const totalDone = answers.length + 1;
      if (totalDone >= ADAPTIVE_TOTAL_QUESTIONS) {
        setPhase('report');
        return;
      }
      const { question, newDiff, newConsecHigh } = getNextAdaptiveQuestion(
        adaptiveDifficulty,
        answerScore,
        consecutiveHighScores
      );
      setQuestions(prev => [...prev, question]);
      setAdaptiveDifficulty(newDiff);
      setConsecutiveHighScores(newConsecHigh);
      setDifficultyHistory(prev => [...prev, newDiff]);
      setCurrentIndex(prev => prev + 1);
      setTimeLeft(DIFFICULTY_TIME_LIMITS[newDiff]);
      startTimeRef.current = Date.now();
      timedOutRef.current = false;
    } else {
      const idx = currentIndex;
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
    }
  }, [practiceModeType, adaptiveDifficulty, consecutiveHighScores, currentIndex, questions.length, answers.length, getNextAdaptiveQuestion]);

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
      difficulty: q.difficulty,
    };

    setAnswers(prev => [...prev, answer]);
    setStrokes([]);
    setSelectedStrokes(new Set());
    advanceToNextQuestion(0);
  }, [timeLeft, phase, advanceToNextQuestion]);

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
        difficulty: q.difficulty,
      };

      setAnswers(prev => [...prev, answer]);
      setStrokes([]);
      setSelectedStrokes(new Set());
      advanceToNextQuestion(comparison.score);
    } catch (e) {
      console.error('Recognition error:', e);
      const answer: AnswerRecord = {
        questionLatex: q.latex,
        recognizedLatex: '',
        score: 0,
        timeSpent,
        knowledgePoints: q.knowledgePoints,
        difficulty: q.difficulty,
      };
      setAnswers(prev => [...prev, answer]);
      setStrokes([]);
      setSelectedStrokes(new Set());
      advanceToNextQuestion(0);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, strokes, advanceToNextQuestion]);

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

    const diffHistRanks = difficultyHistory.map(d => DIFFICULTY_RANK[d]);

    try {
      const saveDiff = practiceModeType === 'adaptive' ? 'adaptive' : (repractice ? repractice.difficulty : difficulty);
      const sid = await invoke<string>('save_practice_session', {
        difficulty: saveDiff,
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
        difficultyHistory: JSON.stringify(diffHistRanks),
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
  }, [answers, difficulty, questions.length, repractice, practiceModeType, difficultyHistory]);

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
  const totalTime = times.reduce((s, t) => s + t, 0);

  const kpScores: Record<string, number[]> = {};
  const kpCounts: Record<string, number> = {};
  ALL_KNOWLEDGE_POINTS.forEach(kp => { kpScores[kp] = []; kpCounts[kp] = 0; });
  answers.forEach(a => {
    a.knowledgePoints.forEach(kp => {
      if (kpScores[kp]) {
        kpScores[kp].push(a.score);
        kpCounts[kp] = (kpCounts[kp] || 0) + 1;
      }
    });
  });
  const kpAverages: Record<string, number> = {};
  ALL_KNOWLEDGE_POINTS.forEach(kp => {
    const scores = kpScores[kp];
    kpAverages[kp] = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  });
  const kpAccuracyRates: Record<string, number> = {};
  ALL_KNOWLEDGE_POINTS.forEach(kp => {
    const scores = kpScores[kp];
    kpAccuracyRates[kp] = scores.length > 0 ? scores.filter(s => s >= 60).length / scores.length * 100 : 0;
  });

  const getDisplayDifficultyLabel = () => {
    if (practiceModeType === 'adaptive') return '自适应';
    return DIFFICULTY_LABELS[difficulty];
  };

  const handleShare = async () => {
    try {
      if (!reportContainerRef.current) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scale = 2;
      const width = 800;
      const height = 1100;
      canvas.width = width * scale;
      canvas.height = height * scale;
      ctx.scale(scale, scale);

      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, width, height);

      const headerGrad = ctx.createLinearGradient(0, 0, width, 120);
      headerGrad.addColorStop(0, '#667eea');
      headerGrad.addColorStop(1, '#764ba2');
      ctx.fillStyle = headerGrad;
      ctx.fillRect(0, 0, width, 120);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('公式听写练习报告', width / 2, 50);
      ctx.font = '14px -apple-system, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText(new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }), width / 2, 80);

      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.06)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      roundRect(ctx, 30, 140, 200, 100, 12);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = '#3b82f6';
      ctx.font = 'bold 36px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(totalScore / Math.max(answers.length, 1))}`, 130, 190);
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText('平均分', 130, 215);

      const stats = [
        { label: '正确率', value: `${Math.round(accuracy)}%` },
        { label: '总用时', value: `${Math.round(totalTime)}秒` },
        { label: '难度', value: getDisplayDifficultyLabel() },
        { label: '完成题数', value: `${answers.length}/${questions.length}` },
      ];
      stats.forEach((s, i) => {
        const x = 250 + (i % 2) * 260;
        const y = 140 + Math.floor(i / 2) * 52;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.04)';
        ctx.shadowBlur = 4;
        roundRect(ctx, x, y, 240, 44, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#6b7280';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(s.label, x + 14, y + 18);
        ctx.fillStyle = '#1f2937';
        ctx.font = 'bold 18px -apple-system, sans-serif';
        ctx.fillText(s.value, x + 14, y + 40);
      });

      const radarX = width / 2;
      const radarY = 380;
      const maxR = 110;
      const points = ALL_KNOWLEDGE_POINTS;
      const n = points.length;
      const angleStep = (2 * Math.PI) / n;

      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.04)';
      ctx.shadowBlur = 8;
      roundRect(ctx, 30, 260, width - 60, 280, 12);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 16px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('知识点掌握雷达图', 50, 288);

      [0.2, 0.4, 0.6, 0.8, 1.0].forEach(level => {
        ctx.beginPath();
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        points.forEach((_, i) => {
          const angle = i * angleStep - Math.PI / 2;
          const x = radarX + maxR * level * Math.cos(angle);
          const y = radarY + maxR * level * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
      });

      points.forEach((_, i) => {
        const angle = i * angleStep - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(radarX, radarY);
        ctx.lineTo(radarX + maxR * Math.cos(angle), radarY + maxR * Math.sin(angle));
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      ctx.beginPath();
      ctx.fillStyle = 'rgba(59,130,246,0.2)';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      points.forEach((kp, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const val = (kpAverages[kp] || 0) / 100;
        const x = radarX + maxR * val * Math.cos(angle);
        const y = radarY + maxR * val * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      points.forEach((kp, i) => {
        const angle = i * angleStep - Math.PI / 2;
        const val = (kpAverages[kp] || 0) / 100;
        const x = radarX + maxR * val * Math.cos(angle);
        const y = radarY + maxR * val * Math.sin(angle);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.fill();

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        let labelR = maxR + 28;
        if (Math.abs(cosA) > 0.9 || Math.abs(sinA) > 0.9) {
          labelR = maxR + 34;
        }

        const lx = radarX + labelR * cosA;
        const ly = radarY + labelR * sinA;

        let textAlign: CanvasTextAlign = 'center';
        let textBaseline: CanvasTextBaseline = 'middle';

        if (cosA > 0.5) {
          textAlign = 'left';
        } else if (cosA < -0.5) {
          textAlign = 'right';
        }

        if (sinA > 0.5) {
          textBaseline = 'top';
        } else if (sinA < -0.5) {
          textBaseline = 'bottom';
        }

        ctx.fillStyle = '#374151';
        ctx.font = 'bold 12px -apple-system, sans-serif';
        ctx.textAlign = textAlign;
        ctx.textBaseline = textBaseline;
        ctx.fillText(kp, lx, ly);
      });

      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 16px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('最近答题概览', 50, 565);

      const previewCount = Math.min(5, answers.length);
      for (let i = 0; i < previewCount; i++) {
        const a = answers[answers.length - previewCount + i];
        const y = 585 + i * 46;
        const isCorrect = a.score >= 60;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, 30, y, width - 60, 40, 8);
        ctx.fill();
        ctx.fillStyle = isCorrect ? '#22c55e' : '#ef4444';
        ctx.fillRect(30, y, 4, 40);
        ctx.fillStyle = '#374151';
        ctx.font = '13px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`第${answers.length - previewCount + i + 1}题`, 48, y + 18);
        ctx.fillStyle = isCorrect ? '#15803d' : '#dc2626';
        ctx.font = 'bold 14px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(a.score)}分`, width - 48, y + 25);
      }

      if (previewCount === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '14px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无答题记录', width / 2, 620);
      }

      const base64 = canvas.toDataURL('image/png');
      const defaultName = `练习报告_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.png`;
      const savePath = await save({
        defaultPath: defaultName,
        filters: [{
          name: 'PNG图片',
          extensions: ['png']
        }]
      });

      if (savePath) {
        await invoke('save_png_file', {
          base64Data: base64,
          outputPath: savePath,
        });
        alert('报告已保存成功！');
      }
    } catch (e) {
      console.error('Share error:', e);
      alert('分享失败：' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const handleRadarPointClick = (kp: KnowledgePoint) => {
    onViewMistakes(kp);
  };

  if (phase === 'setup') {
    return (
      <div className="practice-setup">
        <div className="practice-setup-header">
          <h2>📝 公式听写练习</h2>
          <button className="practice-close-btn" onClick={onClose}>✕ 返回</button>
        </div>

        <div className="practice-setup-content">
          <p className="practice-setup-desc">选择练习模式和难度等级开始练习，系统会随机抽取题目，请在限定时间内手写出对应的数学公式。</p>

          <div style={{ display: 'flex', gap: 20, marginBottom: 8 }}>
            <button
              className={`difficulty-option ${practiceModeType === 'fixed' ? 'active' : ''}`}
              style={{ flex: 1, minWidth: 220 }}
              onClick={() => setPracticeModeType('fixed')}
            >
              <div className="difficulty-label">🎯 固定难度</div>
              <div className="difficulty-desc">手动选择难度，随机出15题</div>
            </button>
            <button
              className={`difficulty-option ${practiceModeType === 'adaptive' ? 'active' : ''}`}
              style={{ flex: 1, minWidth: 220 }}
              onClick={() => setPracticeModeType('adaptive')}
            >
              <div className="difficulty-label">📈 自适应难度</div>
              <div className="difficulty-desc">系统根据表现自动调节难度，共20题</div>
            </button>
          </div>

          {practiceModeType === 'fixed' && (
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
          )}

          {practiceModeType === 'adaptive' && (
            <div className="adaptive-rules" style={{
              padding: 20, background: 'white', borderRadius: 12, border: '1px solid #e5e7eb',
              maxWidth: 500, width: '100%'
            }}>
              <h4 style={{ fontSize: 15, fontWeight: 600, color: '#1f2937', marginBottom: 12 }}>📋 自适应规则</h4>
              <ul style={{ fontSize: 13, color: '#4b5563', lineHeight: 2, listStyle: 'none', padding: 0 }}>
                <li>• 第1题从 <strong style={{ color: '#f59e0b' }}>中级</strong> 难度开始</li>
                <li>• 连续答对2题（得分≥80分）<span style={{ color: '#22c55e' }}>升一级</span></li>
                <li>• 单题得分＜40分 <span style={{ color: '#ef4444' }}>降一级</span></li>
                <li>• 到顶级/底级后不再升降</li>
                <li>• 共20题，报告中含难度变化折线图</li>
              </ul>
            </div>
          )}

          <button className="practice-start-btn" onClick={startPractice}>
            🚀 开始练习
          </button>

          <div className="practice-setup-actions">
            <button className="practice-action-btn" onClick={onViewHistory}>📊 练习历史</button>
            <button className="practice-action-btn" onClick={() => onViewMistakes(null)}>📖 错题本</button>
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

        <div className="practice-report-content" ref={reportContainerRef}>
          <div className="report-summary">
            <div className="report-score-card">
              <div className="report-score-value">{Math.round(totalScore / Math.max(answers.length, 1))}</div>
              <div className="report-score-label">平均分</div>
            </div>
            <div className="report-stat-grid">
              <div className="report-stat">
                <div className="report-stat-value">{getDisplayDifficultyLabel()}</div>
                <div className="report-stat-label">难度</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{Math.round(accuracy)}%</div>
                <div className="report-stat-label">正确率</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{avgTime.toFixed(1)}s</div>
                <div className="report-stat-label">平均用时</div>
              </div>
              <div className="report-stat">
                <div className="report-stat-value">{totalTime.toFixed(0)}s</div>
                <div className="report-stat-label">总用时</div>
              </div>
            </div>
          </div>

          {practiceModeType === 'adaptive' && difficultyHistory.length > 0 && (
            <div className="report-radar-section">
              <h3>📈 难度变化折线图</h3>
              <div className="radar-chart-container">
                <svg viewBox="0 0 600 220" className="line-chart-svg">
                  {(() => {
                    const padding = { left: 50, right: 30, top: 30, bottom: 40 };
                    const w = 600 - padding.left - padding.right;
                    const h = 220 - padding.top - padding.bottom;
                    const data = difficultyHistory.map(d => DIFFICULTY_RANK[d]);
                    const n = data.length;
                    const xStep = w / Math.max(n - 1, 1);

                    const yTicks = [
                      { val: 1, label: '初级' },
                      { val: 2, label: '中级' },
                      { val: 3, label: '高级' },
                    ];

                    const gridLines = yTicks.map(t => {
                      const y = padding.top + h - ((t.val - 1) / 2) * h;
                      return (
                        <line key={`grid-${t.val}`} x1={padding.left} y1={y} x2={600 - padding.right} y2={y} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4 4" />
                      );
                    });

                    const yLabels = yTicks.map(t => {
                      const y = padding.top + h - ((t.val - 1) / 2) * h;
                      return (
                        <text key={`ylabel-${t.val}`} x={padding.left - 10} y={y} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="#6b7280">{t.label}</text>
                      );
                    });

                    const xLabels = [];
                    const step = Math.max(1, Math.floor(n / 10));
                    for (let i = 0; i < n; i += step) {
                      const x = padding.left + (n === 1 ? w / 2 : i * xStep);
                      xLabels.push(
                        <text key={`xlabel-${i}`} x={x} y={220 - padding.bottom + 18} textAnchor="middle" fontSize="11" fill="#9ca3af">{i + 1}</text>
                      );
                    }

                    const points = data.map((v, i) => {
                      const x = padding.left + (n === 1 ? w / 2 : i * xStep);
                      const y = padding.top + h - ((v - 1) / 2) * h;
                      return { x, y, v };
                    });

                    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');

                    return (
                      <>
                        {gridLines}
                        {yLabels}
                        {xLabels}
                        <text x={padding.left - 35} y={padding.top - 12} fontSize="11" fill="#9ca3af">难度</text>
                        <text x={600 - padding.right} y={220 - padding.bottom + 18} textAnchor="end" fontSize="11" fill="#9ca3af">题号</text>
                        <path d={pathD} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        {points.map((p, i) => (
                          <g key={`pt-${i}`}>
                            <circle cx={p.x} cy={p.y} r="6" fill="#fff" stroke="#f97316" strokeWidth="2.5" />
                            <circle cx={p.x} cy={p.y} r="3" fill="#f97316" />
                          </g>
                        ))}
                      </>
                    );
                  })()}
                </svg>
              </div>
            </div>
          )}

          <div className="report-radar-section">
            <h3>🎯 知识点掌握雷达图 <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>（悬停查看详情，点击跳转错题本）</span></h3>
            <div className="radar-chart-container" style={{ position: 'relative' }}>
              <svg viewBox="0 0 300 300" className="radar-chart interactive-radar">
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
                    const val = (kpAverages[kp] || 0) / 100;
                    const x = cx + maxR * val * Math.cos(angle);
                    const y = cy + maxR * val * Math.sin(angle);
                    return { x, y, kp, angle };
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
                      <polygon
                        points={dataPts.map(p => `${p.x},${p.y}`).join(' ')}
                        fill="rgba(59,130,246,0.2)"
                        stroke="#3b82f6"
                        strokeWidth="2"
                      />
                      {dataPts.map((pt, i) => (
                        <g key={`dot-group-${i}`} className="radar-interactive-point">
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r="12"
                            fill="transparent"
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={(e) => {
                              const rect = (e.currentTarget.ownerSVGElement as SVGElement).getBoundingClientRect();
                              const container = (e.currentTarget.ownerSVGElement as SVGElement).parentElement;
                              if (!container) return;
                              const containerRect = container.getBoundingClientRect();
                              setRadarTooltip({
                                x: rect.left - containerRect.left + pt.x * (rect.width / 300),
                                y: rect.top - containerRect.top + pt.y * (rect.height / 300) - 10,
                                kp: pt.kp,
                              });
                            }}
                            onMouseLeave={() => setRadarTooltip(null)}
                            onClick={() => handleRadarPointClick(pt.kp as KnowledgePoint)}
                          />
                          <circle cx={pt.x} cy={pt.y} r="5" fill="#3b82f6" style={{ pointerEvents: 'none' }} />
                        </g>
                      ))}
                      {labels.map((l, i) => (
                        <text key={`label-${i}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#374151" fontWeight="500">{l.label}</text>
                      ))}
                    </>
                  );
                })()}
              </svg>
              {radarTooltip && (
                <div
                  className="radar-tooltip"
                  style={{
                    position: 'absolute',
                    left: radarTooltip.x,
                    top: radarTooltip.y,
                    transform: 'translate(-50%, -100%)',
                    background: 'rgba(17, 24, 39, 0.95)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 500,
                    pointerEvents: 'none',
                    zIndex: 10,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                  }}
                >
                  <div>{radarTooltip.kp}</div>
                  <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>
                    正确率: {Math.round(kpAccuracyRates[radarTooltip.kp] || 0)}% · 共 {kpCounts[radarTooltip.kp] || 0} 题
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="report-detail-list">
            <h3>📝 答题详情</h3>
            {answers.map((answer, idx) => (
              <div key={idx} className={`report-detail-item ${answer.score >= 60 ? 'correct' : 'wrong'}`}>
                <div className="report-detail-header">
                  <span className="report-detail-index">第{idx + 1}题</span>
                  <span className="practice-kp-tag" style={{ background: answer.difficulty === 'beginner' ? '#dcfce7' : answer.difficulty === 'intermediate' ? '#fef3c7' : '#fee2e2', color: answer.difficulty === 'beginner' ? '#15803d' : answer.difficulty === 'intermediate' ? '#a16207' : '#dc2626' }}>
                    {DIFFICULTY_LABELS[answer.difficulty]}
                  </span>
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
            <button className="practice-action-btn primary" onClick={() => { setPhase('setup'); setAnswers([]); setDifficultyHistory([]); }}>
              🔄 再来一次
            </button>
            <button className="practice-action-btn share-btn" onClick={handleShare} style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none' }}>
              📸 分享成绩
            </button>
            <button className="practice-action-btn" onClick={onViewHistory}>📊 查看历史</button>
            <button className="practice-action-btn" onClick={() => onViewMistakes(null)}>📖 错题本</button>
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
          {practiceModeType === 'adaptive' && (
            <span className="practice-difficulty-tag" style={{ background: 'rgba(249,115,22,0.35)' }}>
              📈 自适应 · {DIFFICULTY_LABELS[currentQuestion?.difficulty || effectiveDifficulty]}
            </span>
          )}
          {practiceModeType === 'fixed' && (
            <span className="practice-difficulty-tag">
              {DIFFICULTY_LABELS[currentQuestion?.difficulty || difficulty]}
            </span>
          )}
          <span className="practice-progress-text">
            {currentIndex + 1} / {practiceModeType === 'adaptive' ? ADAPTIVE_TOTAL_QUESTIONS : questions.length}
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default PracticeMode;

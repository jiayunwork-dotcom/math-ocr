import { PracticeQuestion, DifficultyLevel, KnowledgePoint } from '../types';

const beginnerQuestions: Omit<PracticeQuestion, 'id'>[] = [
  { latex: 'x^{2}', difficulty: 'beginner', knowledgePoints: ['指数'] },
  { latex: 'a^{3}+1', difficulty: 'beginner', knowledgePoints: ['指数'] },
  { latex: 'y^{2}-4', difficulty: 'beginner', knowledgePoints: ['指数'] },
  { latex: '\\frac{1}{2}', difficulty: 'beginner', knowledgePoints: ['分数'] },
  { latex: '\\frac{a}{b}', difficulty: 'beginner', knowledgePoints: ['分数'] },
  { latex: '\\frac{3}{4}', difficulty: 'beginner', knowledgePoints: ['分数'] },
  { latex: '\\sqrt{x}', difficulty: 'beginner', knowledgePoints: ['根号'] },
  { latex: '\\sqrt{2}', difficulty: 'beginner', knowledgePoints: ['根号'] },
  { latex: '\\sqrt{a+b}', difficulty: 'beginner', knowledgePoints: ['根号'] },
  { latex: '(x+1)', difficulty: 'beginner', knowledgePoints: ['括号'] },
  { latex: '(a-b)^{2}', difficulty: 'beginner', knowledgePoints: ['括号', '指数'] },
  { latex: '2^{n}', difficulty: 'beginner', knowledgePoints: ['指数'] },
  { latex: '\\frac{x}{5}', difficulty: 'beginner', knowledgePoints: ['分数'] },
  { latex: '\\sqrt{9}', difficulty: 'beginner', knowledgePoints: ['根号'] },
  { latex: '[a+b]', difficulty: 'beginner', knowledgePoints: ['括号'] },
];

const intermediateQuestions: Omit<PracticeQuestion, 'id'>[] = [
  { latex: '\\frac{x+1}{\\sqrt{y}}', difficulty: 'intermediate', knowledgePoints: ['分数', '根号'] },
  { latex: '\\sqrt{x^{2}+y^{2}}', difficulty: 'intermediate', knowledgePoints: ['根号', '指数'] },
  { latex: '\\frac{a^{2}-b^{2}}{a+b}', difficulty: 'intermediate', knowledgePoints: ['分数', '指数'] },
  { latex: '\\left(x+1\\right)^{3}', difficulty: 'intermediate', knowledgePoints: ['括号', '指数'] },
  { latex: '\\frac{\\sqrt{a}}{b+1}', difficulty: 'intermediate', knowledgePoints: ['分数', '根号'] },
  { latex: 'x^{2}+2xy+y^{2}', difficulty: 'intermediate', knowledgePoints: ['指数'] },
  { latex: '\\frac{1}{\\sqrt{1+x}}', difficulty: 'intermediate', knowledgePoints: ['分数', '根号'] },
  { latex: '\\left(a+b\\right)\\left(a-b\\right)', difficulty: 'intermediate', knowledgePoints: ['括号'] },
  { latex: '\\frac{x^{3}}{y^{2}}', difficulty: 'intermediate', knowledgePoints: ['分数', '指数'] },
  { latex: '\\sqrt[3]{x+1}', difficulty: 'intermediate', knowledgePoints: ['根号'] },
  { latex: '\\frac{2x+1}{x-1}', difficulty: 'intermediate', knowledgePoints: ['分数'] },
  { latex: '\\left(\\frac{a}{b}\\right)^{2}', difficulty: 'intermediate', knowledgePoints: ['分数', '括号', '指数'] },
  { latex: '\\sqrt{x^{2}+1}', difficulty: 'intermediate', knowledgePoints: ['根号', '指数'] },
  { latex: '\\frac{\\sqrt{2}}{2}', difficulty: 'intermediate', knowledgePoints: ['分数', '根号'] },
  { latex: '[x+y]^{2}', difficulty: 'intermediate', knowledgePoints: ['括号', '指数'] },
];

const advancedQuestions: Omit<PracticeQuestion, 'id'>[] = [
  { latex: '\\int_{0}^{1} \\frac{dx}{\\sqrt{1-x^{2}}}', difficulty: 'advanced', knowledgePoints: ['积分', '分数', '根号'] },
  { latex: '\\int_{0}^{\\infty} e^{-x} dx', difficulty: 'advanced', knowledgePoints: ['积分'] },
  { latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', difficulty: 'advanced', knowledgePoints: ['矩阵'] },
  { latex: '\\begin{pmatrix} 1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1 \\end{pmatrix}', difficulty: 'advanced', knowledgePoints: ['矩阵'] },
  { latex: '\\int x^{2} dx', difficulty: 'advanced', knowledgePoints: ['积分', '指数'] },
  { latex: '\\frac{d}{dx}\\left(x^{3}\\right)', difficulty: 'advanced', knowledgePoints: ['分数', '括号', '指数'] },
  { latex: '\\begin{pmatrix} x_{1} & x_{2} \\\\ x_{3} & x_{4} \\end{pmatrix}', difficulty: 'advanced', knowledgePoints: ['矩阵'] },
  { latex: '\\int_{a}^{b} f(x) dx', difficulty: 'advanced', knowledgePoints: ['积分', '括号'] },
  { latex: '\\frac{\\partial}{\\partial x} f(x,y)', difficulty: 'advanced', knowledgePoints: ['分数', '括号'] },
  { latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}', difficulty: 'advanced', knowledgePoints: ['矩阵'] },
  { latex: '\\int_{0}^{1} \\sqrt{x} dx', difficulty: 'advanced', knowledgePoints: ['积分', '根号'] },
  { latex: '\\frac{\\int_{0}^{1} f(x) dx}{\\int_{0}^{1} g(x) dx}', difficulty: 'advanced', knowledgePoints: ['分数', '积分'] },
  { latex: '\\begin{pmatrix} a^{2} & b^{2} \\\\ c^{2} & d^{2} \\end{pmatrix}', difficulty: 'advanced', knowledgePoints: ['矩阵', '指数'] },
  { latex: '\\int \\frac{1}{x} dx', difficulty: 'advanced', knowledgePoints: ['积分', '分数'] },
  { latex: '\\left(\\int_{0}^{1} x dx\\right)^{2}', difficulty: 'advanced', knowledgePoints: ['积分', '括号', '指数'] },
];

const allQuestions: Record<DifficultyLevel, Omit<PracticeQuestion, 'id'>[]> = {
  beginner: beginnerQuestions,
  intermediate: intermediateQuestions,
  advanced: advancedQuestions,
};

export const DIFFICULTY_LABELS: Record<DifficultyLevel, string> = {
  beginner: '初级',
  intermediate: '中级',
  advanced: '高级',
};

export const DIFFICULTY_TIME_LIMITS: Record<DifficultyLevel, number> = {
  beginner: 90,
  intermediate: 120,
  advanced: 180,
};

export const ALL_KNOWLEDGE_POINTS: KnowledgePoint[] = ['指数', '分数', '根号', '积分', '矩阵', '括号'];

let questionIdCounter = 0;

export const getQuestions = (difficulty: DifficultyLevel, count: number = 15): PracticeQuestion[] => {
  const pool = [...allQuestions[difficulty]];
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const result: PracticeQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const q = shuffled[i % shuffled.length];
    result.push({
      ...q,
      id: `q_${difficulty}_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
  }
  return result;
};

export const getSingleQuestionByDifficulty = (difficulty: DifficultyLevel): PracticeQuestion => {
  const pool = allQuestions[difficulty];
  const q = pool[Math.floor(Math.random() * pool.length)];
  return {
    ...q,
    id: `q_${difficulty}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
};

export const getSingleQuestion = (latex: string): PracticeQuestion => {
  return {
    id: `q_single_${++questionIdCounter}_${Date.now()}`,
    latex,
    difficulty: 'beginner',
    knowledgePoints: detectKnowledgePoints(latex),
  };
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

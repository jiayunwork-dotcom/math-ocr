export interface Point {
  x: number;
  y: number;
  timestamp: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  thickness: number;
  color: string;
  boundingBox?: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ToolType = 'pen' | 'eraser' | 'select';

export type ThicknessType = 'thin' | 'medium' | 'thick';

export interface SymbolCandidate {
  label: string;
  latex: string;
  probability: number;
}

export interface RecognizedSymbol {
  id: string;
  strokes: Stroke[];
  boundingBox: BoundingBox;
  candidates: SymbolCandidate[];
  selectedCandidate: number;
}

export type RelationType = 
  | 'horizontal'
  | 'superscript'
  | 'subscript'
  | 'above'
  | 'below'
  | 'contains';

export interface SyntaxNode {
  id: string;
  symbol?: RecognizedSymbol;
  nodeType: 'symbol' | 'fraction' | 'sqrt' | 'sum' | 'integral' | 'bracket' | 'matrix' | 'row';
  children: SyntaxNode[];
  relation?: RelationType;
  parent?: string;
  value?: string;
}

export interface FormulaHistory {
  id: string;
  latex: string;
  thumbnail: string;
  isFavorite: boolean;
  createdAt: string;
}

export interface RecognitionResult {
  symbols: RecognizedSymbol[];
  syntaxTree: SyntaxNode;
  latex: string;
}

export interface HistoryState {
  strokes: Stroke[];
  timestamp: number;
}

export interface CanvasState {
  strokes: Stroke[];
  history: HistoryState[];
  historyIndex: number;
  currentTool: ToolType;
  currentThickness: ThicknessType;
  selectedStrokes: Set<string>;
  isDrawing: boolean;
  currentStroke: Point[];
}

export interface ExportOptions {
  width: number;
  height: number;
  background: string;
}

export interface FormulaTemplate {
  id: string;
  name: string;
  category: string;
  latex: string;
  thumbnail: string;
  createdAt: string;
  useCount: number;
  sortOrder: number;
  isBuiltin: boolean;
}

export interface TemplateReferenceLine {
  latex: string;
}

export interface SaveTemplateDialogData {
  latex: string;
  thumbnail: string;
}

export const TEMPLATE_CATEGORIES = [
  '基础运算',
  '微积分',
  '线性代数',
  '概率统计',
  '集合逻辑',
] as const;

export type TemplateCategory = typeof TEMPLATE_CATEGORIES[number];

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface PracticeQuestion {
  id: string;
  latex: string;
  difficulty: DifficultyLevel;
  knowledgePoints: KnowledgePoint[];
}

export type KnowledgePoint = '指数' | '分数' | '根号' | '积分' | '矩阵' | '括号';

export interface PracticeAnswer {
  id: string;
  sessionId: string;
  questionId: string;
  questionLatex: string;
  recognizedLatex: string;
  score: number;
  timeSpent: number;
  knowledgePoints: KnowledgePoint[];
  createdAt: string;
}

export interface PracticeSession {
  id: string;
  difficulty: DifficultyLevel;
  totalScore: number;
  accuracy: number;
  avgTime: number;
  fastestTime: number;
  slowestTime: number;
  fastestQuestion: string;
  slowestQuestion: string;
  completedQuestions: number;
  totalQuestions: number;
  knowledgePointScores: Record<KnowledgePoint, number>;
  createdAt: string;
}

export interface MistakeEntry {
  id: string;
  questionLatex: string;
  recognizedLatex: string;
  score: number;
  difficulty: DifficultyLevel;
  knowledgePoints: KnowledgePoint[];
  createdAt: string;
  sessionId: string;
}

export interface LatexASTNode {
  type: 'command' | 'group' | 'superscript' | 'subscript' | 'text' | 'operator' | 'root';
  value: string;
  children: LatexASTNode[];
}

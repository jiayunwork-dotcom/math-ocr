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

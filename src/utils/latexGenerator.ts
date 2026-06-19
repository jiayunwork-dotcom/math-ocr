import { SyntaxNode, RelationType } from '../types';

const getSymbolLatex = (node: SyntaxNode): string => {
  if (!node.symbol) return '';
  
  const candidate = node.symbol.candidates[node.symbol.selectedCandidate];
  if (!candidate) return '';
  
  return candidate.latex;
};

const getChildByRelation = (node: SyntaxNode, relation: RelationType): SyntaxNode | null => {
  return node.children.find(c => c.relation === relation) || null;
};

const getChildrenByRelation = (node: SyntaxNode, relation: RelationType): SyntaxNode[] => {
  return node.children.filter(c => c.relation === relation);
};

const generateFromNode = (node: SyntaxNode, inSuperscript: boolean = false): string => {
  switch (node.nodeType) {
    case 'row': {
      return node.children
        .map(child => generateFromNode(child, inSuperscript))
        .join(' ');
    }
    
    case 'symbol': {
      let latex = getSymbolLatex(node);
      
      const superscript = getChildByRelation(node, 'superscript');
      const subscript = getChildByRelation(node, 'subscript');
      const above = getChildByRelation(node, 'above');
      const below = getChildByRelation(node, 'below');
      
      if (below) {
        latex += `_{${generateFromNode(below, true)}}`;
      }
      if (above) {
        latex += `^{${generateFromNode(above, true)}}`;
      }
      if (subscript) {
        latex += `_{${generateFromNode(subscript, true)}}`;
      }
      if (superscript) {
        latex += `^{${generateFromNode(superscript, true)}}`;
      }
      
      return latex;
    }
    
    case 'fraction': {
      const numerator = getChildByRelation(node, 'above');
      const denominator = getChildByRelation(node, 'below');
      
      const numLatex = numerator ? generateFromNode(numerator) : '';
      const denLatex = denominator ? generateFromNode(denominator) : '';
      
      return `\\frac{${numLatex}}{${denLatex}}`;
    }
    
    case 'sqrt': {
      const inside = getChildByRelation(node, 'contains');
      const insideLatex = inside ? generateFromNode(inside) : '';
      
      return `\\sqrt{${insideLatex}}`;
    }
    
    case 'sum': {
      const symbolLatex = getSymbolLatex(node);
      const below = getChildByRelation(node, 'below');
      const above = getChildByRelation(node, 'above');
      
      let latex = symbolLatex;
      
      if (below) {
        latex += `_{${generateFromNode(below, true)}}`;
      }
      if (above) {
        latex += `^{${generateFromNode(above, true)}}`;
      }
      
      return latex;
    }
    
    case 'integral': {
      const symbolLatex = getSymbolLatex(node);
      const below = getChildByRelation(node, 'below');
      const above = getChildByRelation(node, 'above');
      
      let latex = symbolLatex;
      
      if (below) {
        latex += `_{${generateFromNode(below, true)}}`;
      }
      if (above) {
        latex += `^{${generateFromNode(above, true)}}`;
      }
      
      return latex;
    }
    
    case 'bracket': {
      const bracketMap: Record<string, { open: string; close: string }> = {
        '(': { open: '(', close: ')' },
        '[': { open: '[', close: ']' },
        '{': { open: '\\{', close: '\\}' },
      };
      
      const bracket = bracketMap[node.value || '('] || bracketMap['('];
      const inside = getChildByRelation(node, 'contains');
      const insideLatex = inside ? generateFromNode(inside) : '';
      
      return `\\left${bracket.open} ${insideLatex} \\right${bracket.close}`;
    }
    
    case 'matrix': {
      const rows = getChildrenByRelation(node, 'horizontal');
      const content = rows
        .map(row => generateFromNode(row).split(' ').join(' & '))
        .join(' \\\\ ');
      
      return `\\begin{pmatrix} ${content} \\end{pmatrix}`;
    }
    
    default:
      return '';
  }
};

export const generateLatex = (root: SyntaxNode): string => {
  if (!root.children.length && root.nodeType === 'row') {
    return '';
  }
  
  return generateFromNode(root);
};

const BRACKET_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '\\{': '\\}',
  '\\left(': '\\right)',
  '\\left[': '\\right]',
  '\\left\\{': '\\right\\}',
};

export const validateBrackets = (latex: string): { valid: boolean; message?: string } => {
  const stack: string[] = [];
  const tokens = latex.match(/\\left[(\[\{]|\\right[)\]\}]|\\{|[(){}\[\]]/g) || [];
  
  for (const token of tokens) {
    if (token in BRACKET_PAIRS || token.startsWith('\\left')) {
      stack.push(token);
    } else {
      const isClose = Object.values(BRACKET_PAIRS).includes(token) || token.startsWith('\\right');
      
      if (isClose) {
        if (stack.length === 0) {
          return { valid: false, message: `多余的右括号: ${token}` };
        }
        
        const lastOpen = stack.pop()!;
        const expectedClose = BRACKET_PAIRS[lastOpen] || 
          (lastOpen === '\\left(' ? '\\right)' :
           lastOpen === '\\left[' ? '\\right]' :
           lastOpen === '\\left\\{' ? '\\right\\}' : undefined);
        
        if (expectedClose !== token) {
          return { valid: false, message: `括号不匹配: 期望 ${expectedClose}, 得到 ${token}` };
        }
      }
    }
  }
  
  if (stack.length > 0) {
    return { valid: false, message: `缺少右括号: ${stack.join(', ')}` };
  }
  
  return { valid: true };
};

export const escapeForText = (latex: string): string => {
  return latex
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
};

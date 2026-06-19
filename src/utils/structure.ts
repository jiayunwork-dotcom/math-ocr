import { v4 as uuidv4 } from 'uuid';
import { RecognizedSymbol, SyntaxNode, RelationType } from '../types';

const determineRelation = (
  s1: RecognizedSymbol,
  s2: RecognizedSymbol
): RelationType => {
  const b1 = s1.boundingBox;
  const b2 = s2.boundingBox;
  
  const s1CenterY = b1.y + b1.height / 2;
  const s1CenterX = b1.x + b1.width / 2;
  const s2CenterY = b2.y + b2.height / 2;
  const s2CenterX = b2.x + b2.width / 2;
  
  const s1Right = b1.x + b1.width;
  const s2Left = b2.x;
  
  const horizontalDist = s2Left - s1Right;
  const verticalDist = s2CenterY - s1CenterY;
  
  const s1Area = b1.width * b1.height;
  const s2Area = b2.width * b2.height;
  const sizeRatio = s2Area / s1Area;
  
  const label1 = s1.candidates[s1.selectedCandidate]?.label || '';
  
  if (label1 === 'fraction' || label1 === 'sqrt' || label1 === 'sum' || label1 === 'int' || label1 === 'prod') {
    return 'contains';
  }
  
  if (label1 === '(' || label1 === '[' || label1 === '{') {
    return 'contains';
  }
  
  if (s2CenterY < s1CenterY - b1.height * 0.2 && 
      s2CenterX > s1Right - b1.width * 0.3 &&
      sizeRatio < 0.6) {
    return 'superscript';
  }
  
  if (s2CenterY > s1CenterY + b1.height * 0.2 && 
      s2CenterX > s1Right - b1.width * 0.3 &&
      sizeRatio < 0.6) {
    return 'subscript';
  }
  
  if (s2CenterY < b1.y - b1.height * 0.3 &&
      Math.abs(s2CenterX - s1CenterX) < b1.width * 0.5) {
    return 'above';
  }
  
  if (s2CenterY > b1.y + b1.height + b1.height * 0.3 &&
      Math.abs(s2CenterX - s1CenterX) < b1.width * 0.5) {
    return 'below';
  }
  
  if (horizontalDist < Math.max(b1.width, b2.width) * 0.8 &&
      Math.abs(verticalDist) < Math.max(b1.height, b2.height) * 0.5) {
    return 'horizontal';
  }
  
  return 'horizontal';
};

const buildSyntaxTreeRecursive = (
  symbols: RecognizedSymbol[],
  startIndex: number,
  parentId?: string
): { node: SyntaxNode | null; nextIndex: number } => {
  if (startIndex >= symbols.length) {
    return { node: null, nextIndex: startIndex };
  }
  
  const current = symbols[startIndex];
  const currentLabel = current.candidates[current.selectedCandidate]?.label || '';
  
  let currentNode: SyntaxNode;
  
  if (currentLabel === 'fraction') {
    currentNode = {
      id: uuidv4(),
      nodeType: 'fraction',
      children: [],
      parent: parentId,
    };
    
    let idx = startIndex + 1;
    
    const numerator: RecognizedSymbol[] = [];
    while (idx < symbols.length) {
      const s = symbols[idx];
      if (s.boundingBox.y + s.boundingBox.height / 2 < current.boundingBox.y) {
        numerator.push(s);
        idx++;
      } else {
        break;
      }
    }
    
    if (numerator.length > 0) {
      const { node: numNode, nextIndex: numNext } = buildSequenceTree(numerator, currentNode.id);
      if (numNode) {
        numNode.relation = 'above';
        currentNode.children.push(numNode);
      }
      idx = Math.max(idx, numNext);
    }
    
    const denominator: RecognizedSymbol[] = [];
    while (idx < symbols.length) {
      const s = symbols[idx];
      if (s.boundingBox.y + s.boundingBox.height / 2 > current.boundingBox.y + current.boundingBox.height) {
        denominator.push(s);
        idx++;
      } else {
        break;
      }
    }
    
    if (denominator.length > 0) {
      const { node: denNode, nextIndex: denNext } = buildSequenceTree(denominator, currentNode.id);
      if (denNode) {
        denNode.relation = 'below';
        currentNode.children.push(denNode);
      }
      idx = Math.max(idx, denNext);
    }
    
    return { node: currentNode, nextIndex: idx };
  }
  
  if (currentLabel === 'sqrt') {
    currentNode = {
      id: uuidv4(),
      nodeType: 'sqrt',
      children: [],
      parent: parentId,
    };
    
    let idx = startIndex + 1;
    const inside: RecognizedSymbol[] = [];
    
    const sqrtRight = current.boundingBox.x + current.boundingBox.width;
    const sqrtBottom = current.boundingBox.y + current.boundingBox.height;
    
    while (idx < symbols.length) {
      const s = symbols[idx];
      const sbb = s.boundingBox;
      
      if (sbb.x > sqrtRight * 0.6 && 
          sbb.y > current.boundingBox.y * 0.8 &&
          sbb.y + sbb.height < sqrtBottom * 1.2) {
        inside.push(s);
        idx++;
      } else {
        break;
      }
    }
    
    if (inside.length > 0) {
      const { node: insideNode, nextIndex: insideNext } = buildSequenceTree(inside, currentNode.id);
      if (insideNode) {
        insideNode.relation = 'contains';
        currentNode.children.push(insideNode);
      }
      idx = Math.max(idx, insideNext);
    }
    
    return { node: currentNode, nextIndex: idx };
  }
  
  if (currentLabel === 'sum' || currentLabel === 'int' || currentLabel === 'prod' || currentLabel === 'lim') {
    const typeMap: Record<string, SyntaxNode['nodeType']> = {
      'sum': 'sum',
      'int': 'integral',
      'prod': 'sum',
      'lim': 'sum',
    };
    
    currentNode = {
      id: uuidv4(),
      symbol: current,
      nodeType: typeMap[currentLabel] || 'symbol',
      children: [],
      parent: parentId,
      value: currentLabel,
    };
    
    let idx = startIndex + 1;
    
    const below: RecognizedSymbol[] = [];
    while (idx < symbols.length) {
      const s = symbols[idx];
      if (s.boundingBox.y > current.boundingBox.y + current.boundingBox.height * 0.5 &&
          Math.abs((s.boundingBox.x + s.boundingBox.width / 2) - (current.boundingBox.x + current.boundingBox.width / 2)) < current.boundingBox.width) {
        below.push(s);
        idx++;
      } else {
        break;
      }
    }
    
    if (below.length > 0) {
      const { node: belowNode, nextIndex: belowNext } = buildSequenceTree(below, currentNode.id);
      if (belowNode) {
        belowNode.relation = 'below';
        currentNode.children.push(belowNode);
      }
      idx = Math.max(idx, belowNext);
    }
    
    const above: RecognizedSymbol[] = [];
    while (idx < symbols.length) {
      const s = symbols[idx];
      if (s.boundingBox.y + s.boundingBox.height < current.boundingBox.y + current.boundingBox.height * 0.5 &&
          Math.abs((s.boundingBox.x + s.boundingBox.width / 2) - (current.boundingBox.x + current.boundingBox.width / 2)) < current.boundingBox.width * 1.5) {
        above.push(s);
        idx++;
      } else {
        break;
      }
    }
    
    if (above.length > 0) {
      const { node: aboveNode, nextIndex: aboveNext } = buildSequenceTree(above, currentNode.id);
      if (aboveNode) {
        aboveNode.relation = 'above';
        currentNode.children.push(aboveNode);
      }
      idx = Math.max(idx, aboveNext);
    }
    
    return { node: currentNode, nextIndex: idx };
  }
  
  if (currentLabel === '(' || currentLabel === '[' || currentLabel === '{') {
    const closingMap: Record<string, string> = {
      '(': ')',
      '[': ']',
      '{': '}',
    };
    
    currentNode = {
      id: uuidv4(),
      nodeType: 'bracket',
      children: [],
      parent: parentId,
      value: currentLabel,
    };
    
    let idx = startIndex + 1;
    const inside: RecognizedSymbol[] = [];
    let depth = 1;
    
    while (idx < symbols.length && depth > 0) {
      const s = symbols[idx];
      const sLabel = s.candidates[s.selectedCandidate]?.label || '';
      
      if (sLabel === currentLabel) depth++;
      if (sLabel === closingMap[currentLabel]) depth--;
      
      if (depth > 0) {
        inside.push(s);
      }
      idx++;
    }
    
    if (inside.length > 0) {
      const { node: insideNode } = buildSequenceTree(inside, currentNode.id);
      if (insideNode) {
        insideNode.relation = 'contains';
        currentNode.children.push(insideNode);
      }
    }
    
    return { node: currentNode, nextIndex: idx };
  }
  
  currentNode = {
    id: uuidv4(),
    symbol: current,
    nodeType: 'symbol',
    children: [],
    parent: parentId,
    value: currentLabel,
  };
  
  let idx = startIndex + 1;
  
  while (idx < symbols.length) {
    const next = symbols[idx];
    const relation = determineRelation(current, next);
    
    if (relation === 'superscript' || relation === 'subscript' || relation === 'above' || relation === 'below') {
      const { node: subNode, nextIndex: subNext } = buildSyntaxTreeRecursive(symbols, idx, currentNode.id);
      if (subNode) {
        subNode.relation = relation;
        currentNode.children.push(subNode);
        idx = subNext;
      } else {
        idx++;
      }
    } else {
      break;
    }
  }
  
  return { node: currentNode, nextIndex: idx };
};

const buildSequenceTree = (
  symbols: RecognizedSymbol[],
  parentId?: string
): { node: SyntaxNode | null; nextIndex: number } => {
  if (symbols.length === 0) {
    return { node: null, nextIndex: 0 };
  }
  
  if (symbols.length === 1) {
    return buildSyntaxTreeRecursive(symbols, 0, parentId);
  }
  
  const rowNode: SyntaxNode = {
    id: uuidv4(),
    nodeType: 'row',
    children: [],
    parent: parentId,
  };
  
  let idx = 0;
  while (idx < symbols.length) {
    const { node, nextIndex } = buildSyntaxTreeRecursive(symbols, idx, rowNode.id);
    if (node) {
      node.relation = 'horizontal';
      rowNode.children.push(node);
    }
    idx = nextIndex;
  }
  
  return { node: rowNode, nextIndex: symbols.length };
};

export const buildSyntaxTree = (symbols: RecognizedSymbol[]): SyntaxNode => {
  const { node } = buildSequenceTree(symbols);
  return node || {
    id: uuidv4(),
    nodeType: 'row',
    children: [],
  };
};

export const updateSymbolInTree = (
  root: SyntaxNode,
  symbolId: string,
  newCandidateIndex: number
): SyntaxNode => {
  const updateRecursive = (node: SyntaxNode): SyntaxNode => {
    if (node.symbol && node.symbol.id === symbolId) {
      return {
        ...node,
        symbol: {
          ...node.symbol,
          selectedCandidate: newCandidateIndex,
        },
      };
    }
    
    return {
      ...node,
      children: node.children.map(updateRecursive),
    };
  };
  
  return updateRecursive(root);
};

export const updateRelationInTree = (
  root: SyntaxNode,
  nodeId: string,
  newRelation: RelationType
): SyntaxNode => {
  const updateRecursive = (node: SyntaxNode): SyntaxNode => {
    return {
      ...node,
      children: node.children.map(child => {
        if (child.id === nodeId) {
          return { ...child, relation: newRelation };
        }
        return updateRecursive(child);
      }),
    };
  };
  
  return updateRecursive(root);
};

export const collectAllSymbols = (node: SyntaxNode): RecognizedSymbol[] => {
  const symbols: RecognizedSymbol[] = [];
  
  const collect = (n: SyntaxNode) => {
    if (n.symbol) {
      symbols.push(n.symbol);
    }
    n.children.forEach(collect);
  };
  
  collect(node);
  return symbols;
};

export const findSymbolById = (root: SyntaxNode, symbolId: string): RecognizedSymbol | null => {
  const find = (node: SyntaxNode): RecognizedSymbol | null => {
    if (node.symbol && node.symbol.id === symbolId) {
      return node.symbol;
    }
    for (const child of node.children) {
      const result = find(child);
      if (result) return result;
    }
    return null;
  };
  
  return find(root);
};

import { LatexASTNode } from '../types';

const EQUIVALENT_COMMANDS: Record<string, string[]> = {
  '\\left(': ['('],
  '\\right)': [')'],
  '\\left[': ['['],
  '\\right]': [']'],
  '\\left\\{': ['\\{'],
  '\\right\\}': ['\\}'],
  '\\cdot': ['\\times', '*'],
  '\\times': ['\\cdot', '*'],
  '\\to': ['\\rightarrow'],
  '\\rightarrow': ['\\to'],
  '\\colon': [':'],
};

function normalizeCommand(cmd: string): string {
  if (EQUIVALENT_COMMANDS[cmd]) {
    return EQUIVALENT_COMMANDS[cmd][0];
  }
  return cmd;
}

function areEquivalentCommands(a: string, b: string): boolean {
  if (a === b) return true;
  const equivs = EQUIVALENT_COMMANDS[a];
  if (equivs && equivs.includes(b)) return true;
  const equivsB = EQUIVALENT_COMMANDS[b];
  if (equivsB && equivsB.includes(a)) return true;
  return false;
}

export function parseLatexToAST(latex: string): LatexASTNode {
  const tokens = tokenize(latex);
  const { node } = parseExpression(tokens, 0);
  return node;
}

interface Token {
  type: 'command' | 'group_open' | 'group_close' | 'superscript' | 'subscript' | 'text' | 'operator' | 'ampersand' | 'newline';
  value: string;
}

function tokenize(latex: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < latex.length) {
    const ch = latex[i];

    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    if (ch === '\\') {
      let cmd = '\\';
      i++;
      while (i < latex.length && /[a-zA-Z]/.test(latex[i])) {
        cmd += latex[i];
        i++;
      }
      if (cmd === '\\') {
        if (i < latex.length) {
          cmd += latex[i];
          i++;
        }
      }
      tokens.push({ type: 'command', value: cmd });
      continue;
    }

    if (ch === '{') {
      tokens.push({ type: 'group_open', value: '{' });
      i++;
      continue;
    }

    if (ch === '}') {
      tokens.push({ type: 'group_close', value: '}' });
      i++;
      continue;
    }

    if (ch === '^') {
      tokens.push({ type: 'superscript', value: '^' });
      i++;
      continue;
    }

    if (ch === '_') {
      tokens.push({ type: 'subscript', value: '_' });
      i++;
      continue;
    }

    if (ch === '&') {
      tokens.push({ type: 'ampersand', value: '&' });
      i++;
      continue;
    }

    if (ch === '\\\\') {
      tokens.push({ type: 'newline', value: '\\\\' });
      i += 2;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let num = '';
      while (i < latex.length && /[0-9.]/.test(latex[i])) {
        num += latex[i];
        i++;
      }
      tokens.push({ type: 'text', value: num });
      continue;
    }

    if (/[a-zA-Z]/.test(ch)) {
      tokens.push({ type: 'text', value: ch });
      i++;
      continue;
    }

    if ('+-=<>!/,'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    if ('()[]'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      i++;
      continue;
    }

    i++;
  }

  return tokens;
}

interface ParseResult {
  node: LatexASTNode;
  nextIndex: number;
}

function parseExpression(tokens: Token[], startIndex: number, stopTypes?: Token['type'][]): ParseResult {
  const children: LatexASTNode[] = [];
  let i = startIndex;

  while (i < tokens.length) {
    const token = tokens[i];

    if (stopTypes && stopTypes.includes(token.type)) {
      break;
    }

    if (token.type === 'group_close') {
      break;
    }

    if (token.type === 'command') {
      const cmdResult = parseCommand(tokens, i);
      children.push(cmdResult.node);
      i = cmdResult.nextIndex;
      continue;
    }

    if (token.type === 'group_open') {
      const groupResult = parseGroup(tokens, i);
      children.push(groupResult.node);
      i = groupResult.nextIndex;
      continue;
    }

    if (token.type === 'superscript') {
      i++;
      if (i < tokens.length) {
        let supResult: ParseResult;
        if (tokens[i].type === 'group_open') {
          supResult = parseGroup(tokens, i);
        } else {
          supResult = { node: tokenToNode(tokens[i]), nextIndex: i + 1 };
        }
        if (children.length > 0) {
          const lastChild = children[children.length - 1];
          lastChild.children.push({ ...supResult.node, type: 'superscript' });
        } else {
          children.push({ type: 'root', value: '', children: [{ ...supResult.node, type: 'superscript' }] });
        }
        i = supResult.nextIndex;
      }
      continue;
    }

    if (token.type === 'subscript') {
      i++;
      if (i < tokens.length) {
        let subResult: ParseResult;
        if (tokens[i].type === 'group_open') {
          subResult = parseGroup(tokens, i);
        } else {
          subResult = { node: tokenToNode(tokens[i]), nextIndex: i + 1 };
        }
        if (children.length > 0) {
          const lastChild = children[children.length - 1];
          lastChild.children.push({ ...subResult.node, type: 'subscript' });
        } else {
          children.push({ type: 'root', value: '', children: [{ ...subResult.node, type: 'subscript' }] });
        }
        i = subResult.nextIndex;
      }
      continue;
    }

    if (token.type === 'ampersand' || token.type === 'newline') {
      i++;
      continue;
    }

    children.push(tokenToNode(token));
    i++;
  }

  if (children.length === 1) {
    return { node: children[0], nextIndex: i };
  }

  return {
    node: { type: 'root', value: '', children },
    nextIndex: i,
  };
}

function parseCommand(tokens: Token[], startIndex: number): ParseResult {
  const cmd = tokens[startIndex].value;
  let i = startIndex + 1;

  const commandsWithArgs: Record<string, number> = {
    '\\frac': 2,
    '\\sqrt': 1,
    '\\int': 0,
    '\\sum': 0,
    '\\prod': 0,
    '\\lim': 0,
    '\\left': 1,
    '\\right': 1,
    '\\begin': 1,
    '\\end': 1,
    '\\binom': 2,
    '\\partial': 0,
    '\\text': 1,
    '\\mathrm': 1,
    '\\mathbf': 1,
    '\\vec': 1,
    '\\hat': 1,
    '\\bar': 1,
    '\\dot': 1,
  };

  const argCount = commandsWithArgs[cmd];

  if (cmd === '\\begin') {
    const envResult = parseGroup(tokens, i);
    i = envResult.nextIndex;

    const matrixRows: LatexASTNode[][] = [];
    let currentRow: LatexASTNode[] = [];

    while (i < tokens.length) {
      if (tokens[i].type === 'command' && tokens[i].value === '\\end') {
        i++;
        i++;
        break;
      }
      if (tokens[i].type === 'newline') {
        if (currentRow.length > 0) {
          matrixRows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      }
      if (tokens[i].type === 'ampersand') {
        i++;
        continue;
      }

      const exprResult = parseExpression(tokens, i, ['ampersand', 'newline', 'group_close']);
      if (exprResult.node.children.length > 0 || exprResult.node.value) {
        currentRow.push(exprResult.node);
      }
      i = exprResult.nextIndex;
    }

    if (currentRow.length > 0) {
      matrixRows.push(currentRow);
    }

    return {
      node: {
        type: 'command',
        value: 'matrix',
        children: matrixRows.map(row => ({
          type: 'root',
          value: '',
          children: row,
        })),
      },
      nextIndex: i,
    };
  }

  if (argCount === undefined || argCount === 0) {
    const node: LatexASTNode = { type: 'command', value: cmd, children: [] };

    while (i < tokens.length) {
      if (tokens[i].type === 'subscript') {
        i++;
        const subResult = parseSingleArg(tokens, i);
        node.children.push({ ...subResult.node, type: 'subscript' });
        i = subResult.nextIndex;
      } else if (tokens[i].type === 'superscript') {
        i++;
        const supResult = parseSingleArg(tokens, i);
        node.children.push({ ...supResult.node, type: 'superscript' });
        i = supResult.nextIndex;
      } else {
        break;
      }
    }

    return { node, nextIndex: i };
  }

  const args: LatexASTNode[] = [];
  for (let a = 0; a < argCount && i < tokens.length; a++) {
    const argResult = parseSingleArg(tokens, i);
    args.push(argResult.node);
    i = argResult.nextIndex;
  }

  return {
    node: { type: 'command', value: cmd, children: args },
    nextIndex: i,
  };
}

function parseSingleArg(tokens: Token[], startIndex: number): ParseResult {
  if (startIndex < tokens.length && tokens[startIndex].type === 'group_open') {
    return parseGroup(tokens, startIndex);
  }
  if (startIndex < tokens.length) {
    if (tokens[startIndex].type === 'command') {
      return parseCommand(tokens, startIndex);
    }
    return { node: tokenToNode(tokens[startIndex]), nextIndex: startIndex + 1 };
  }
  return { node: { type: 'text', value: '', children: [] }, nextIndex: startIndex };
}

function parseGroup(tokens: Token[], startIndex: number): ParseResult {
  if (startIndex >= tokens.length || tokens[startIndex].type !== 'group_open') {
    return { node: { type: 'group', value: '', children: [] }, nextIndex: startIndex };
  }

  let i = startIndex + 1;
  let depth = 1;

  const groupStart = i;
  while (i < tokens.length && depth > 0) {
    if (tokens[i].type === 'group_open') depth++;
    if (tokens[i].type === 'group_close') depth--;
    if (depth > 0) i++;
  }

  const groupTokens = tokens.slice(groupStart, i);
  const innerResult = parseExpression(groupTokens, 0);

  const endIdx = i + 1;
  return {
    node: { type: 'group', value: '', children: [innerResult.node] },
    nextIndex: endIdx,
  };
}

function tokenToNode(token: Token): LatexASTNode {
  switch (token.type) {
    case 'text':
      return { type: 'text', value: token.value, children: [] };
    case 'operator':
      return { type: 'operator', value: token.value, children: [] };
    default:
      return { type: 'text', value: token.value, children: [] };
  }
}

interface ComparisonResult {
  score: number;
  structureMatch: boolean;
  symbolErrors: number;
  totalSymbols: number;
}

function normalizeAST(node: LatexASTNode): LatexASTNode {
  const normalizedChildren = node.children.map(normalizeAST);

  if (node.type === 'command') {
    return {
      ...node,
      value: normalizeCommand(node.value),
      children: normalizedChildren,
    };
  }

  if (node.type === 'group' && normalizedChildren.length === 1) {
    return normalizedChildren[0];
  }

  if (node.type === 'root' && normalizedChildren.length === 1) {
    return normalizedChildren[0];
  }

  return { ...node, children: normalizedChildren };
}

function countSymbols(node: LatexASTNode): number {
  let count = 0;
  if (node.type === 'text' || node.type === 'operator') {
    if (node.value) count = 1;
  }
  if (node.type === 'command') {
    count = 1;
  }
  return count + node.children.reduce((sum, child) => sum + countSymbols(child), 0);
}

function compareNodes(a: LatexASTNode, b: LatexASTNode): { matches: number; errors: number; structureMatch: boolean } {
  const normA = normalizeAST(a);
  const normB = normalizeAST(b);

  if (normA.type === 'root' && normB.type === 'root') {
    return compareChildLists(normA.children, normB.children);
  }

  if (normA.type === 'root') {
    return compareNodes(normA.children[0] || { type: 'text', value: '', children: [] }, normB);
  }
  if (normB.type === 'root') {
    return compareNodes(normA, normB.children[0] || { type: 'text', value: '', children: [] });
  }

  if (normA.type === 'command' && normB.type === 'command') {
    if (areEquivalentCommands(normA.value, normB.value)) {
      const childComparison = compareChildLists(normA.children, normB.children);
      return {
        matches: 1 + childComparison.matches,
        errors: childComparison.errors,
        structureMatch: childComparison.structureMatch,
      };
    }
    return { matches: 0, errors: 1, structureMatch: false };
  }

  if (normA.type === normB.type) {
    if (normA.type === 'text' || normA.type === 'operator') {
      if (normA.value === normB.value) {
        return { matches: 1, errors: 0, structureMatch: true };
      }
      return { matches: 0, errors: 1, structureMatch: true };
    }

    if (normA.type === 'group') {
      return compareChildLists(normA.children, normB.children);
    }

    if (normA.type === 'superscript' || normA.type === 'subscript') {
      return compareChildLists(normA.children, normB.children);
    }

    return compareChildLists(normA.children, normB.children);
  }

  return { matches: 0, errors: Math.max(countSymbols(normA), countSymbols(normB)), structureMatch: false };
}

function compareChildLists(aChildren: LatexASTNode[], bChildren: LatexASTNode[]): { matches: number; errors: number; structureMatch: boolean } {
  const maxLen = Math.max(aChildren.length, bChildren.length);
  if (maxLen === 0) return { matches: 0, errors: 0, structureMatch: true };

  let totalMatches = 0;
  let totalErrors = 0;
  let allStructureMatch = true;

  const minLen = Math.min(aChildren.length, bChildren.length);

  for (let i = 0; i < minLen; i++) {
    const result = compareNodes(aChildren[i], bChildren[i]);
    totalMatches += result.matches;
    totalErrors += result.errors;
    if (!result.structureMatch) allStructureMatch = false;
  }

  const extraChildren = Math.abs(aChildren.length - bChildren.length);
  if (extraChildren > 0) {
    totalErrors += extraChildren;
    allStructureMatch = false;
  }

  return {
    matches: totalMatches,
    errors: totalErrors,
    structureMatch: allStructureMatch,
  };
}

export function compareLatex(targetLatex: string, recognizedLatex: string): ComparisonResult {
  if (!targetLatex.trim() && !recognizedLatex.trim()) {
    return { score: 100, structureMatch: true, symbolErrors: 0, totalSymbols: 0 };
  }
  if (!recognizedLatex.trim()) {
    return { score: 0, structureMatch: false, symbolErrors: countSymbols(parseLatexToAST(targetLatex)), totalSymbols: countSymbols(parseLatexToAST(targetLatex)) };
  }

  const targetAST = normalizeAST(parseLatexToAST(targetLatex));
  const recognizedAST = normalizeAST(parseLatexToAST(recognizedLatex));

  const totalSymbols = Math.max(countSymbols(targetAST), 1);
  const comparison = compareNodes(targetAST, recognizedAST);

  let score: number;
  if (comparison.structureMatch && comparison.errors === 0) {
    score = 100;
  } else if (comparison.structureMatch) {
    const penalty = comparison.errors * 10;
    score = Math.max(60, 100 - penalty);
  } else {
    const matchRatio = comparison.matches / Math.max(totalSymbols, 1);
    score = Math.max(0, Math.min(40, Math.round(matchRatio * 60)));
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    structureMatch: comparison.structureMatch,
    symbolErrors: comparison.errors,
    totalSymbols,
  };
}

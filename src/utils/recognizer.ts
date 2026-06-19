import { v4 as uuidv4 } from 'uuid';
import { Stroke, RecognizedSymbol, SymbolCandidate } from '../types';
import { SYMBOL_CATEGORIES } from '../constants';
import { getBoundingBox, getStrokesBoundingBox, strokesToImageData } from './preprocessing';

interface FeatureVector {
  numStrokes: number;
  aspectRatio: number;
  horizontalExtent: number;
  verticalExtent: number;
  directionChanges: number;
  enclosedArea: number;
  horizontalSymmetry: number;
  verticalSymmetry: number;
  pixelDensity: number;
  centerOfMassX: number;
  centerOfMassY: number;
  strokeLengths: number[];
  dominantDirection: number;
  cornerCount: number;
  loopCount: number;
}

const extractFeatures = (strokes: Stroke[], size: number = 64): FeatureVector => {
  const bb = getStrokesBoundingBox(strokes);
  const imageData = strokesToImageData(strokes, size);
  
  const numStrokes = strokes.length;
  const aspectRatio = bb.height > 0 ? bb.width / bb.height : 1;
  
  let horizontalExtent = 0;
  let verticalExtent = 0;
  let directionChanges = 0;
  let totalLength = 0;
  const strokeLengths: number[] = [];
  
  for (const stroke of strokes) {
    let strokeLen = 0;
    let prevAngle: number | null = null;
    
    for (let i = 1; i < stroke.points.length; i++) {
      const p1 = stroke.points[i - 1];
      const p2 = stroke.points[i];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      strokeLen += len;
      totalLength += len;
      
      if (len > 0) {
        const angle = Math.atan2(dy, dx);
        if (prevAngle !== null) {
          let diff = Math.abs(angle - prevAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff > Math.PI / 4) {
            directionChanges++;
          }
        }
        prevAngle = angle;
      }
    }
    strokeLengths.push(strokeLen);
  }
  
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (imageData[y * size + x] > 0) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  
  const centerOfMassX = count > 0 ? sumX / count / size : 0.5;
  const centerOfMassY = count > 0 ? sumY / count / size : 0.5;
  const pixelDensity = count / (size * size);
  
  let horizontalSymmetry = 0;
  let verticalSymmetry = 0;
  let symmetryCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size / 2; x++) {
      const left = imageData[y * size + x];
      const right = imageData[y * size + (size - 1 - x)];
      if (left > 0 || right > 0) {
        horizontalSymmetry += 1 - Math.abs(left - right) / 255;
        symmetryCount++;
      }
    }
  }
  horizontalSymmetry = symmetryCount > 0 ? horizontalSymmetry / symmetryCount : 0;
  
  symmetryCount = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size / 2; y++) {
      const top = imageData[y * size + x];
      const bottom = imageData[(size - 1 - y) * size + x];
      if (top > 0 || bottom > 0) {
        verticalSymmetry += 1 - Math.abs(top - bottom) / 255;
        symmetryCount++;
      }
    }
  }
  verticalSymmetry = symmetryCount > 0 ? verticalSymmetry / symmetryCount : 0;
  
  let enclosedArea = 0;
  let visited = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (imageData[y * size + x] === 0 && visited[y * size + x] === 0) {
        let isEnclosed = true;
        let area = 0;
        let stack = [[x, y]];
        
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          if (cx < 0 || cx >= size || cy < 0 || cy >= size) {
            isEnclosed = false;
            continue;
          }
          if (visited[cy * size + cx] === 1 || imageData[cy * size + cx] > 0) {
            continue;
          }
          visited[cy * size + cx] = 1;
          area++;
          
          stack.push([cx + 1, cy]);
          stack.push([cx - 1, cy]);
          stack.push([cx, cy + 1]);
          stack.push([cx, cy - 1]);
        }
        
        if (isEnclosed) {
          enclosedArea += area;
        }
      }
    }
  }
  
  let dominantDirection = 0;
  if (strokes.length > 0 && strokes[0].points.length > 1) {
    const first = strokes[0].points[0];
    const last = strokes[0].points[strokes[0].points.length - 1];
    dominantDirection = Math.atan2(last.y - first.y, last.x - first.x);
  }
  
  let cornerCount = 0;
  for (const stroke of strokes) {
    for (let i = 2; i < stroke.points.length; i++) {
      const p0 = stroke.points[i - 2];
      const p1 = stroke.points[i - 1];
      const p2 = stroke.points[i];
      
      const v1x = p1.x - p0.x;
      const v1y = p1.y - p0.y;
      const v2x = p2.x - p1.x;
      const v2y = p2.y - p1.y;
      
      const dot = v1x * v2x + v1y * v2y;
      const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
      const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);
      
      if (mag1 > 0 && mag2 > 0) {
        const cos = dot / (mag1 * mag2);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
        if (angle > Math.PI / 3) {
          cornerCount++;
        }
      }
    }
  }
  
  let loopCount = 0;
  if (enclosedArea > 100) {
    loopCount = Math.round(enclosedArea / 500);
  }
  
  return {
    numStrokes,
    aspectRatio,
    horizontalExtent,
    verticalExtent,
    directionChanges,
    enclosedArea,
    horizontalSymmetry,
    verticalSymmetry,
    pixelDensity,
    centerOfMassX,
    centerOfMassY,
    strokeLengths,
    dominantDirection,
    cornerCount,
    loopCount,
  };
};

const compareFeatures = (f1: FeatureVector, f2: Partial<FeatureVector>): number => {
  let score = 0;
  
  if (f2.numStrokes !== undefined) {
    score += Math.abs(f1.numStrokes - f2.numStrokes) * -10;
  }
  
  if (f2.aspectRatio !== undefined) {
    const diff = Math.abs(f1.aspectRatio - f2.aspectRatio);
    score += Math.max(0, 10 - diff * 5);
  }
  
  if (f2.loopCount !== undefined) {
    score += Math.abs(f1.loopCount - f2.loopCount) * -15;
  }
  
  if (f2.cornerCount !== undefined) {
    const diff = Math.abs(f1.cornerCount - f2.cornerCount);
    score += Math.max(0, 10 - diff * 2);
  }
  
  if (f2.horizontalSymmetry !== undefined) {
    const diff = Math.abs(f1.horizontalSymmetry - f2.horizontalSymmetry);
    score += Math.max(0, 10 - diff * 10);
  }
  
  if (f2.verticalSymmetry !== undefined) {
    const diff = Math.abs(f1.verticalSymmetry - f2.verticalSymmetry);
    score += Math.max(0, 10 - diff * 10);
  }
  
  if (f2.dominantDirection !== undefined) {
    let diff = Math.abs(f1.dominantDirection - f2.dominantDirection);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    score += Math.max(0, 10 - diff * 3);
  }
  
  return score;
};

const symbolTemplates: Record<string, Partial<FeatureVector>> = {
  '0': { numStrokes: 1, loopCount: 1, aspectRatio: 0.8, horizontalSymmetry: 0.8, verticalSymmetry: 0.8 },
  '1': { numStrokes: 1, aspectRatio: 0.3, loopCount: 0, cornerCount: 0 },
  '2': { numStrokes: 1, loopCount: 0, cornerCount: 2, aspectRatio: 0.6 },
  '3': { numStrokes: 1, loopCount: 0, cornerCount: 2, aspectRatio: 0.6 },
  '4': { numStrokes: 2, loopCount: 0, cornerCount: 3, aspectRatio: 0.6 },
  '5': { numStrokes: 2, loopCount: 0, cornerCount: 2, aspectRatio: 0.6 },
  '6': { numStrokes: 1, loopCount: 1, aspectRatio: 0.7 },
  '7': { numStrokes: 2, loopCount: 0, cornerCount: 1, aspectRatio: 0.5 },
  '8': { numStrokes: 1, loopCount: 2, aspectRatio: 0.7, horizontalSymmetry: 0.7, verticalSymmetry: 0.7 },
  '9': { numStrokes: 1, loopCount: 1, aspectRatio: 0.7 },
  '+': { numStrokes: 2, horizontalSymmetry: 0.8, verticalSymmetry: 0.8, aspectRatio: 1.0 },
  '-': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: 0 },
  '*': { numStrokes: 3, horizontalSymmetry: 0.8, verticalSymmetry: 0.8 },
  '/': { numStrokes: 1, dominantDirection: -Math.PI / 4, aspectRatio: 0.5 },
  '=': { numStrokes: 2, aspectRatio: 2.0, dominantDirection: 0, horizontalSymmetry: 0.9 },
  '(': { numStrokes: 1, aspectRatio: 0.5, verticalSymmetry: 0.8 },
  ')': { numStrokes: 1, aspectRatio: 0.5, verticalSymmetry: 0.8 },
  '[': { numStrokes: 1, aspectRatio: 0.4, cornerCount: 4 },
  ']': { numStrokes: 1, aspectRatio: 0.4, cornerCount: 4 },
  'x': { numStrokes: 2, horizontalSymmetry: 0.7, verticalSymmetry: 0.7, aspectRatio: 0.8 },
  'y': { numStrokes: 2, aspectRatio: 0.6, cornerCount: 1 },
  'a': { numStrokes: 1, loopCount: 1, aspectRatio: 0.8 },
  'b': { numStrokes: 1, loopCount: 1, aspectRatio: 0.5 },
  'c': { numStrokes: 1, loopCount: 0, aspectRatio: 0.7, verticalSymmetry: 0.5 },
  'd': { numStrokes: 1, loopCount: 1, aspectRatio: 0.5 },
  'e': { numStrokes: 1, loopCount: 0, aspectRatio: 0.8, cornerCount: 1 },
  'f': { numStrokes: 1, aspectRatio: 0.4, cornerCount: 2 },
  'g': { numStrokes: 1, loopCount: 1, aspectRatio: 0.6 },
  'h': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 2 },
  'i': { numStrokes: 2, aspectRatio: 0.3 },
  'j': { numStrokes: 2, aspectRatio: 0.4 },
  'k': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 2 },
  'l': { numStrokes: 1, aspectRatio: 0.3, cornerCount: 0 },
  'm': { numStrokes: 1, aspectRatio: 1.2, cornerCount: 2 },
  'n': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1 },
  'o': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9, horizontalSymmetry: 0.8, verticalSymmetry: 0.8 },
  'p': { numStrokes: 1, loopCount: 1, aspectRatio: 0.5 },
  'q': { numStrokes: 1, loopCount: 1, aspectRatio: 0.5 },
  'r': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 1 },
  's': { numStrokes: 1, loopCount: 0, aspectRatio: 0.6, cornerCount: 0 },
  't': { numStrokes: 2, aspectRatio: 0.4 },
  'u': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1 },
  'v': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1 },
  'w': { numStrokes: 1, aspectRatio: 1.2, cornerCount: 2 },
  'z': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 2 },
  'A': { numStrokes: 3, aspectRatio: 0.8, cornerCount: 3 },
  'B': { numStrokes: 2, loopCount: 2, aspectRatio: 0.6 },
  'C': { numStrokes: 1, loopCount: 0, aspectRatio: 0.8, verticalSymmetry: 0.6 },
  'D': { numStrokes: 2, loopCount: 1, aspectRatio: 0.6 },
  'E': { numStrokes: 4, aspectRatio: 0.6, cornerCount: 6 },
  'F': { numStrokes: 3, aspectRatio: 0.5, cornerCount: 4 },
  'G': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9 },
  'H': { numStrokes: 3, aspectRatio: 0.8, horizontalSymmetry: 0.8 },
  'I': { numStrokes: 1, aspectRatio: 0.3 },
  'J': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 1 },
  'K': { numStrokes: 3, aspectRatio: 0.7, cornerCount: 2 },
  'L': { numStrokes: 2, aspectRatio: 0.6, cornerCount: 1 },
  'M': { numStrokes: 1, aspectRatio: 1.0, cornerCount: 3 },
  'N': { numStrokes: 3, aspectRatio: 0.7, cornerCount: 2 },
  'O': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9, horizontalSymmetry: 0.8, verticalSymmetry: 0.8 },
  'P': { numStrokes: 2, loopCount: 1, aspectRatio: 0.6 },
  'Q': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9 },
  'R': { numStrokes: 2, loopCount: 1, aspectRatio: 0.6 },
  'S': { numStrokes: 1, loopCount: 0, aspectRatio: 0.7 },
  'T': { numStrokes: 2, aspectRatio: 0.7, horizontalSymmetry: 0.8 },
  'U': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 1 },
  'V': { numStrokes: 2, aspectRatio: 0.8, cornerCount: 1 },
  'W': { numStrokes: 1, aspectRatio: 1.3, cornerCount: 3 },
  'X': { numStrokes: 2, horizontalSymmetry: 0.8, verticalSymmetry: 0.8, aspectRatio: 0.9 },
  'Y': { numStrokes: 3, aspectRatio: 0.7, cornerCount: 1 },
  'Z': { numStrokes: 1, aspectRatio: 0.9, cornerCount: 2 },
  'alpha': { numStrokes: 1, loopCount: 1, aspectRatio: 0.8 },
  'beta': { numStrokes: 1, loopCount: 2, aspectRatio: 0.5 },
  'gamma': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 1 },
  'delta': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 1 },
  'pi': { numStrokes: 2, aspectRatio: 1.0, horizontalSymmetry: 0.7 },
  'sigma': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 2 },
  'sum': { numStrokes: 1, aspectRatio: 0.9, cornerCount: 4, horizontalSymmetry: 0.8 },
  'int': { numStrokes: 1, aspectRatio: 0.4, loopCount: 0 },
  'sqrt': { numStrokes: 2, aspectRatio: 0.8, cornerCount: 2 },
  'fraction': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: 0 },
  '>': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1, dominantDirection: Math.PI / 4 },
  '<': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1, dominantDirection: -Math.PI / 4 },
  '.': { numStrokes: 1, aspectRatio: 1.0, pixelDensity: 0.1 },
  ',': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 1 },
  '!': { numStrokes: 2, aspectRatio: 0.3 },
  'neq': { numStrokes: 2, aspectRatio: 1.5 },
  'geq': { numStrokes: 2, aspectRatio: 1.0 },
  'leq': { numStrokes: 2, aspectRatio: 1.0 },
  'approx': { numStrokes: 2, aspectRatio: 2.0 },
  'pm': { numStrokes: 2, aspectRatio: 0.8, horizontalSymmetry: 0.7 },
  'rightarrow': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: 0, cornerCount: 1 },
  'leftarrow': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: Math.PI, cornerCount: 1 },
  'infty': { numStrokes: 1, loopCount: 2, aspectRatio: 1.5 },
  'partial': { numStrokes: 1, loopCount: 1, aspectRatio: 0.8 },
  'lim': { numStrokes: 3, aspectRatio: 1.2 },
  'prod': { numStrokes: 1, aspectRatio: 0.9, cornerCount: 4, horizontalSymmetry: 0.8 },
  'in': { numStrokes: 2, aspectRatio: 0.8 },
  'subset': { numStrokes: 1, aspectRatio: 1.0, cornerCount: 2 },
};

const recognizeSymbol = (strokes: Stroke[]): RecognizedSymbol | null => {
  if (strokes.length === 0) return null;
  
  const features = extractFeatures(strokes);
  const bb = getStrokesBoundingBox(strokes);
  
  const scores: SymbolCandidate[] = [];
  
  for (const category of SYMBOL_CATEGORIES) {
    const template = symbolTemplates[category.label];
    if (template) {
      const score = compareFeatures(features, template);
      scores.push({
        ...category,
        probability: Math.max(0, score),
      });
    } else {
      scores.push({
        ...category,
        probability: 0.1,
      });
    }
  }
  
  scores.sort((a, b) => b.probability - a.probability);
  
  const totalScore = scores.reduce((sum, s) => sum + s.probability, 0);
  const normalized = scores.map(s => ({
    ...s,
    probability: totalScore > 0 ? s.probability / totalScore : 0,
  }));
  
  return {
    id: uuidv4(),
    strokes: [...strokes],
    boundingBox: bb,
    candidates: normalized.slice(0, 5),
    selectedCandidate: 0,
  };
};

const isHorizontalLine = (stroke: Stroke): boolean => {
  const bb = stroke.boundingBox || getBoundingBox(stroke.points);
  return bb.width > bb.height * 4 && bb.height < 15;
};

const isFractionBar = (stroke: Stroke, allStrokes: Stroke[]): boolean => {
  if (!isHorizontalLine(stroke)) return false;
  
  const bb = stroke.boundingBox || getBoundingBox(stroke.points);
  const midY = bb.y + bb.height / 2;
  
  let hasAbove = false;
  let hasBelow = false;
  
  for (const s of allStrokes) {
    if (s.id === stroke.id) continue;
    const sbb = s.boundingBox || getBoundingBox(s.points);
    const sMidY = sbb.y + sbb.height / 2;
    
    if (sMidY < midY - bb.height) hasAbove = true;
    if (sMidY > midY + bb.height) hasBelow = true;
  }
  
  return hasAbove && hasBelow;
};

const isRadical = (strokes: Stroke[]): boolean => {
  if (strokes.length < 2) return false;
  
  const firstStroke = strokes[0];
  const bb1 = firstStroke.boundingBox || getBoundingBox(firstStroke.points);
  
  const start = firstStroke.points[0];
  const end = firstStroke.points[firstStroke.points.length - 1];
  
  const goingUpRight = end.y < start.y && end.x > start.x;
  
  return goingUpRight && bb1.height > 20;
};

const groupStrokesByProximity = (strokes: Stroke[]): Stroke[][] => {
  if (strokes.length === 0) return [];
  
  const groups: Stroke[][] = [];
  const used = new Set<string>();
  
  const sorted = [...strokes].sort((a, b) => {
    const bba = a.boundingBox || getBoundingBox(a.points);
    const bbb = b.boundingBox || getBoundingBox(b.points);
    return bba.x - bbb.x;
  });
  
  for (const stroke of sorted) {
    if (used.has(stroke.id)) continue;
    
    const group: Stroke[] = [stroke];
    used.add(stroke.id);
    
    const bb = stroke.boundingBox || getBoundingBox(stroke.points);
    const threshold = Math.max(bb.width, bb.height) * 1.5;
    
    let added = true;
    while (added) {
      added = false;
      for (const s of sorted) {
        if (used.has(s.id)) continue;
        
        const sbb = s.boundingBox || getBoundingBox(s.points);
        const groupBB = getStrokesBoundingBox(group);
        
        const dx = Math.max(0, groupBB.x - (sbb.x + sbb.width), sbb.x - (groupBB.x + groupBB.width));
        const dy = Math.max(0, groupBB.y - (sbb.y + sbb.height), sbb.y - (groupBB.y + groupBB.height));
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < threshold) {
          group.push(s);
          used.add(s.id);
          added = true;
        }
      }
    }
    
    groups.push(group);
  }
  
  return groups;
};

export const recognizeStrokes = (strokes: Stroke[]): RecognizedSymbol[] => {
  if (strokes.length === 0) return [];
  
  const symbols: RecognizedSymbol[] = [];
  const processedStrokes = new Set<string>();
  
  for (const stroke of strokes) {
    if (processedStrokes.has(stroke.id)) continue;
    
    if (isFractionBar(stroke, strokes)) {
      const bb = stroke.boundingBox || getBoundingBox(stroke.points);
      const fracSymbol: RecognizedSymbol = {
        id: uuidv4(),
        strokes: [stroke],
        boundingBox: bb,
        candidates: [
          { label: 'fraction', latex: '\\frac', probability: 0.95 },
          { label: '-', latex: '-', probability: 0.05 },
        ],
        selectedCandidate: 0,
      };
      symbols.push(fracSymbol);
      processedStrokes.add(stroke.id);
      continue;
    }
  }
  
  const remainingStrokes = strokes.filter(s => !processedStrokes.has(s.id));
  const groups = groupStrokesByProximity(remainingStrokes);
  
  for (const group of groups) {
    if (isRadical(group) && group.length >= 2) {
      const bb = getStrokesBoundingBox(group);
      const sqrtSymbol: RecognizedSymbol = {
        id: uuidv4(),
        strokes: group,
        boundingBox: bb,
        candidates: [
          { label: 'sqrt', latex: '\\sqrt', probability: 0.9 },
          { label: '<', latex: '<', probability: 0.1 },
        ],
        selectedCandidate: 0,
      };
      symbols.push(sqrtSymbol);
      for (const s of group) processedStrokes.add(s.id);
      continue;
    }
    
    const recognized = recognizeSymbol(group);
    if (recognized) {
      symbols.push(recognized);
      for (const s of group) processedStrokes.add(s.id);
    }
  }
  
  symbols.sort((a, b) => {
    const bba = a.boundingBox;
    const bbb = b.boundingBox;
    const aMidY = bba.y + bba.height / 2;
    const bMidY = bbb.y + bbb.height / 2;
    
    if (Math.abs(aMidY - bMidY) < Math.min(bba.height, bbb.height) * 0.5) {
      return bba.x - bbb.x;
    }
    return aMidY - bMidY;
  });
  
  return symbols;
};

import { v4 as uuidv4 } from 'uuid';
import { Stroke, RecognizedSymbol, SymbolCandidate } from '../types';
import { SYMBOL_CATEGORIES } from '../constants';
import { getBoundingBox, getStrokesBoundingBox, strokesToImageData, normalizeStrokes } from './preprocessing';

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
  zoneDensities: number[];
  horizontalProfile: number[];
  verticalProfile: number[];
  endpointCount: number;
  intersectionCount: number;
  topHeavy: number;
  leftHeavy: number;
}

const extractFeatures = (strokes: Stroke[], size: number = 64): FeatureVector => {
  const normalizedStrokes = normalizeStrokes(strokes, size);
  const bb = getStrokesBoundingBox(normalizedStrokes);
  const imageData = strokesToImageData(normalizedStrokes, size);
  
  const numStrokes = normalizedStrokes.length;
  const aspectRatio = bb.height > 0 ? bb.width / bb.height : 1;
  
  let horizontalExtent = 0;
  let verticalExtent = 0;
  let directionChanges = 0;
  let totalLength = 0;
  const strokeLengths: number[] = [];
  
  for (const stroke of normalizedStrokes) {
    let strokeLen = 0;
    let prevAngle: number | null = null;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (let i = 0; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    
    horizontalExtent += (maxX - minX);
    verticalExtent += (maxY - minY);
    
    for (let i = 1; i < stroke.points.length; i++) {
      const p1 = stroke.points[i - 1];
      const p2 = stroke.points[i];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      strokeLen += len;
      totalLength += len;
      
      if (len > 0.5) {
        const angle = Math.atan2(dy, dx);
        if (prevAngle !== null) {
          let diff = Math.abs(angle - prevAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff > Math.PI / 6) {
            directionChanges++;
          }
        }
        prevAngle = angle;
      }
    }
    strokeLengths.push(strokeLen);
  }
  
  horizontalExtent = numStrokes > 0 ? horizontalExtent / numStrokes : 0;
  verticalExtent = numStrokes > 0 ? verticalExtent / numStrokes : 0;
  
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
  
  const zoneDensities: number[] = [];
  const zoneSize = Math.floor(size / 3);
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      let zoneCount = 0;
      for (let y = zy * zoneSize; y < (zy + 1) * zoneSize && y < size; y++) {
        for (let x = zx * zoneSize; x < (zx + 1) * zoneSize && x < size; x++) {
          if (imageData[y * size + x] > 0) {
            zoneCount++;
          }
        }
      }
      zoneDensities.push(zoneCount / (zoneSize * zoneSize));
    }
  }
  
  const horizontalProfile: number[] = [];
  for (let y = 0; y < size; y++) {
    let rowCount = 0;
    for (let x = 0; x < size; x++) {
      if (imageData[y * size + x] > 0) rowCount++;
    }
    horizontalProfile.push(rowCount / size);
  }
  
  const verticalProfile: number[] = [];
  for (let x = 0; x < size; x++) {
    let colCount = 0;
    for (let y = 0; y < size; y++) {
      if (imageData[y * size + x] > 0) colCount++;
    }
    verticalProfile.push(colCount / size);
  }
  
  let topHalfDensity = 0;
  let bottomHalfDensity = 0;
  let leftHalfDensity = 0;
  let rightHalfDensity = 0;
  const halfSize = Math.floor(size / 2);
  
  for (let y = 0; y < halfSize; y++) {
    for (let x = 0; x < size; x++) {
      if (imageData[y * size + x] > 0) topHalfDensity++;
    }
  }
  for (let y = halfSize; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (imageData[y * size + x] > 0) bottomHalfDensity++;
    }
  }
  for (let x = 0; x < halfSize; x++) {
    for (let y = 0; y < size; y++) {
      if (imageData[y * size + x] > 0) leftHalfDensity++;
    }
  }
  for (let x = halfSize; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (imageData[y * size + x] > 0) rightHalfDensity++;
    }
  }
  
  const topHeavy = topHalfDensity / Math.max(1, topHalfDensity + bottomHalfDensity);
  const leftHeavy = leftHalfDensity / Math.max(1, leftHalfDensity + rightHalfDensity);
  
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
  if (normalizedStrokes.length > 0 && normalizedStrokes[0].points.length > 1) {
    const first = normalizedStrokes[0].points[0];
    const last = normalizedStrokes[0].points[normalizedStrokes[0].points.length - 1];
    dominantDirection = Math.atan2(last.y - first.y, last.x - first.x);
  }
  
  let cornerCount = 0;
  for (const stroke of normalizedStrokes) {
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
      
      if (mag1 > 1 && mag2 > 1) {
        const cos = dot / (mag1 * mag2);
        const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
        if (angle > Math.PI / 4) {
          cornerCount++;
        }
      }
    }
  }
  
  let loopCount = 0;
  if (enclosedArea > 50) {
    loopCount = Math.min(3, Math.round(enclosedArea / 200));
  }
  
  let endpointCount = 0;
  for (const stroke of normalizedStrokes) {
    if (stroke.points.length >= 2) {
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      const dist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
      if (dist > size * 0.1) {
        endpointCount += 2;
      } else {
        endpointCount += 0;
      }
    }
  }
  
  let intersectionCount = 0;
  if (numStrokes >= 2) {
    for (let i = 0; i < normalizedStrokes.length; i++) {
      for (let j = i + 1; j < normalizedStrokes.length; j++) {
        const bb_i = normalizedStrokes[i].boundingBox || getBoundingBox(normalizedStrokes[i].points);
        const bb_j = normalizedStrokes[j].boundingBox || getBoundingBox(normalizedStrokes[j].points);
        if (bb_i.x < bb_j.x + bb_j.width && bb_i.x + bb_i.width > bb_j.x &&
            bb_i.y < bb_j.y + bb_j.height && bb_i.y + bb_i.height > bb_j.y) {
          intersectionCount++;
        }
      }
    }
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
    zoneDensities,
    horizontalProfile,
    verticalProfile,
    endpointCount,
    intersectionCount,
    topHeavy,
    leftHeavy,
  };
};

const compareFeatures = (f1: FeatureVector, f2: Partial<FeatureVector>): number => {
  let score = 0;
  
  if (f2.numStrokes !== undefined) {
    const diff = Math.abs(f1.numStrokes - f2.numStrokes);
    score += diff * -25;
  }
  
  if (f2.aspectRatio !== undefined) {
    const diff = Math.abs(f1.aspectRatio - f2.aspectRatio);
    score += Math.max(0, 15 - diff * 10);
  }
  
  if (f2.loopCount !== undefined) {
    const diff = Math.abs(f1.loopCount - f2.loopCount);
    score += diff * -20;
  }
  
  if (f2.cornerCount !== undefined) {
    const diff = Math.abs(f1.cornerCount - f2.cornerCount);
    score += Math.max(0, 15 - diff * 2);
  }
  
  if (f2.horizontalSymmetry !== undefined) {
    const diff = Math.abs(f1.horizontalSymmetry - f2.horizontalSymmetry);
    score += Math.max(0, 12 - diff * 15);
  }
  
  if (f2.verticalSymmetry !== undefined) {
    const diff = Math.abs(f1.verticalSymmetry - f2.verticalSymmetry);
    score += Math.max(0, 12 - diff * 15);
  }
  
  if (f2.dominantDirection !== undefined) {
    let diff = Math.abs(f1.dominantDirection - f2.dominantDirection);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    score += Math.max(0, 8 - diff * 2);
  }
  
  if (f2.topHeavy !== undefined) {
    const diff = Math.abs(f1.topHeavy - f2.topHeavy);
    score += Math.max(0, 10 - diff * 20);
  }
  
  if (f2.leftHeavy !== undefined) {
    const diff = Math.abs(f1.leftHeavy - f2.leftHeavy);
    score += Math.max(0, 8 - diff * 15);
  }
  
  if (f2.endpointCount !== undefined) {
    const diff = Math.abs(f1.endpointCount - f2.endpointCount);
    score += diff * -5;
  }
  
  if (f2.pixelDensity !== undefined) {
    const diff = Math.abs(f1.pixelDensity - f2.pixelDensity);
    score += Math.max(0, 5 - diff * 20);
  }
  
  if (f2.zoneDensities !== undefined && f1.zoneDensities.length === f2.zoneDensities.length) {
    let zoneScore = 0;
    for (let i = 0; i < f1.zoneDensities.length; i++) {
      const diff = Math.abs(f1.zoneDensities[i] - f2.zoneDensities[i]);
      zoneScore += Math.max(0, 2 - diff * 8);
    }
    score += zoneScore;
  }
  
  if (f2.centerOfMassY !== undefined) {
    const diff = Math.abs(f1.centerOfMassY - f2.centerOfMassY);
    score += Math.max(0, 5 - diff * 15);
  }
  
  return score;
};

const symbolTemplates: Record<string, Partial<FeatureVector>> = {
  '0': { numStrokes: 1, loopCount: 1, aspectRatio: 0.75, horizontalSymmetry: 0.85, verticalSymmetry: 0.85, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 0 },
  '1': { numStrokes: 1, aspectRatio: 0.35, loopCount: 0, cornerCount: 0, topHeavy: 0.45, leftHeavy: 0.5, endpointCount: 2 },
  '2': { numStrokes: 1, loopCount: 0, cornerCount: 2, aspectRatio: 0.6, topHeavy: 0.55, leftHeavy: 0.5, endpointCount: 2 },
  '3': { numStrokes: 1, loopCount: 0, cornerCount: 2, aspectRatio: 0.6, topHeavy: 0.5, leftHeavy: 0.55, endpointCount: 2 },
  '4': { numStrokes: 2, loopCount: 0, cornerCount: 3, aspectRatio: 0.6, topHeavy: 0.55, leftHeavy: 0.45, endpointCount: 4 },
  '5': { numStrokes: 2, loopCount: 0, cornerCount: 2, aspectRatio: 0.6, topHeavy: 0.55, leftHeavy: 0.45, endpointCount: 4 },
  '6': { numStrokes: 1, loopCount: 1, aspectRatio: 0.7, topHeavy: 0.6, leftHeavy: 0.5, endpointCount: 2 },
  '7': { numStrokes: 1, loopCount: 0, cornerCount: 1, aspectRatio: 0.5, topHeavy: 0.35, leftHeavy: 0.5, endpointCount: 2 },
  '8': { numStrokes: 1, loopCount: 2, aspectRatio: 0.7, horizontalSymmetry: 0.8, verticalSymmetry: 0.8, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 0 },
  '9': { numStrokes: 1, loopCount: 1, aspectRatio: 0.7, topHeavy: 0.45, leftHeavy: 0.5, endpointCount: 2 },
  '+': { numStrokes: 2, horizontalSymmetry: 0.9, verticalSymmetry: 0.9, aspectRatio: 1.0, topHeavy: 0.5, leftHeavy: 0.5, intersectionCount: 1, loopCount: 0 },
  '-': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: 0, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  '*': { numStrokes: 3, horizontalSymmetry: 0.8, verticalSymmetry: 0.8, aspectRatio: 0.9, loopCount: 0, endpointCount: 6 },
  '/': { numStrokes: 1, dominantDirection: -Math.PI / 4, aspectRatio: 0.5, loopCount: 0, endpointCount: 2, topHeavy: 0.3, leftHeavy: 0.3 },
  '=': { numStrokes: 2, aspectRatio: 2.0, dominantDirection: 0, horizontalSymmetry: 0.9, verticalSymmetry: 0.95, loopCount: 0, endpointCount: 4 },
  '(': { numStrokes: 1, aspectRatio: 0.5, verticalSymmetry: 0.8, leftHeavy: 0.7, loopCount: 0, endpointCount: 2 },
  ')': { numStrokes: 1, aspectRatio: 0.5, verticalSymmetry: 0.8, leftHeavy: 0.3, loopCount: 0, endpointCount: 2 },
  '[': { numStrokes: 1, aspectRatio: 0.4, cornerCount: 4, leftHeavy: 0.7, loopCount: 0, endpointCount: 2 },
  ']': { numStrokes: 1, aspectRatio: 0.4, cornerCount: 4, leftHeavy: 0.3, loopCount: 0, endpointCount: 2 },
  'x': { numStrokes: 2, horizontalSymmetry: 0.75, verticalSymmetry: 0.75, aspectRatio: 0.85, loopCount: 0, endpointCount: 4, intersectionCount: 1, topHeavy: 0.5 },
  'y': { numStrokes: 2, aspectRatio: 0.65, cornerCount: 1, loopCount: 0, endpointCount: 4, topHeavy: 0.4, leftHeavy: 0.5 },
  'a': { numStrokes: 1, loopCount: 1, aspectRatio: 0.8, topHeavy: 0.55, leftHeavy: 0.45, endpointCount: 2 },
  'b': { numStrokes: 1, loopCount: 1, aspectRatio: 0.55, topHeavy: 0.65, leftHeavy: 0.4, endpointCount: 2 },
  'c': { numStrokes: 1, loopCount: 0, aspectRatio: 0.7, verticalSymmetry: 0.5, leftHeavy: 0.4, endpointCount: 2, cornerCount: 0 },
  'd': { numStrokes: 1, loopCount: 1, aspectRatio: 0.55, topHeavy: 0.65, leftHeavy: 0.6, endpointCount: 2 },
  'e': { numStrokes: 1, loopCount: 0, aspectRatio: 0.8, cornerCount: 1, topHeavy: 0.5, leftHeavy: 0.45, endpointCount: 2 },
  'f': { numStrokes: 1, aspectRatio: 0.4, cornerCount: 2, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'g': { numStrokes: 1, loopCount: 1, aspectRatio: 0.6, topHeavy: 0.35, leftHeavy: 0.5, endpointCount: 2 },
  'h': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 2, topHeavy: 0.6, leftHeavy: 0.4, loopCount: 0, endpointCount: 2 },
  'i': { numStrokes: 2, aspectRatio: 0.3, topHeavy: 0.25, leftHeavy: 0.5, loopCount: 0, endpointCount: 4 },
  'j': { numStrokes: 2, aspectRatio: 0.4, topHeavy: 0.25, leftHeavy: 0.45, loopCount: 0, endpointCount: 4 },
  'k': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.4, loopCount: 0, endpointCount: 2 },
  'l': { numStrokes: 1, aspectRatio: 0.3, cornerCount: 0, loopCount: 0, endpointCount: 2, topHeavy: 0.5 },
  'm': { numStrokes: 1, aspectRatio: 1.2, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'n': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1, topHeavy: 0.55, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'o': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9, horizontalSymmetry: 0.85, verticalSymmetry: 0.85, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 0 },
  'p': { numStrokes: 1, loopCount: 1, aspectRatio: 0.55, topHeavy: 0.35, leftHeavy: 0.4, endpointCount: 2 },
  'q': { numStrokes: 1, loopCount: 1, aspectRatio: 0.55, topHeavy: 0.35, leftHeavy: 0.6, endpointCount: 2 },
  'r': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 1, topHeavy: 0.6, leftHeavy: 0.4, loopCount: 0, endpointCount: 2 },
  's': { numStrokes: 1, loopCount: 0, aspectRatio: 0.65, cornerCount: 0, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 2 },
  't': { numStrokes: 2, aspectRatio: 0.45, topHeavy: 0.35, leftHeavy: 0.5, loopCount: 0, endpointCount: 4, horizontalSymmetry: 0.7 },
  'u': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1, topHeavy: 0.4, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'v': { numStrokes: 1, aspectRatio: 0.75, cornerCount: 1, topHeavy: 0.35, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'w': { numStrokes: 1, aspectRatio: 1.25, cornerCount: 2, topHeavy: 0.4, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'z': { numStrokes: 1, aspectRatio: 0.85, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'A': { numStrokes: 3, aspectRatio: 0.8, cornerCount: 3, topHeavy: 0.4, leftHeavy: 0.5, loopCount: 0, endpointCount: 6 },
  'B': { numStrokes: 2, loopCount: 2, aspectRatio: 0.6, topHeavy: 0.5, leftHeavy: 0.3, endpointCount: 2, verticalSymmetry: 0.5 },
  'C': { numStrokes: 1, loopCount: 0, aspectRatio: 0.8, verticalSymmetry: 0.6, leftHeavy: 0.35, endpointCount: 2, cornerCount: 0 },
  'D': { numStrokes: 2, loopCount: 1, aspectRatio: 0.6, topHeavy: 0.5, leftHeavy: 0.3, endpointCount: 2 },
  'E': { numStrokes: 4, aspectRatio: 0.6, cornerCount: 6, topHeavy: 0.5, leftHeavy: 0.35, loopCount: 0, endpointCount: 6 },
  'F': { numStrokes: 3, aspectRatio: 0.5, cornerCount: 4, topHeavy: 0.4, leftHeavy: 0.35, loopCount: 0, endpointCount: 5 },
  'G': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 2, verticalSymmetry: 0.6 },
  'H': { numStrokes: 3, aspectRatio: 0.8, horizontalSymmetry: 0.85, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0, endpointCount: 6 },
  'I': { numStrokes: 1, aspectRatio: 0.3, cornerCount: 0, loopCount: 0, endpointCount: 2, topHeavy: 0.5 },
  'J': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 1, topHeavy: 0.3, leftHeavy: 0.6, loopCount: 0, endpointCount: 2 },
  'K': { numStrokes: 3, aspectRatio: 0.7, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.35, loopCount: 0, endpointCount: 5 },
  'L': { numStrokes: 2, aspectRatio: 0.6, cornerCount: 1, topHeavy: 0.6, leftHeavy: 0.35, loopCount: 0, endpointCount: 4 },
  'M': { numStrokes: 1, aspectRatio: 1.0, cornerCount: 3, topHeavy: 0.35, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'N': { numStrokes: 3, aspectRatio: 0.7, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0, endpointCount: 6 },
  'O': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9, horizontalSymmetry: 0.85, verticalSymmetry: 0.85, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 0 },
  'P': { numStrokes: 2, loopCount: 1, aspectRatio: 0.6, topHeavy: 0.6, leftHeavy: 0.3, endpointCount: 2 },
  'Q': { numStrokes: 1, loopCount: 1, aspectRatio: 0.9, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 2, centerOfMassY: 0.55 },
  'R': { numStrokes: 2, loopCount: 1, aspectRatio: 0.6, topHeavy: 0.55, leftHeavy: 0.3, endpointCount: 2, cornerCount: 1 },
  'S': { numStrokes: 1, loopCount: 0, aspectRatio: 0.7, topHeavy: 0.5, leftHeavy: 0.5, cornerCount: 0, endpointCount: 2 },
  'T': { numStrokes: 2, aspectRatio: 0.7, horizontalSymmetry: 0.85, topHeavy: 0.25, leftHeavy: 0.5, loopCount: 0, endpointCount: 4 },
  'U': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 1, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'V': { numStrokes: 2, aspectRatio: 0.8, cornerCount: 1, topHeavy: 0.25, leftHeavy: 0.5, loopCount: 0, endpointCount: 4 },
  'W': { numStrokes: 1, aspectRatio: 1.3, cornerCount: 3, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'X': { numStrokes: 2, horizontalSymmetry: 0.85, verticalSymmetry: 0.85, aspectRatio: 0.9, loopCount: 0, endpointCount: 4, intersectionCount: 1 },
  'Y': { numStrokes: 3, aspectRatio: 0.7, cornerCount: 1, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0, endpointCount: 5 },
  'Z': { numStrokes: 1, aspectRatio: 0.9, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0, endpointCount: 2 },
  'alpha': { numStrokes: 1, loopCount: 1, aspectRatio: 0.8, topHeavy: 0.5, leftHeavy: 0.5 },
  'beta': { numStrokes: 1, loopCount: 2, aspectRatio: 0.55, topHeavy: 0.5, leftHeavy: 0.35 },
  'gamma': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 1, topHeavy: 0.3, leftHeavy: 0.4, loopCount: 0 },
  'delta': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 1, topHeavy: 0.25, leftHeavy: 0.5, loopCount: 0 },
  'pi': { numStrokes: 2, aspectRatio: 1.0, horizontalSymmetry: 0.7, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0 },
  'sigma': { numStrokes: 1, aspectRatio: 0.8, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0 },
  'sum': { numStrokes: 1, aspectRatio: 0.9, cornerCount: 4, horizontalSymmetry: 0.8, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0 },
  'int': { numStrokes: 1, aspectRatio: 0.4, loopCount: 0, cornerCount: 0, topHeavy: 0.5 },
  'sqrt': { numStrokes: 2, aspectRatio: 0.8, cornerCount: 2, topHeavy: 0.35, leftHeavy: 0.4, loopCount: 0 },
  'fraction': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: 0, loopCount: 0, endpointCount: 2 },
  '>': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1, dominantDirection: Math.PI / 4, leftHeavy: 0.3, loopCount: 0, endpointCount: 2 },
  '<': { numStrokes: 1, aspectRatio: 0.7, cornerCount: 1, dominantDirection: -Math.PI / 4, leftHeavy: 0.7, loopCount: 0, endpointCount: 2 },
  '.': { numStrokes: 1, aspectRatio: 1.0, pixelDensity: 0.15, loopCount: 0 },
  ',': { numStrokes: 1, aspectRatio: 0.5, cornerCount: 1, topHeavy: 0.35, loopCount: 0, endpointCount: 2 },
  '!': { numStrokes: 2, aspectRatio: 0.3, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0, endpointCount: 4 },
  'neq': { numStrokes: 2, aspectRatio: 1.5 },
  'geq': { numStrokes: 2, aspectRatio: 1.0, leftHeavy: 0.3 },
  'leq': { numStrokes: 2, aspectRatio: 1.0, leftHeavy: 0.7 },
  'approx': { numStrokes: 2, aspectRatio: 2.0, loopCount: 0, cornerCount: 4 },
  'pm': { numStrokes: 2, aspectRatio: 0.8, horizontalSymmetry: 0.7, topHeavy: 0.4, leftHeavy: 0.5, loopCount: 0 },
  'rightarrow': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: 0, cornerCount: 1, leftHeavy: 0.3, loopCount: 0, endpointCount: 2 },
  'leftarrow': { numStrokes: 1, aspectRatio: 3.0, dominantDirection: Math.PI, cornerCount: 1, leftHeavy: 0.7, loopCount: 0, endpointCount: 2 },
  'infty': { numStrokes: 1, loopCount: 2, aspectRatio: 1.5, horizontalSymmetry: 0.8, verticalSymmetry: 0.7, topHeavy: 0.5, leftHeavy: 0.5, endpointCount: 0 },
  'partial': { numStrokes: 1, loopCount: 1, aspectRatio: 0.7, topHeavy: 0.5, leftHeavy: 0.55 },
  'lim': { numStrokes: 3, aspectRatio: 1.2 },
  'prod': { numStrokes: 1, aspectRatio: 0.9, cornerCount: 4, horizontalSymmetry: 0.8, topHeavy: 0.3, leftHeavy: 0.5, loopCount: 0 },
  'in': { numStrokes: 2, aspectRatio: 0.8 },
  'subset': { numStrokes: 1, aspectRatio: 1.0, cornerCount: 2, topHeavy: 0.5, leftHeavy: 0.5, loopCount: 0 },
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
    const aBaseline = bba.y + bba.height;
    const bBaseline = bbb.y + bbb.height;
    const maxHeight = Math.max(bba.height, bbb.height);
    
    if (Math.abs(aBaseline - bBaseline) < maxHeight * 0.4) {
      return bba.x - bbb.x;
    }
    return aBaseline - bBaseline;
  });
  
  return symbols;
};

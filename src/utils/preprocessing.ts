import { Point, Stroke, BoundingBox } from '../types';
import { RESAMPLE_POINTS, SMOOTHING_WINDOW, STROKE_SPLIT_THRESHOLD, NORMALIZE_SIZE } from '../constants';

export const distance = (p1: Point, p2: Point): number => {
  return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
};

export const pathLength = (points: Point[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distance(points[i - 1], points[i]);
  }
  return length;
};

export const resample = (points: Point[], numPoints: number = RESAMPLE_POINTS): Point[] => {
  if (points.length < 2) return points;
  
  const totalLength = pathLength(points);
  const interval = totalLength / (numPoints - 1);
  
  const result: Point[] = [{ ...points[0] }];
  let currentDistance = 0;
  let currentIndex = 0;
  
  for (let i = 1; i < numPoints - 1; i++) {
    const targetDistance = i * interval;
    
    while (currentIndex < points.length - 1 && currentDistance + distance(points[currentIndex], points[currentIndex + 1]) < targetDistance) {
      currentDistance += distance(points[currentIndex], points[currentIndex + 1]);
      currentIndex++;
    }
    
    if (currentIndex >= points.length - 1) {
      result.push({ ...points[points.length - 1] });
      continue;
    }
    
    const remaining = targetDistance - currentDistance;
    const segLength = distance(points[currentIndex], points[currentIndex + 1]);
    
    if (segLength === 0) {
      result.push({ ...points[currentIndex] });
      continue;
    }
    
    const t = remaining / segLength;
    const p1 = points[currentIndex];
    const p2 = points[currentIndex + 1];
    
    result.push({
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y),
      timestamp: p1.timestamp + t * (p2.timestamp - p1.timestamp),
    });
  }
  
  result.push({ ...points[points.length - 1] });
  return result;
};

export const smooth = (points: Point[], windowSize: number = SMOOTHING_WINDOW): Point[] => {
  if (points.length < windowSize) return points;
  
  const halfWindow = Math.floor(windowSize / 2);
  const result: Point[] = [];
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(points.length - 1, i + halfWindow); j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      count++;
    }
    
    result.push({
      x: sumX / count,
      y: sumY / count,
      timestamp: points[i].timestamp,
    });
  }
  
  return result;
};

export const getBoundingBox = (points: Point[]): BoundingBox => {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const getStrokesBoundingBox = (strokes: Stroke[]): BoundingBox => {
  if (strokes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  
  for (const stroke of strokes) {
    const bb = stroke.boundingBox || getBoundingBox(stroke.points);
    minX = Math.min(minX, bb.x);
    maxX = Math.max(maxX, bb.x + bb.width);
    minY = Math.min(minY, bb.y);
    maxY = Math.max(maxY, bb.y + bb.height);
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const normalize = (points: Point[], targetSize: number = NORMALIZE_SIZE): Point[] => {
  if (points.length === 0) return points;
  
  const bb = getBoundingBox(points);
  if (bb.width === 0 && bb.height === 0) return points;
  
  const maxDim = Math.max(bb.width, bb.height);
  if (maxDim === 0) return points;
  
  const scale = (targetSize - 4) / maxDim;
  const offsetX = (targetSize - bb.width * scale) / 2;
  const offsetY = (targetSize - bb.height * scale) / 2;
  
  return points.map(p => ({
    x: (p.x - bb.x) * scale + offsetX,
    y: (p.y - bb.y) * scale + offsetY,
    timestamp: p.timestamp,
  }));
};

export const normalizeStrokes = (strokes: Stroke[], targetSize: number = NORMALIZE_SIZE): Stroke[] => {
  if (strokes.length === 0) return [];
  
  const bb = getStrokesBoundingBox(strokes);
  if (bb.width === 0 && bb.height === 0) return strokes;
  
  const maxDim = Math.max(bb.width, bb.height);
  if (maxDim === 0) return strokes;
  
  const scale = (targetSize - 8) / maxDim;
  const offsetX = (targetSize - bb.width * scale) / 2;
  const offsetY = (targetSize - bb.height * scale) / 2;
  
  return strokes.map(stroke => ({
    ...stroke,
    points: stroke.points.map(p => ({
      x: (p.x - bb.x) * scale + offsetX,
      y: (p.y - bb.y) * scale + offsetY,
      timestamp: p.timestamp,
    })),
    boundingBox: {
      x: (stroke.boundingBox?.x ?? bb.x - bb.x) * scale + offsetX,
      y: (stroke.boundingBox?.y ?? bb.y - bb.y) * scale + offsetY,
      width: (stroke.boundingBox?.width ?? 0) * scale,
      height: (stroke.boundingBox?.height ?? 0) * scale,
    },
  }));
};

export const splitStrokeByPause = (
  points: Point[],
  threshold: number = STROKE_SPLIT_THRESHOLD
): Point[][] => {
  if (points.length < 2) return [points];
  
  const segments: Point[][] = [];
  let currentSegment: Point[] = [points[0]];
  
  for (let i = 1; i < points.length; i++) {
    const timeDiff = points[i].timestamp - points[i - 1].timestamp;
    
    if (timeDiff > threshold) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      currentSegment = [points[i]];
    } else {
      currentSegment.push(points[i]);
    }
  }
  
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  
  return segments.filter(s => s.length > 1);
};

export const processStroke = (stroke: Stroke): Stroke[] => {
  const segments = splitStrokeByPause(stroke.points);
  
  return segments.map((segment, index) => {
    const resampled = resample(segment);
    const smoothed = smooth(resampled);
    const bb = getBoundingBox(smoothed);
    
    return {
      id: `${stroke.id}_${index}`,
      points: smoothed,
      thickness: stroke.thickness,
      color: stroke.color,
      boundingBox: bb,
    };
  });
};

export const processStrokes = (strokes: Stroke[]): Stroke[] => {
  const result: Stroke[] = [];
  
  for (const stroke of strokes) {
    const processed = processStroke(stroke);
    result.push(...processed);
  }
  
  return result;
};

export const strokeToImageData = (stroke: Stroke, size: number = 64): Uint8Array => {
  const data = new Uint8Array(size * size).fill(0);
  const points = stroke.points;
  
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    
    const steps = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
    for (let t = 0; t <= steps; t++) {
      const alpha = steps === 0 ? 0 : t / steps;
      const x = Math.round(p1.x + alpha * (p2.x - p1.x));
      const y = Math.round(p1.y + alpha * (p2.y - p1.y));
      
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && px < size && py >= 0 && py < size) {
            data[py * size + px] = Math.max(data[py * size + px], 255);
          }
        }
      }
    }
  }
  
  return data;
};

export const strokesToImageData = (strokes: Stroke[], size: number = 64): Uint8Array => {
  const data = new Uint8Array(size * size).fill(0);
  
  for (const stroke of strokes) {
    const strokeData = strokeToImageData(stroke, size);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(data[i], strokeData[i]);
    }
  }
  
  return data;
};

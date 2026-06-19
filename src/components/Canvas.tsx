import React, { useRef, useEffect, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Point, Stroke, ToolType, ThicknessType, HistoryState, BoundingBox } from '../types';
import { THICKNESS_MAP, MAX_HISTORY } from '../constants';
import { getBoundingBox } from '../utils/preprocessing';

interface CanvasProps {
  onStrokesChange: (strokes: Stroke[]) => void;
  strokes: Stroke[];
  selectedStrokes: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}

const bezierSmooth = (points: Point[], tension: number = 0.5): Point[] => {
  if (points.length < 3) return points;
  
  const result: Point[] = [points[0]];
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;
    
    const cp1x = p1.x + (p2.x - p0.x) * tension / 6;
    const cp1y = p1.y + (p2.y - p0.y) * tension / 6;
    const cp2x = p2.x - (p3.x - p1.x) * tension / 6;
    const cp2y = p2.y - (p3.y - p1.y) * tension / 6;
    
    for (let t = 0.1; t <= 1; t += 0.1) {
      const t2 = t * t;
      const t3 = t2 * t;
      
      const x = (1 - t) ** 3 * p1.x + 
                3 * (1 - t) ** 2 * t * cp1x + 
                3 * (1 - t) * t2 * cp2x + 
                t3 * p2.x;
      const y = (1 - t) ** 3 * p1.y + 
                3 * (1 - t) ** 2 * t * cp1y + 
                3 * (1 - t) * t2 * cp2y + 
                t3 * p2.y;
      
      result.push({ x, y, timestamp: p1.timestamp + t * (p2.timestamp - p1.timestamp) });
    }
  }
  
  return result;
};

const Canvas: React.FC<CanvasProps> = ({ 
  onStrokesChange, 
  strokes, 
  selectedStrokes, 
  onSelectionChange 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentTool, setCurrentTool] = useState<ToolType>('pen');
  const [currentThickness, setCurrentThickness] = useState<ThicknessType>('medium');
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [history, setHistory] = useState<HistoryState[]>([{ strokes: [], timestamp: Date.now() }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [selectionBox, setSelectionBox] = useState<BoundingBox | null>(null);
  const [selectStart, setSelectStart] = useState<{ x: number; y: number } | null>(null);

  const getCanvasPoint = useCallback((e: React.MouseEvent | React.TouchEvent): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0, timestamp: Date.now() };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    let clientX: number, clientY: number;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      timestamp: Date.now(),
    };
  }, []);

  const pushHistory = useCallback((newStrokes: Stroke[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ strokes: JSON.parse(JSON.stringify(newStrokes)), timestamp: Date.now() });
    
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    }
    
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onStrokesChange(JSON.parse(JSON.stringify(history[newIndex].strokes)));
    }
  }, [historyIndex, history, onStrokesChange]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onStrokesChange(JSON.parse(JSON.stringify(history[newIndex].strokes)));
    }
  }, [historyIndex, history, onStrokesChange]);

  const clearCanvas = useCallback(() => {
    const newStrokes: Stroke[] = [];
    pushHistory(newStrokes);
    onStrokesChange(newStrokes);
    onSelectionChange(new Set());
  }, [pushHistory, onStrokesChange, onSelectionChange]);

  const selectAll = useCallback(() => {
    const allIds = new Set(strokes.map(s => s.id));
    onSelectionChange(allIds);
  }, [strokes, onSelectionChange]);

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke, isSelected: boolean) => {
    if (stroke.points.length < 2) return;
    
    ctx.beginPath();
    ctx.strokeStyle = isSelected ? '#3b82f6' : stroke.color;
    ctx.lineWidth = stroke.thickness;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const smoothed = bezierSmooth(stroke.points);
    
    ctx.moveTo(smoothed[0].x, smoothed[0].y);
    for (let i = 1; i < smoothed.length; i++) {
      ctx.lineTo(smoothed[i].x, smoothed[i].y);
    }
    ctx.stroke();
    
    if (isSelected) {
      const bb = stroke.boundingBox || getBoundingBox(stroke.points);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(bb.x - 2, bb.y - 2, bb.width + 4, bb.height + 4);
      ctx.setLineDash([]);
    }
  }, []);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    for (const stroke of strokes) {
      drawStroke(ctx, stroke, selectedStrokes.has(stroke.id));
    }
    
    if (currentStroke.length > 1) {
      const smoothed = bezierSmooth(currentStroke);
      ctx.beginPath();
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = THICKNESS_MAP[currentThickness];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(smoothed[0].x, smoothed[0].y);
      for (let i = 1; i < smoothed.length; i++) {
        ctx.lineTo(smoothed[i].x, smoothed[i].y);
      }
      ctx.stroke();
    }
    
    if (selectionBox && selectStart) {
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
      ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.width, selectionBox.height);
      ctx.setLineDash([]);
    }
  }, [strokes, currentStroke, currentThickness, selectedStrokes, selectionBox, selectStart, drawStroke]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRef.current) return;
    
    const resize = () => {
      const container = containerRef.current;
      if (!container) return;
      
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      redrawCanvas();
    };
    
    resize();
    window.addEventListener('resize', resize);
    
    return () => window.removeEventListener('resize', resize);
  }, [redrawCanvas]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const point = getCanvasPoint(e);
    
    if (currentTool === 'select') {
      setSelectStart(point);
      setSelectionBox({ x: point.x, y: point.y, width: 0, height: 0 });
      onSelectionChange(new Set());
    } else if (currentTool === 'eraser') {
      setIsDrawing(true);
      const newStrokes = strokes.filter(stroke => {
        const bb = stroke.boundingBox || getBoundingBox(stroke.points);
        const padding = 10;
        return !(point.x >= bb.x - padding && 
                 point.x <= bb.x + bb.width + padding && 
                 point.y >= bb.y - padding && 
                 point.y <= bb.y + bb.height + padding);
      });
      pushHistory(newStrokes);
      onStrokesChange(newStrokes);
    } else {
      setIsDrawing(true);
      setCurrentStroke([point]);
    }
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const point = getCanvasPoint(e);
    
    if (currentTool === 'select' && selectStart) {
      const x = Math.min(selectStart.x, point.x);
      const y = Math.min(selectStart.y, point.y);
      const width = Math.abs(point.x - selectStart.x);
      const height = Math.abs(point.y - selectStart.y);
      setSelectionBox({ x, y, width, height });
      
      const selected = new Set<string>();
      for (const stroke of strokes) {
        const bb = stroke.boundingBox || getBoundingBox(stroke.points);
        if (bb.x >= x && bb.x + bb.width <= x + width &&
            bb.y >= y && bb.y + bb.height <= y + height) {
          selected.add(stroke.id);
        }
      }
      onSelectionChange(selected);
    } else if (currentTool === 'eraser' && isDrawing) {
      const newStrokes = strokes.filter(stroke => {
        for (const sp of stroke.points) {
          const dist = Math.sqrt((sp.x - point.x) ** 2 + (sp.y - point.y) ** 2);
          if (dist < 15) return false;
        }
        return true;
      });
      if (newStrokes.length !== strokes.length) {
        pushHistory(newStrokes);
        onStrokesChange(newStrokes);
      }
    } else if (currentTool === 'pen' && isDrawing) {
      setCurrentStroke(prev => [...prev, point]);
    }
  };

  const handleEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    
    if (currentTool === 'select') {
      setSelectStart(null);
      setSelectionBox(null);
    } else if (currentTool === 'pen' && currentStroke.length > 1) {
      const bb = getBoundingBox(currentStroke);
      const newStroke: Stroke = {
        id: uuidv4(),
        points: bezierSmooth(currentStroke),
        thickness: THICKNESS_MAP[currentThickness],
        color: '#1f2937',
        boundingBox: bb,
      };
      
      const newStrokes = [...strokes, newStroke];
      pushHistory(newStrokes);
      onStrokesChange(newStrokes);
    }
    
    setIsDrawing(false);
    setCurrentStroke([]);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (e.key === 'z' && e.shiftKey || e.key === 'y') {
          e.preventDefault();
          redo();
        } else if (e.key === 'a') {
          e.preventDefault();
          selectAll();
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedStrokes.size > 0) {
          e.preventDefault();
          const newStrokes = strokes.filter(s => !selectedStrokes.has(s.id));
          pushHistory(newStrokes);
          onStrokesChange(newStrokes);
          onSelectionChange(new Set());
        }
      }
      if (e.key === 'Escape') {
        onSelectionChange(new Set());
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectAll, strokes, selectedStrokes, pushHistory, onStrokesChange, onSelectionChange]);

  const deleteSelected = () => {
    const newStrokes = strokes.filter(s => !selectedStrokes.has(s.id));
    pushHistory(newStrokes);
    onStrokesChange(newStrokes);
    onSelectionChange(new Set());
  };

  return (
    <div className="canvas-container flex flex-col h-full">
      <div className="toolbar flex items-center gap-2 p-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-1">
          <button
            className={`tool-btn px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              currentTool === 'pen' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
            onClick={() => setCurrentTool('pen')}
            title="画笔"
          >
            ✏️ 画笔
          </button>
          <button
            className={`tool-btn px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              currentTool === 'eraser' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
            onClick={() => setCurrentTool('eraser')}
            title="橡皮擦"
          >
            🧹 橡皮
          </button>
          <button
            className={`tool-btn px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              currentTool === 'select' ? 'bg-blue-500 text-white' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
            onClick={() => setCurrentTool('select')}
            title="选择"
          >
            🖱️ 选择
          </button>
        </div>
        
        <div className="h-6 w-px bg-gray-300" />
        
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-600 mr-1">粗细:</span>
          {(['thin', 'medium', 'thick'] as ThicknessType[]).map((t) => (
            <button
              key={t}
              className={`thickness-btn p-2 rounded-md transition-colors ${
                currentThickness === t ? 'bg-blue-100 border-2 border-blue-500' : 'bg-white border border-gray-300 hover:bg-gray-100'
              }`}
              onClick={() => setCurrentThickness(t)}
              title={t === 'thin' ? '细' : t === 'medium' ? '中' : '粗'}
            >
              <div
                className="bg-gray-800 rounded-full"
                style={{
                  width: THICKNESS_MAP[t] * 2,
                  height: THICKNESS_MAP[t] * 2,
                }}
              />
            </button>
          ))}
        </div>
        
        <div className="h-6 w-px bg-gray-300" />
        
        <div className="flex items-center gap-1">
          <button
            className="tool-btn px-3 py-1.5 rounded-md text-sm font-medium bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={undo}
            disabled={historyIndex <= 0}
            title="撤销 (Ctrl+Z)"
          >
            ↩️ 撤销
          </button>
          <button
            className="tool-btn px-3 py-1.5 rounded-md text-sm font-medium bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            title="重做 (Ctrl+Y)"
          >
            ↪️ 重做
          </button>
          <button
            className="tool-btn px-3 py-1.5 rounded-md text-sm font-medium bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 transition-colors"
            onClick={clearCanvas}
            title="清空画布"
          >
            🗑️ 清空
          </button>
          <button
            className="tool-btn px-3 py-1.5 rounded-md text-sm font-medium bg-white text-gray-700 hover:bg-gray-100 border border-gray-300 transition-colors"
            onClick={selectAll}
            title="全选 (Ctrl+A)"
          >
            📋 全选
          </button>
        </div>
        
        {selectedStrokes.size > 0 && (
          <>
            <div className="h-6 w-px bg-gray-300" />
            <button
              className="tool-btn px-3 py-1.5 rounded-md text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
              onClick={deleteSelected}
              title="删除选中"
            >
              ❌ 删除选中 ({selectedStrokes.size})
            </button>
          </>
        )}
        
        <div className="flex-1" />
        
        <div className="text-sm text-gray-500 font-medium">
          笔画: {strokes.length}
        </div>
      </div>
      
      <div ref={containerRef} className="flex-1 relative bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair touch-none"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
        <div className="absolute bottom-3 right-3 bg-white/80 backdrop-blur-sm px-3 py-1.5 rounded-md text-sm text-gray-600 shadow-sm border border-gray-200">
          笔画数: {strokes.length}
        </div>
      </div>
    </div>
  );
};

export default Canvas;

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import Canvas from './components/Canvas';
import Preview, { CandidateModal, PreviewHandle } from './components/Preview';
import HistoryPanel from './components/HistoryPanel';
import TemplateLibrary from './components/TemplateLibrary';
import SaveTemplateDialog from './components/SaveTemplateDialog';
import BatchRecognition from './components/BatchRecognition';
import ExportDialog from './components/ExportDialog';
import PracticeMode from './components/PracticeMode';
import PracticeHistory from './components/PracticeHistory';
import MistakeBook from './components/MistakeBook';
import { Stroke, RecognizedSymbol, SyntaxNode, FormulaTemplate, DifficultyLevel } from './types';
import { RECOGNITION_DELAY } from './constants';
import { processStrokes } from './utils/preprocessing';
import { recognizeStrokes } from './utils/recognizer';
import { buildSyntaxTree, updateSymbolInTree, collectAllSymbols } from './utils/structure';
import { generateLatex } from './utils/latexGenerator';
import './App.css';

type PanelView = 'preview' | 'history';
type AppView = 'main' | 'practice' | 'practiceHistory' | 'mistakeBook';

interface SaveTemplateDialogState {
  isOpen: boolean;
  latex: string;
  thumbnail: string;
}

function App() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedStrokes, setSelectedStrokes] = useState<Set<string>>(new Set());
  const [symbols, setSymbols] = useState<RecognizedSymbol[]>([]);
  const [syntaxTree, setSyntaxTree] = useState<SyntaxNode | null>(null);
  const [latex, setLatex] = useState<string>('');
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<RecognizedSymbol | null>(null);
  const [activePanel, setActivePanel] = useState<PanelView>('preview');
  const [showBatchRecognition, setShowBatchRecognition] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [canvasDataUrl, setCanvasDataUrl] = useState<string>('');
  const [referenceLatex, setReferenceLatex] = useState<string>('');
  const [saveTemplateDialog, setSaveTemplateDialog] = useState<SaveTemplateDialogState>({
    isOpen: false,
    latex: '',
    thumbnail: '',
  });
  const [appView, setAppView] = useState<AppView>('main');
  const [repracticeInfo, setRepracticeInfo] = useState<{ latex: string; difficulty: DifficultyLevel; mistakeId: string } | null>(null);
  
  const recognitionTimeoutRef = useRef<number | null>(null);
  const previewRef = useRef<PreviewHandle>(null);

  const performRecognition = useCallback((currentStrokes: Stroke[]) => {
    if (currentStrokes.length === 0) {
      setSymbols([]);
      setSyntaxTree(null);
      setLatex('');
      return;
    }
    
    setIsRecognizing(true);
    
    try {
      const processedStrokes = processStrokes(currentStrokes);
      const recognizedSymbols = recognizeStrokes(processedStrokes);
      const tree = buildSyntaxTree(recognizedSymbols);
      const generatedLatex = generateLatex(tree);
      
      setSymbols(recognizedSymbols);
      setSyntaxTree(tree);
      setLatex(generatedLatex);
    } catch (e) {
      console.error('Recognition error:', e);
    } finally {
      setIsRecognizing(false);
    }
  }, []);

  const handleStrokesChange = useCallback((newStrokes: Stroke[]) => {
    setStrokes(newStrokes);
    
    if (recognitionTimeoutRef.current) {
      clearTimeout(recognitionTimeoutRef.current);
    }
    
    recognitionTimeoutRef.current = window.setTimeout(() => {
      performRecognition(newStrokes);
    }, RECOGNITION_DELAY);
  }, [performRecognition]);

  useEffect(() => {
    return () => {
      if (recognitionTimeoutRef.current) {
        clearTimeout(recognitionTimeoutRef.current);
      }
    };
  }, []);

  const handleSymbolClick = (symbol: RecognizedSymbol) => {
    setSelectedSymbol(symbol);
  };

  const handleCandidateSelect = (symbolId: string, candidateIndex: number) => {
    if (!syntaxTree) return;
    
    const newTree = updateSymbolInTree(syntaxTree, symbolId, candidateIndex);
    const newLatex = generateLatex(newTree);
    const newSymbols = collectAllSymbols(newTree);
    
    setSyntaxTree(newTree);
    setLatex(newLatex);
    setSymbols(newSymbols);
    setSelectedSymbol(null);
  };

  const handleSaveHistory = async () => {
    if (!latex.trim()) return;
    
    try {
      const thumbnail = canvasDataUrl || await generateThumbnail();
      await invoke('save_formula', {
        latex,
        thumbnail,
      });
      alert('保存成功！');
    } catch (e) {
      console.error('Save failed:', e);
      alert('保存失败: ' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const generateThumbnail = async (): Promise<string> => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (strokes.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const stroke of strokes) {
        for (const p of stroke.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
      
      const padding = 10;
      const scale = Math.min(
        (canvas.width - padding * 2) / (maxX - minX || 1),
        (canvas.height - padding * 2) / (maxY - minY || 1)
      );
      
      for (const stroke of strokes) {
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = Math.max(1, stroke.thickness * scale * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        for (let i = 0; i < stroke.points.length; i++) {
          const x = (stroke.points[i].x - minX) * scale + padding;
          const y = (stroke.points[i].y - minY) * scale + padding;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    }
    
    return canvas.toDataURL('image/png');
  };

  const handleCopyLatex = async (text?: string) => {
    const textToCopy = text || latex;
    if (!textToCopy.trim()) return;
    
    try {
      await writeText(textToCopy);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  };

  const handleExport = () => {
    generateThumbnail().then(url => {
      setCanvasDataUrl(url);
      setShowExportDialog(true);
    });
  };

  const handleSelectFormulaFromHistory = (historyLatex: string) => {
    setLatex(historyLatex);
  };

  const handleExportFromHistory = (historyLatex: string, thumbnail: string) => {
    setCanvasDataUrl(thumbnail);
    setLatex(historyLatex);
    setShowExportDialog(true);
  };

  const handleLatexChange = (newLatex: string) => {
    setLatex(newLatex);
  };

  const handleInsertTemplate = useCallback((template: FormulaTemplate) => {
    if (previewRef.current) {
      previewRef.current.insertAtCursor(template.latex);
      previewRef.current.focusEditor();
    } else {
      setLatex(prev => prev + template.latex);
    }
    setReferenceLatex(template.latex);
    setActivePanel('preview');
  }, []);

  const handleClearReference = useCallback(() => {
    setReferenceLatex('');
  }, []);

  const handleSaveAsTemplate = useCallback((formulaLatex: string, thumbnail: string) => {
    setSaveTemplateDialog({
      isOpen: true,
      latex: formulaLatex,
      thumbnail,
    });
  }, []);

  const handleCurrentSaveAsTemplate = useCallback(async () => {
    if (!latex.trim()) return;
    const thumbnail = canvasDataUrl || await generateThumbnail();
    handleSaveAsTemplate(latex, thumbnail);
  }, [latex, canvasDataUrl, generateThumbnail, handleSaveAsTemplate]);

  return (
    <div className="app-container flex flex-col h-screen bg-gray-100 overflow-hidden">
      {appView === 'practice' && (
        <PracticeMode
          onClose={() => { setAppView('main'); setRepracticeInfo(null); }}
          onViewHistory={() => setAppView('practiceHistory')}
          onViewMistakes={() => setAppView('mistakeBook')}
          repractice={repracticeInfo}
        />
      )}
      {appView === 'practiceHistory' && (
        <PracticeHistory
          onClose={() => setAppView('practice')}
          onRepractice={(info) => { setRepracticeInfo(info); setAppView('practice'); }}
        />
      )}
      {appView === 'mistakeBook' && (
        <MistakeBook
          onClose={() => setAppView('practice')}
          onRepractice={(info) => { setRepracticeInfo(info); setAppView('practice'); }}
        />
      )}
      {appView === 'main' && (
        <>
          <header className="app-header bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <div className="text-2xl">📐</div>
              <div>
                <h1 className="text-xl font-bold text-gray-800">Math OCR</h1>
                <p className="text-xs text-gray-500">手写数学公式识别</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium hover:bg-green-200 transition-colors"
                onClick={() => { setRepracticeInfo(null); setAppView('practice'); }}
              >
                🎯 练习模式
              </button>
              <div className="h-6 w-px bg-gray-300 mx-1" />
              <button
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activePanel === 'preview'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onClick={() => setActivePanel('preview')}
              >
                👁️ 预览
              </button>
              <button
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activePanel === 'history'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onClick={() => setActivePanel('history')}
              >
                📚 历史
              </button>
              <div className="h-6 w-px bg-gray-300 mx-1" />
              {activePanel === 'preview' && (
                <button
                  className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleCurrentSaveAsTemplate}
                  disabled={!latex.trim()}
                  title="将当前公式保存为模板"
                >
                  📑 存为模板
                </button>
              )}
              <button
                className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-200 transition-colors"
                onClick={() => setShowBatchRecognition(true)}
              >
                📦 批量识别
              </button>
            </div>
          </header>
          
          <main className="flex-1 flex overflow-hidden">
            <TemplateLibrary onInsertTemplate={handleInsertTemplate} />
            
            <div className="canvas-wrapper flex-1 min-w-0">
              <Canvas
                strokes={strokes}
                onStrokesChange={handleStrokesChange}
                selectedStrokes={selectedStrokes}
                onSelectionChange={setSelectedStrokes}
                referenceLatex={referenceLatex}
                onClearReference={handleClearReference}
              />
            </div>
            
            <div className="panel-wrapper w-[400px] min-w-[400px] max-w-[50%] overflow-hidden">
              {activePanel === 'preview' ? (
                <Preview
                  ref={previewRef}
                  latex={latex}
                  onLatexChange={handleLatexChange}
                  symbols={symbols}
                  onSymbolClick={handleSymbolClick}
                  onSaveHistory={handleSaveHistory}
                  onExport={handleExport}
                  onCopyLatex={() => handleCopyLatex()}
                  isRecognizing={isRecognizing}
                />
              ) : (
                <HistoryPanel
                  onSelectFormula={handleSelectFormulaFromHistory}
                  onCopyLatex={handleCopyLatex}
                  onExport={handleExportFromHistory}
                  onSaveAsTemplate={handleSaveAsTemplate}
                />
              )}
            </div>
          </main>
          
          <CandidateModal
            symbol={selectedSymbol}
            onClose={() => setSelectedSymbol(null)}
            onSelect={handleCandidateSelect}
          />
          
          {showBatchRecognition && (
            <BatchRecognition
              onClose={() => setShowBatchRecognition(false)}
              onUseFormula={handleSelectFormulaFromHistory}
              onCopyLatex={handleCopyLatex}
            />
          )}
          
          <ExportDialog
            isOpen={showExportDialog}
            onClose={() => setShowExportDialog(false)}
            canvasData={canvasDataUrl}
            defaultLatex={latex}
          />

          <SaveTemplateDialog
            isOpen={saveTemplateDialog.isOpen}
            onClose={() => setSaveTemplateDialog({ isOpen: false, latex: '', thumbnail: '' })}
            onSaved={() => {}}
            defaultLatex={saveTemplateDialog.latex}
            defaultThumbnail={saveTemplateDialog.thumbnail}
          />
        </>
      )}
    </div>
  );
}

export default App;

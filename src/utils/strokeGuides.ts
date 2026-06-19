export interface StrokeStep {
  type: 'text' | 'fraction-line' | 'integral' | 'sqrt' | 'bracket-open' | 'bracket-close' | 'operator-large' | 'arrow' | 'equation' | 'dot';
  direction: 'ltr' | 'rtl' | 'ttb' | 'btt' | 'diagonal-up' | 'curve-s';
  selector: string;
  label?: string;
}

const STROKE_GUIDES: Record<string, StrokeStep[]> = {
  '\\frac{a}{b}': [
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(1)', label: 'a' },
    { type: 'fraction-line', direction: 'ltr', selector: '.frac-line' },
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(2)', label: 'b' },
  ],
  '\\sqrt{x}': [
    { type: 'sqrt', direction: 'diagonal-up', selector: '.sqrt-sign' },
    { type: 'text', direction: 'ltr', selector: '.mord', label: 'x' },
  ],
  '\\sqrt[n]{x}': [
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(1)', label: 'n' },
    { type: 'sqrt', direction: 'diagonal-up', selector: '.sqrt-sign' },
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(2)', label: 'x' },
  ],
  'x^{n}': [
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(1)', label: 'x' },
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(2)', label: 'n' },
  ],
  'x_{i}': [
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(1)', label: 'x' },
    { type: 'text', direction: 'ltr', selector: '.mord:nth-of-type(2)', label: 'i' },
  ],
};

const DIRECTION_ARROWS: Record<string, string> = {
  'ltr': '→',
  'rtl': '←',
  'ttb': '↓',
  'btt': '↑',
  'diagonal-up': '↗',
  'curve-s': '↡',
};

const DIRECTION_LABELS: Record<string, string> = {
  'ltr': '从左到右',
  'rtl': '从右到左',
  'ttb': '从上到下',
  'btt': '从下到上',
  'diagonal-up': '从左下到右上',
  'curve-s': 'S形曲线',
};

export interface PositionedStrokeStep {
  step: number;
  x: number;
  y: number;
  width: number;
  height: number;
  direction: string;
  directionArrow: string;
  directionLabel: string;
  type: StrokeStep['type'];
  label?: string;
}

function normalizeLatex(latex: string): string {
  return latex
    .replace(/\s+/g, ' ')
    .replace(/\\, /g, '\\,')
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .trim();
}

export function getStrokeGuideForLatex(latex: string): StrokeStep[] | null {
  const normalized = normalizeLatex(latex);
  if (STROKE_GUIDES[normalized]) {
    return STROKE_GUIDES[normalized];
  }
  return null;
}

export function generateDefaultStrokeGuide(): StrokeStep[] {
  return [];
}

export function findElementsAndBuildGuide(
  katexRoot: HTMLElement,
  latex: string
): PositionedStrokeStep[] {
  const guide = getStrokeGuideForLatex(latex);
  const results: PositionedStrokeStep[] = [];

  if (guide) {
    let stepNum = 0;
    for (const step of guide) {
      stepNum++;
      const elements = katexRoot.querySelectorAll(step.selector);
      for (const el of elements) {
        if (!(el instanceof HTMLElement)) continue;
        const rect = el.getBoundingClientRect();
        const rootRect = katexRoot.getBoundingClientRect();
        results.push({
          step: stepNum,
          x: rect.left - rootRect.left,
          y: rect.top - rootRect.top,
          width: rect.width,
          height: rect.height,
          direction: step.direction,
          directionArrow: DIRECTION_ARROWS[step.direction] || '→',
          directionLabel: DIRECTION_LABELS[step.direction] || '',
          type: step.type,
          label: step.label,
        });
        break;
      }
    }
  }

  if (results.length === 0) {
    results.push(...buildAutoGuide(katexRoot));
  }

  return results;
}

function buildAutoGuide(katexRoot: HTMLElement): PositionedStrokeStep[] {
  const results: PositionedStrokeStep[] = [];
  const rootRect = katexRoot.getBoundingClientRect();

  const fracLines = katexRoot.querySelectorAll('.frac-line');
  const sqrtSigns = katexRoot.querySelectorAll('.sqrt-sign, .sqrt > .mop');
  const svgElements = katexRoot.querySelectorAll('svg');
  const allMords = katexRoot.querySelectorAll('.mord, .mop, .mbin, .mrel, .mopen, .mclose');

  let stepNum = 0;
  const processed = new Set<HTMLElement>();

  for (const el of fracLines) {
    if (!(el instanceof HTMLElement)) continue;
    processed.add(el);
    stepNum++;
    const rect = el.getBoundingClientRect();
    results.push({
      step: stepNum,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
      direction: 'ltr',
      directionArrow: '→',
      directionLabel: '从左到右',
      type: 'fraction-line',
    });
  }

  for (const el of sqrtSigns) {
    if (!(el instanceof HTMLElement)) continue;
    processed.add(el);
    stepNum++;
    const rect = el.getBoundingClientRect();
    results.push({
      step: stepNum,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
      direction: 'diagonal-up',
      directionArrow: '↗',
      directionLabel: '从左下到右上',
      type: 'sqrt',
    });
  }

  for (const svg of svgElements) {
    if (!(svg instanceof HTMLElement)) continue;
    if (processed.has(svg)) continue;
    const parent = svg.parentElement;
    if (parent && processed.has(parent)) continue;

    stepNum++;
    const rect = svg.getBoundingClientRect();
    const isHorizontal = rect.width > rect.height * 1.5;

    let dir: StrokeStep['direction'] = 'ttb';
    let dirArrow = '↓';
    let dirLabel = '从上到下';
    let stepType: StrokeStep['type'] = 'operator-large';

    if (isHorizontal) {
      dir = 'ltr';
      dirArrow = '→';
      dirLabel = '从左到右';
      stepType = 'fraction-line';
    }

    results.push({
      step: stepNum,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
      direction: dir,
      directionArrow: dirArrow,
      directionLabel: dirLabel,
      type: stepType,
    });
  }

  for (const el of allMords) {
    if (!(el instanceof HTMLElement)) continue;
    if (processed.has(el)) continue;
    let hasProcessedChild = false;
    for (const p of processed) {
      if (p.contains(el)) {
        hasProcessedChild = true;
        break;
      }
    }
    if (hasProcessedChild) continue;

    const text = el.textContent?.trim() || '';
    if (!text || text.length > 5) continue;

    stepNum++;
    const rect = el.getBoundingClientRect();
    const isBracket = el.classList.contains('mopen') || el.classList.contains('mclose');
    const isOperator = el.classList.contains('mop');

    let dir: StrokeStep['direction'] = 'ltr';
    let dirArrow = '→';
    let dirLabel = '从左到右';
    let stepType: StrokeStep['type'] = 'text';

    if (isBracket) {
      dir = 'ttb';
      dirArrow = '↓';
      dirLabel = '从上到下';
      stepType = el.classList.contains('mopen') ? 'bracket-open' : 'bracket-close';
    } else if (isOperator) {
      const opText = text.toLowerCase();
      if (opText.includes('∫') || opText.includes('∑') || opText.includes('∏') || opText.includes('lim')) {
        dir = 'ttb';
        dirArrow = '↓';
        dirLabel = '从上到下';
        stepType = 'operator-large';
      }
    }

    results.push({
      step: stepNum,
      x: rect.left - rootRect.left,
      y: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
      direction: dir,
      directionArrow: dirArrow,
      directionLabel: dirLabel,
      type: stepType,
      label: text,
    });
  }

  results.sort((a, b) => {
    const rowTolerance = Math.max(a.height, b.height) * 0.5;
    if (Math.abs(a.y - b.y) > rowTolerance) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });

  results.forEach((r, i) => {
    r.step = i + 1;
  });

  return results;
}

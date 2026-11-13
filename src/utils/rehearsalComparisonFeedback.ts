import type { IntelligentLineFeedbackEntry } from '../types/sharedScript';
import type { RehearsalComparisonResult } from './rehearsalComparisonSession';
import { scoreLineMatch } from './lineMatching';

export type ComparisonLineMetadata = { lineIndex: number; character: string; sceneTitle: string | null;
  expectedText: string; speakableText: string; language: string };
export const makeRehearsalComparisonEntry = (result: RehearsalComparisonResult, line: ComparisonLineMetadata): IntelligentLineFeedbackEntry => ({
  recognitionEngine: 'comparison', result: result.completion === 'report_snapshot' ? 'informe_parcial' : 'comparacion_ensayo', ...line,
  heardText: result.results.map(item => `${item.engine}: ${item.text || `[${item.error || 'sin texto'}]`}`).join('\n'),
  score: 0, matchedReferenceText: line.expectedText, matchedReferenceIndex: 0, createdAt: new Date().toISOString(),
  rehearsalComparison: { id: result.turn.id, execution: 'parallel', sameUtterance: true,
    completion: result.completion, elapsedMs: result.elapsedMs, quietMs: result.quietMs,
    speechStartMs: result.speechStartMs, speechEndMs: result.speechEndMs, inputClosedMs: result.inputClosedMs, speechTimingSource: result.speechTimingSource,
    results: result.results.map(item => {
      // Scores describe the saved ASR output. They never determine when a
      // comparison take ends or whether the actor may continue the scene.
      const match = scoreLineMatch(line.speakableText, item.text);
      return { ...item, score: match.score, coverageScore: match.coverageScore, orderScore: match.orderScore,
        precisionScore: match.precisionScore, finalScore: match.finalScore };
    }) },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { buildSharedApiUrl } from '../api/sharedApiUrl';
import { submitIntelligentLineFeedback } from '../api/sharedScripts';
import { createFeedbackOutbox } from '../utils/feedbackOutbox';

export const feedbackOutbox = createFeedbackOutbox({
  read: () => AsyncStorage.getItem('@teatro_ia_feedback_outbox_v1'),
  write: value => AsyncStorage.setItem('@teatro_ia_feedback_outbox_v1', value),
  scope: () => typeof window === 'undefined' ? 'https://ai-theater.vercel.app' : window.location.origin,
  writable: async () => {
    const response = await fetch(buildSharedApiUrl('/api/shared-script/storage-context'), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('No se pudo comprobar el almacenamiento.');
    const context = await response.json();
    return context.readOnly !== true && context.feedbackWritable === true;
  },
  send: report => submitIntelligentLineFeedback(report, AbortSignal.timeout(12000)),
});
export const useFeedbackOutbox = () => useSyncExternalStore(feedbackOutbox.subscribe, feedbackOutbox.getSnapshot, feedbackOutbox.getSnapshot);

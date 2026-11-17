import { useVoiceCommand } from './useVoiceCommand';
import { isWarmupAdvanceCommand } from '../utils/voiceAdvance';

export const useWarmupAdvance = (restKey: string | null, enabled: boolean, onAdvance: () => void) => {
  const recognition = useVoiceCommand(restKey, enabled, onAdvance, isWarmupAdvanceCommand);
  return { ...recognition, prepareWarmupMicrophone: recognition.prepareVoiceInput, releaseWarmupMicrophone: recognition.releaseVoiceInput };
};

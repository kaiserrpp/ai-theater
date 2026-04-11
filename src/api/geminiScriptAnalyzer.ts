import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  Dialogue,
  PendingAnalysisJob,
  SceneExtractionResult,
  ScriptData,
  SCENE_SYSTEM_SPEAKER,
} from '../types/script';
import { parseModelJson } from '../utils/json';

const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';
const DEFAULT_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro'];
const FILE_STATUS_POLL_INTERVAL_MS = 3000;
const FILE_STATUS_MAX_POLLS = 40;
const MODEL_RETRY_DELAY_MS = 2000;
const PROCESSING_TITLE = 'Procesando...';

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null;

type AsyncCallback = (() => void | Promise<void> | undefined) | undefined;

interface AnalysisCallbacks {
  onStatusChange?: (status: string) => void | Promise<void>;
  onScenesReady?: (sceneTitles: string[]) => void | Promise<void>;
  onSceneStart?: (index: number, total: number) => void | Promise<void>;
  onSceneComplete?: (script: ScriptData, checkpoint: PendingAnalysisJob) => void | Promise<void>;
}

interface AnalyzeScriptInStagesInput {
  localUri?: string | null;
  resumeJob?: PendingAnalysisJob | null;
  preferredModels?: string[];
  callbacks?: AnalysisCallbacks;
}

interface UploadedPdf {
  fileName: string;
  fileUri: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runCallback = async (callback: AsyncCallback) => {
  if (callback) {
    await callback();
  }
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const ensureApiKey = () => {
  if (!API_KEY || !genAI) {
    throw new Error('Falta configurar EXPO_PUBLIC_API_KEY.');
  }
};

const getClient = () => {
  ensureApiKey();
  return genAI as GoogleGenerativeAI;
};

const getModelsToTry = (preferredModels: string[] = []) => {
  const uniqueModels = new Set<string>([...preferredModels, ...DEFAULT_MODELS]);
  return Array.from(uniqueModels);
};

const normalizeDialogue = (line: unknown): Dialogue | null => {
  if (!line || typeof line !== 'object') {
    return null;
  }

  const candidate = line as Partial<Dialogue>;
  if (typeof candidate.p !== 'string' || typeof candidate.t !== 'string') {
    return null;
  }

  const speaker = candidate.p.trim().toUpperCase();
  const text = candidate.t.trim();

  if (!speaker || !text) {
    return null;
  }

  return {
    p: speaker,
    t: text,
    a: typeof candidate.a === 'string' ? candidate.a.trim() : '',
  };
};

const parseSceneList = (text: string) => {
  const parsed = parseModelJson<unknown>(text);
  if (!Array.isArray(parsed)) {
    throw new Error('La IA no devolvio una lista valida de escenas.');
  }

  const sceneTitles = parsed.map((scene) => String(scene).trim()).filter(Boolean);
  if (sceneTitles.length === 0) {
    throw new Error('No se detectaron escenas en el PDF.');
  }

  return sceneTitles;
};

const parseSceneChunk = (text: string): SceneExtractionResult => {
  const parsed = parseModelJson<unknown>(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La IA no devolvio un objeto JSON valido para la escena.');
  }

  const chunk = parsed as SceneExtractionResult;

  return {
    obra: typeof chunk.obra === 'string' ? chunk.obra.trim() : undefined,
    personajes: Array.isArray(chunk.personajes)
      ? chunk.personajes.map((character) => String(character).trim().toUpperCase()).filter(Boolean)
      : [],
    guion: Array.isArray(chunk.guion)
      ? chunk.guion
          .map((line) => normalizeDialogue(line))
          .filter((line): line is Dialogue => line !== null)
      : [],
  };
};

const mergeSceneIntoScript = (
  currentScript: ScriptData,
  sceneTitle: string,
  chunkData: SceneExtractionResult
): ScriptData => {
  const mergedCharacters = new Set(currentScript.personajes);

  chunkData.personajes?.forEach((character) => {
    mergedCharacters.add(character);
  });

  return {
    obra: currentScript.obra === PROCESSING_TITLE ? chunkData.obra || currentScript.obra : currentScript.obra,
    personajes: Array.from(mergedCharacters).sort(),
    guion: [
      ...currentScript.guion,
      { p: SCENE_SYSTEM_SPEAKER, t: sceneTitle, a: '' },
      ...(chunkData.guion ?? []),
    ],
  };
};

const buildModelOptions = (model: string, responseMimeType?: string) => {
  if (!responseMimeType) {
    return { model };
  }

  return {
    model,
    generationConfig: {
      responseMimeType,
      temperature: 0.1,
    },
  };
};

const generateWithFallback = async <T>({
  models,
  contents,
  responseMimeType,
  parse,
  fallbackErrorMessage,
}: {
  models: string[];
  contents: any[];
  responseMimeType?: string;
  parse: (text: string) => T;
  fallbackErrorMessage: string;
}) => {
  let lastError: unknown;

  for (const modelName of models) {
    try {
      const model = getClient().getGenerativeModel(buildModelOptions(modelName, responseMimeType));
      const response = await model.generateContent(contents);
      const text = response.response.text().trim();

      if (!text) {
        throw new Error(`El modelo ${modelName} devolvio una respuesta vacia.`);
      }

      return parse(text);
    } catch (error) {
      lastError = error;
      await wait(MODEL_RETRY_DELAY_MS);
    }
  }

  throw new Error(`${fallbackErrorMessage} ${getErrorMessage(lastError, 'Sin detalle adicional.')}`.trim());
};

const uploadPdf = async (localUri: string): Promise<UploadedPdf> => {
  const fileResponse = await fetch(localUri);
  const fileBlob = await fileResponse.blob();

  const uploadResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
    },
    body: fileBlob,
  });

  const uploadData = await uploadResponse.json();
  const fileUri = uploadData?.file?.uri;
  const fileName = uploadData?.file?.name;

  if (!uploadResponse.ok || typeof fileUri !== 'string' || typeof fileName !== 'string') {
    throw new Error(uploadData?.error?.message || 'Error de subida.');
  }

  return { fileName, fileUri };
};

const waitForUploadedFile = async (fileName: string) => {
  for (let attempt = 0; attempt < FILE_STATUS_MAX_POLLS; attempt += 1) {
    await wait(FILE_STATUS_POLL_INTERVAL_MS);

    const statusResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
    const statusData = await statusResponse.json();

    if (statusData?.state === 'ACTIVE') {
      return;
    }

    if (statusData?.state === 'FAILED') {
      throw new Error('El archivo subido fallo durante el procesamiento en Google.');
    }
  }

  throw new Error('El archivo no se activo a tiempo en Google.');
};

const extractSceneList = async (fileUri: string, models: string[]) =>
  generateWithFallback<string[]>({
    models,
    contents: [
      { text: 'Devuelve un array JSON de strings con los nombres de las escenas de este PDF. Solo el array, sin texto extra.' },
      { fileData: { mimeType: 'application/pdf', fileUri } },
    ],
    responseMimeType: 'application/json',
    parse: parseSceneList,
    fallbackErrorMessage: 'No se pudo obtener el indice de escenas.',
  });

const extractSceneChunk = async (sceneTitle: string, fileUri: string, models: string[]) =>
  generateWithFallback<SceneExtractionResult>({
    models,
    contents: [
      {
        text: `Transcribe integro y literal el texto de la escena "${sceneTitle}". JSON: {"obra":"t", "personajes":["P1"], "guion":[{"p":"P", "t":"t", "a":"a"}]}`,
      },
      { fileData: { mimeType: 'application/pdf', fileUri } },
    ],
    responseMimeType: 'application/json',
    parse: parseSceneChunk,
    fallbackErrorMessage: `No se pudo procesar la escena "${sceneTitle}".`,
  });

export const fetchAvailableGeminiModels = async () => {
  if (!API_KEY) {
    return [];
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
    const data = await response.json();

    if (!response.ok || !Array.isArray(data?.models)) {
      return [];
    }

    return data.models
      .filter((model: { supportedGenerationMethods?: string[] }) =>
        Array.isArray(model.supportedGenerationMethods) &&
        model.supportedGenerationMethods.includes('generateContent')
      )
      .map((model: { name?: string }) => model.name?.replace('models/', ''))
      .filter((modelName: string | undefined): modelName is string => Boolean(modelName));
  } catch {
    return [];
  }
};

export const analyzeScriptInStages = async ({
  localUri,
  resumeJob,
  preferredModels = [],
  callbacks,
}: AnalyzeScriptInStagesInput) => {
  ensureApiKey();

  let currentFileUri = resumeJob?.fileUri ?? '';
  let sceneList = resumeJob?.totalChunks ?? [];
  let currentScript: ScriptData = resumeJob?.data ?? {
    obra: PROCESSING_TITLE,
    personajes: [],
    guion: [],
  };

  const modelsToTry = getModelsToTry(preferredModels);
  const startAt = resumeJob ? resumeJob.index + 1 : 0;

  if (!resumeJob) {
    if (!localUri) {
      throw new Error('No se ha seleccionado ningun PDF.');
    }

    await runCallback(() => callbacks?.onStatusChange?.('Subiendo PDF...'));
    const uploadedPdf = await uploadPdf(localUri);
    currentFileUri = uploadedPdf.fileUri;

    await runCallback(() => callbacks?.onStatusChange?.('Esperando a Google...'));
    await waitForUploadedFile(uploadedPdf.fileName);

    await runCallback(() => callbacks?.onStatusChange?.('Mapeando escenas...'));
    sceneList = await extractSceneList(currentFileUri, modelsToTry);
  }

  await runCallback(() => callbacks?.onScenesReady?.(sceneList));

  for (let index = startAt; index < sceneList.length; index += 1) {
    await runCallback(() => callbacks?.onSceneStart?.(index, sceneList.length));
    await runCallback(() => callbacks?.onStatusChange?.(`Escena ${index + 1} de ${sceneList.length}...`));

    const chunkData = await extractSceneChunk(sceneList[index], currentFileUri, modelsToTry);
    currentScript = mergeSceneIntoScript(currentScript, sceneList[index], chunkData);

    await runCallback(() =>
      callbacks?.onSceneComplete?.(currentScript, {
        data: currentScript,
        fileUri: currentFileUri,
        index,
        totalChunks: sceneList,
      })
    );
  }

  await runCallback(() => callbacks?.onStatusChange?.('Completado'));

  return currentScript;
};

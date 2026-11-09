import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  getAuditionLineRoles, normalizeAuditionScript, resolveAuditionPreferences, validateAuditionScript,
  type AuditionPreferences,
} from '../../shared/auditionScenes';
import { analyzeScriptLocally } from '../api/localScriptAnalyzer';
import { analyzeScriptInStages } from '../api/geminiScriptAnalyzer';
import { deleteSharedAuditionScene, fetchSharedScript, saveSharedAuditionScene } from '../api/sharedScripts';
import { useIsAdmin } from '../store/adminSession';
import { AUDITION_PREFERENCES_STORAGE_PREFIX } from '../store/storageKeys';
import { Dialogue, SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER, ScriptData } from '../types/script';
import { SharedAuditionScene, SharedScriptManifest } from '../types/sharedScript';
import { getSceneTitles } from '../utils/scriptScenes';
import { getAuditionRehearsalPlan, recordAuditionRehearsalProgress, type AuditionRehearsalMode } from '../utils/auditionRehearsal';
import { AdminAccessPanel } from './AdminAccessPanel';
import { RehearsalView } from './RehearsalView';
import { Button, Chip, Icon, usePracticeTheme } from './PracticeUI';

interface Props {
  practiceOnly?: boolean;
  initialSceneId?: string | null;
  initialMode?: AuditionRehearsalMode;
  onRehearsalActiveChange?: (active: boolean) => void;
  onPracticeSelected?: (id: string, mode: AuditionRehearsalMode) => void;
  sharedScript: SharedScriptManifest | null;
  obraTitle: string;
  onEnsureShared: () => Promise<SharedScriptManifest | undefined>;
  onManifestUpdated: (manifest: SharedScriptManifest) => void;
  onExit: () => void;
}

interface Draft {
  sceneId?: string;
  revision?: number;
  title: string;
  fileName: string | null;
  guion: Dialogue[];
}

const Action = ({ label, onPress, secondary = false, danger = false, disabled = false }: {
  label: string; onPress: () => void; secondary?: boolean; danger?: boolean; disabled?: boolean;
}) => (
  <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.action, secondary && styles.secondary, danger && styles.danger, disabled && styles.disabled]}>
    <Text style={[styles.actionText, secondary && styles.secondaryText, danger && styles.dangerText]}>{label}</Text>
  </TouchableOpacity>
);

const Field = ({ label, value, onChangeText, multiline = false, editable = true }: {
  label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean; editable?: boolean;
}) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} multiline={multiline}
      editable={editable} style={[styles.input, multiline && styles.multiline]} />
  </View>
);

export const AuditionScenesPanel = ({ sharedScript, obraTitle, onEnsureShared, onManifestUpdated, onExit, practiceOnly = false, initialSceneId, initialMode, onRehearsalActiveChange, onPracticeSelected }: Props) => {
  const { palette, ui } = usePracticeTheme();
  const isAdmin = useIsAdmin();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<AuditionPreferences | null>(null);
  const [rehearsal, setRehearsal] = useState<{
    scene: SharedAuditionScene; roles: string[]; start: number; mode: AuditionRehearsalMode; sceneFilter: string[];
  } | null>(null);
  const [pendingResumeMode, setPendingResumeMode] = useState<AuditionRehearsalMode | null>(null);
  const [transcriptVisible, setTranscriptVisible] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [discardRequested, setDiscardRequested] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState<string | null>(null);
  const [renamingRole, setRenamingRole] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const [practiceMine, setPracticeMine] = useState(true);
  const [showPracticeRoles, setShowPracticeRoles] = useState(false);
  const scenes = sharedScript?.auditionScenes ?? [];
  const selectedScene = scenes.find((scene) => scene.id === selectedId) ?? null;
  const preferencesKey = sharedScript && selectedScene
    ? `${AUDITION_PREFERENCES_STORAGE_PREFIX}${sharedScript.shareId}:${selectedScene.id}` : null;
  const selectedRevision = selectedScene?.revision;
  const [loadedPreferencesKey, setLoadedPreferencesKey] = useState<string | null>(null);
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);
  const isEditing = Boolean(draft);

  const draftRoles = useMemo(() => [...new Set(draft?.guion.flatMap(getAuditionLineRoles) ?? [])], [draft]);
  const selectedPlans = useMemo(() => selectedScene && preferences && loadedPreferencesKey === preferencesKey && loadedRevision === selectedRevision ? {
    ALL: getAuditionRehearsalPlan(selectedScene, preferences, 'ALL'),
    MINE: getAuditionRehearsalPlan(selectedScene, preferences, 'MINE'),
  } : null, [selectedScene, preferences, loadedPreferencesKey, preferencesKey, loadedRevision, selectedRevision]);
  const handleProgress = useCallback((lineIndex: number) => setPreferences((previous) =>
    previous && rehearsal && previous.revision === rehearsal.scene.revision
      ? recordAuditionRehearsalProgress(previous, rehearsal.mode, rehearsal.sceneFilter, rehearsal.roles, lineIndex) : previous), [rehearsal]);
  const exitRehearsal = useCallback(() => setRehearsal(null), []);
  useEffect(() => { if (initialSceneId) setSelectedId(initialSceneId); }, [initialSceneId]);
  useEffect(() => { if (initialMode) setPracticeMine(initialMode === 'MINE'); }, [initialMode]);
  useEffect(() => { onRehearsalActiveChange?.(Boolean(rehearsal)); }, [rehearsal, onRehearsalActiveChange]);

  useEffect(() => {
    setKeyboardInset(0);
    if (!isEditing || Platform.OS !== 'web' || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => setKeyboardInset(viewport.scale === 1
      ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)) : 0);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [isEditing]);

  // The scene snapshot also guards against writing one scene's progress under another key.
  useEffect(() => {
    let cancelled = false;
    setPreferences(null);
    setLoadedPreferencesKey(null);
    setLoadedRevision(null);
    setPendingResumeMode(null);
    setTranscriptVisible(false);
    if (preferencesKey && selectedScene) {
      const scene = selectedScene;
      void AsyncStorage.getItem(preferencesKey).then((stored) => {
        const saved: unknown = stored ? JSON.parse(stored) : null;
        if (!cancelled) setPreferences(resolveAuditionPreferences(scene, saved));
      }).catch(() => {
        if (!cancelled) {
          setPreferences(resolveAuditionPreferences(scene, null));
          setNotice('No se pudo recuperar el ensayo guardado. Puedes empezar de nuevo.');
        }
      }).finally(() => {
        if (!cancelled) { setLoadedPreferencesKey(preferencesKey); setLoadedRevision(scene.revision); }
      });
    }
    return () => { cancelled = true; };
    // Only reload when the scene or its text revision changes, not after unrelated manifest edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferencesKey, selectedRevision]);

  useEffect(() => {
    if (preferencesKey && preferences && preferencesKey === loadedPreferencesKey && loadedRevision === selectedRevision) {
      void AsyncStorage.setItem(preferencesKey, JSON.stringify(preferences)).catch(() => {
        setNotice('No se pudo guardar el progreso en este dispositivo. Puedes seguir ensayando.');
      });
    }
  }, [preferencesKey, preferences, loadedPreferencesKey, loadedRevision, selectedRevision]);

  const refresh = async () => {
    if (!sharedScript || busy || refreshing) return;
    setRefreshing(true);
    setError(null);
    try { onManifestUpdated(await fetchSharedScript(sharedScript.shareId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudieron actualizar las audiciones.'); }
    finally { setRefreshing(false); }
  };

  const importPdf = async () => {
    if (!isAdmin || busy) return;
    setBusy(true);
    setError(null);
    setNotice('');
    setStatus('Elige un PDF con texto…');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (picked.canceled) return;
      const file = picked.assets[0];
      const report = (value: string) => { setStatus(value); };
      const parsed = Platform.OS === 'web'
        ? await analyzeScriptLocally(file.uri, { documentName: file.name, callbacks: { onStatusChange: report } })
        : await analyzeScriptInStages({ localUri: file.uri, callbacks: { onStatusChange: report } });
      setDraft({ sceneId: draft?.sceneId, revision: draft?.revision,
        title: draft?.title || file.name.replace(/\.pdf$/i, ''), fileName: file.name,
        guion: parsed.guion.map((line) => ({ ...line, ...(line.r ? { r: [...line.r] } : {}) })) });
      setDiscardRequested(false);
      setRenamingRole(null);
      setNotice('PDF leído. Revisa los personajes y las réplicas antes de guardar.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo leer el PDF.');
    } finally { setBusy(false); setStatus(''); }
  };

  const updateLine = (index: number, update: Partial<Dialogue>) => setDraft((previous) => previous && ({
    ...previous, guion: previous.guion.map((line, lineIndex) => lineIndex === index ? { ...line, ...update } : line),
  }));

  const addLine = (after: number) => setDraft((previous) => previous && ({ ...previous,
    guion: [...previous.guion.slice(0, after + 1), { p: '', t: '' }, ...previous.guion.slice(after + 1)],
  }));

  const moveLine = (index: number, direction: -1 | 1) => setDraft((previous) => {
    if (!previous || index + direction < 0 || index + direction >= previous.guion.length) return previous;
    const guion = [...previous.guion];
    [guion[index], guion[index + direction]] = [guion[index + direction], guion[index]];
    return { ...previous, guion };
  });

  const renameRole = () => {
    const nextName = roleName.trim();
    if (!draft || !renamingRole || !nextName || [SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER].includes(nextName)) return;
    setDraft({ ...draft, guion: draft.guion.map((line) => {
      const roles = getAuditionLineRoles(line);
      if (!roles.includes(renamingRole)) return line;
      const nextRoles = [...new Set(roles.map((role) => role === renamingRole ? nextName : role))];
      return { ...line, p: nextRoles.join(' / '), r: nextRoles.length > 1 ? nextRoles : undefined };
    }) });
    setRenamingRole(null);
  };

  const save = async () => {
    if (!sharedScript || !isAdmin || !draft || busy) return;
    const title = draft.title.trim();
    const data: ScriptData = { obra: title, personajes: [], guion: draft.guion };
    const validation = !title || title.length > 160 ? 'Pon un título de hasta 160 caracteres.' : validateAuditionScript(data);
    if (validation) { setError(validation); return; }
    setBusy(true);
    setError(null);
    try {
      const next = await saveSharedAuditionScene({ shareId: sharedScript.shareId, sceneId: draft.sceneId, revision: draft.revision, title, fileName: draft.fileName,
        scriptData: normalizeAuditionScript(data, title) });
      const sceneId = draft.sceneId ?? next.auditionScenes[next.auditionScenes.length - 1]?.id;
      onManifestUpdated(next);
      setSelectedId(sceneId ?? null);
      setDraft(null);
      setTranscriptVisible(false);
      setPendingResumeMode(null);
      setDiscardRequested(false);
      setNotice('Mini-guion guardado. Ya puedes elegir personaje y ensayar.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el mini-guion.'); }
    finally { setBusy(false); }
  };

  const remove = async (scene: SharedAuditionScene) => {
    if (!sharedScript || !isAdmin || busy) return;
    setBusy(true);
    setError(null);
    try {
      onManifestUpdated(await deleteSharedAuditionScene({ shareId: sharedScript.shareId, sceneId: scene.id, revision: scene.revision }));
      if (selectedId === scene.id) setSelectedId(null);
      setDeleteRequested(null);
      setNotice('Escena de audición eliminada.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo eliminar la escena.'); }
    finally { setBusy(false); }
  };

  const launchRehearsal = (scene: SharedAuditionScene, mode: AuditionRehearsalMode, resume = false) => {
    if (!preferences || !selectedPlans || !preferences.roles.length) return;
    const plan = selectedPlans[mode];
    if (!plan.lineCount) return;
    setPendingResumeMode(null);
    onPracticeSelected?.(scene.id, mode);
    setRehearsal({ scene, mode, roles: [...preferences.roles], sceneFilter: [...plan.sceneFilter],
      start: resume && plan.canResume ? plan.lineIndex : 0 });
  };

  const requestRehearsal = (scene: SharedAuditionScene, mode: AuditionRehearsalMode) => {
    if (selectedPlans?.[mode].canResume) setPendingResumeMode(mode);
    else launchRehearsal(scene, mode);
  };

  if (rehearsal) {
    return <RehearsalView key={`${rehearsal.scene.id}:${rehearsal.scene.revision}`}
      guion={rehearsal.scene.scriptData.guion} myRoles={rehearsal.roles}
      filterScenes={rehearsal.sceneFilter} spokenOnly
      scriptId={`audition:${sharedScript?.shareId}:${rehearsal.scene.id}:${rehearsal.scene.revision}`}
      scriptTitle={`${obraTitle} · ${rehearsal.scene.title}`} shareId={sharedScript?.shareId}
      initialIndex={rehearsal.start}
      onProgressChange={handleProgress}
      onExit={exitRehearsal} />;
  }

  if (practiceOnly) {
    return <ScrollView contentContainerStyle={ui.page}>
      {selectedScene ? <>
        <TouchableOpacity accessibilityRole="button" onPress={() => setSelectedId(null)} style={ui.row}><Icon name="arrow-left" /><Text style={[ui.text, { color: palette.plum }]}>Todas las audiciones</Text></TouchableOpacity>
        <Text style={ui.subtitle}>{selectedScene.title}</Text>
        {preferences && selectedPlans ? <>
          <TouchableOpacity accessibilityRole="button" onPress={() => setShowPracticeRoles(!showPracticeRoles)} style={[ui.card, ui.row, { padding: 15 }]}><Icon name="account-outline" /><View style={{ flex: 1 }}><Text style={ui.text}>Mis personajes</Text><Text style={{ color: palette.ink, fontWeight: '600' }}>{preferences.roles.join(', ') || 'Elegir personaje'}</Text></View><Icon name="chevron-down" /></TouchableOpacity>
          {showPracticeRoles || !preferences.roles.length ? <View style={ui.wrap}>{selectedScene.scriptData.personajes.map((role) => <Chip key={role} label={role} selected={preferences.roles.includes(role)} onPress={() => { setPendingResumeMode(null); setPreferences({ ...preferences, roles: preferences.roles.includes(role) ? preferences.roles.filter((candidate) => candidate !== role) : [...preferences.roles, role] }); }} />)}</View> : null}
          <View style={ui.wrap}><Chip label={`Mis escenas · ${selectedPlans.MINE.sceneFilter.length}`} selected={practiceMine} onPress={() => setPracticeMine(true)} /><Chip label={`Todas · ${selectedPlans.ALL.sceneFilter.length}`} selected={!practiceMine} onPress={() => setPracticeMine(false)} /></View>
          <Text style={ui.text}>La app interpreta los demás personajes y espera tu réplica.</Text>
          <Button label={selectedPlans[practiceMine ? 'MINE' : 'ALL'].canResume ? 'Continuar ensayo' : 'Empezar ensayo'} disabled={!preferences.roles.length || !selectedPlans[practiceMine ? 'MINE' : 'ALL'].lineCount} onPress={() => launchRehearsal(selectedScene, practiceMine ? 'MINE' : 'ALL', true)} />
          {selectedPlans[practiceMine ? 'MINE' : 'ALL'].canResume ? <Button label="Empezar desde el principio" secondary onPress={() => launchRehearsal(selectedScene, practiceMine ? 'MINE' : 'ALL')} /> : null}
          <Button label={transcriptVisible ? 'Ocultar mini-guion' : 'Leer mini-guion'} secondary onPress={() => setTranscriptVisible(!transcriptVisible)} />
          {transcriptVisible ? selectedScene.scriptData.guion.map((line, index) => <View key={index} style={{ gap: 6 }}><Text style={ui.label}>{line.p === SCENE_SYSTEM_SPEAKER ? line.t : line.p}</Text>{line.a ? <Text style={ui.text}>{line.a}</Text> : null}{line.p !== SCENE_SYSTEM_SPEAKER ? <Text style={[ui.text, { color: palette.ink }]}>{line.t}</Text> : null}</View>) : null}
        </> : <Text style={ui.text}>Recuperando tu ensayo…</Text>}
      </> : <>
        <Text style={ui.text}>Elige un mini-guion para preparar tu personaje.</Text>
        {scenes.map((scene) => <TouchableOpacity accessibilityRole="button" key={scene.id} onPress={() => { setSelectedId(scene.id); setShowPracticeRoles(false); }} style={[ui.card, ui.row, { padding: 18 }]}><Icon name="script-text-outline" /><View style={{ flex: 1, gap: 5 }}><Text style={[ui.subtitle, { fontSize: 18 }]}>{scene.title}</Text><Text style={ui.text}>{scene.scriptData.personajes.join(' · ')}</Text><Text style={ui.text}>{getSceneTitles(scene.scriptData.guion).length} escenas</Text></View><Icon name="chevron-right" /></TouchableOpacity>)}
        {!scenes.length ? <View style={ui.card}><Text style={ui.subtitle}>Todavía no hay mini-guiones</Text><Text style={ui.text}>Cuando se añadan a la obra, aparecerán aquí.</Text></View> : null}
        <Button label={refreshing ? 'Actualizando…' : 'Actualizar escenas'} secondary disabled={refreshing || !sharedScript} onPress={() => void refresh()} />
      </>}
      {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
      {notice ? <Text style={ui.text}>{notice}</Text> : null}
    </ScrollView>;
  }

  return (
    <KeyboardAvoidingView style={[styles.root, Platform.OS === 'web' && { paddingBottom: keyboardInset }]}
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>AUDICIONES · ESCENAS</Text>
        <Text style={styles.title}>{obraTitle}</Text>
        <Text style={styles.hint}>Mini-guiones para preparar tus personajes.</Text>
      </View>
      <Action label="Volver a la obra" secondary disabled={busy} onPress={() => {
        if (draft) setDiscardRequested(true); else onExit();
      }} />
      {!draft ? <AdminAccessPanel /> : null}
      {error && !draft ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {busy && status && !draft ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{status}</Text> : null}

      {!sharedScript ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Prepara las audiciones de esta obra</Text>
          <Text style={styles.hint}>Publica la obra para guardar sus mini-guiones y compartirlos con el grupo.</Text>
          {isAdmin ? <Action label="Preparar obra para audiciones" disabled={busy} onPress={() => {
            setBusy(true);
            void onEnsureShared().then((manifest) => {
              if (!manifest) setError('No se pudo preparar la obra. Vuelve a la obra y revisa el mensaje de publicación.');
            }).catch((failure) => {
              setError(failure instanceof Error ? failure.message : 'No se pudo preparar la obra.');
            }).finally(() => setBusy(false));
          }} /> : null}
        </View>
      ) : draft ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>{draft.sceneId ? 'Revisar mini-guion' : 'Nuevo mini-guion'}</Text>
          <Field label="Título del mini-guion" value={draft.title} editable={!busy} onChangeText={(title) => setDraft({ ...draft, title })} />
          <Text style={styles.hint}>{draft.fileName ? `PDF: ${draft.fileName}` : 'Puedes importar un PDF o escribir las réplicas.'}</Text>
          <Action label={draft.fileName ? 'Sustituir PDF' : 'Importar PDF'} secondary disabled={busy} onPress={() => void importPdf()} />
          <Text style={styles.label}>Personajes detectados · pulsa para corregir un nombre</Text>
          <View style={styles.tags}>
            {draftRoles.map((role) => <TouchableOpacity accessibilityRole="button" key={role} disabled={busy}
              style={styles.tag} onPress={() => { setRenamingRole(role); setRoleName(role); }}>
              <Text style={styles.tagText}>{role}</Text>
            </TouchableOpacity>)}
          </View>
          {renamingRole ? <View style={styles.lineCard}>
            <Field label={`Corregir ${renamingRole}`} value={roleName} onChangeText={setRoleName} editable={!busy} />
            <Action label="Cambiar nombre en todo el mini-guion" secondary disabled={busy || !roleName.trim()} onPress={renameRole} />
          </View> : null}
          <Text style={styles.hint}>Revisa el orden, los personajes, las réplicas y las acotaciones. Guardar un cambio de texto reinicia el progreso de esa escena.</Text>
          {draft.guion.map((line, index) => <View key={index} style={styles.lineCard}>
            <Text style={styles.lineNumber}>Elemento {index + 1}{line.p === SCENE_SYSTEM_SPEAKER ? ' · Escena' : ''}</Text>
            {[SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER].includes(line.p) || line.k === 'song' ? (
              <Action label={`Tratar elemento ${index + 1} como réplica`} secondary disabled={busy}
                onPress={() => updateLine(index, { p: '', r: undefined, k: undefined, songTitle: undefined })} />
            ) : null}
            {line.p !== SCENE_SYSTEM_SPEAKER && line.p !== SONG_SYSTEM_SPEAKER && line.k !== 'song' ? (
              <Field label={`Personaje de la réplica ${index + 1}`} value={line.r?.join(' / ') || line.p} editable={!busy}
                onChangeText={(value) => {
                  const roles = value.split('/').map((role) => role.trim()).filter(Boolean);
                  updateLine(index, { p: value, r: roles.length > 1 ? roles : undefined });
                }} />
            ) : null}
            <Field label={line.p === SCENE_SYSTEM_SPEAKER ? `Nombre de escena ${index + 1}` : `Texto de la réplica ${index + 1}`}
              value={line.t} multiline editable={!busy} onChangeText={(t) => updateLine(index, { t })} />
            {line.p !== SCENE_SYSTEM_SPEAKER ? <Field label={`Acotación ${index + 1}`} value={line.a || ''} multiline editable={!busy}
              onChangeText={(a) => updateLine(index, { a })} /> : null}
            <View style={styles.row}>
              <Action label="Subir" secondary disabled={busy || index === 0} onPress={() => moveLine(index, -1)} />
              <Action label="Bajar" secondary disabled={busy || index === draft.guion.length - 1} onPress={() => moveLine(index, 1)} />
              <Action label={`Quitar elemento ${index + 1}`} danger disabled={busy} onPress={() => setDraft({ ...draft, guion: draft.guion.filter((_, position) => position !== index) })} />
            </View>
            <Action label={`Añadir réplica después del elemento ${index + 1}`} secondary disabled={busy} onPress={() => addLine(index)} />
          </View>)}
          {!draft.guion.length ? <Action label="Añadir primera réplica" secondary disabled={busy} onPress={() => addLine(-1)} /> : null}
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.subtitle}>Escenas de audición</Text>
            <Text style={styles.hint}>{scenes.length ? 'Abre una escena y elige qué personaje preparar.' : 'Todavía no hay escenas. Cada PDF se guarda como un mini-guion independiente.'}</Text>
            {isAdmin ? <>
              <Action label="Importar mini-guion PDF" disabled={busy || refreshing} onPress={() => void importPdf()} />
              <Action label="Escribir mini-guion" secondary disabled={busy || refreshing} onPress={() => {
                setDraft({ title: '', fileName: null, guion: [{ p: '', t: '' }] }); setError(null); setNotice('');
                setRenamingRole(null); setDiscardRequested(false);
              }} />
            </> : null}
            <Action label={refreshing ? 'Actualizando…' : 'Actualizar escenas'} secondary disabled={busy || refreshing} onPress={() => void refresh()} />
            {Platform.OS === 'web' ? <Text selectable style={styles.shareLink}>
              Comparte la obra: {`${window.location.origin}/?share=${encodeURIComponent(sharedScript.shareId)}`}
            </Text> : null}
          </View>
          {scenes.map((scene) => <View key={scene.id} style={[styles.card, selectedId === scene.id && styles.selectedCard]}>
            <Text style={styles.subtitle}>{scene.title}</Text>
            <Text style={styles.hint}>{scene.scriptData.personajes.join(' · ')}</Text>
            <Text style={styles.hint}>{getSceneTitles(scene.scriptData.guion).length} escenas · {scene.scriptData.guion.filter((line) => getAuditionLineRoles(line).length).length} réplicas</Text>
            <Action label={selectedId === scene.id ? 'Cerrar escena' : `Preparar ${scene.title}`} secondary disabled={busy || refreshing}
              onPress={() => { setSelectedId(selectedId === scene.id ? null : scene.id); setError(null); setDeleteRequested(null); }} />
            {selectedId === scene.id ? (
              preferences && selectedPlans ? <>
                <Text style={styles.label}>¿Qué personaje quieres ensayar?</Text>
                <View style={styles.tags}>
                  {scene.scriptData.personajes.map((role) => <TouchableOpacity accessibilityRole="checkbox"
                    accessibilityState={{ checked: preferences.roles.includes(role) }} aria-checked={preferences.roles.includes(role)} key={role}
                    style={[styles.tag, preferences.roles.includes(role) && styles.selectedTag]} onPress={() => {
                      setPendingResumeMode(null);
                      setPreferences({ ...preferences,
                        roles: preferences.roles.includes(role) ? preferences.roles.filter((candidate) => candidate !== role) : [...preferences.roles, role],
                      });
                    }}>
                    <Text style={[styles.tagText, preferences.roles.includes(role) && styles.selectedTagText]}>{role}</Text>
                  </TouchableOpacity>)}
                </View>
                <Text style={styles.hint}>La app leerá las réplicas de los demás personajes. Tu elección se recuerda en este dispositivo.</Text>
                {preferences.roles.length ? <Text style={styles.hint}>
                  Tus personajes participan en {selectedPlans.MINE.sceneFilter.length} de {selectedPlans.ALL.sceneFilter.length} escenas.
                  {' '}Ensayaremos las escenas completas, con las réplicas de los demás.
                </Text> : null}
                <Action label={`Ensayar mis escenas (${selectedPlans.MINE.sceneFilter.length})`}
                  disabled={!selectedPlans.MINE.lineCount || busy || refreshing} onPress={() => requestRehearsal(scene, 'MINE')} />
                <Action label={`Ensayar todas las escenas (${selectedPlans.ALL.sceneFilter.length})`} secondary
                  disabled={!preferences.roles.length || !selectedPlans.ALL.lineCount || busy || refreshing} onPress={() => requestRehearsal(scene, 'ALL')} />
                {pendingResumeMode ? <View style={styles.confirmation}>
                  <Text style={styles.label}>Tienes un ensayo a medias en «{pendingResumeMode === 'MINE' ? 'Mis escenas' : 'Todas las escenas'}».</Text>
                  <View style={styles.row}>
                    <Action label="Continuar donde lo dejé" disabled={busy || refreshing} onPress={() => launchRehearsal(scene, pendingResumeMode, true)} />
                    <Action label="Empezar desde el principio" secondary disabled={busy || refreshing} onPress={() => launchRehearsal(scene, pendingResumeMode)} />
                  </View>
                </View> : null}
                <Action label={transcriptVisible ? 'Ocultar texto del mini-guion' : 'Ver texto del mini-guion'} secondary
                  onPress={() => setTranscriptVisible(!transcriptVisible)} />
                {transcriptVisible ? <View style={styles.transcript}>
                  <Text style={styles.label}>Texto del mini-guion</Text>
                  {scene.scriptData.guion.map((line, index) => <View key={index} style={styles.transcriptLine}>
                    <Text style={styles.speaker}>{line.p === SCENE_SYSTEM_SPEAKER ? line.t : getAuditionLineRoles(line).join(' / ') || 'Canción'}</Text>
                    {line.a ? <Text style={styles.stageDirection}>{line.a}</Text> : null}
                    {line.p !== SCENE_SYSTEM_SPEAKER ? <Text style={styles.dialogue}>{line.t}</Text> : null}
                  </View>)}
                </View> : null}
              </> : <Text style={styles.hint}>Recuperando tu ensayo…</Text>
            ) : null}
            {isAdmin ? <View style={styles.row}>
              <Action label={`Editar ${scene.title}`} secondary disabled={busy || refreshing} onPress={() => {
                setDraft({ sceneId: scene.id, revision: scene.revision, title: scene.title, fileName: scene.fileName,
                  guion: scene.scriptData.guion.map((line) => ({ ...line, ...(line.r ? { r: [...line.r] } : {}) })) });
                setRenamingRole(null); setDiscardRequested(false); setError(null); setNotice('');
              }} />
              <Action label={`Eliminar ${scene.title}`} danger disabled={busy || refreshing} onPress={() => setDeleteRequested(scene.id)} />
            </View> : null}
            {isAdmin && deleteRequested === scene.id ? <View style={styles.confirmation}>
              <Text style={styles.hint}>Se eliminará «{scene.title}» de las audiciones compartidas.</Text>
              <Action label="Confirmar eliminación" danger disabled={busy} onPress={() => void remove(scene)} />
              <Action label="Conservar escena" secondary disabled={busy} onPress={() => setDeleteRequested(null)} />
            </View> : null}
          </View>)}
        </>
      )}
    </ScrollView>
    {draft ? (
      <View testID="audition-editor-actions" style={styles.editorDock}>
        {error ? <Text accessibilityRole="alert" style={styles.dockError}>{error}</Text> : null}
        {busy && status ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{status}</Text> : null}
        {discardRequested ? <>
          <Text style={styles.label}>¿Descartar los cambios de esta revisión?</Text>
          <View style={styles.dockRow}>
            <View style={styles.dockAction}><Action label="Descartar cambios" danger disabled={busy}
              onPress={() => { setDraft(null); setDiscardRequested(false); setError(null); }} /></View>
            <View style={styles.dockAction}><Action label="Seguir revisando" secondary disabled={busy} onPress={() => setDiscardRequested(false)} /></View>
          </View>
        </> : <View style={styles.dockRow}>
          <View style={styles.dockAction}><Action label={busy ? 'Procesando…' : 'Guardar mini-guion'} disabled={busy || !isAdmin} onPress={() => void save()} /></View>
          <View style={styles.dockAction}><Action label="Cancelar revisión" secondary disabled={busy} onPress={() => setDiscardRequested(true)} /></View>
        </View>}
      </View>
    ) : null}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  editorDock: { marginHorizontal: 12, marginBottom: 12, marginTop: 8, padding: 12, gap: 10,
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#c8b6d4',
    boxShadow: '0px 4px 18px rgba(40, 20, 60, 0.18)', elevation: 8 },
  dockRow: { flexDirection: 'row', gap: 10 },
  dockAction: { flex: 1 },
  dockError: { color: '#a32330', lineHeight: 22 },
  page: { padding: 12, paddingBottom: 48, gap: 16 },
  heading: { padding: 18, alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 18, borderWidth: 1, borderColor: '#dfd5e7' },
  eyebrow: { color: '#775128', fontWeight: '800', letterSpacing: 2, fontSize: 12 },
  title: { fontSize: 27, fontWeight: '800', color: '#17324c', textAlign: 'center' },
  subtitle: { fontSize: 21, color: '#513362', fontWeight: '700' },
  hint: { color: '#46536a', lineHeight: 22, fontSize: 15 },
  label: { color: '#34435c', fontWeight: '700', lineHeight: 21 },
  card: { padding: 16, gap: 14, backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 18, borderWidth: 1, borderColor: '#dfd5e7' },
  selectedCard: { borderColor: '#80528b', borderWidth: 2 },
  field: { gap: 6 },
  input: { padding: 12, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#bac6d5', fontSize: 16, color: '#17324c' },
  multiline: { minHeight: 82, textAlignVertical: 'top', lineHeight: 24 },
  action: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 11, alignItems: 'center', backgroundColor: '#674078' },
  actionText: { color: '#fff', fontWeight: '700', textAlign: 'center', lineHeight: 21 },
  secondary: { backgroundColor: '#eef1f7', borderWidth: 1, borderColor: '#d3dbea' },
  secondaryText: { color: '#354d6b' },
  danger: { backgroundColor: '#fff0ef', borderColor: '#ebc4c1', borderWidth: 1 },
  dangerText: { color: '#9b2b37' },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20, borderWidth: 1, borderColor: '#d6c7de', backgroundColor: '#f7f2fa' },
  tagText: { color: '#674078', fontWeight: '700' },
  selectedTag: { backgroundColor: '#674078', borderColor: '#674078' },
  selectedTagText: { color: '#fff' },
  lineCard: { gap: 10, padding: 12, backgroundColor: '#f7f8fb', borderRadius: 12, borderWidth: 1, borderColor: '#dde3eb' },
  lineNumber: { color: '#775128', fontWeight: '700' },
  error: { color: '#a32330', backgroundColor: '#fff0ef', padding: 14, borderRadius: 12, lineHeight: 23 },
  notice: { color: '#305147', backgroundColor: '#eff8f2', padding: 14, borderRadius: 12, lineHeight: 23 },
  confirmation: { padding: 12, gap: 10, borderRadius: 12, backgroundColor: '#fff6e7' },
  transcript: { paddingTop: 12, gap: 16 },
  transcriptLine: { gap: 5 },
  speaker: { color: '#674078', fontWeight: '800', lineHeight: 22 },
  stageDirection: { color: '#69758b', fontStyle: 'italic', lineHeight: 22 },
  dialogue: { color: '#17324c', fontSize: 16, lineHeight: 25 },
  shareLink: { color: '#51607a', lineHeight: 21, fontSize: 13 },
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  getAuditionLineRoles, normalizeAuditionScript, resolveAuditionPreferences, validateAuditionScript,
  type AuditionPreferences,
} from '../../shared/auditionScenes';
import { analyzeScriptLocally } from '../api/localScriptAnalyzer';
import { analyzeScriptInStages } from '../api/geminiScriptAnalyzer';
import { deleteSharedAuditionScene, fetchSharedScript, saveSharedAuditionScene } from '../api/sharedScripts';
import { useAdminPassword } from '../store/adminSession';
import { AUDITION_PREFERENCES_STORAGE_PREFIX } from '../store/storageKeys';
import { Dialogue, SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER, ScriptData } from '../types/script';
import { SharedAuditionScene, SharedScriptManifest } from '../types/sharedScript';
import { getSceneTitles } from '../utils/scriptScenes';
import { AdminAccessPanel } from './AdminAccessPanel';
import { RehearsalView } from './RehearsalView';

interface Props {
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

export const AuditionScenesPanel = ({ sharedScript, obraTitle, onEnsureShared, onManifestUpdated, onExit }: Props) => {
  const password = useAdminPassword();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<AuditionPreferences | null>(null);
  const [rehearsal, setRehearsal] = useState<{ scene: SharedAuditionScene; roles: string[]; start: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [discardRequested, setDiscardRequested] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState<string | null>(null);
  const [renamingRole, setRenamingRole] = useState<string | null>(null);
  const [roleName, setRoleName] = useState('');
  const scenes = sharedScript?.auditionScenes ?? [];
  const selectedScene = scenes.find((scene) => scene.id === selectedId) ?? null;
  const preferencesKey = sharedScript && selectedScene
    ? `${AUDITION_PREFERENCES_STORAGE_PREFIX}${sharedScript.shareId}:${selectedScene.id}` : null;
  const selectedRevision = selectedScene?.revision;
  const [loadedPreferencesKey, setLoadedPreferencesKey] = useState<string | null>(null);
  const [loadedRevision, setLoadedRevision] = useState<number | null>(null);

  const draftRoles = useMemo(() => [...new Set(draft?.guion.flatMap(getAuditionLineRoles) ?? [])], [draft]);
  const rehearsalScenes = useMemo(() => rehearsal ? getSceneTitles(rehearsal.scene.scriptData.guion) : [], [rehearsal]);
  const handleProgress = useCallback((lineIndex: number) => setPreferences((previous) =>
    previous && previous.lineIndex !== lineIndex ? { ...previous, lineIndex } : previous), []);
  const exitRehearsal = useCallback(() => setRehearsal(null), []);

  // The scene snapshot also guards against writing one scene's progress under another key.
  useEffect(() => {
    let cancelled = false;
    setPreferences(null);
    setLoadedPreferencesKey(null);
    setLoadedRevision(null);
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
    if (!password || busy) return;
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
    if (!sharedScript || !password || !draft || busy) return;
    const title = draft.title.trim();
    const data: ScriptData = { obra: title, personajes: [], guion: draft.guion };
    const validation = !title || title.length > 160 ? 'Pon un título de hasta 160 caracteres.' : validateAuditionScript(data);
    if (validation) { setError(validation); return; }
    setBusy(true);
    setError(null);
    try {
      const next = await saveSharedAuditionScene({ shareId: sharedScript.shareId, password,
        sceneId: draft.sceneId, revision: draft.revision, title, fileName: draft.fileName,
        scriptData: normalizeAuditionScript(data, title) });
      const sceneId = draft.sceneId ?? next.auditionScenes[next.auditionScenes.length - 1]?.id;
      onManifestUpdated(next);
      setSelectedId(sceneId ?? null);
      setDraft(null);
      setDiscardRequested(false);
      setNotice('Mini-guion guardado. Ya puedes elegir personaje y ensayar.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar el mini-guion.'); }
    finally { setBusy(false); }
  };

  const remove = async (scene: SharedAuditionScene) => {
    if (!sharedScript || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      onManifestUpdated(await deleteSharedAuditionScene({ shareId: sharedScript.shareId, password, sceneId: scene.id, revision: scene.revision }));
      if (selectedId === scene.id) setSelectedId(null);
      setDeleteRequested(null);
      setNotice('Escena de audición eliminada.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo eliminar la escena.'); }
    finally { setBusy(false); }
  };

  if (rehearsal) {
    return <RehearsalView key={`${rehearsal.scene.id}:${rehearsal.scene.revision}`}
      guion={rehearsal.scene.scriptData.guion} myRoles={rehearsal.roles}
      filterScenes={rehearsalScenes} spokenOnly
      scriptId={`audition:${sharedScript?.shareId}:${rehearsal.scene.id}:${rehearsal.scene.revision}`}
      scriptTitle={`${obraTitle} · ${rehearsal.scene.title}`} shareId={sharedScript?.shareId}
      initialIndex={rehearsal.start}
      onProgressChange={handleProgress}
      onExit={exitRehearsal} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>AUDICIONES · ESCENAS</Text>
        <Text style={styles.title}>{obraTitle}</Text>
        <Text style={styles.hint}>Mini-guiones para preparar tus personajes.</Text>
      </View>
      <Action label="Volver a la obra" secondary disabled={busy} onPress={() => {
        if (draft) setDiscardRequested(true); else onExit();
      }} />
      {!draft ? <AdminAccessPanel /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {busy && status ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{status}</Text> : null}

      {!sharedScript ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Prepara las audiciones de esta obra</Text>
          <Text style={styles.hint}>Publica la obra para guardar sus mini-guiones y compartirlos con el grupo.</Text>
          {password ? <Action label="Preparar obra para audiciones" disabled={busy} onPress={() => {
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
          <Action label={busy ? 'Procesando…' : 'Guardar mini-guion'} disabled={busy || !password} onPress={() => void save()} />
          <Action label="Cancelar revisión" secondary disabled={busy} onPress={() => setDiscardRequested(true)} />
          {discardRequested ? <View style={styles.confirmation}>
            <Text style={styles.hint}>Los cambios de esta revisión todavía no están guardados.</Text>
            <Action label="Descartar cambios y cerrar revisión" danger onPress={() => { setDraft(null); setDiscardRequested(false); setError(null); }} />
            <Action label="Seguir revisando" secondary onPress={() => setDiscardRequested(false)} />
          </View> : null}
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.subtitle}>Escenas de audición</Text>
            <Text style={styles.hint}>{scenes.length ? 'Abre una escena y elige qué personaje preparar.' : 'Todavía no hay escenas. Cada PDF se guarda como un mini-guion independiente.'}</Text>
            {password ? <>
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
            <Text style={styles.hint}>{scene.scriptData.guion.filter((line) => getAuditionLineRoles(line).length).length} réplicas</Text>
            <Action label={selectedId === scene.id ? 'Cerrar escena' : `Preparar ${scene.title}`} secondary disabled={busy || refreshing}
              onPress={() => { setSelectedId(selectedId === scene.id ? null : scene.id); setError(null); setDeleteRequested(null); }} />
            {selectedId === scene.id ? (
              preferences ? <>
                <Text style={styles.label}>¿Qué personaje quieres ensayar?</Text>
                <View style={styles.tags}>
                  {scene.scriptData.personajes.map((role) => <TouchableOpacity accessibilityRole="checkbox"
                    accessibilityState={{ checked: preferences.roles.includes(role) }} aria-checked={preferences.roles.includes(role)} key={role}
                    style={[styles.tag, preferences.roles.includes(role) && styles.selectedTag]} onPress={() => setPreferences({ ...preferences,
                      roles: preferences.roles.includes(role) ? preferences.roles.filter((candidate) => candidate !== role) : [...preferences.roles, role],
                    })}>
                    <Text style={[styles.tagText, preferences.roles.includes(role) && styles.selectedTagText]}>{role}</Text>
                  </TouchableOpacity>)}
                </View>
                <Text style={styles.hint}>La app leerá las réplicas de los demás personajes. Tu elección se recuerda en este dispositivo.</Text>
                <Action label={preferences.lineIndex > 0 && preferences.lineIndex < scene.scriptData.guion.length ? 'Continuar ensayo de audición' : 'Ensayar escena de audición'}
                  disabled={!preferences.roles.length || busy || refreshing} onPress={() => setRehearsal({ scene, roles: [...preferences.roles],
                    start: preferences.lineIndex < scene.scriptData.guion.length ? preferences.lineIndex : 0 })} />
                {preferences.lineIndex > 0 && preferences.lineIndex < scene.scriptData.guion.length ? <Action label="Ensayar desde el principio" secondary
                  disabled={!preferences.roles.length || busy || refreshing} onPress={() => setRehearsal({ scene, roles: [...preferences.roles], start: 0 })} /> : null}
                <View style={styles.transcript}>
                  <Text style={styles.label}>Texto del mini-guion</Text>
                  {scene.scriptData.guion.map((line, index) => <View key={index} style={styles.transcriptLine}>
                    <Text style={styles.speaker}>{line.p === SCENE_SYSTEM_SPEAKER ? line.t : getAuditionLineRoles(line).join(' / ') || 'Canción'}</Text>
                    {line.a ? <Text style={styles.stageDirection}>{line.a}</Text> : null}
                    {line.p !== SCENE_SYSTEM_SPEAKER ? <Text style={styles.dialogue}>{line.t}</Text> : null}
                  </View>)}
                </View>
              </> : <Text style={styles.hint}>Recuperando tu ensayo…</Text>
            ) : null}
            {password ? <View style={styles.row}>
              <Action label={`Editar ${scene.title}`} secondary disabled={busy || refreshing} onPress={() => {
                setDraft({ sceneId: scene.id, revision: scene.revision, title: scene.title, fileName: scene.fileName,
                  guion: scene.scriptData.guion.map((line) => ({ ...line, ...(line.r ? { r: [...line.r] } : {}) })) });
                setRenamingRole(null); setDiscardRequested(false); setError(null); setNotice('');
              }} />
              <Action label={`Eliminar ${scene.title}`} danger disabled={busy || refreshing} onPress={() => setDeleteRequested(scene.id)} />
            </View> : null}
            {password && deleteRequested === scene.id ? <View style={styles.confirmation}>
              <Text style={styles.hint}>Se eliminará «{scene.title}» de las audiciones compartidas.</Text>
              <Action label="Confirmar eliminación" danger disabled={busy} onPress={() => void remove(scene)} />
              <Action label="Conservar escena" secondary disabled={busy} onPress={() => setDeleteRequested(null)} />
            </View> : null}
          </View>)}
        </>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
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

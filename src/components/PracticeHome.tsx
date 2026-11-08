import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SavedScript } from '../hooks/useLibrary';
import { resolveAuditionPreferences } from '../../shared/auditionScenes';
import { getAuditionRehearsalPlan, type AuditionRehearsalMode } from '../utils/auditionRehearsal';
import { AUDITION_PREFERENCES_STORAGE_PREFIX, REHEARSAL_LISTEN_MODE_STORAGE_KEY, REHEARSAL_TRANSCRIPT_STORAGE_KEY } from '../store/storageKeys';
import { RehearsalMode, ScriptData } from '../types/script';
import { SharedScriptListItem, SharedScriptManifest } from '../types/sharedScript';
import { resolveListenPreference, resolveTranscriptPreference, supportsRecognition, type ListenPreference } from '../utils/rehearsalPreferences';
import { getScenesForRolesAndSongs } from '../utils/scriptScenes';
import { AuditionScenesPanel } from './AuditionScenesPanel';
import { MicrophoneSettings } from './MicrophoneSettings';
import { Button, Chip, Icon, palette, Sheet, ui } from './PracticeUI';
import { SongPracticeLibrary } from './SongPracticeLibrary';
import { VersionBadge } from './VersionBadge';

interface Props {
  script: ScriptData | null; manifest: SharedScriptManifest | null;
  myRoles: string[]; onRolesChange: (roles: string[]) => void; sceneTitles: string[];
  onStart: (mode: RehearsalMode) => void; onStartScene: (scene: string) => void;
  resumeMode: RehearsalMode | null; onResume: () => void; resumeChoice: React.ReactNode;
  sharedWorks: SharedScriptListItem[]; savedWorks: SavedScript[];
  onOpenShared: (id: string) => Promise<void>; onOpenSaved: (saved: SavedScript) => Promise<void>;
  onMaterials: () => void; onAuditionMaterials: () => void; onSongMaterials: () => void;
  onEnsureShared: () => Promise<SharedScriptManifest | undefined>;
  onManifestUpdated: (manifest: SharedScriptManifest) => void;
  loading: boolean; status: string; error: string | null; onRefresh: () => void;
}

export const PracticeHome = (props: Props) => {
  const [tab, setTab] = useState<'home' | 'scenes' | 'songs'>('home');
  const [sheet, setSheet] = useState<'menu' | 'mic' | 'works' | 'materials' | 'roles' | 'share' | null>(null);
  const [scope, setScope] = useState<'auditions' | 'work'>('auditions');
  const [mine, setMine] = useState(true);
  const [inRehearsal, setInRehearsal] = useState(false);
  const [lastAudition, setLastAudition] = useState<{ id: string; mode: AuditionRehearsalMode } | null>(null);
  const [canResumeAudition, setCanResumeAudition] = useState(false);
  const [initialAudition, setInitialAudition] = useState<string | null>(null);
  const [mode, setMode] = useState<ListenPreference>(() => resolveListenPreference(null, supportsRecognition()));
  const [showTranscript, setShowTranscript] = useState(true);
  const [storageNotice, setStorageNotice] = useState('');
  const [auditionUploadRequest, setAuditionUploadRequest] = useState(0);
  const shareId = props.manifest?.shareId;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([AsyncStorage.getItem(REHEARSAL_LISTEN_MODE_STORAGE_KEY), AsyncStorage.getItem(REHEARSAL_TRANSCRIPT_STORAGE_KEY)])
      .then(([storedMode, storedTranscript]) => { if (!cancelled) { setMode(resolveListenPreference(storedMode, supportsRecognition())); setShowTranscript(resolveTranscriptPreference(storedTranscript)); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [sheet]);
  useEffect(() => {
    let cancelled = false;
    setLastAudition(null); setInitialAudition(null); setInRehearsal(false);
    if (shareId) void AsyncStorage.getItem(`@teatro_ia_last_audition:${shareId}`).then((stored) => {
      const value = stored ? JSON.parse(stored) : null;
      if (!cancelled && value && typeof value.id === 'string' && (value.mode === 'MINE' || value.mode === 'ALL')) setLastAudition(value);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [shareId]);

  const savePreference = (key: string, value: string) => { void AsyncStorage.setItem(key, value).catch(() => setStorageNotice('No se pudo recordar este ajuste. Seguirá activo mientras uses esta pantalla.')); };
  const chooseTab = (next: typeof tab) => { setTab(next); setInitialAudition(null); };
  const lastScene = props.manifest?.auditionScenes.find((scene) => scene.id === lastAudition?.id);
  useEffect(() => {
    let cancelled = false;
    setCanResumeAudition(false);
    if (shareId && lastScene && lastAudition && !inRehearsal) {
      void AsyncStorage.getItem(`${AUDITION_PREFERENCES_STORAGE_PREFIX}${shareId}:${lastScene.id}`).then((stored) => {
        const preferences = resolveAuditionPreferences(lastScene, stored ? JSON.parse(stored) : null);
        if (!cancelled) setCanResumeAudition(getAuditionRehearsalPlan(lastScene, preferences, lastAudition.mode).canResume);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [inRehearsal, lastAudition, lastScene, shareId, tab]);
  const openAuditions = (id: string | null = null) => { setScope('auditions'); setInitialAudition(id); setTab('scenes'); };
  const workScenes = mine ? getScenesForRolesAndSongs(props.script?.guion ?? [], props.myRoles, props.manifest?.songs ?? []) : props.sceneTitles;
  const canResume = Boolean(canResumeAudition || props.resumeMode);
  const openMaterials = (action: () => void) => { setSheet(null); action(); };

  return <View style={{ flex: 1 }}>
    {!inRehearsal ? <View style={ui.header}>
      <View style={{ flex: 1, gap: 3 }}><Text style={[ui.label, { fontSize: 11, letterSpacing: 2 }]}>AI · THEATRE</Text><Text numberOfLines={1} style={{ fontSize: 16, color: palette.ink, fontWeight: '600' }}>{props.script?.obra || 'Tu espacio de ensayo'}</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Más opciones" onPress={() => setSheet('menu')} style={ui.icon}><Icon name="dots-horizontal" size={28} /></TouchableOpacity>
    </View> : null}

    {tab === 'home' ? <ScrollView contentContainerStyle={ui.page}>
      <View style={{ gap: 8, paddingTop: 12 }}><Text style={ui.label}>A ESCENA</Text><Text style={ui.title}>¿Qué quieres preparar?</Text><Text style={ui.text}>Un rato para tus escenas y tus canciones.</Text></View>
      {props.loading ? <Text accessibilityLiveRegion="polite" style={ui.text}>{props.status || 'Cargando obra…'}</Text> : null}
      {props.error ? <Text accessibilityRole="alert" style={ui.error}>{props.error}</Text> : null}
      {!props.script ? <View style={ui.card}><Text style={ui.subtitle}>Elige una obra para empezar</Text><Text style={ui.text}>Abre una obra del grupo o una que ya tengas guardada.</Text><Button label="Elegir obra" onPress={() => setSheet('works')} /></View> : <>
        {canResume ? <TouchableOpacity accessibilityRole="button" onPress={() => { if (canResumeAudition && lastScene) openAuditions(lastScene.id); else props.onResume(); }} style={[ui.card, { backgroundColor: palette.soft, borderColor: palette.soft }]}>
          <View style={ui.row}><Icon name="play-circle" /><Text style={[ui.subtitle, { flex: 1 }]}>Continuar ensayo</Text><Icon name="arrow-right" /></View>
          <Text style={ui.text}>{canResumeAudition && lastScene ? `Audiciones · ${lastScene.title}` : 'Retoma tu ensayo de la obra'}</Text>
        </TouchableOpacity> : null}
        <TouchableOpacity accessibilityRole="button" onPress={() => chooseTab('scenes')} style={ui.card}><View style={ui.row}><Icon name="drama-masks" size={30} /><Text style={[ui.subtitle, { flex: 1 }]}>Ensayar escenas</Text><Icon name="arrow-right" /></View><Text style={ui.text}>Audiciones y escenas de la obra, a tu ritmo.</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => chooseTab('songs')} style={ui.card}><View style={ui.row}><Icon name="music-note-outline" size={30} /><Text style={[ui.subtitle, { flex: 1 }]}>Escuchar y practicar</Text><Icon name="arrow-right" /></View><Text style={ui.text}>Aprende la canción con voz o ensaya con karaoke.</Text></TouchableOpacity>
      </>}
      {props.resumeChoice}
    </ScrollView> : null}

    {tab === 'scenes' ? <View style={{ flex: 1 }}>
      {!inRehearsal ? <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 6, gap: 14 }}><Text style={ui.title}>Ensayar escenas</Text><View style={ui.wrap}><Chip label="Audiciones" selected={scope === 'auditions'} onPress={() => setScope('auditions')} /><Chip label="Obra" selected={scope === 'work'} onPress={() => setScope('work')} /></View></View> : null}
      {scope === 'auditions' ? <AuditionScenesPanel practiceOnly initialSceneId={initialAudition} initialMode={initialAudition ? lastAudition?.mode : undefined} sharedScript={props.manifest} obraTitle={props.script?.obra || ''}
        onEnsureShared={props.onEnsureShared} onManifestUpdated={props.onManifestUpdated} onExit={() => chooseTab('home')}
        onRehearsalActiveChange={setInRehearsal} onPracticeSelected={(id, auditionMode) => { const value = { id, mode: auditionMode }; setLastAudition(value); if (shareId) savePreference(`@teatro_ia_last_audition:${shareId}`, JSON.stringify(value)); }} /> : <ScrollView contentContainerStyle={ui.page}>
        <TouchableOpacity accessibilityRole="button" onPress={() => setSheet('roles')} style={[ui.card, ui.row, { padding: 15 }]}><Icon name="account-outline" /><View style={{ flex: 1 }}><Text style={ui.text}>Mis personajes</Text><Text style={{ color: palette.ink, fontWeight: '600' }}>{props.myRoles.join(', ') || 'Elegir personaje'}</Text></View><Icon name="chevron-down" /></TouchableOpacity>
        <View style={ui.wrap}><Chip label="Mis escenas" selected={mine} onPress={() => setMine(true)} /><Chip label="Todas" selected={!mine} onPress={() => setMine(false)} /></View>
        {props.myRoles.length ? <Button label={mine ? 'Ensayar mis escenas' : 'Ensayar la obra'} disabled={!workScenes.length} onPress={() => props.onStart(mine ? 'MINE' : 'ALL')} /> : <Text style={ui.text}>Elige tu personaje para que la app interprete las demás réplicas.</Text>}
        {props.resumeChoice}
        {workScenes.map((scene, index) => <TouchableOpacity accessibilityRole="button" disabled={!props.myRoles.length} key={scene} onPress={() => props.onStartScene(scene)} style={[ui.card, ui.row, { padding: 16 }]}><Text style={ui.label}>{String(index + 1).padStart(2, '0')}</Text><Text style={[ui.subtitle, { flex: 1, fontSize: 17 }]}>{scene}</Text><Icon name="play-outline" /></TouchableOpacity>)}
        {!workScenes.length ? <Text style={ui.text}>{props.sceneTitles.length ? 'No hay escenas para estos personajes.' : 'El guion de la obra todavía no está cargado.'}</Text> : null}
      </ScrollView>}
    </View> : null}

    {!inRehearsal ? <SongPracticeLibrary manifest={props.manifest} active={tab === 'songs'} defaultRoles={props.myRoles}
      onUpdated={props.onManifestUpdated} onManageWork={props.onSongMaterials} openEditorRequest={auditionUploadRequest} /> : null}
    {!inRehearsal ? <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: palette.rule, backgroundColor: palette.surface, paddingTop: 6, paddingBottom: 10 }}>
      {([['home', 'Inicio', 'home-outline'], ['scenes', 'Ensayar', 'drama-masks'], ['songs', 'Canciones', 'music-note-outline']] as const).map(([value, label, icon]) => <TouchableOpacity key={value} accessibilityRole="tab" aria-selected={tab === value} accessibilityState={{ selected: tab === value }} onPress={() => chooseTab(value)} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4 }}><Icon name={icon} color={tab === value ? palette.plum : palette.sub} /><Text style={{ fontSize: 12, fontWeight: tab === value ? '700' : '500', color: tab === value ? palette.plum : palette.sub }}>{label}</Text></TouchableOpacity>)}
    </View> : null}

    <Sheet title="Más opciones" visible={sheet === 'menu'} onClose={() => setSheet(null)}>
      <Button label="Micrófono y voz" secondary onPress={() => setSheet('mic')} />
      <Button label="Materiales y gestión" secondary onPress={() => setSheet('materials')} />
      <Button label="Compartir obra" secondary disabled={!props.manifest} onPress={() => setSheet('share')} />
      <Button label="Cambiar obra" secondary onPress={() => setSheet('works')} /><VersionBadge />
    </Sheet>
    <Sheet title="Micrófono y voz" visible={sheet === 'mic'} onClose={() => setSheet(null)}>
      <MicrophoneSettings mode={mode} supported={supportsRecognition()} onModeChange={(next) => { setMode(next); savePreference(REHEARSAL_LISTEN_MODE_STORAGE_KEY, next); }} showTranscript={showTranscript} onTranscriptChange={(visible) => { setShowTranscript(visible); savePreference(REHEARSAL_TRANSCRIPT_STORAGE_KEY, String(visible)); }} />
      {storageNotice ? <Text style={ui.error}>{storageNotice}</Text> : null}
    </Sheet>
    <Sheet title="Materiales y gestión" visible={sheet === 'materials'} onClose={() => setSheet(null)}>
      <Button label="Subir canción de audición" secondary disabled={!props.manifest} onPress={() => { setSheet(null); setTab('songs'); setAuditionUploadRequest((previous) => previous + 1); }} />
      <Button label="Mini-guiones de audición" secondary disabled={!props.script} onPress={() => openMaterials(props.onAuditionMaterials)} />
      <Button label="Canciones y números musicales" secondary disabled={!props.script} onPress={() => openMaterials(props.onSongMaterials)} />
      <Button label="Gestionar obra e importar PDF" secondary onPress={() => openMaterials(props.onMaterials)} />
    </Sheet>
    <Sheet title="Elegir obra" visible={sheet === 'works'} onClose={() => setSheet(null)}>
      {props.loading ? <Text style={ui.text}>{props.status || 'Cargando…'}</Text> : null}
      {props.error ? <Text style={ui.error}>{props.error}</Text> : null}
      <Text style={ui.label}>OBRAS DEL GRUPO</Text>
      {props.sharedWorks.map((work) => <Button key={work.shareId} secondary label={work.obra} disabled={props.loading} onPress={() => { void props.onOpenShared(work.shareId).then(() => { setSheet(null); chooseTab('home'); }); }} />)}
      {!props.sharedWorks.length ? <Text style={ui.text}>Todavía no hay obras compartidas.</Text> : null}
      <Button label="Actualizar obras" secondary onPress={props.onRefresh} />
      {props.savedWorks.filter((work) => !work.config.sharedScriptId).map((work) => <Button key={work.scriptId} secondary label={`Guardada · ${work.data.obra}`} disabled={props.loading} onPress={() => { void props.onOpenSaved(work).then(() => { setSheet(null); chooseTab('home'); }); }} />)}
      <Button label="Crear o importar una obra" secondary onPress={() => openMaterials(props.onMaterials)} />
    </Sheet>
    <Sheet title="Mis personajes" visible={sheet === 'roles'} onClose={() => setSheet(null)}>
      <Text style={ui.text}>Elige uno o varios. Tu selección se recuerda para esta obra.</Text><View style={ui.wrap}>{props.script?.personajes.map((role) => <Chip key={role} label={role} selected={props.myRoles.includes(role)} onPress={() => props.onRolesChange(props.myRoles.includes(role) ? props.myRoles.filter((item) => item !== role) : [...props.myRoles, role])} />)}</View><Button label="Listo" onPress={() => setSheet(null)} />
    </Sheet>
    <Sheet title="Compartir obra" visible={sheet === 'share'} onClose={() => setSheet(null)}>
      <Text style={ui.text}>Envía este enlace al grupo para que puedan abrir los materiales y ensayar.</Text>
      <Text selectable style={[ui.text, { color: palette.plum }]}>{props.manifest && typeof window !== 'undefined' ? `${window.location.origin}/?share=${encodeURIComponent(props.manifest.shareId)}` : ''}</Text>
    </Sheet>
  </View>;
};

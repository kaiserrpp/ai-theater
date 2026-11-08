import * as DocumentPicker from 'expo-document-picker';
import React, { useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import { normalizeRoles, validateMusicalAudition } from '../../shared/musicalAuditions';
import { deleteMusicalAudition, fetchSharedScript, removeMusicalAuditionAudio, saveMusicalAudition, saveMusicalAuditionAudio } from '../api/sharedScripts';
import { MAX_SHARED_SONG_UPLOAD_BYTES, uploadSharedSongAudio, type SharedSongUploadResult } from '../api/sharedSongUploads';
import { useAdminPassword } from '../store/adminSession';
import type { SharedMusicalAudition, SharedScriptManifest, SharedSongAudioKind } from '../types/sharedScript';
import { performMusicalAuditionSave, resolveAuditionAudioMimeType } from '../utils/saveMusicalAudition';
import { AdminAccessPanel } from './AdminAccessPanel';
import { Button, Chip, palette, Sheet, ui } from './PracticeUI';

interface Props { manifest: SharedScriptManifest; initial?: SharedMusicalAudition | null; onUpdated: (manifest: SharedScriptManifest) => void; onClose: () => void; onSaved: () => void; }
const kinds = [['vocal_guide', 'Con voz'], ['karaoke', 'Karaoke']] as const;
const newId = () => `musical-audition-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const MusicalAuditionEditor = ({ manifest, initial, onUpdated, onClose, onSaved }: Props) => {
  const password = useAdminPassword();
  const [draft, setDraft] = useState(() => ({ id: initial?.id || newId(), revision: initial?.revision,
    musicalNumberId: initial?.musicalNumberId || '', musicalNumberTitle: '', title: initial?.title || '',
    roles: initial?.roles || [], lyrics: initial?.lyrics || '' }));
  const [saved, setSaved] = useState(initial || null);
  const [files, setFiles] = useState<Partial<Record<SharedSongAudioKind, File>>>({});
  const [removeKinds, setRemoveKinds] = useState<SharedSongAudioKind[]>([]);
  const uploadedFiles = useRef(new Map<File, SharedSongUploadResult>());
  const [newRole, setNewRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null);
  const availableRoles = normalizeRoles([...manifest.scriptData.personajes, ...manifest.auditionScenes.flatMap((scene) => scene.scriptData.personajes),
    ...(manifest.musicalAuditions || []).flatMap((cut) => cut.roles), ...draft.roles]);
  const change = (update: Partial<typeof draft>) => { setDraft((previous) => ({ ...previous, ...update })); setError(''); };
  const requestClose = () => {
    if (busy) return;
    if (!password || Platform.OS !== 'web') onClose();
    else setConfirm('close');
  };

  const chooseAudio = async (kind: SharedSongAudioKind) => {
    if (!password || busy) return;
    setError('');
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const mime = resolveAuditionAudioMimeType(asset.name, asset.mimeType || '');
      if (!mime) throw new Error('Elige un archivo de audio, por ejemplo MP3, M4A o WAV.');
      const blob = asset.file || await (await fetch(asset.uri)).blob();
      if (blob.size > MAX_SHARED_SONG_UPLOAD_BYTES) throw new Error('El archivo supera el máximo de 512 MB. Sube el fragmento ya recortado.');
      if (!blob.size) throw new Error('El archivo está vacío. Elige otro audio.');
      const file = new File([blob], asset.name, { type: mime });
      setFiles((previous) => ({ ...previous, [kind]: file }));
      setRemoveKinds((previous) => previous.filter((value) => value !== kind));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo abrir el audio.'); }
  };

  const save = async () => {
    if (!password || busy || Platform.OS !== 'web') return;
    const invalid = validateMusicalAudition(draft);
    if (invalid) { setError(invalid); return; }
    if (!draft.musicalNumberId && !draft.musicalNumberTitle.trim()) { setError('Elige el número musical o escribe su nombre.'); return; }
    setBusy(true); setError(''); setStatus('Guardando fragmento…');
    try {
      await performMusicalAuditionSave({ ...draft, auditionId: draft.id, shareId: manifest.shareId, password },
        kinds.flatMap(([kind]) => files[kind] ? [{ kind, file: files[kind]! }] : []), removeKinds, {
          saveDetails: saveMusicalAudition, uploadedFiles: uploadedFiles.current,
          onCommitted: (next, cut) => {
            onUpdated(next); setSaved(cut);
            setDraft((previous) => ({ ...previous, revision: cut.revision, musicalNumberId: cut.musicalNumberId }));
            setRemoveKinds((previous) => previous.filter((kind) => cut.audios.some((audio) => audio.kind === kind)));
          },
          upload: async (file, kind) => {
            const label = kind === 'karaoke' ? 'Karaoke' : 'Con voz';
            setStatus(`Subiendo ${label}…`);
            return uploadSharedSongAudio({ shareId: manifest.shareId, targetId: draft.id, targetType: 'musical-audition', file, password,
              onUploadProgress: (progress) => setStatus(`Subiendo ${label} · ${progress}%`) });
          },
          saveAudio: (cut, kind, upload) => {
            setStatus(`Guardando ${kind === 'karaoke' ? 'karaoke' : 'audio con voz'}…`);
            return saveMusicalAuditionAudio({ shareId: manifest.shareId, password, auditionId: cut.id, revision: cut.revision,
              kind, audio: { audioUrl: upload.url, audioFileName: upload.fileName, contentType: upload.contentType, size: upload.size } });
          },
          removeAudio: (cut, kind) => removeMusicalAuditionAudio({ shareId: manifest.shareId, password, auditionId: cut.id, revision: cut.revision, kind }),
          onFileCommitted: (kind) => setFiles((previous) => ({ ...previous, [kind]: undefined })),
        });
      onSaved(); onClose();
    } catch (failure) {
      // A response can be lost after the server saved it. Recover the revision
      // and committed slots while keeping unsent files and the user's edits.
      try {
        const latest = await fetchSharedScript(manifest.shareId);
        const cut = latest.musicalAuditions.find((candidate) => candidate.id === draft.id);
        onUpdated(latest);
        if (cut) {
          setSaved(cut); setDraft((previous) => ({ ...previous, revision: cut.revision, musicalNumberId: cut.musicalNumberId }));
          setFiles((previous) => Object.fromEntries(Object.entries(previous).filter(([kind, file]) => {
            const uploaded = file && uploadedFiles.current.get(file);
            return !uploaded || !cut.audios.some((audio) => audio.kind === kind && audio.audioUrl === uploaded.url);
          })));
        }
      } catch { /* The form and selected files remain available for retry. */ }
      setError(`${failure instanceof Error ? failure.message : 'No se pudo completar la subida.'} Los datos y audios ya guardados se conservan. Puedes volver a guardar para completar lo pendiente.`);
    } finally { setBusy(false); setStatus(''); }
  };

  const remove = async () => {
    if (!saved || !password || busy) return;
    setBusy(true); setError('');
    try { onUpdated(await deleteMusicalAudition({ shareId: manifest.shareId, password, auditionId: saved.id, revision: saved.revision })); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo eliminar el fragmento.'); setConfirm(null); }
    finally { setBusy(false); }
  };

  return <Sheet visible closeDisabled={busy} title={saved ? 'Editar audición musical' : 'Subir canción de audición'} onClose={requestClose} footer={password && Platform.OS === 'web' ? <View testID="audition-music-editor-actions" style={{ gap: 10 }}>
    {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    {status ? <Text accessibilityLiveRegion="polite" style={ui.text}>{status}</Text> : null}
    {confirm ? <><Text style={ui.text}>{confirm === 'delete' ? 'Se eliminará este fragmento y sus referencias a los audios. El número musical se conserva.' : '¿Cerrar la edición? Se conservará lo que ya hayas guardado; los archivos pendientes deberán elegirse otra vez.'}</Text><Button label={confirm === 'delete' ? 'Eliminar fragmento' : 'Cerrar sin guardar lo pendiente'} disabled={busy} onPress={confirm === 'delete' ? () => void remove() : onClose} /><Button label="Seguir editando" secondary disabled={busy} onPress={() => setConfirm(null)} /></> : <View style={ui.row}><View style={{ flex: 1 }}><Button label={busy ? 'Guardando…' : 'Guardar audición'} disabled={busy} onPress={() => void save()} /></View><Button label="Cancelar" secondary disabled={busy} onPress={requestClose} /></View>}
  </View> : undefined}>
    {!password ? <><Text style={ui.text}>Para subir o modificar canciones, entra con la clave de gestión. Escuchar no requiere clave.</Text><AdminAccessPanel initiallyExpanded /></>
      : Platform.OS !== 'web' ? <Text style={ui.text}>Abre la app web en Safari para subir los archivos.</Text> : <>
        <Text style={ui.text}>Sube el trozo de la audición ya recortado. Puedes guardar una versión y añadir la otra después.</Text>
        <Text style={ui.label}>NÚMERO MUSICAL</Text>
        <View style={ui.wrap}>{manifest.musicalNumbers.map((number) => <Chip key={number.id} label={number.title} selected={draft.musicalNumberId === number.id} onPress={() => !busy && change({ musicalNumberId: number.id })} />)}<Chip label="+ Nuevo número" selected={!draft.musicalNumberId} onPress={() => !busy && change({ musicalNumberId: '' })} /></View>
        {!draft.musicalNumberId ? <TextInput accessibilityLabel="Nombre del número musical" placeholder="Nombre de la canción" value={draft.musicalNumberTitle} editable={!busy} onChangeText={(musicalNumberTitle) => change({ musicalNumberTitle })} style={inputStyle} /> : null}
        <Text style={ui.label}>FRAGMENTO DE AUDICIÓN</Text><TextInput accessibilityLabel="Nombre del fragmento" placeholder="Ej. Audición de Benny" value={draft.title} editable={!busy} onChangeText={(title) => change({ title })} style={inputStyle} />
        <Text style={ui.label}>PERSONAJES QUE CANTAN</Text><View style={ui.wrap}>{availableRoles.map((role) => <Chip key={role} label={role} selected={draft.roles.includes(role)} onPress={() => !busy && change({ roles: draft.roles.includes(role) ? draft.roles.filter((candidate) => candidate !== role) : [...draft.roles, role] })} />)}</View>
        <View style={ui.row}><TextInput accessibilityLabel="Nuevo personaje" placeholder="Añadir personaje" value={newRole} editable={!busy} onChangeText={setNewRole} style={[inputStyle, { flex: 1, minWidth: 0 }]} /><Button label="Añadir" secondary disabled={busy || !newRole.trim()} onPress={() => { const canonical = availableRoles.find((role) => role.toLocaleLowerCase('es') === newRole.trim().toLocaleLowerCase('es')) || newRole.trim(); change({ roles: normalizeRoles([...draft.roles, canonical]) }); setNewRole(''); }} /></View>
        {kinds.map(([kind, label]) => {
          const audio = saved?.audios.find((candidate) => candidate.kind === kind);
          return <View key={kind} style={ui.card}><Text style={ui.subtitle}>{label}</Text><Text style={ui.text}>{files[kind]?.name || (removeKinds.includes(kind) ? 'Se quitará al guardar' : audio?.audioFileName || (audio ? 'Audio guardado' : 'Todavía sin audio'))}</Text><Button label={files[kind] || audio ? `Cambiar ${label.toLowerCase()}` : `Elegir ${label.toLowerCase()}`} secondary disabled={busy} onPress={() => void chooseAudio(kind)} />
            {files[kind] ? <Button label="Quitar archivo pendiente" secondary disabled={busy} onPress={() => setFiles((previous) => ({ ...previous, [kind]: undefined }))} /> : audio ? <Button label={removeKinds.includes(kind) ? 'Conservar audio' : 'Quitar audio al guardar'} secondary disabled={busy} onPress={() => setRemoveKinds((previous) => previous.includes(kind) ? previous.filter((value) => value !== kind) : [...previous, kind])} /> : null}</View>;
        })}
        <Text style={ui.label}>LETRA DEL FRAGMENTO · OPCIONAL</Text><TextInput accessibilityLabel="Letra del fragmento" placeholder="Pega aquí la letra de este trozo" value={draft.lyrics} editable={!busy} onChangeText={(lyrics) => change({ lyrics })} multiline style={[inputStyle, { minHeight: 100, textAlignVertical: 'top' }]} />
        {saved ? <Button label="Eliminar este fragmento" secondary disabled={busy} onPress={() => setConfirm('delete')} /> : null}
      </>}
  </Sheet>;
};
const inputStyle = { padding: 13, borderWidth: 1, borderColor: palette.rule, borderRadius: 12, backgroundColor: '#fff', fontSize: 16, color: palette.ink };

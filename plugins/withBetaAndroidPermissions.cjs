const { withAndroidManifest } = require('expo/config-plugins');

// expo-audio 1.1 includes these services even with background recording off.
// This shell uses only the foreground level recorder; playback stays in WebView.
const audioServices = [
  'expo.modules.audio.service.AudioControlsService',
  'expo.modules.audio.service.AudioRecordingService',
];

const removeUnusedAudioServices = manifest => {
  const application = manifest.application?.[0];
  if (!application) throw Error('No se encontró la aplicación Android para limitar los servicios de audio.');
  manifest.$ = { ...manifest.$, 'xmlns:tools': 'http://schemas.android.com/tools' };
  application.service = (application.service || []).filter(service => !audioServices.includes(service.$?.['android:name']));
  // Library manifests merge after config plugins. Explicit merger markers are
  // necessary: deleting an entry here would not remove the library's service.
  application.service.push(...audioServices.map(name => ({ $: { 'android:name': name, 'tools:node': 'remove' } })));
  return manifest;
};

module.exports = config => withAndroidManifest(config, next => {
  next.modResults.manifest = removeUnusedAudioServices(next.modResults.manifest);
  return next;
});
module.exports.removeUnusedAudioServices = removeUnusedAudioServices;

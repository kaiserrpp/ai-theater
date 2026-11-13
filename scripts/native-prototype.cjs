const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const command = process.argv[2] || 'check';
const tasks = {
  login: ['login'], whoami: ['whoami'], link: ['init'], info: ['project:info'], devices: ['device:create'],
  usage: ['account:usage', 'kaiserpps-team', '--json', '--non-interactive'],
  android: ['build', '--platform', 'android', '--profile', 'prototype'],
  ios: ['build', '--platform', 'ios', '--profile', 'prototype'],
  'ios-validation': ['build', '--platform', 'ios', '--profile', 'ios-validation', '--non-interactive'],
};
if (command === 'link' && process.argv[3]) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(process.argv[3])) throw Error('El identificador de Expo debe ser un UUID.');
  tasks.link.push('--id', process.argv[3], '--force', '--non-interactive');
}
if (command === 'check') {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8'));
  const ignore = require('ignore')().add(fs.readFileSync(path.join(root, '.easignore'), 'utf8'));
  const required = ['App.native.tsx', 'app.json', 'package.json', 'package-lock.json', 'eas.json', 'tsconfig.json',
    'src/nativePrototype/controller.ts', 'src/nativePrototype/bridgeBootstrap.ts', 'src/nativePrototype/protocol.ts',
    'assets/images/caras-teatro.png', 'assets/images/splash-icon.png'];
  for (const file of required) {
    if (!fs.existsSync(path.join(root, file)) || ignore.ignores(file)) throw Error(`Falta en el paquete nativo: ${file}`);
    // EAS walks each parent with fs.cp, passing directory names without a
    // trailing slash. Testing only the complete filename misses exclusions.
    const parts = file.split('/');
    for (let depth = 1; depth < parts.length; depth++) {
      const directory = parts.slice(0, depth).join('/');
      if (ignore.ignores(directory) || ignore.ignores(directory + '/')) throw Error(`Expo no puede recorrer la carpeta ${directory}`);
    }
  }
  for (const file of ['.env', '.env.feedback.local', '.env.matching-build.local/test', 'api/shared-script/index.js', 'pdf/guion.pdf',
    'src/screens/HomeScreen.tsx', 'assets/images/stage-frame-white.png', 'node_modules/test.js', 'codex-handoff.md']) {
    if (!ignore.ignores(file)) throw Error(`No debe enviarse a Expo: ${file}`);
  }
  if (pkg.version !== app.version || !app.ios.bundleIdentifier || !app.android.package) throw Error('Versiones o identificadores incompletos.');
  if (eas.build.prototype.distribution !== 'internal' || eas.build.prototype.android.buildType !== 'apk') throw Error('La prueba debe usar distribución interna y APK.');
  if (!app.extra.nativePrototype.webUrl.startsWith('https://ai-theater.vercel.app/')) throw Error('La URL del prototipo debe apuntar a la app publicada.');
  console.log(`Prototipo ${pkg.version}: configuración de iPhone y Android correcta.`);
  console.log('La captura y la voz son nativas; la interfaz y los guiones proceden de la web existente.');
  console.log('Paquete de compilación limitado a la app nativa, sin .env, servidor, guiones PDF ni archivos temporales.');
  console.log(app.extra.eas?.projectId ? `Proyecto Expo vinculado: ${app.extra.eas.projectId}` : 'Pendiente: iniciar sesión en Expo y vincular el proyecto (npm run prototype:login / prototype:link).');
  console.log('iPhone: requiere una membresía Apple Developer activa y registrar el dispositivo antes de firmar el instalador.');
  console.log('Android: APK para prueba interna; Google Play no es necesario.');
} else {
  if (!tasks[command]) throw Error(`Comando desconocido: ${command}`);
  if (!process.env.npm_execpath) throw Error('Ejecuta este comando mediante npm run prototype:<comando>.');
  const env = { ...process.env };
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 22 || major === 22 && minor >= 15) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --use-system-ca`.trim();
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'exec', '--yes', '--registry=https://registry.npmjs.org',
    '--package=eas-cli@27.9.0', '--', 'eas', ...tasks[command]], { cwd: root, stdio: 'inherit', env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

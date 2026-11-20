const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, '.expo', 'ios-personal');
const env = { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' };

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminó con código ${result.status}. ${capture ? result.stderr : ''}`);
  return capture ? result.stdout.trim() : '';
}

function nativeFiles() {
  const ignore = require('ignore')().add(fs.readFileSync(path.join(root, '.easignore'), 'utf8'));
  const tracked = run('git', ['ls-files', '-z'], root, true).split('\0').filter(Boolean);
  const files = tracked.filter(file => !ignore.ignores(file));
  for (const required of ['App.native.tsx', 'app.json', 'package.json', 'package-lock.json',
    'src/nativePrototype/controller.ts', 'src/nativePrototype/recognitionRuntime.ts']) {
    if (!files.includes(required)) throw new Error(`Falta en la selección nativa: ${required}`);
  }
  for (const file of files) {
    if (/(^|\/)(\.env[^/]*|pdf|server|api|public|node_modules)(\/|$)/i.test(file) ||
      /\.(p8|p12|key|pem|jks|mobileprovision)$/i.test(file) || fs.lstatSync(path.join(root, file)).isSymbolicLink()) {
      throw new Error(`Archivo no permitido en el proyecto nativo: ${file}`);
    }
  }
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  if (app.version !== pkg.version || lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
    throw new Error('Las versiones de app.json, package.json y package-lock.json deben coincidir.');
  }
  return { files, app, version: pkg.version };
}

function stage() {
  const selection = nativeFiles();
  fs.mkdirSync(workRoot, { recursive: true });
  // Cada intento tiene una carpeta nueva: nunca se borra el repositorio ni una compilación anterior.
  const project = fs.mkdtempSync(path.join(workRoot, 'project-'));
  for (const file of selection.files) {
    const target = path.join(project, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  const sourceFiles = selection.files.map(file => ({
    path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(project, file))).digest('hex'),
  }));
  fs.writeFileSync(path.join(project, 'native-source.json'), JSON.stringify({ sourceFiles }, null, 2));
  return { ...selection, project, sourceFiles };
}

function build() {
  if (process.platform !== 'darwin') throw new Error('La compilación iPhone necesita macOS. Desde Windows, inicia el workflow iOS personal gratuito de GitHub.');
  const selection = stage();
  const { project, app, version, sourceFiles } = selection;
  run('npm', ['ci', '--no-audit', '--no-fund'], project);
  run(process.execPath, [path.join(project, 'node_modules/expo/bin/cli'), 'prebuild', '--platform', 'ios', '--no-install'], project);
  run('pod', ['install', '--project-directory=ios'], project);
  const ios = path.join(project, 'ios');
  const workspaces = fs.readdirSync(ios).filter(name => name.endsWith('.xcworkspace'));
  const projects = fs.readdirSync(ios).filter(name => name.endsWith('.xcodeproj'));
  if (workspaces.length !== 1 || projects.length !== 1) throw new Error('No se pudo identificar un único proyecto/workspace iOS.');
  const scheme = projects[0].slice(0, -'.xcodeproj'.length);
  const derived = path.join(project, 'DerivedData');
  const xcode = run('xcodebuild', ['-version'], project, true);
  run('xcodebuild', ['-quiet', '-workspace', path.join(ios, workspaces[0]), '-scheme', scheme,
    '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS',
    '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'build'], project);
  const products = path.join(derived, 'Build', 'Products', 'Release-iphoneos');
  const apps = fs.readdirSync(products).filter(name => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('La compilación no produjo una única app para iphoneos.');
  const payload = path.join(project, 'Payload');
  fs.mkdirSync(payload);
  fs.cpSync(path.join(products, apps[0]), path.join(payload, apps[0]), { recursive: true, dereference: false });
  const output = path.join(workRoot, 'output');
  fs.mkdirSync(output, { recursive: true });
  const filename = `AI-Theatre-${version}-iPhone-personal-unsigned.ipa`;
  const ipa = path.join(output, filename);
  if (fs.existsSync(ipa)) throw new Error('Ya existe un IPA con esa versión. No se sobrescribe un instalador anterior.');
  run('ditto', ['-c', '-k', '--keepParent', payload, ipa], project);
  const checked = JSON.parse(run('python3', [path.join(root, 'scripts/verify-ios-personal.py'), ipa,
    '--version', version, '--bundle-id', app.ios.bundleIdentifier], root, true));
  const metadata = { ...checked, sourceCommit: process.env.GITHUB_SHA || run('git', ['rev-parse', 'HEAD'], root, true),
    sourceFiles, generatedAt: new Date().toISOString(), xcode,
    webUrl: app.extra.nativePrototype.webUrl, signed: false, intendedInstaller: 'AltStore Classic / cuenta Apple gratuita',
    physicalDeviceTested: false };
  fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${checked.sha256}  ${filename}\n`);
  const notes = `# AI-Theatre ${version} · prueba personal de iPhone\n\n` +
    `IPA para iPhone real (iphoneos/arm64), **sin firmar**, para firmar e instalar con AltStore Classic desde Windows.\n\n` +
    `No es una publicación en App Store ni TestFlight. No requiere renovar una membresía Apple de pago.\n\n` +
    `La firma gratuita se renueva cada siete días. El ensayo usa la web de producción y las API nativas de voz.\n\n` +
    `La compilación y el paquete están verificados; instalación, permisos y audio en un iPhone físico siguen pendientes.\n\n` +
    `Guía: https://github.com/kaiserrpp/ai-theater/blob/main/docs/ios-personal-gratis.md\n\n` +
    `Fuente: ${metadata.sourceCommit}\nSHA256: ${checked.sha256}\n`;
  fs.writeFileSync(path.join(output, 'RELEASE.md'), notes);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `version=${version}\noutput=${output}\nipa=${ipa}\n`);
  console.log(JSON.stringify(metadata, null, 2));
}

if (require.main === module) {
  try {
    const command = process.argv[2] || 'check';
    if (command === 'build') build();
    else if (command === 'stage') console.log(JSON.stringify(stage(), null, 2));
    else if (command === 'check') { const { version, files } = nativeFiles(); console.log(JSON.stringify({ version, files }, null, 2)); }
    else throw new Error(`Comando desconocido: ${command}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { nativeFiles, stage };

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const version = require('../package.json').version;
const source = fs.readFileSync(path.join(root, 'src/utils/lineMatching.ts'), 'utf8');
const outputs = {
  'public/asr/line-matching.mjs': '// Generated from src/utils/lineMatching.ts; run npm run comparison:build.\n' + ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, removeComments: false },
  }).outputText,
  'public/asr/comparison-version.mjs': `// Generated from package.json.\nexport const APP_VERSION = ${JSON.stringify(version)};\n`,
};
for (const [name, content] of Object.entries(outputs)) {
  const file = path.join(root, name);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== content.replace(/\r\n/g, '\n')) {
      throw new Error(`${name} is out of date. Run npm run comparison:build.`);
    }
  } else fs.writeFileSync(file, content);
}

const fs = require('fs');
const path = require('path');

const now = new Date();
const year = now.getFullYear().toString();
const month = (now.getMonth() + 1).toString().padStart(2, '0');
const VERSION_PATTERN = /^(\d{4})\.(\d{2})\.(\d{3})$/;
const INITIAL_INCREMENT = '001';

function updateJsonVersion(fileName) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) return null;

  const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const currentVersion = fileName === 'app.json' ? content.expo.version : content.version;
  const match = typeof currentVersion === 'string' ? currentVersion.match(VERSION_PATTERN) : null;
  const [, vYear = '', vMonth = '', vPatch = '000'] = match || [];

  let newPatch = INITIAL_INCREMENT;
  if (vYear === year && vMonth === month) {
    const nextNumber = parseInt(vPatch, 10) + 1;
    newPatch = nextNumber.toString().padStart(3, '0');
  }

  const newVersion = `${year}.${month}.${newPatch}`;

  if (fileName === 'app.json') {
    content.expo.version = newVersion;
  } else {
    content.version = newVersion;
  }

  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  return newVersion;
}

const finalVersion = updateJsonVersion('package.json');
updateJsonVersion('app.json');

console.log(finalVersion);

const fs = require('fs');
const path = require('path');

// 1. Obtener la fecha actual
const now = new Date();
const year = now.getFullYear().toString();
const month = (now.getMonth() + 1).toString().padStart(2, '0');

// 2. Función para procesar un archivo JSON
function updateJsonVersion(fileName) {
    const filePath = path.join(__dirname, fileName);
    if (!fs.existsSync(filePath)) return null;

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // En app.json la versión suele estar dentro del objeto "expo"
    let currentVersion = fileName === 'app.json' ? content.expo.version : content.version;
    
    let [vYear, vMonth, vPatch] = currentVersion.split('.');
    let newPatch = "001";

    // Si seguimos en el mismo año y mes, incrementamos el contador
    if (vYear === year && vMonth === month) {
        let nextNumber = parseInt(vPatch) + 1;
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

// 3. Ejecutar actualización
const finalVersion = updateJsonVersion('package.json');
updateJsonVersion('app.json');

// Devolvemos la versión para que el .bat la pueda usar
console.log(finalVersion);
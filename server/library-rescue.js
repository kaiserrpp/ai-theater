const snapshot = require('./library-rescue.json');
const { isSupabaseReady } = require('./shared-storage');

// A deployment contains these already-public materials independently of Blob.
// Preview/development never read production's snapshot or media.
const protectedLibrary = (namespace) => namespace === snapshot.namespace &&
  process.env.VERCEL === '1' && process.env.LIBRARY_STORAGE_MODE !== 'blob' && !isSupabaseReady();

const getProtectedLibrary = (namespace) => protectedLibrary(namespace) ? structuredClone(snapshot) : null;

const assertStorageWritable = (namespace) => {
  if (protectedLibrary(namespace)) {
    throw new Error('Las subidas y los cambios compartidos están temporalmente protegidos porque se ha alcanzado casi todo el límite del almacenamiento. Puedes seguir ensayando con los materiales publicados. Conserva los archivos nuevos hasta conectar el almacenamiento alternativo.');
  }
};

const getPublishedLibrary = namespace => namespace === snapshot.namespace ? structuredClone(snapshot) : null;
module.exports = { getProtectedLibrary, getPublishedLibrary, assertStorageWritable };

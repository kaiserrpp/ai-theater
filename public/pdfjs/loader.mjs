const pushTrace = (message) => {
  globalThis.__teatroPdfJsTrace ||= [];
  globalThis.__teatroPdfJsTrace.push(message);

  if (globalThis.__teatroPdfJsTrace.length > 40) {
    globalThis.__teatroPdfJsTrace.shift();
  }
};

const installPolyfills = () => {
  pushTrace('loader: installPolyfills:start');

  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
      });
      return { promise, resolve, reject };
    };
  }

  if (typeof URL.parse !== 'function') {
    URL.parse = function parse(url, base) {
      try {
        return new URL(url, base);
      } catch {
        return null;
      }
    };
  }

  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function hasOwn(object, property) {
      return Object.prototype.hasOwnProperty.call(object, property);
    };
  }

  if (typeof Array.prototype.findLast !== 'function') {
    Array.prototype.findLast = function findLast(predicate, thisArg) {
      if (typeof predicate !== 'function') {
        throw new TypeError('predicate must be a function');
      }

      for (let index = this.length - 1; index >= 0; index -= 1) {
        const value = this[index];
        if (predicate.call(thisArg, value, index, this)) {
          return value;
        }
      }

      return undefined;
    };
  }

  if (typeof Array.prototype.at !== 'function') {
    Array.prototype.at = function at(index) {
      const normalizedIndex = Number(index) || 0;
      const finalIndex = normalizedIndex < 0 ? this.length + normalizedIndex : normalizedIndex;
      return this[finalIndex];
    };
  }

  if (typeof String.prototype.at !== 'function') {
    String.prototype.at = function at(index) {
      const normalizedIndex = Number(index) || 0;
      const finalIndex = normalizedIndex < 0 ? this.length + normalizedIndex : normalizedIndex;
      return this.charAt(finalIndex);
    };
  }

  pushTrace('loader: installPolyfills:done');
};

const collectFeatureFlags = () => ({
  promiseWithResolvers: typeof Promise.withResolvers === 'function',
  urlParse: typeof URL.parse === 'function',
  objectHasOwn: typeof Object.hasOwn === 'function',
  arrayFindLast: typeof Array.prototype.findLast === 'function',
  arrayAt: typeof Array.prototype.at === 'function',
  stringAt: typeof String.prototype.at === 'function',
  structuredClone: typeof structuredClone === 'function',
  weakRef: typeof WeakRef === 'function',
});

const formatError = (error) => {
  if (error instanceof Error) {
    const stack = typeof error.stack === 'string' ? error.stack.split('\n').slice(0, 6).join('\n') : '';
    return {
      name: error.name || 'Error',
      message: error.message || 'Sin mensaje',
      stack,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
    stack: '',
  };
};

const setLoaderError = (error) => {
  const formattedError = formatError(error);
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const featureFlags = collectFeatureFlags();
  const trace = Array.isArray(globalThis.__teatroPdfJsTrace) ? globalThis.__teatroPdfJsTrace.join('\n') : '';
  const details = [
    `${formattedError.name}: ${formattedError.message}`,
    formattedError.stack ? `stack:\n${formattedError.stack}` : '',
    `userAgent: ${userAgent}`,
    `features: ${JSON.stringify(featureFlags)}`,
    trace ? `trace:\n${trace}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  globalThis.__teatroPdfJsLoaderError = details;
};

(async () => {
  try {
    installPolyfills();

    const loaderUrl = new URL(import.meta.url);
    pushTrace(`loader: importMeta:${loaderUrl.href}`);
    const version = loaderUrl.searchParams.get('v');
    const pdfModuleUrl = new URL('./pdf.min.mjs', loaderUrl);
    const workerModuleUrl = new URL('./pdf.worker.min.mjs', loaderUrl);
    if (version) {
      pdfModuleUrl.searchParams.set('v', version);
      workerModuleUrl.searchParams.set('v', version);
    }
    pushTrace(`loader: pdfModule:${pdfModuleUrl.href}`);
    pushTrace(`loader: workerModule:${workerModuleUrl.href}`);

    pushTrace('loader: imports:start');
    const [pdfjs, pdfjsWorker] = await Promise.all([
      import(pdfModuleUrl.href),
      import(workerModuleUrl.href),
    ]);
    pushTrace('loader: imports:done');

    globalThis.pdfjsWorker = pdfjsWorker;
    pushTrace('loader: fakeWorker:ready');
    globalThis.__teatroPdfJsLoaderError = undefined;
    globalThis.__teatroPdfJsModule = pdfjs;
    pushTrace('loader: module:ready');
  } catch (error) {
    pushTrace(`loader: error:${error instanceof Error ? error.message : String(error)}`);
    setLoaderError(error);
    console.error('No se pudo inicializar PDF.js', error);
  }
})();

const installPolyfills = () => {
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
};

const setLoaderError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  globalThis.__teatroPdfJsLoaderError = message;
};

(async () => {
  try {
    installPolyfills();

    const loaderUrl = new URL(import.meta.url);
    const version = loaderUrl.searchParams.get('v');
    const pdfModuleUrl = new URL('./pdf.min.mjs', loaderUrl);
    if (version) {
      pdfModuleUrl.searchParams.set('v', version);
    }

    const pdfjs = await import(pdfModuleUrl.href);
    globalThis.__teatroPdfJsLoaderError = undefined;
    globalThis.__teatroPdfJsModule = pdfjs;
  } catch (error) {
    setLoaderError(error);
    console.error('No se pudo inicializar PDF.js', error);
  }
})();

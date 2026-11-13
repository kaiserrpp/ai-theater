import type { createBrowserRehearsalComparison as BrowserFactory } from './rehearsalComparison.web';
export const createBrowserRehearsalComparison: typeof BrowserFactory = () => {
  throw new Error('La comparativa del ensayo necesita un navegador web.');
};

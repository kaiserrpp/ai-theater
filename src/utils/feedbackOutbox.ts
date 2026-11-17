import type { IntelligentLineFeedbackSessionInput } from '../types/sharedScript';

type Report = IntelligentLineFeedbackSessionInput;
type Item = { scope: string; report: Report };
export const createFeedbackOutbox = (io: {
  read: () => Promise<string | null>; write: (value: string) => Promise<void>;
  scope: () => string; writable: () => Promise<boolean>; send: (report: Report) => Promise<unknown>;
}) => {
  let items: Item[] = [], loaded: Promise<void> | null = null, writes = Promise.resolve();
  let flushing: Promise<void> | null = null;
  let message = '', pending = 0;
  let snapshot = { pending, message };
  const listeners = new Set<() => void>();
  const publish = (text: string) => {
    message = text; pending = items.filter(item => item.scope === io.scope()).length;
    snapshot = { pending, message }; listeners.forEach(listener => listener());
  };
  const load = () => loaded ??= io.read().then(value => {
    const parsed: unknown = value ? JSON.parse(value) : [];
    if (!Array.isArray(parsed)) throw new Error('No se pudo leer la cola de informes.');
    items = parsed.filter(item => item && typeof item.scope === 'string' && typeof item.report?.sessionId === 'string' && Array.isArray(item.report?.entries));
    publish(items.length ? 'Hay informes pendientes de envío.' : '');
  }).catch(error => { loaded = null; throw error; });
  const mutate = (change: () => Item[]) => {
    const next = writes.catch(() => {}).then(async () => {
      await load(); const updated = change();
      // Keep the previous durable queue if storage is full or unavailable.
      await io.write(JSON.stringify(updated)); items = updated;
    });
    writes = next; return next;
  };
  const enqueue = async (report: Report) => {
    const scope = io.scope();
    const chunks = Math.max(1, Math.ceil(report.entries.length / 500));
    const added = Array.from({ length: chunks }, (_, index) => ({ scope, report: { ...report,
      sessionId: chunks === 1 ? report.sessionId : `${report.sessionId}-part-${index + 1}`,
      entries: report.entries.slice(index * 500, (index + 1) * 500),
    } }));
    await mutate(() => [...items.filter(item => !added.some(next => next.scope === item.scope && next.report.sessionId === item.report.sessionId)), ...added]);
    publish('Ensayo terminado. Informe guardado en este dispositivo, pendiente de envío.');
  };
  const flush = (): Promise<void> => {
    if (flushing) return flushing;
    flushing = (async () => {
      await load(); await writes;
      if (!items.some(item => item.scope === io.scope())) return;
      if (!await io.writable()) { publish('Informe pendiente: el almacenamiento compartido está temporalmente protegido.'); return; }
      for (const item of items.filter(item => item.scope === io.scope())) {
        await io.send(item.report);
        await mutate(() => items.filter(current => current !== item));
        publish(pending > 1 ? 'Informe enviado. Quedan otros pendientes.' : 'Informe del ensayo enviado.');
      }
    })().catch(() => publish('No se pudo enviar el informe. Se conserva en este dispositivo para reintentarlo.'))
      .finally(() => { flushing = null; });
    return flushing;
  };
  return { enqueue, flush, getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
};

// Generated from src/utils/scriptRecognitionContext.ts.
export const resolveRecognitionEngine = (stored) => stored === 'whisper' || stored === 'comparison' ? stored : 'vosk';
const words = (text) => text.normalize('NFKC').match(/[\p{L}][\p{L}'’-]*/gu) || [];
const key = (text) => text.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const title = (text) => text.toLocaleLowerCase().replace(/(^|[\s-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
const ignored = new Set(('a al algo ante antes asi aun aunque bajo bien cada como con contra cual cuando de del desde donde dos el ella ellas ellos en entre era es esa ese eso esta estan estar este esto fue ha habia hacia hasta hay la las le les lo los mas me mi mis muy nada ni no nos o otra otro para pero poco por porque que quien se ser si sin sobre son su sus te tengo ti todo tras tu tus un una uno unos unas ya yo y e u').split(' '));
const english = new Set(('really sure english my your getting better much is are was were have has do does dont can cant hello hey please thank thanks need want love know yes not what why how where when this that these those it its im youre we they you get got good').split(' '));
// A bounded vocabulary, never the expected reply or a replacement transcript.
export const buildScriptRecognitionContext = (lines, characters = []) => {
    const names = [], vocabulary = [];
    const seen = new Set();
    const addName = (value) => {
        for (const raw of value.split(/[,/;&]|\s+[yY]\s+/u)) {
            if (names.length >= 24)
                return;
            const clean = words(raw).slice(0, 5).join(' ').slice(0, 60), normalized = key(clean);
            if (!clean || /sistema|escena|cancion|narrador/u.test(normalized) || seen.has(normalized))
                continue;
            if (names.join(', ').length + clean.length > 260)
                continue;
            seen.add(normalized);
            names.push(title(clean));
        }
    };
    characters.slice(0, 40).forEach(addName);
    lines.slice(0, 10000).forEach((line) => {
        if (names.length >= 24)
            return;
        if (line.p)
            addName(line.p);
        line.r?.forEach(addName);
    });
    const candidates = new Map();
    for (const line of lines.slice(0, 10000)) {
        if (line.k === 'song' || !line.t || /SISTEMA/.test(line.p || ''))
            continue;
        const tokens = words(line.t.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\benlgish\b/gi, 'English').replace(/\briquean\b/gi, 'Rican'));
        const isEnglish = tokens.some((token) => english.has(key(token)));
        tokens.forEach((token, index) => {
            const normalized = key(token);
            if (normalized.length < 3 || ignored.has(normalized) || seen.has(normalized))
                return;
            const weight = (english.has(normalized) ? 5 : isEnglish ? 3 : 0) + (index > 0 && /^\p{Lu}/u.test(token) ? 2 : 0);
            const previous = candidates.get(normalized);
            candidates.set(normalized, { text: token, weight: Math.max(previous?.weight || 0, weight), count: (previous?.count || 0) + 1 });
        });
    }
    const ranked = [...candidates.values()].sort((a, b) => b.weight - a.weight || a.count - b.count || a.text.localeCompare(b.text));
    let size = names.join(', ').length;
    for (const candidate of ranked) {
        if (vocabulary.length >= 36 || size + candidate.text.length + 2 > 460)
            continue;
        vocabulary.push(candidate.text);
        size += candidate.text.length + 2;
    }
    return { names, vocabulary, prompt: [names.join(', '), vocabulary.join(', ')].filter(Boolean).join('. ') };
};

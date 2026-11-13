// Generated from src/utils/speechRecognitionCompatibility.ts.
export const needsNaturalRecognitionEnd = (device) => {
    if (!device)
        return false;
    const agent = device.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(agent) ||
        (device.platform === 'MacIntel' && (device.maxTouchPoints || 0) > 1);
    if (!isIOS)
        return false;
    const safariVersion = /Version\/(\d+)/i.exec(agent);
    // Standalone iOS can omit Version and freeze the OS version in its UA.
    return !safariVersion || Number(safariVersion[1]) >= 27;
};
export const hasRecognizedMicrophoneCheck = (text) => /\bprueba (?:de|del) (?:micro|microfono)\b/.test(text.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim());

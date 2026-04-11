export const extractJsonPayload = (text: string) => {
  const clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const startBrace = clean.indexOf('{');
  const startBracket = clean.indexOf('[');
  const endBrace = clean.lastIndexOf('}') + 1;
  const endBracket = clean.lastIndexOf(']') + 1;

  let start = -1;
  let end = -1;

  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
    start = startBrace;
    end = endBrace;
  } else {
    start = startBracket;
    end = endBracket;
  }

  if (start === -1 || end === 0) {
    return clean;
  }

  return clean.substring(start, end);
};

export const parseModelJson = <T>(text: string) => JSON.parse(extractJsonPayload(text)) as T;

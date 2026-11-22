const CHOIR_PART_LABELS = Object.freeze({
  bass: 'Bajo',
  'bass-1': 'Bajo 1',
  'bass-2': 'Bajo 2',
  mezzo: 'Mezzo',
  'mezzo-1': 'Mezzo 1',
  'mezzo-2': 'Mezzo 2',
  soprano: 'Soprano',
  'soprano-1': 'Soprano 1',
  'soprano-2': 'Soprano 2',
  all: 'Todas las voces',
});

const CHOIR_PARTS = Object.freeze(Object.keys(CHOIR_PART_LABELS));
const normalizeChoirPart = (value) =>
  typeof value === 'string' && CHOIR_PARTS.includes(value) ? value : null;

module.exports = { CHOIR_PART_LABELS, CHOIR_PARTS, normalizeChoirPart };

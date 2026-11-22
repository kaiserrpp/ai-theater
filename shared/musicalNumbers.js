const { normalizeRoles } = require('./musicalAuditions');

const normalizeNumberDetails = (value) => ({
  ...(Array.isArray(value.roles) ? { roles: normalizeRoles(value.roles) } : {}),
  ...(typeof value.lyrics === 'string' ? { lyrics: value.lyrics.trim() } : {}),
  ...(typeof value.referenceAudioId === 'string' && value.referenceAudioId.trim()
    ? { referenceAudioId: value.referenceAudioId.trim() }
    : {}),
});

const normalizeNumberAudioDetails = (value) => ({
  ...(Array.isArray(value.audibleRoles) ? { audibleRoles: normalizeRoles(value.audibleRoles) }
    : value.audibleRoles === null ? { audibleRoles: null } : {}),
  ...(value.timelineNeedsReview === true && value.timelineCues?.length ? { timelineNeedsReview: true } : {}),
});

const markTimelinesForReview = (audios) => audios.map((audio) =>
  audio.timelineCues?.length ? { ...audio, timelineNeedsReview: true } : audio);

const isRangeInScene = (guion, sceneTitle, start, end) => {
  if (!sceneTitle || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= guion.length) {
    return false;
  }
  let scene = null;
  for (let index = 0; index <= end; index++) {
    if (guion[index]?.p === 'ESCENA_SISTEMA') {
      if (index >= start) return false;
      scene = guion[index].t;
    }
  }
  return scene === sceneTitle;
};

module.exports = { normalizeNumberDetails, normalizeNumberAudioDetails, markTimelinesForReview, isRangeInScene };

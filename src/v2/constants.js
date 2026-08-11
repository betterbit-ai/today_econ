const BRAND = Object.freeze({
  name: 'DIEM',
  longName: 'Daily Issue & Economy Magazine',
  primaryHandle: 'diem.magazine',
  fallbackHandle: 'diem_magazine',
  hashtags: Object.freeze(['#diem', '#diemmagazine', '#데일리이슈앤이코노미']),
  colors: Object.freeze({
    background: '#080C16',
    blue: '#4D7CFE',
    white: '#F7F9FC',
    muted: '#A6AEC1',
  }),
});

const CATEGORIES = Object.freeze({
  ECONOMY: 'economy',
  ISSUE: 'issue',
});

const PUBLICATION_STATES = Object.freeze([
  'planned',
  'draft',
  'approved',
  'rejected',
  'generating',
  'ready',
  'publishing',
  'published',
  'no_publish',
  'retry_pending',
  'failed',
  'manual_action_required',
]);

const TERMINAL_STATES = Object.freeze(['published', 'no_publish', 'manual_action_required']);

module.exports = {
  BRAND,
  CATEGORIES,
  PUBLICATION_STATES,
  TERMINAL_STATES,
};

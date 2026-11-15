const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCardHtml, CARD_STYLES } = require('../src/v2/cards');
const { DIEM_CARD_REEL, buildDiemCardReelArgs } = require('../src/v2/reel');
const { validateCards } = require('../src/v2/editorial');
const { stageDailyPackage, CARD_REEL_SECONDS } = require('../src/v2/daily-content');

const CARDS = [
  { role: 'hook', kicker: '연말정산', title: '청약통장\n공제금액\n확인하세요', sub: '올해 넣은 돈이 기준입니다' },
  { role: 'stat', kicker: '최대 공제액', value: '120만원', valueLabel: '연 소득공제', bullets: ['연 300만원 납입의 40%'] },
  {
    role: 'list',
    kicker: '같이 보면 좋은 공제',
    title: '공제율은\n이렇게 다릅니다',
    rows: [
      { label: '신용카드', value: '15%' },
      { label: '체크·현금영수증', value: '30%' },
    ],
  },
  { role: 'cta', kicker: 'SAVE', title: '저장해두고\n12월에\n다시 보세요', sub: '@diem.magazine' },
];

test('accepts a four-cut card series and rejects misplaced roles', () => {
  assert.deepEqual(validateCards(CARDS, { name: 'diem-dark' }), []);
  const swapped = [CARDS[1], CARDS[0], CARDS[2], CARDS[3]];
  assert.match(validateCards(swapped).join(' '), /must open with a hook card/);
  const longTitle = [{ ...CARDS[0], title: '아주 길고 긴 제목입니다\n두 번째 줄\n세 번째 줄' }, ...CARDS.slice(1)];
  assert.match(validateCards(longTitle).join(' '), /title line exceeds/);
});

test('builds a 15 second four-cut Reel with crossfades and a constant frame rate', () => {
  const cardPaths = [1, 2, 3, 4].map(index => `/tmp/card-${index}.png`);
  const { args, totalDuration } = buildDiemCardReelArgs({ cardPaths, sceneDurations: DIEM_CARD_REEL.sceneDurations });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.equal(totalDuration, 15);
  assert.match(filter, /\[0:v\]fps=30/);
  assert.match(filter, /xfade=transition=fade:duration=0\.4:offset=3\.8/);
  assert.match(filter, /xfade=transition=fade:duration=0\.4:offset=7\.6/);
  assert.match(filter, /xfade=transition=fade:duration=0\.4:offset=11\.4/);
  assert.ok(args.includes('-frames:v'));
  assert.equal(args[args.indexOf('-frames:v') + 1], String(15 * DIEM_CARD_REEL.fps));
});

test('rejects a card Reel outside the three-to-four cut contract', () => {
  assert.throws(() => buildDiemCardReelArgs({ cardPaths: ['/tmp/a.png', '/tmp/b.png'] }), /Three or four cards/);
  assert.throws(() => buildDiemCardReelArgs({ cardPaths: [1, 2, 3, 4, 5].map(index => `/tmp/${index}.png`) }), /Three or four cards/);
});

test('renders both card styles as 1080x1920 static cuts with a progress indicator', () => {
  for (const style of CARD_STYLES) {
    const html = buildCardHtml({ card: CARDS[0], style, date: '2026-11-16', category: 'economy', index: 0, total: 4 });
    assert.match(html, /width=1080, initial-scale=1/);
    assert.match(html, new RegExp(`data-card-style="${style}"`));
    assert.match(html, /data-progress="1\/4"/);
    assert.match(html, /data-card-role="hook"/);
    assert.match(html, /@diem\.magazine/);
  }
  assert.throws(() => buildCardHtml({ card: { role: 'scene' }, style: 'diem-dark', date: '2026-11-16', category: 'economy' }), /Unsupported card role/);
});

test('stages a card package with its own publication key and cut-aware duration', () => {
  const item = {
    schemaVersion: 3,
    packageId: '2026-11-16-0110-economy-demo',
    runId: '2026-11-16-0110',
    category: 'economy',
    editorial: { reelFormat: 'cards', cards: CARDS },
    visual: { kind: 'typographic', fallbackTheme: 'tax-account', fallbackVariant: 1, visualFingerprint: 'card-series:test' },
    source: { title: '테스트 기사', url: 'https://example.com/a', evidenceText: '테스트 근거 문장입니다.', evidenceSha256: 'a'.repeat(64) },
    claims: [],
    generation: { provider: 'pickle-assistant', model: 'pickle-cloud-editorial' },
    review: { mode: 'assisted', status: 'model-reviewed' },
    integrity: { contentSha256: 'b'.repeat(64) },
    expiresAt: '2026-11-17T23:59:00+09:00',
  };
  const publication = stageDailyPackage(item, { date: '2026-11-16', now: new Date('2026-11-16T01:10:00+09:00') });
  assert.equal(publication.analytics.reelDurationSeconds, CARD_REEL_SECONDS[4]);
  assert.equal(publication.publicationKey, 'diem:2026-11-16:economy:daily-2026-11-16-0110-economy-demo');
  assert.equal(publication.contentType, 'diem_daily');
});

import assert from 'node:assert/strict';
import { evaluatePostinstallEvidence } from '../scripts/status-ui-postinstall-check.mjs';

function validEvidence(overrides = {}) {
  const evidence = {
    schemaVersion: 1,
    deterministic: {
      versionParity: 'PASS', pluginLoaded: 'PASS', hooksRegistered: 'PASS', permissions: 'PASS',
      toolOwnership: 'PASS', toolInventoryPreserved: 'PASS', markerIntegrity: 'PASS',
      configValidation: 'PASS', pluginDoctor: 'PASS', gatewayRestart: 'PASS', freshSession: 'PASS',
    },
    live: {
      cards: [
        { category: 'start', text: '狀態更新：任務已開始。', safeReview: 'PASS', containsPrivateContent: false },
        { category: 'phase', text: '狀態更新：目前在檢查設定；下一步驗證工具。', hasCurrentPhase: true, hasNextAction: true, safeReview: 'PASS', containsPrivateContent: false },
        { category: 'blocker', text: '狀態更新：目前在檢查版本；發現版本不一致，決定先停止安裝；下一步修正來源。', hasCurrentPhase: true, hasNextAction: true, hasDecisionSummary: true, safeReview: 'PASS', containsPrivateContent: false },
        { category: 'validation_start', text: '狀態更新：目前開始驗證；下一步比對工具清單。', hasCurrentPhase: true, hasNextAction: true, safeReview: 'PASS', containsPrivateContent: false },
        { category: 'validation_result', text: '狀態更新：目前驗證完成且通過；下一步整理結果。', hasCurrentPhase: true, hasNextAction: true, safeReview: 'PASS', containsPrivateContent: false },
        { category: 'runtime_wait', text: '狀態更新：仍在等待測試完成；完成後驗證。', safeReview: 'PASS', containsPrivateContent: false },
      ],
      ordinaryFinalReply: 'PASS', routeIsolation: 'PASS', cardCountOnly: false,
      harnessCoverage: 'SUPPORTED', modelAuthoredFallback: 'PASS',
      observableLongTool: { status: 'PASS', waitCardCount: 1 },
    },
  };
  return { ...evidence, ...overrides };
}

assert.deepEqual(evaluatePostinstallEvidence(validEvidence()), {
  status: 'PASS', deterministic: 'PASS', liveBehavior: 'PASS', waitCoverage: 'PASS',
  harnessCoverage: 'SUPPORTED',
  cardCategories: ['blocker', 'phase', 'runtime_wait', 'start', 'validation_result', 'validation_start'],
});

const limited = validEvidence();
limited.live.harnessCoverage = 'PARTIAL';
limited.live.observableLongTool = { status: 'NOT_RUN' };
assert.equal(evaluatePostinstallEvidence(limited).waitCoverage, 'LIMITED');

const cases = [
  ['deterministic failure', (value) => { value.deterministic.pluginDoctor = 'FAIL'; }, /pluginDoctor/],
  ['missing phase', (value) => { value.live.cards = value.live.cards.filter((card) => card.category !== 'phase'); }, /missing 'phase'/],
  ['count only', (value) => { value.live.cardCountOnly = true; }, /card-count-only/],
  ['missing next action', (value) => { value.live.cards.find((card) => card.category === 'phase').hasNextAction = false; }, /next action/],
  ['missing decision summary', (value) => { value.live.cards.find((card) => card.category === 'blocker').hasDecisionSummary = false; }, /decision summary/],
  ['raw command', (value) => { value.live.cards[1].text = '$ sudo openclaw restart'; }, /forbidden/],
  ['sensitive path', (value) => { value.live.cards[1].text = '讀取 /Users/customer/secret'; }, /sensitive local path/],
  ['credential', (value) => { value.live.cards[1].text = 'api_key=secret-value'; }, /credential/],
  ['private content', (value) => { value.live.cards[1].containsPrivateContent = true; }, /containsPrivateContent/],
  ['unsupported without fallback', (value) => { value.live.harnessCoverage = 'UNVERIFIED'; value.live.observableLongTool = { status: 'NOT_RUN' }; value.live.modelAuthoredFallback = 'FAIL'; }, /modelAuthoredFallback/],
  ['supported without long test', (value) => { value.live.observableLongTool = { status: 'NOT_RUN' }; }, /requires observable long-tool/],
  ['duplicate wait', (value) => { value.live.observableLongTool.waitCardCount = 2; }, /exactly 1/],
];
for (const [name, mutate, pattern] of cases) {
  const value = validEvidence();
  mutate(value);
  assert.throws(() => evaluatePostinstallEvidence(value), pattern, name);
}

console.log('postinstall-check tests passed');

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_DETERMINISTIC = [
  'versionParity',
  'pluginLoaded',
  'hooksRegistered',
  'permissions',
  'toolOwnership',
  'toolInventoryPreserved',
  'markerIntegrity',
  'configValidation',
  'pluginDoctor',
  'gatewayRestart',
  'freshSession',
];
const REQUIRED_LIVE_CATEGORIES = ['start', 'phase', 'validation_start', 'validation_result'];
const FORBIDDEN_TEXT = [
  ['code fence', /```/],
  ['shell prompt', /(^|\n)\s*\$\s+\S/m],
  ['raw shell command', /\b(?:sudo|bash\s+-c|zsh\s+-c|curl\s+https?:\/\/|npm\s+(?:install|run)|git\s+(?:commit|push))\b/i],
  ['sensitive local path', /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/],
  ['credential', /\b(?:api[_ -]?key|access[_ -]?token|service[_ -]?role|private[_ -]?key|password)\s*[:=]\s*\S+/i],
  ['JWT-like secret', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['hidden-reasoning claim', /chain[- ]of[- ]thought|hidden reasoning|完整思考過程|內部推理過程/i],
];

function fail(message) {
  throw new Error(message);
}

function requirePassMap(map, keys, label) {
  if (!map || typeof map !== 'object') fail(`${label}: object is required`);
  for (const key of keys) {
    if (map[key] !== 'PASS') fail(`${label}.${key}: expected PASS, found ${map[key] ?? 'missing'}`);
  }
}

function inspectCard(card, index) {
  if (!card || typeof card !== 'object') fail(`live.cards[${index}]: object is required`);
  if (typeof card.category !== 'string' || !card.category) fail(`live.cards[${index}]: category is required`);
  if (typeof card.text !== 'string' || !card.text.trim()) fail(`live.cards[${index}]: sanitized text is required`);
  if (card.safeReview !== 'PASS') fail(`live.cards[${index}]: safeReview must be PASS`);
  if (card.containsPrivateContent !== false) fail(`live.cards[${index}]: containsPrivateContent must be false`);
  for (const [name, pattern] of FORBIDDEN_TEXT) {
    if (pattern.test(card.text)) fail(`live.cards[${index}]: forbidden ${name}`);
  }
}

export function evaluatePostinstallEvidence(evidence) {
  if (evidence?.schemaVersion !== 1) fail('schemaVersion must be 1');
  requirePassMap(evidence.deterministic, REQUIRED_DETERMINISTIC, 'deterministic');
  if (!Array.isArray(evidence?.live?.cards)) fail('live.cards[] is required');
  evidence.live.cards.forEach(inspectCard);
  const categories = new Set(evidence.live.cards.map((card) => card.category));
  for (const category of REQUIRED_LIVE_CATEGORIES) {
    if (!categories.has(category)) fail(`live.cards: missing '${category}' category`);
  }
  if (!categories.has('blocker') && !categories.has('strategy_change')) {
    fail("live.cards: requires a 'blocker' or 'strategy_change' category");
  }
  const authored = evidence.live.cards.filter((card) => card.category !== 'start' && card.category !== 'runtime_wait');
  for (const card of authored) {
    if (card.hasCurrentPhase !== true) fail(`live.cards '${card.category}': current phase is required`);
    if (card.hasNextAction !== true) fail(`live.cards '${card.category}': next action is required`);
  }
  const changeCards = evidence.live.cards.filter((card) => ['blocker', 'strategy_change'].includes(card.category));
  if (!changeCards.some((card) => card.hasDecisionSummary === true)) {
    fail('live.cards: blocker/strategy evidence requires a decision summary');
  }
  if (evidence.live.ordinaryFinalReply !== 'PASS') fail('live.ordinaryFinalReply must be PASS');
  if (evidence.live.routeIsolation !== 'PASS') fail('live.routeIsolation must be PASS');
  if (evidence.live.cardCountOnly === true) fail('live evidence cannot be card-count-only');

  const requestedCoverage = String(evidence.live.harnessCoverage ?? '').toUpperCase();
  if (!['SUPPORTED', 'PARTIAL', 'UNVERIFIED'].includes(requestedCoverage)) {
    fail('live.harnessCoverage must be SUPPORTED, PARTIAL, or UNVERIFIED');
  }
  const longTool = evidence.live.observableLongTool;
  if (!longTool || !['PASS', 'NOT_RUN'].includes(longTool.status)) {
    fail('live.observableLongTool.status must be PASS or NOT_RUN');
  }
  if (longTool.status === 'PASS' && (!Number.isInteger(longTool.waitCardCount) || longTool.waitCardCount !== 1)) {
    fail('live.observableLongTool.waitCardCount must be exactly 1 when tested');
  }
  let waitCoverage = 'PASS';
  if (requestedCoverage === 'SUPPORTED') {
    if (longTool.status !== 'PASS') fail('SUPPORTED harness coverage requires observable long-tool evidence');
  } else {
    if (evidence.live.modelAuthoredFallback !== 'PASS') {
      fail(`${requestedCoverage} harness coverage requires modelAuthoredFallback PASS`);
    }
    waitCoverage = 'LIMITED';
  }

  return {
    status: 'PASS',
    deterministic: 'PASS',
    liveBehavior: 'PASS',
    waitCoverage,
    harnessCoverage: requestedCoverage,
    cardCategories: [...categories].sort(),
  };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || argv[0] === '--help') {
    console.log('Usage: node scripts/status-ui-postinstall-check.mjs EVIDENCE.json');
    if (argv[0] === '--help') return;
    process.exitCode = 2;
    return;
  }
  const evidence = JSON.parse(fs.readFileSync(path.resolve(argv[0]), 'utf8'));
  const result = evaluatePostinstallEvidence(evidence);
  console.log(`PASS postinstall deterministic=${result.deterministic} live=${result.liveBehavior} waitCoverage=${result.waitCoverage} harness=${result.harnessCoverage}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`FAIL ${error.message}`); process.exitCode = 1; }
}

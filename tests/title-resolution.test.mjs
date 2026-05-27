import assert from 'node:assert/strict';
import {
  applyTitleTemplate,
  buildFallbackText,
  buildPresentation,
  buildWorkingTitle,
  clearBotNameCacheForTest,
  resolveStatusTitle,
} from '../src/core.js';

clearBotNameCacheForTest();

assert.equal(applyTitleTemplate('{name} 正在處理', '安賽小助手'), '安賽小助手 正在處理');
assert.equal(applyTitleTemplate('', ''), '助理 正在處理');
assert.equal(buildWorkingTitle('客戶Bot'), '客戶Bot 正在處理');

const configured = await resolveStatusTitle({
  pluginConfig: { title: '自訂標題' },
  route: { channel: 'discord', accountId: null },
  ctx: {},
  api: {},
  cfg: {},
  fetchImpl: async () => { throw new Error('should not fetch'); },
});
assert.equal(configured, '自訂標題');

const templatedContext = await resolveStatusTitle({
  pluginConfig: { titleTemplate: '正在由 {name} 處理' },
  route: { channel: 'signal', accountId: null },
  ctx: { identity: { name: '客戶助理' } },
  api: {},
  cfg: {},
});
assert.equal(templatedContext, '正在由 客戶助理 處理');

const unknownFallback = await resolveStatusTitle({
  pluginConfig: {},
  route: { channel: 'signal', accountId: null },
  ctx: {},
  api: {},
  cfg: {},
});
assert.equal(unknownFallback, '助理 正在處理');

const customFallback = await resolveStatusTitle({
  pluginConfig: { fallbackName: '我的助理' },
  route: { channel: 'signal', accountId: null },
  ctx: {},
  api: {},
  cfg: {},
});
assert.equal(customFallback, '我的助理 正在處理');

const fallbackText = buildFallbackText({ title: '安賽小助手 正在處理', prefix: '狀態更新：', body: '測試中' });
assert.match(fallbackText, /安賽小助手 正在處理/);

const presentation = buildPresentation({ fallbackText });
assert.equal(presentation.title, undefined);
assert.equal(presentation.blocks.length, 1);
assert.match(presentation.blocks[0].text, /安賽小助手 正在處理/);
assert.match(presentation.blocks[0].text, /狀態更新：測試中/);

console.log('title-resolution tests passed');

import assert from 'node:assert/strict';
import {
  clearBotNameCacheForTest,
  readPlainDiscordToken,
  resolveDiscordBotName,
  resolveStatusTitle,
} from '../src/core.js';

clearBotNameCacheForTest();

assert.equal(readPlainDiscordToken({ channels: { discord: { token: 'Bot abc123' } } }, null, {}), 'abc123');
assert.equal(readPlainDiscordToken({ channels: { discord: { accounts: { alt: { token: 'acct-token' } }, token: 'top-token' } } }, 'alt', {}), 'acct-token');
assert.equal(readPlainDiscordToken({ channels: { discord: { token: { ref: 'secret' } } } }, null, { DISCORD_TOKEN: 'env-token' }), 'env-token');

const contextFirst = await resolveStatusTitle({
  pluginConfig: {},
  route: { channel: 'discord', accountId: null },
  ctx: { deliveryContext: { botName: 'Context Bot' } },
  api: {},
  cfg: { channels: { discord: { token: 'token' } } },
  fetchImpl: async () => ({ ok: true, json: async () => ({ username: 'Discord Bot' }) }),
});
assert.equal(contextFirst, 'Context Bot 正在處理');

clearBotNameCacheForTest();
const discordName = await resolveDiscordBotName({
  cfg: { channels: { discord: { token: 'token' } } },
  accountId: null,
  fetchImpl: async (url, opts) => {
    assert.equal(url, 'https://discord.com/api/v10/users/@me');
    assert.equal(opts.headers.Authorization, 'Bot token');
    return { ok: true, json: async () => ({ username: 'Discord Bot' }) };
  },
  env: {},
});
assert.equal(discordName, 'Discord Bot');

clearBotNameCacheForTest();
const discordFailureFallback = await resolveStatusTitle({
  pluginConfig: {},
  route: { channel: 'discord', accountId: null },
  ctx: {},
  api: {},
  cfg: { channels: { discord: { token: 'token' } } },
  fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  env: {},
});
assert.equal(discordFailureFallback, '助理 正在處理');

clearBotNameCacheForTest();
const noTokenFallback = await resolveStatusTitle({
  pluginConfig: { fallbackName: '客服助理' },
  route: { channel: 'discord', accountId: null },
  ctx: {},
  api: {},
  cfg: {},
  fetchImpl: async () => { throw new Error('should not fetch without token'); },
  env: {},
});
assert.equal(noTokenFallback, '客服助理 正在處理');

console.log('identity-resolution tests passed');

import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createAI, SecretStore } from '../src';
import { FakeHost, tmpDir } from './helpers';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
// Reversible fabricated encryption: the contract is that settings use SecretStore, never a plaintext file.
const secretStore: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value.split('').reverse().join('')),
  decryptString: value => value.toString().split('').reverse().join(''),
};
it('fails if stock keys are saved in plaintext, cannot survive restart, or cannot be removed', async () => {
  const settingsDir = tmpDir('stock-keys '); roots.push(settingsDir);
  const opts = { settingsDir, host: new FakeHost(settingsDir), secretStore };
  const ai = createAI(opts);
  await ai.setStockKey('pexels', 'fabricated-pexels-key');
  await ai.setStockKey('pixabay', 'fabricated-pixabay-key');
  const names = await fs.readdir(settingsDir);
  expect(names.sort()).toEqual(['pexels-key.bin', 'pixabay-key.bin']);
  for (const name of names) expect(await fs.readFile(path.join(settingsDir, name), 'utf8')).not.toContain('fabricated');
  const restarted = createAI(opts);
  expect(await restarted.stockProviders()).toEqual([{ id: 'pexels', connected: true }, { id: 'pixabay', connected: true }, { id: 'openverse', connected: true }]);
  await restarted.setStockKey('pexels', null);
  expect(await restarted.stockProviders()).toContainEqual({ id: 'pexels', connected: false });
  expect(await fs.readdir(settingsDir)).toEqual(['pixabay-key.bin']);
});
it('fails if stock keys fall back to plaintext without secure storage or an invalid provider writes a file', async () => {
  const settingsDir = tmpDir('stock-keys '); roots.push(settingsDir);
  const ai = createAI({ settingsDir, host: new FakeHost(settingsDir), allowPlaintextSecrets: true });
  await expect(ai.setStockKey('pexels', 'fabricated-key')).rejects.toMatchObject({ code: 'no_secure_storage' });
  // Renderer messages are untrusted even when TypeScript callers use the right union.
  await expect(ai.setStockKey('../escape' as 'pexels', 'fabricated-key')).rejects.toMatchObject({ code: 'bad_stock_key' });
  const failing = createAI({ settingsDir, host: new FakeHost(settingsDir), secretStore: { ...secretStore,
    encryptString(value) { throw new Error(`cannot encrypt ${value}`); } } });
  await expect(failing.setStockKey('pexels', 'fabricated-key')).rejects.toMatchObject({ code: 'stock_key_save_failed' });
  expect(await fs.readdir(settingsDir)).toEqual([]);
});

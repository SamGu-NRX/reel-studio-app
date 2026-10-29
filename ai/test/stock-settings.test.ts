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
it('fails if the basic_text backend saves stock keys or loads existing keys as connected', async () => {
  const settingsDir = tmpDir('stock-keys '); roots.push(settingsDir);
  let backend = 'gnome_libsecret';
  const opts = { settingsDir, host: new FakeHost(settingsDir), secretStore: { ...secretStore,
    getSelectedStorageBackend: () => backend } };
  const ai = createAI(opts);
  await ai.setStockKey('pexels', 'fabricated-pexels-key');
  await ai.setStockKey('pixabay', 'fabricated-pixabay-key');
  backend = 'basic_text';
  const restarted = createAI(opts);
  expect(await restarted.stockProviders()).toEqual([
    { id: 'pexels', connected: false }, { id: 'pixabay', connected: false }, { id: 'openverse', connected: true },
  ]);
  const before = await fs.readFile(path.join(settingsDir, 'pexels-key.bin'));
  await expect(restarted.setStockKey('pexels', 'fabricated-replacement')).rejects.toMatchObject({ code: 'no_secure_storage' });
  expect(await fs.readFile(path.join(settingsDir, 'pexels-key.bin'))).toEqual(before);
  await restarted.setStockKey('pixabay', null);
  await expect(restarted.setStockKey('pixabay', 'fabricated-new-key')).rejects.toMatchObject({ code: 'no_secure_storage' });
  expect(await fs.readdir(settingsDir)).toEqual(['pexels-key.bin']);
  backend = 'gnome_libsecret';
  expect(await restarted.stockProviders()).toContainEqual({ id: 'pexels', connected: true });
});
it('fails if opening Settings with no keys saved touches the secret store', async () => {
  // On a Mac, any secret store call (even isEncryptionAvailable) reads the app's keychain item. An ad-hoc-signed
  // build (the nightly) gets a keychain prompt after every update, and the app is blocked until it is answered, so
  // status must not touch the store unless a key file is there to read.
  const settingsDir = tmpDir('stock-keys '); roots.push(settingsDir);
  const touched: string[] = [];
  const trap = (name: string) => () => { touched.push(name); throw new Error(`secret store touched: ${name}`); };
  const ai = createAI({ settingsDir, host: new FakeHost(settingsDir), secretStore: {
    isEncryptionAvailable: trap('isEncryptionAvailable'), encryptString: trap('encryptString'), decryptString: trap('decryptString'),
    getSelectedStorageBackend: trap('getSelectedStorageBackend') } as SecretStore });
  expect(await ai.stockProviders()).toEqual([{ id: 'pexels', connected: false }, { id: 'pixabay', connected: false }, { id: 'openverse', connected: true }]);
  await ai.providers();
  await ai.connections?.();
  await ai.autoModels?.();
  await ai.editorModels?.();
  expect(touched).toEqual([]);
});

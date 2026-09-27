import 'reflect-metadata';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Container } from '@n8n/di';
import { Cipher, Credentials, EncryptionKeyProxy } from 'n8n-core';
import { InstanceKeyProvider } from '../encryption-key-provider';

const TEST_ENCRYPTION_KEY = 'runner-test-encryption-key';

describe('InstanceKeyProvider', () => {
  let userFolder: string;
  const originalEnv = {
    N8N_USER_FOLDER: process.env.N8N_USER_FOLDER,
    N8N_ENCRYPTION_KEY: process.env.N8N_ENCRYPTION_KEY,
  };

  beforeAll(() => {
    // Isolate InstanceSettings from the developer's real ~/.n8n/config
    userFolder = mkdtempSync(path.join(tmpdir(), 'n8n-runner-test-'));
    process.env.N8N_USER_FOLDER = userFolder;
    process.env.N8N_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    rmSync(userFolder, { recursive: true, force: true });
  });

  beforeEach(() => {
    Container.reset();
  });

  afterEach(() => {
    Container.reset();
  });

  const registerProvider = (): InstanceKeyProvider => {
    const provider = new InstanceKeyProvider();
    Container.get(EncryptionKeyProxy).setProvider(provider);
    return provider;
  };

  it('should describe the instance key as the legacy no-prefix aes-256-cbc key', async () => {
    const provider = registerProvider();
    const cipher = Container.get(Cipher);

    const keyInfo = await provider.getLegacyKey();

    expect(keyInfo).toEqual({
      id: 'instance-key',
      value: expect.any(String),
      algorithm: 'aes-256-cbc',
      format: 'no-prefix',
    });
    expect(cipher.decryptDEKWithInstanceKey(keyInfo.value)).toBe(TEST_ENCRYPTION_KEY);
  });

  it('should serve the same descriptor for the active key and cache it', async () => {
    const provider = registerProvider();

    const legacy = await provider.getLegacyKey();
    const active = await provider.getActiveKey();

    expect(active).toBe(legacy);
    expect(await provider.getLegacyKey()).toBe(legacy);
  });

  it('should not resolve key-id-prefixed ciphertext', async () => {
    const provider = registerProvider();
    const cipher = Container.get(Cipher);

    expect(await provider.getKeyById('some-key-id')).toBeNull();
    await expect(cipher.decryptV2('some-key-id:ciphertext')).rejects.toThrow(
      'Encryption key not found: some-key-id',
    );
  });

  it('should decrypt data encrypted with the instance key by older n8n versions', async () => {
    registerProvider();
    const cipher = Container.get(Cipher);
    const data = { apiKey: 'secret', endpoint: 'https://example.com' };

    // Cipher.encrypt is the pre-2.40 code path: plain aes-256-cbc under the instance key
    const legacyBlob = cipher.encrypt(data);

    await expect(cipher.decryptV2(legacyBlob)).resolves.toBe(JSON.stringify(data));

    const credentials = new Credentials({ id: '1', name: 'Test' }, 'testApi', legacyBlob);
    await expect(credentials.getData()).resolves.toEqual(data);
  });

  it('should encrypt in the same legacy format so the output stays readable elsewhere', async () => {
    registerProvider();
    const cipher = Container.get(Cipher);

    const blob = await cipher.encryptV2({ token: 'abc' });

    expect(blob).not.toContain(':');
    expect(cipher.decrypt(blob)).toBe(JSON.stringify({ token: 'abc' }));
  });

  it('should be required: without a provider n8n-core cannot decrypt credentials', async () => {
    const cipher = Container.get(Cipher);
    const legacyBlob = cipher.encrypt({ apiKey: 'secret' });

    await expect(cipher.decryptV2(legacyBlob)).rejects.toThrow(
      'Encryption key provider is not configured',
    );
  });
});

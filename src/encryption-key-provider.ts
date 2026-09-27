import { Container } from '@n8n/di';
import type { IEncryptionKeyProvider, KeyInfo } from 'n8n-core';
import { Cipher, InstanceSettings } from 'n8n-core';

/**
 * Serves the instance encryption key as the only data-encryption key.
 *
 * Since n8n-core 2.40 every `Cipher.encryptV2`/`decryptV2` call resolves its key
 * through `EncryptionKeyProxy`, which throws unless a provider is registered.
 * n8n itself registers a database-backed key manager; the runner has no key store,
 * so this mirrors that manager's behaviour with key rotation switched off: the
 * legacy `no-prefix` descriptor wrapping the instance key, which keeps credential
 * blobs encrypted with `N8N_ENCRYPTION_KEY` readable and writes in the same format.
 */
export class InstanceKeyProvider implements IEncryptionKeyProvider {
  private instanceKeyInfo?: KeyInfo;

  async getActiveKey(): Promise<KeyInfo> {
    return this.getInstanceKeyInfo();
  }

  /**
   * Key-id-prefixed ciphertext (`<keyId>:<data>`) comes from instances with key
   * rotation enabled; the runner has no key store to look those ids up in.
   */
  async getKeyById(_id: string): Promise<KeyInfo | null> {
    return null;
  }

  async getLegacyKey(): Promise<KeyInfo> {
    return this.getInstanceKeyInfo();
  }

  private getInstanceKeyInfo(): KeyInfo {
    if (!this.instanceKeyInfo) {
      // Resolved lazily: constructing InstanceSettings reads (or creates) the
      // n8n settings file, which should only happen once credentials are used.
      const cipher = Container.get(Cipher);
      const instanceSettings = Container.get(InstanceSettings);

      this.instanceKeyInfo = {
        id: 'instance-key',
        value: cipher.encryptDEKWithInstanceKey(instanceSettings.encryptionKey),
        algorithm: 'aes-256-cbc',
        format: 'no-prefix',
      };
    }

    return this.instanceKeyInfo;
  }
}

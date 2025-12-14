import 'reflect-metadata';

jest.mock('@n8n/di', () => ({
  Service: () => (target: unknown) => target,
}));

import { CredentialsOverwrites } from '../credentials-overwrites';

describe('CredentialsOverwrites', () => {
  let credentialsOverwrites: CredentialsOverwrites;

  beforeEach(() => {
    credentialsOverwrites = new CredentialsOverwrites();
  });

  describe('applyOverwrite', () => {
    it('should return decrypted data unchanged', () => {
      const decryptedData = { username: 'test', password: 'secret' };
      const result = credentialsOverwrites.applyOverwrite('testType', decryptedData);
      expect(result).toBe(decryptedData);
    });

    it('should handle various credential data types', () => {
      const emptyData = {};
      const result1 = credentialsOverwrites.applyOverwrite('testType', emptyData);
      expect(result1).toEqual({});

      const complexData = {
        username: 'user@example.com',
        password: 'complex-password-123',
        apiKey: 'key-abc-def',
        options: { timeout: 5000 },
      };
      const result2 = credentialsOverwrites.applyOverwrite('apiType', complexData);
      expect(result2).toEqual(complexData);
    });
  });
});

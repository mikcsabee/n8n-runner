import { Service } from '@n8n/di';
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

/**
 * Simplified CredentialsOverwrites for runner
 */
@Service()
export class CredentialsOverwrites {
  /**
   * Apply overwrites to credential data
   * In runner mode, we don't have any overwrites, so just return the original data
   */
  applyOverwrite(
    _type: string,
    decryptedData: ICredentialDataDecryptedObject,
  ): ICredentialDataDecryptedObject {
    return decryptedData;
  }
}

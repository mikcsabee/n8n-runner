/**
 * Interface for credential data providers
 * Abstracts where credentials are stored (file, env vars, database, etc.)
 */
export interface ICredentialsProvider {
  /**
   * Get credential data by ID and type
   * @param id - Credential ID (must match workflow credential reference)
   * @param type - Credential type (e.g., 'googlePalmApi')
   * @returns Credential data with encrypted data field
   */
  getCredentialData(
    id: string,
    type: string,
  ): { id: string; name: string; type: string; data: string };
}

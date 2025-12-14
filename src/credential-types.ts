import { Logger } from '@n8n/backend-common';
import { Container, Service } from '@n8n/di';
import type { ICredentialType, ICredentialTypes } from 'n8n-workflow';
import { UnexpectedError } from 'n8n-workflow';

/**
 * Simplified CredentialTypes for runner
 * Loads credentials dynamically from n8n-nodes-base and @n8n/n8n-nodes-langchain
 */
@Service()
export class CredentialTypes implements ICredentialTypes {
  private loadedCredentials: Record<string, { type: ICredentialType }> = {};
  private knownCredentials: Record<string, { extends?: string[]; supportedNodes?: string[] }> = {};
  private logger: Logger;

  constructor() {
    this.logger = Container.get(Logger);
  }

  recognizes(type: string): boolean {
    return type in this.knownCredentials || type in this.loadedCredentials;
  }

  getByName(credentialType: string): ICredentialType {
    // Try to load the credential if not already loaded
    if (!this.loadedCredentials[credentialType]) {
      this.loadCredentialType(credentialType);
    }

    if (!this.loadedCredentials[credentialType]) {
      throw new UnexpectedError(`Unknown credential type: ${credentialType}`);
    }

    const credType = this.loadedCredentials[credentialType].type;
    this.logger.debug(`[CredentialTypes] getByName(${credentialType}) returning:`, {
      name: credType.name,
      hasProperties: !!credType.properties,
      propertiesCount: credType.properties?.length,
    });

    return credType;
  }

  getSupportedNodes(type: string): string[] {
    return this.knownCredentials[type]?.supportedNodes ?? [];
  }

  getParentTypes(typeName: string): string[] {
    const extendsArr = this.knownCredentials[typeName]?.extends ?? [];

    if (extendsArr.length === 0) return [];

    const extendsArrCopy = [...extendsArr];

    for (const type of extendsArr) {
      extendsArrCopy.push(...this.getParentTypes(type));
    }

    return extendsArrCopy;
  }

  /**
   * Dynamically load a credential type
   */
  private loadCredentialType(credentialType: string): void {
    // Convert credential type to PascalCase for filename
    // e.g., googlePalmApi -> GooglePalmApi
    const pascalCaseType = credentialType.charAt(0).toUpperCase() + credentialType.slice(1);

    try {
      // Try loading from n8n-nodes-base/dist/credentials first
      const credentialPath = `n8n-nodes-base/dist/credentials/${pascalCaseType}.credentials.js`;
      const credentialModule = this.tryRequireModule(credentialPath) as Record<string, unknown>;

      if (credentialModule?.[pascalCaseType]) {
        this.loadedCredentials[credentialType] = {
          type: new (credentialModule[pascalCaseType] as new () => ICredentialType)(),
        };
        this.logger.debug(
          `[CredentialTypes] Loaded credential from n8n-nodes-base: ${credentialType}`,
        );
        return;
      }
    } catch (_error) {
      // Not in n8n-nodes-base, try langchain package
    }

    try {
      // Try loading from @n8n/n8n-nodes-langchain/dist/credentials
      const credentialPath = `@n8n/n8n-nodes-langchain/dist/credentials/${pascalCaseType}.credentials.js`;
      const credentialModule = this.tryRequireModule(credentialPath) as Record<string, unknown>;

      if (credentialModule?.[pascalCaseType]) {
        this.loadedCredentials[credentialType] = {
          type: new (credentialModule[pascalCaseType] as new () => ICredentialType)(),
        };
        this.logger.debug(`[CredentialTypes] Loaded credential from langchain: ${credentialType}`);
        return;
      }
    } catch (error) {
      this.logger.error(`[CredentialTypes] Failed to load credential type: ${credentialType}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Helper method to require a module with fallback to consumer's node_modules
   */
  private tryRequireModule(modulePath: string): unknown {
    try {
      // Try direct require first
      return require(modulePath);
    } catch (_e) {
      // If not found locally, try resolving from the current working directory
      // This allows the library to load modules from the consumer's node_modules
      const resolvedPath = require.resolve(modulePath, {
        paths: [process.cwd(), ...(require.resolve.paths(modulePath) || [])],
      });
      return require(resolvedPath);
    }
  }
}

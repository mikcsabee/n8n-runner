import { Logger } from '@n8n/backend-common';
import { Container, Service } from '@n8n/di';
import { Credentials } from 'n8n-core';
import type {
  ICredentialDataDecryptedObject,
  ICredentialsExpressionResolveValues,
  IExecuteData,
  IHttpRequestOptions,
  INode,
  INodeCredentialsDetails,
  INodeParameters,
  INodeProperties,
  INodeTypes,
  IWorkflowExecuteAdditionalData,
  WorkflowExecuteMode,
} from 'n8n-workflow';
import { ICredentialsHelper, NodeHelpers, UnexpectedError, Workflow } from 'n8n-workflow';

import type { CredentialTypes } from './credential-types';
import type { CredentialsOverwrites } from './credentials-overwrites';
import type { ICredentialsProvider } from './credentials-provider';

const mockNode = {
  name: '',
  typeVersion: 1,
  type: 'mock',
  position: [0, 0],
  parameters: {} as INodeParameters,
} as INode;

/**
 * Simplified CredentialsHelper for runner
 */
@Service()
export class CredentialsHelper extends ICredentialsHelper {
  private logger: Logger;

  constructor(
    private readonly credentialTypes: CredentialTypes,
    private readonly credentialsOverwrites: CredentialsOverwrites,
    private readonly credentialsProvider: ICredentialsProvider,
  ) {
    super();
    this.logger = Container.get(Logger);
  }

  /**
   * Add the required authentication information to the request
   */
  async authenticate(
    _credentials: ICredentialDataDecryptedObject,
    _typeName: string,
    requestOptions: IHttpRequestOptions,
  ): Promise<IHttpRequestOptions> {
    // Stub implementation - authentication is not supported in runner mode
    return requestOptions;
  }

  /**
   * Pre-authentication method
   */
  async preAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
    // Stub implementation - pre-auth is not supported in runner mode
    return undefined;
  }

  /**
   * Updates credentials in the database
   */
  async updateCredentials(): Promise<void> {
    // Stub implementation - credential updates not supported in runner mode
  }

  /**
   * Updates credential's oauth token data in the database
   */
  async updateCredentialsOauthTokenData(): Promise<void> {
    // Stub implementation - OAuth token updates not supported in runner mode
  }

  /**
   * Returns all parent types of the given credential type
   */
  getParentTypes(typeName: string): string[] {
    return this.credentialTypes.getParentTypes(typeName);
  }

  /**
   * Returns the credentials instance
   */
  async getCredentials(
    nodeCredential: INodeCredentialsDetails,
    type: string,
  ): Promise<Credentials> {
    if (!nodeCredential.id) {
      throw new UnexpectedError('Found credential with no ID.', {
        extra: { credentialName: nodeCredential.name },
        tags: { credentialType: type },
      });
    }

    const credential = this.credentialsProvider.getCredentialData(nodeCredential.id, type);

    return new Credentials(
      { id: credential.id, name: credential.name },
      credential.type,
      credential.data,
    );
  }

  /**
   * Returns all the properties of the credentials with the given name
   */
  getCredentialsProperties(type: string): INodeProperties[] {
    this.logger.debug(`[CredentialsHelper] getCredentialsProperties called with type: ${type}`);
    const credentialTypeData = this.credentialTypes.getByName(type);

    this.logger.debug(`[CredentialsHelper] credentialTypeData:`, {
      exists: !!credentialTypeData,
      name: credentialTypeData?.name,
      hasProperties: !!credentialTypeData?.properties,
      propertiesLength: credentialTypeData?.properties?.length,
    });

    if (!credentialTypeData) {
      throw new UnexpectedError('Unknown credential type', { tags: { credentialType: type } });
    }

    if (credentialTypeData.extends === undefined) {
      // Manually add the special OAuth parameter which stores
      // data like access- and refresh-token
      if (['oAuth1Api', 'oAuth2Api'].includes(type)) {
        return [
          ...(credentialTypeData.properties as INodeProperties[]),
          {
            displayName: 'oauthTokenData',
            name: 'oauthTokenData',
            type: 'json',
            required: false,
            default: {},
          } as INodeProperties,
        ];
      }

      return credentialTypeData.properties as INodeProperties[];
    }

    const combineProperties: INodeProperties[] = [];
    for (const credentialsTypeName of credentialTypeData.extends) {
      const mergeCredentialProperties = this.getCredentialsProperties(credentialsTypeName);
      NodeHelpers.mergeNodeProperties(combineProperties, mergeCredentialProperties);
    }

    // The properties defined on the parent credentials take precedence
    NodeHelpers.mergeNodeProperties(
      combineProperties,
      credentialTypeData.properties as INodeProperties[],
    );

    return combineProperties;
  }

  /**
   * Returns the decrypted credential data with applied overwrites
   */
  async getDecrypted(
    additionalData: IWorkflowExecuteAdditionalData,
    nodeCredentials: INodeCredentialsDetails,
    type: string,
    mode: WorkflowExecuteMode,
    _executeData?: IExecuteData,
    raw?: boolean,
    _expressionResolveValues?: ICredentialsExpressionResolveValues,
  ): Promise<ICredentialDataDecryptedObject> {
    const credentials = await this.getCredentials(nodeCredentials, type);
    const decryptedDataOriginal = credentials.getData();

    if (raw === true) {
      return decryptedDataOriginal;
    }

    return await this.applyDefaultsAndOverwrites(additionalData, decryptedDataOriginal, type, mode);
  }

  /**
   * Creates a minimal mock INodeTypes for workflow expression resolution
   */
  public static createMockNodeTypes(): INodeTypes {
    return {
      getByName: (_nodeType: string) => {
        // Return a minimal node type structure
        return {
          description: {
            displayName: 'Mock',
            name: 'mock',
            group: [],
            version: 1,
            description: 'Mock node',
            defaults: { name: 'Mock' },
            inputs: [],
            outputs: [],
            properties: [],
          },
        };
      },
      getByNameAndVersion: (_nodeType: string, _version?: number) => {
        return CredentialsHelper.createMockNodeTypes().getByName(_nodeType);
      },
      getKnownTypes: () => ({}),
    } as unknown as INodeTypes;
  }

  /**
   * Applies credential default data and overwrites
   */
  async applyDefaultsAndOverwrites(
    _additionalData: IWorkflowExecuteAdditionalData,
    decryptedDataOriginal: ICredentialDataDecryptedObject,
    type: string,
    mode: WorkflowExecuteMode,
  ): Promise<ICredentialDataDecryptedObject> {
    this.logger.debug(`[CredentialsHelper] applyDefaultsAndOverwrites for type: ${type}`);
    const credentialsProperties = this.getCredentialsProperties(type);

    this.logger.debug(`[CredentialsHelper] credentialsProperties:`, {
      isArray: Array.isArray(credentialsProperties),
      length: credentialsProperties?.length,
      first: credentialsProperties?.[0],
    });

    // Load and apply the credentials overwrites if any exist
    const dataWithOverwrites = this.credentialsOverwrites.applyOverwrite(
      type,
      decryptedDataOriginal,
    );

    this.logger.debug(`[CredentialsHelper] calling NodeHelpers.getNodeParameters`);
    // Add the default credential values
    let decryptedData: ICredentialDataDecryptedObject;
    try {
      decryptedData = NodeHelpers.getNodeParameters(
        credentialsProperties as unknown as INodeProperties[],
        dataWithOverwrites as INodeParameters,
        true,
        false,
        null,
        null,
      ) as ICredentialDataDecryptedObject;
      this.logger.debug(`[CredentialsHelper] NodeHelpers.getNodeParameters succeeded`);
    } catch (error) {
      this.logger.error(`[CredentialsHelper] NodeHelpers.getNodeParameters failed:`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (decryptedDataOriginal.oauthTokenData !== undefined) {
      // The OAuth data gets removed as it is not defined specifically as a parameter
      // on the credentials so add it back in case it was set
      decryptedData.oauthTokenData = decryptedDataOriginal.oauthTokenData;
    }

    const workflow = new Workflow({
      nodes: [mockNode],
      connections: {},
      active: false,
      nodeTypes: CredentialsHelper.createMockNodeTypes(),
    });

    // Resolve expressions if any are set
    decryptedData = workflow.expression.getComplexParameterValue(
      mockNode,
      decryptedData as INodeParameters,
      mode,
      {},
      undefined,
      undefined,
      decryptedData,
    ) as ICredentialDataDecryptedObject;

    return decryptedData;
  }
}

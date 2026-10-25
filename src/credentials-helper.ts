import { Logger } from '@n8n/backend-common';
import { Container, Service } from '@n8n/di';
import { Credentials } from 'n8n-core';
import type {
  ICredentialDataDecryptedObject,
  ICredentialsExpressionResolveValues,
  ICredentialType,
  IExecuteData,
  IHttpRequestOptions,
  INode,
  INodeCredentialsDetails,
  INodeParameters,
  INodeProperties,
  INodeTypes,
  IWorkflowDataProxyAdditionalKeys,
  IWorkflowExecuteAdditionalData,
  WorkflowExecuteMode,
} from 'n8n-workflow';
import {
  ICredentialsHelper,
  isExpression,
  NodeHelpers,
  UnexpectedError,
  Workflow,
} from 'n8n-workflow';

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
    credentials: ICredentialDataDecryptedObject,
    typeName: string,
    requestOptions: IHttpRequestOptions,
    workflow?: Workflow,
    node?: INode,
  ): Promise<IHttpRequestOptions> {
    const credentialType = this.credentialTypes.getByName(typeName);

    if (!credentialType.authenticate) {
      // No authentication data defined, return request options unchanged
      return requestOptions;
    }

    if (typeof credentialType.authenticate === 'function') {
      // The credential type brings its own authenticate function
      return credentialType.authenticate(credentials, requestOptions);
    }

    if (!workflow || !node) {
      throw new UnexpectedError(
        `Cannot resolve generic authentication for credential type "${typeName}" without workflow and node`,
        { tags: { credentialType: typeName } },
      );
    }

    const { authenticate } = credentialType;

    if (requestOptions.headers === undefined) {
      requestOptions.headers = {};
    }

    if (authenticate.type !== 'generic') {
      // Unknown authentication type, return request options unchanged
      return requestOptions;
    }

    const additionalKeys: IWorkflowDataProxyAdditionalKeys = {
      $credentials: credentials,
    };

    for (const [outerKey, outerValue] of Object.entries(authenticate.properties)) {
      for (const [key, value] of Object.entries(outerValue as Record<string, string>)) {
        const keyResolved = this.resolveAuthenticationValue(key, additionalKeys, workflow, node);
        const valueResolved = this.resolveAuthenticationValue(
          value,
          additionalKeys,
          workflow,
          node,
        );

        // Dynamic key on request options (qs / headers / body / auth) - outerKey
        // is only known at runtime, so there is no way to type this statically
        const dynamicOptions = requestOptions as unknown as Record<string, Record<string, unknown>>;
        dynamicOptions[outerKey] ??= {};
        dynamicOptions[outerKey][keyResolved] = valueResolved;
      }
    }

    return requestOptions;
  }

  /**
   * Resolves a generic-authentication property value, evaluating any
   * `={{ $credentials.xxx }}` expression against the decrypted credential data
   */
  private resolveAuthenticationValue(
    parameterValue: string,
    additionalKeys: IWorkflowDataProxyAdditionalKeys,
    workflow: Workflow,
    node: INode,
  ): string {
    if (!isExpression(parameterValue)) {
      return parameterValue;
    }

    const returnValue = workflow.expression.getSimpleParameterValue(
      node,
      parameterValue,
      'internal',
      additionalKeys,
      undefined,
      '',
    );

    return returnValue === undefined || returnValue === null ? '' : returnValue.toString();
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
   * Checks whether the given credential type may be used by the given node type
   */
  isCredentialUsableByNode(credentialType: string, nodeType: string): boolean {
    let credentialTypeData: ICredentialType;
    try {
      credentialTypeData = this.credentialTypes.getByName(credentialType);
    } catch {
      return true;
    }

    if (credentialTypeData.restrictToSupportedNodes !== true) {
      return true;
    }

    return (credentialTypeData.supportedNodes ?? []).includes(nodeType);
  }

  /**
   * Runs the pre-authentication step outside of the authentication flow
   */
  async runPreAuthentication(): Promise<ICredentialDataDecryptedObject | undefined> {
    // Stub implementation - pre-auth is not supported in runner mode
    return undefined;
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
    const decryptedDataOriginal = await credentials.getData();

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

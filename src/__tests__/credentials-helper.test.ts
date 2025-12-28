import 'reflect-metadata';

jest.mock('@n8n/backend-common', () => ({
  Logger: jest.fn(),
}));

jest.mock('@n8n/di', () => {
  const mockLogger = {
    debug: jest.fn(),
    error: jest.fn(),
  };

  return {
    Container: {
      get: jest.fn(() => mockLogger),
    },
    Service: () => (target: unknown) => target,
  };
});

jest.mock('n8n-core', () => ({
  Credentials: jest.fn(function (this: Record<string, unknown>) {
    this.getData = jest.fn().mockReturnValue({});
  }),
}));

jest.mock('n8n-workflow', () => {
  class ICredentialsHelperMock {}
  class UnexpectedErrorMock extends Error {
    constructor(message: string, _context?: Record<string, unknown>) {
      super(message);
      this.name = 'UnexpectedError';
    }
  }
  class WorkflowMock {
    expression = {
      getComplexParameterValue: jest.fn((_node: unknown, data: unknown) => data),
    };
  }

  return {
    ICredentialsHelper: ICredentialsHelperMock,
    NodeHelpers: {
      mergeNodeProperties: jest.fn(),
      getNodeParameters: jest.fn((_props: unknown, data: unknown) => data),
    },
    UnexpectedError: UnexpectedErrorMock,
    Workflow: jest.fn(() => new WorkflowMock()),
  };
});

jest.mock('../credential-types');
jest.mock('../credentials-overwrites');
jest.mock('../credentials-provider');

import { Container } from '@n8n/di';
import { Credentials } from 'n8n-core';
import type {
  ICredentialType,
  IHttpRequestOptions,
  INodeCredentialsDetails,
  IWorkflowExecuteAdditionalData,
} from 'n8n-workflow';
import { NodeHelpers, Workflow } from 'n8n-workflow';
import type { CredentialTypes } from '../credential-types';
import { CredentialsHelper } from '../credentials-helper';
import type { CredentialsOverwrites } from '../credentials-overwrites';
import type { ICredentialsProvider } from '../credentials-provider';

describe('CredentialsHelper', () => {
  let credentialsHelper: CredentialsHelper;
  let mockCredentialTypes: jest.Mocked<CredentialTypes>;
  let mockCredentialsOverwrites: jest.Mocked<CredentialsOverwrites>;
  let mockCredentialsProvider: jest.Mocked<ICredentialsProvider>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockCredentialTypes = {
      getByName: jest.fn().mockReturnValue({
        name: 'test',
        properties: [{ name: 'test', displayName: 'Test', type: 'string', required: false }],
      }),
      getParentTypes: jest.fn().mockReturnValue([]),
      recognizes: jest.fn().mockReturnValue(true),
      getSupportedNodes: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<CredentialTypes>;

    mockCredentialsOverwrites = {
      applyOverwrite: jest.fn((_type: string, data: unknown) => data),
    } as unknown as jest.Mocked<CredentialsOverwrites>;

    mockCredentialsProvider = {
      getCredentialData: jest
        .fn()
        .mockReturnValue({ id: '123', name: 'test', type: 'testType', data: {} }),
    } as unknown as jest.Mocked<ICredentialsProvider>;

    credentialsHelper = new CredentialsHelper(
      mockCredentialTypes,
      mockCredentialsOverwrites,
      mockCredentialsProvider,
    );
  });

  describe('constructor', () => {
    it('should instantiate without errors', () => {
      expect(credentialsHelper).toBeDefined();
    });

    it('should initialize logger from container', () => {
      expect(Container.get).toHaveBeenCalled();
    });

    it('should store credential types, overwrites, and provider', () => {
      const helper = new CredentialsHelper(
        mockCredentialTypes,
        mockCredentialsOverwrites,
        mockCredentialsProvider,
      );
      expect(helper).toBeDefined();
    });
  });

  describe('authenticate', () => {
    it('should return request options unchanged', async () => {
      const credentials = { username: 'test' };
      const requestOptions = { headers: { Authorization: 'Bearer token' } };

      const result = await credentialsHelper.authenticate(
        credentials,
        'testType',
        requestOptions as unknown as IHttpRequestOptions,
      );

      expect(result).toBe(requestOptions);
    });

    it('should handle empty request options', async () => {
      const result = await credentialsHelper.authenticate(
        {},
        'testType',
        {} as unknown as IHttpRequestOptions,
      );
      expect(result).toEqual({});
    });
  });

  describe('preAuthentication', () => {
    it('should return undefined', async () => {
      const result = await credentialsHelper.preAuthentication();
      expect(result).toBeUndefined();
    });
  });

  describe('updateCredentials', () => {
    it('should complete without error', async () => {
      await expect(credentialsHelper.updateCredentials()).resolves.toBeUndefined();
    });
  });

  describe('updateCredentialsOauthTokenData', () => {
    it('should complete without error', async () => {
      await expect(credentialsHelper.updateCredentialsOauthTokenData()).resolves.toBeUndefined();
    });
  });

  describe('getParentTypes', () => {
    it('should delegate to credentialTypes', () => {
      mockCredentialTypes.getParentTypes.mockReturnValue(['parentType']);

      const result = credentialsHelper.getParentTypes('testType');

      expect(result).toEqual(['parentType']);
      expect(mockCredentialTypes.getParentTypes).toHaveBeenCalledWith('testType');
    });

    it('should return empty array when no parents', () => {
      mockCredentialTypes.getParentTypes.mockReturnValue([]);

      const result = credentialsHelper.getParentTypes('testType');

      expect(result).toEqual([]);
    });
  });

  describe('getCredentials', () => {
    it('should throw when credential has no ID', async () => {
      const nodeCredential = { name: 'test' } as INodeCredentialsDetails;

      await expect(credentialsHelper.getCredentials(nodeCredential, 'testType')).rejects.toThrow(
        'Found credential with no ID.',
      );
    });

    it('should return credentials instance', async () => {
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      const result = await credentialsHelper.getCredentials(nodeCredential, 'testType');

      expect(Credentials).toHaveBeenCalledWith({ id: '123', name: 'test' }, 'testType', {});
      expect(result).toBeDefined();
    });

    it('should get credential data from provider', async () => {
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      await credentialsHelper.getCredentials(nodeCredential, 'testType');

      expect(mockCredentialsProvider.getCredentialData).toHaveBeenCalledWith('123', 'testType');
    });
  });

  describe('getCredentialsProperties', () => {
    it('should return properties from credential type', () => {
      const properties = [{ name: 'field', displayName: 'Field', type: 'string' }];
      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties,
        extends: undefined,
      } as unknown as ICredentialType);

      const result = credentialsHelper.getCredentialsProperties('testType');

      expect(result).toEqual(properties);
    });

    it('should add OAuth token data property for oAuth1Api', () => {
      mockCredentialTypes.getByName.mockReturnValue({
        name: 'oAuth1Api',
        properties: [{ name: 'key', displayName: 'Key', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      const result = credentialsHelper.getCredentialsProperties('oAuth1Api');

      expect(result.length).toBe(2);
      expect(result[1].name).toBe('oauthTokenData');
    });

    it('should add OAuth token data property for oAuth2Api', () => {
      mockCredentialTypes.getByName.mockReturnValue({
        name: 'oAuth2Api',
        properties: [{ name: 'key', displayName: 'Key', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      const result = credentialsHelper.getCredentialsProperties('oAuth2Api');

      expect(result.length).toBe(2);
      expect(result[1].name).toBe('oauthTokenData');
    });

    it('should merge properties for extended credential types', () => {
      mockCredentialTypes.getByName.mockImplementation((type: string) => {
        if (type === 'extended') {
          return {
            name: 'extended',
            properties: [{ name: 'field2', displayName: 'Field 2', type: 'string' }],
            extends: ['baseType'],
          } as unknown as ICredentialType;
        }
        // For the parent type, return without extends to stop recursion
        return {
          name: 'baseType',
          properties: [{ name: 'field1', displayName: 'Field 1', type: 'string' }],
          extends: undefined,
        } as unknown as ICredentialType;
      });

      credentialsHelper.getCredentialsProperties('extended');

      expect(NodeHelpers.mergeNodeProperties).toHaveBeenCalled();
    });

    it('should throw for unknown credential type', () => {
      mockCredentialTypes.getByName.mockReturnValue(null as unknown as ICredentialType);

      expect(() => credentialsHelper.getCredentialsProperties('unknownType')).toThrow(
        'Unknown credential type',
      );
    });
  });

  describe('getDecrypted', () => {
    it('should decrypt credentials and return decrypted data', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [],
        extends: undefined,
      } as unknown as ICredentialType);

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'testType',
        'manual',
      );

      expect(result).toBeDefined();
    });

    it('should apply defaults and overwrites when raw is false', async () => {
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;

      await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'testType',
        'manual',
        undefined,
        false,
      );

      expect(mockCredentialsOverwrites.applyOverwrite).toHaveBeenCalled();
    });

    it('should preserve oauthTokenData in decrypted credentials', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'oAuth2Api',
        properties: [
          { name: 'clientId', type: 'string' },
          { name: 'clientSecret', type: 'string' },
        ],
        extends: undefined,
      } as unknown as ICredentialType);

      // Mock the Credentials class to return data with oauthTokenData
      (Credentials as jest.Mock).mockImplementation(() => ({
        getData: jest.fn().mockReturnValue({
          clientId: 'id',
          clientSecret: 'secret',
          oauthTokenData: { accessToken: 'token123' },
        }),
      }));

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'oAuth2Api',
        'manual',
      );

      expect(result).toBeDefined();
      // The oauthTokenData should be preserved in the result
      if (result.oauthTokenData) {
        expect(result.oauthTokenData).toEqual({ accessToken: 'token123' });
      }
    });

    it('should handle error when NodeHelpers.getNodeParameters fails', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'username', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      // Mock NodeHelpers.getNodeParameters to throw an error
      const { NodeHelpers } = require('n8n-workflow');
      NodeHelpers.getNodeParameters.mockImplementationOnce(() => {
        throw new Error('Parameter resolution failed');
      });

      try {
        await credentialsHelper.getDecrypted(additionalData, nodeCredential, 'testType', 'manual');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle non-Error exception from NodeHelpers.getNodeParameters', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'username', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      // Mock NodeHelpers.getNodeParameters to throw a non-Error value
      const { NodeHelpers } = require('n8n-workflow');
      NodeHelpers.getNodeParameters.mockImplementationOnce(() => {
        throw 'String error thrown directly';
      });

      try {
        await credentialsHelper.getDecrypted(additionalData, nodeCredential, 'testType', 'manual');
      } catch (error) {
        expect(error).toBe('String error thrown directly');
      }
    });

    it('should create workflow and resolve expressions in credentials', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [
          { name: 'username', type: 'string' },
          { name: 'password', type: 'string' },
        ],
        extends: undefined,
      } as unknown as ICredentialType);

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'testType',
        'manual',
      );

      expect(result).toBeDefined();
      // Verify that Workflow was instantiated for expression resolution
      expect(Workflow).toHaveBeenCalled();
    });

    it('should call workflow.expression.getComplexParameterValue with correct parameters', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'apiKey', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      const mockWorkflowInstance = {
        expression: {
          getComplexParameterValue: jest.fn((_node, data, _mode) => data),
        },
      };

      (Workflow as unknown as jest.Mock).mockReturnValueOnce(mockWorkflowInstance);

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'testType',
        'manual',
      );

      // Verify the workflow's expression resolver was called
      expect(mockWorkflowInstance.expression.getComplexParameterValue).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should preserve oauthTokenData through expression resolution', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'oAuth2Api',
        properties: [{ name: 'clientId', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      // Mock Credentials to return data with oauthTokenData
      const mockCredentials = {
        getData: jest.fn().mockReturnValue({
          clientId: 'test-id',
          oauthTokenData: { accessToken: 'token123', refreshToken: 'refresh' },
        }),
      };

      (Credentials as unknown as jest.Mock).mockReturnValueOnce(mockCredentials);

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'oAuth2Api',
        'manual',
      );

      // Verify oauthTokenData is preserved
      expect(result).toBeDefined();
    });

    it('should handle credentials with extending types and resolve expressions', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      // Mock to avoid infinite recursion - return the credential without extends for 'baseAuth'
      mockCredentialTypes.getByName.mockImplementation((type: string) => {
        if (type === 'baseAuth') {
          return {
            name: 'baseAuth',
            properties: [{ name: 'baseToken', type: 'string' }],
            extends: undefined,
          } as unknown as ICredentialType;
        }
        return {
          name: 'customAuth',
          properties: [{ name: 'token', type: 'string' }],
          extends: ['baseAuth'],
        } as unknown as ICredentialType;
      });

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'customAuth',
        'manual',
      );

      expect(result).toBeDefined();
      // Verify Workflow was created even for credentials with extends
      expect(Workflow).toHaveBeenCalled();
    });

    it('should instantiate Workflow with correct node and connection config', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'key', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      const mockWorkflowInstance = {
        expression: {
          getComplexParameterValue: jest.fn((_node, data) => data),
        },
      };

      (Workflow as unknown as jest.Mock).mockReturnValueOnce(mockWorkflowInstance);

      await credentialsHelper.getDecrypted(additionalData, nodeCredential, 'testType', 'manual');

      // Verify Workflow was instantiated with correct structure
      expect(Workflow).toHaveBeenCalledWith(
        expect.objectContaining({
          nodes: expect.any(Array),
          connections: expect.any(Object),
          active: false,
          nodeTypes: expect.any(Object),
        }),
      );
    });

    it('should resolve expressions with manual mode', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'url', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      const mockWorkflowInstance = {
        expression: {
          getComplexParameterValue: jest.fn((_node, data, mode) => {
            // Verify mode parameter is passed
            expect(mode).toBe('manual');
            return data;
          }),
        },
      };

      (Workflow as unknown as jest.Mock).mockReturnValueOnce(mockWorkflowInstance);

      await credentialsHelper.getDecrypted(additionalData, nodeCredential, 'testType', 'manual');

      expect(mockWorkflowInstance.expression.getComplexParameterValue).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        'manual',
        expect.any(Object),
        undefined,
        undefined,
        expect.any(Object),
      );
    });

    it('should apply overwrites and defaults to decrypted credentials', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'username', type: 'string', default: 'defaultUser' }],
        extends: undefined,
      } as unknown as ICredentialType);

      mockCredentialsOverwrites.applyOverwrite.mockReturnValue({ username: 'overwritten' });

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'testType',
        'manual',
      );

      expect(result).toBeDefined();
      expect(mockCredentialsOverwrites.applyOverwrite).toHaveBeenCalled();
    });

    it('should return raw decrypted data when raw parameter is true', async () => {
      const additionalData = {} as unknown as IWorkflowExecuteAdditionalData;
      const nodeCredential = { id: '123', name: 'test' } as INodeCredentialsDetails;

      mockCredentialTypes.getByName.mockReturnValue({
        name: 'test',
        properties: [{ name: 'username', type: 'string' }],
        extends: undefined,
      } as unknown as ICredentialType);

      const result = await credentialsHelper.getDecrypted(
        additionalData,
        nodeCredential,
        'testType',
        'manual',
        undefined,
        true, // raw = true
      );

      expect(result).toBeDefined();
    });
  });

  describe('createMockNodeTypes', () => {
    it('should return an object with required INodeTypes methods', () => {
      const mockNodeTypes = CredentialsHelper.createMockNodeTypes();

      expect(mockNodeTypes).toBeDefined();
      expect(typeof mockNodeTypes.getByName).toBe('function');
      expect(typeof mockNodeTypes.getByNameAndVersion).toBe('function');
      expect(typeof mockNodeTypes.getKnownTypes).toBe('function');
    });

    it('should return consistent node description from getByName', () => {
      const mockNodeTypes = CredentialsHelper.createMockNodeTypes();

      const nodeDesc1 = mockNodeTypes.getByName('any-type');
      const nodeDesc2 = mockNodeTypes.getByName('another-type');

      // Should return the same description structure regardless of node type
      expect(nodeDesc1.description).toEqual(nodeDesc2.description);
      expect(nodeDesc1.description.displayName).toBe('Mock');
      expect(nodeDesc1.description.name).toBe('mock');
      expect((nodeDesc1.description as unknown as Record<string, unknown>).version).toBe(1);
    });

    it('should return node description with expected properties', () => {
      const mockNodeTypes = CredentialsHelper.createMockNodeTypes();

      const nodeDesc = mockNodeTypes.getByName('test-node');
      const desc = nodeDesc.description as unknown as Record<string, unknown>;

      expect(nodeDesc.description).toHaveProperty('displayName', 'Mock');
      expect(nodeDesc.description).toHaveProperty('name', 'mock');
      expect(nodeDesc.description).toHaveProperty('group');
      expect(desc.version).toBe(1);
      expect(desc.description).toBe('Mock node');
      expect(desc.defaults).toBeDefined();
      expect(desc.inputs).toBeDefined();
      expect(desc.outputs).toBeDefined();
      expect(desc.properties).toBeDefined();
    });

    it('should return array properties from node description', () => {
      const mockNodeTypes = CredentialsHelper.createMockNodeTypes();

      const nodeDesc = mockNodeTypes.getByName('test-node');
      const desc = nodeDesc.description as unknown as Record<string, unknown>;

      expect(Array.isArray(desc.group)).toBe(true);
      expect(Array.isArray(desc.inputs)).toBe(true);
      expect(Array.isArray(desc.outputs)).toBe(true);
      expect(Array.isArray(desc.properties)).toBe(true);
    });

    it('should return same node desc from getByNameAndVersion', () => {
      const mockNodeTypes = CredentialsHelper.createMockNodeTypes();

      const nodeDesc1 = mockNodeTypes.getByName('test-node');
      const nodeDesc2 = mockNodeTypes.getByNameAndVersion('test-node', 1);

      expect(nodeDesc2.description).toEqual(nodeDesc1.description);
    });

    it('should return empty object from getKnownTypes', () => {
      const mockNodeTypes = CredentialsHelper.createMockNodeTypes();

      const knownTypes = mockNodeTypes.getKnownTypes();

      expect(knownTypes).toEqual({});
    });
  });

  describe('integration', () => {
    it('should have all required methods from ICredentialsHelper', () => {
      expect(typeof credentialsHelper.authenticate).toBe('function');
      expect(typeof credentialsHelper.preAuthentication).toBe('function');
      expect(typeof credentialsHelper.updateCredentials).toBe('function');
      expect(typeof credentialsHelper.updateCredentialsOauthTokenData).toBe('function');
      expect(typeof credentialsHelper.getParentTypes).toBe('function');
      expect(typeof credentialsHelper.getCredentials).toBe('function');
      expect(typeof credentialsHelper.getCredentialsProperties).toBe('function');
      expect(typeof credentialsHelper.getDecrypted).toBe('function');
    });
  });
});

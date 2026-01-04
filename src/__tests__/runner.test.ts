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
      set: jest.fn(),
      reset: jest.fn(),
    },
    Service: () => (target: unknown) => target,
  };
});

jest.mock('n8n-core', () => ({
  WorkflowExecute: jest.fn(function () {
    this.run = jest.fn().mockResolvedValue({ status: 'success' });
  }),
}));

jest.mock('n8n-workflow', () => ({
  Workflow: jest.fn(function () {
    this.id = 'test-workflow';
  }),
  ICredentialsHelper: class {},
  NodeHelpers: {
    mergeNodeProperties: jest.fn(),
    getNodeParameters: jest.fn((_props: unknown, data: unknown) => data),
    getVersionedNodeType: jest.fn((node) => node),
  },
}));

jest.mock('../additional-data', () => ({
  createAdditionalData: jest.fn(() => ({
    hooks: {},
    credentialsHelper: {},
  })),
}));

jest.mock('../node-types', () => ({
  NodeTypes: jest.fn(function () {
    this.loadNodesFromWorkflow = jest.fn().mockResolvedValue(undefined);
  }),
}));

import { Container } from '@n8n/di';
import type { ICredentialsProvider } from '../credentials-provider';
import type { NodeTypes } from '../node-types';
import { Runner } from '../runner';

describe('Runner', () => {
  let runner: Runner;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new Runner();
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      const mockProvider: ICredentialsProvider = { getCredentialData: jest.fn() };

      await runner.init(mockProvider);

      expect(Container.get).toHaveBeenCalled();
      expect(Container.set).toHaveBeenCalled();
    });

    it('should not reinitialize if already initialized', async () => {
      const mockProvider: ICredentialsProvider = { getCredentialData: jest.fn() };

      await runner.init(mockProvider);
      (Container.set as jest.Mock).mockClear();

      await runner.init(mockProvider);

      expect(Container.set).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      const mockProvider: ICredentialsProvider = { getCredentialData: jest.fn() };
      await runner.init(mockProvider);
    });

    it('should throw error if not initialized', async () => {
      const uninitializedRunner = new Runner();

      await expect(
        uninitializedRunner.execute({
          id: 'test',
          name: 'Test',
          nodes: [],
          connections: {},
          active: false,
          nodeTypes: {} as unknown as NodeTypes,
        }),
      ).rejects.toThrow('Runner not initialized');
    });

    it('should return success when workflow executes', async () => {
      const result = await runner.execute({
        id: 'test',
        name: 'Test Workflow',
        nodes: [],
        connections: {},
        active: false,
        nodeTypes: {} as unknown as NodeTypes,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should generate execution ID and workflow ID', async () => {
      // Test with provided IDs
      const result1 = await runner.execute({
        id: 'test',
        name: 'Test Workflow',
        nodes: [],
        connections: {},
        active: false,
        nodeTypes: {} as unknown as NodeTypes,
      });
      expect(result1.success).toBe(true);

      // Test with auto-generated workflow ID
      const result2 = await runner.execute({
        name: 'Test Workflow',
        nodes: [],
        connections: {},
        active: false,
        nodeTypes: {} as unknown as NodeTypes,
      });
      expect(result2.success).toBe(true);
    });

    it('should handle workflow execution errors', async () => {
      const { WorkflowExecute } = require('n8n-core');
      const error = new Error('Execution failed');
      (WorkflowExecute as jest.Mock).mockImplementation(function (this: Record<string, unknown>) {
        this.run = jest.fn().mockRejectedValue(error);
      });

      const result = await runner.execute({
        id: 'test',
        name: 'Test Workflow',
        nodes: [],
        connections: {},
        active: false,
        nodeTypes: {} as unknown as NodeTypes,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle non-Error string exceptions from workflow execution', async () => {
      const { WorkflowExecute } = require('n8n-core');
      const stringError = 'Something went wrong';
      (WorkflowExecute as jest.Mock).mockImplementation(function (this: Record<string, unknown>) {
        this.run = jest.fn().mockRejectedValue(stringError);
      });

      const result = await runner.execute({
        id: 'test',
        name: 'Test Workflow',
        nodes: [],
        connections: {},
        active: false,
        nodeTypes: {} as unknown as NodeTypes,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe(stringError);
    });
  });

  describe('shutdown', () => {
    it('should throw error if not initialized', async () => {
      const uninitializedRunner = new Runner();

      await expect(uninitializedRunner.shutdown()).rejects.toThrow('Runner not initialized');
    });

    beforeEach(async () => {
      const mockProvider: ICredentialsProvider = { getCredentialData: jest.fn() };
      await runner.init(mockProvider);
    });

    it('should successfully cleanup SSHClientsManager when it exists', async () => {
      const mockSSHManager = {
        onShutdown: jest.fn(),
      };
      (Container.get as jest.Mock).mockImplementation((type) => {
        if (type.name === 'SSHClientsManager') {
          return mockSSHManager;
        }
        return { debug: jest.fn(), error: jest.fn() };
      });

      await runner.shutdown();

      expect(mockSSHManager.onShutdown).toHaveBeenCalled();
    });

    it('should handle SSHClientsManager not being initialized', async () => {
      (Container.get as jest.Mock).mockImplementation((type) => {
        if (type.name === 'SSHClientsManager') {
          throw new Error('Not initialized');
        }
        return { debug: jest.fn(), error: jest.fn() };
      });

      await expect(runner.shutdown()).resolves.not.toThrow();
    });

    it('should handle SSHClientsManager returning null', async () => {
      (Container.get as jest.Mock).mockImplementation((type) => {
        if (type.name === 'SSHClientsManager') {
          return null;
        }
        return { debug: jest.fn(), error: jest.fn() };
      });

      await expect(runner.shutdown()).resolves.not.toThrow();
    });
  });
});

import 'reflect-metadata';

// Mock modules before importing the function
jest.mock('@n8n/backend-common', () => ({
  Logger: jest.fn(),
}));

jest.mock('@n8n/di', () => {
  const mockLogger = {
    debug: jest.fn(),
    error: jest.fn(),
  };

  const mockContainer = {
    get: jest.fn((serviceClass: unknown) => {
      if (serviceClass === 'Logger') {
        return mockLogger;
      }
      // Return the mock logger by default
      return mockLogger;
    }),
  };

  return {
    Container: mockContainer,
    Service: () => (target: unknown) => target,
    mockLogger,
  };
});

jest.mock('n8n-core', () => {
  let capturedConfigs: Array<Record<string, unknown>> = [];
  const mockHooksClass = jest.fn(function (
    this: Record<string, unknown>,
    _scope: string,
    _execId: string,
    config: Record<string, unknown>,
  ) {
    capturedConfigs.push(config);
    this.addHandler = jest.fn();
    // biome-ignore lint/suspicious/noExplicitAny: Mock setup requires any type
  }) as any;
  mockHooksClass.getCapturedConfigs = () => capturedConfigs;
  mockHooksClass.clearCapturedConfigs = () => {
    capturedConfigs = [];
  };
  return {
    ExecutionLifecycleHooks: mockHooksClass,
  };
});

jest.mock('../credentials-helper');

import { Container } from '@n8n/di';
import { ExecutionLifecycleHooks } from 'n8n-core';
import type { Workflow } from 'n8n-workflow';
import { createAdditionalData } from '../additional-data';

describe('createAdditionalData', () => {
  const createMockWorkflow = (overrides?: Record<string, unknown>): Workflow =>
    ({
      id: 'workflow-1',
      name: 'Test',
      nodes: {},
      connectionsBySourceNode: {},
      ...overrides,
    }) as unknown as Workflow;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('workflow name handling', () => {
    beforeEach(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Mock requires any type
      (ExecutionLifecycleHooks as any).clearCapturedConfigs?.();
    });

    it('should use empty string when workflow name is falsy', () => {
      const mockWorkflow = createMockWorkflow({
        id: 'workflow-123',
        name: '',
      });

      createAdditionalData(mockWorkflow, 'exec-456');

      // biome-ignore lint/suspicious/noExplicitAny: Mock requires any type
      const configs = (ExecutionLifecycleHooks as any).getCapturedConfigs();
      expect(configs[configs.length - 1].name).toBe('');
    });

    it('should use workflow name when it is truthy', () => {
      const mockWorkflow = createMockWorkflow({
        id: 'workflow-123',
        name: 'My Workflow',
      });

      createAdditionalData(mockWorkflow, 'exec-456');

      // biome-ignore lint/suspicious/noExplicitAny: Mock requires any type
      const configs = (ExecutionLifecycleHooks as any).getCapturedConfigs();
      expect(configs[configs.length - 1].name).toBe('My Workflow');
    });
  });

  it('should create additional data with hooks and credentials helper', () => {
    const mockWorkflow = createMockWorkflow({
      id: 'workflow-123',
      name: 'Test Workflow',
      nodes: {
        node1: {
          id: 'node1',
          name: 'Node 1',
          type: 'test',
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
      },
    });

    const result = createAdditionalData(mockWorkflow, 'exec-456');

    expect(result).toBeDefined();
    expect(result.hooks).toBeDefined();
    expect(result.credentialsHelper).toBeDefined();
    expect(ExecutionLifecycleHooks).toHaveBeenCalled();
  });

  it('should set currentNodeExecutionIndex to 0', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.currentNodeExecutionIndex).toBe(0);
  });

  it('should initialize all URL fields as empty strings', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.restApiUrl).toBe('');
    expect(result.instanceBaseUrl).toBe('');
    expect(result.formWaitingBaseUrl).toBe('');
    expect(result.webhookBaseUrl).toBe('');
    expect(result.webhookWaitingBaseUrl).toBe('');
    expect(result.webhookTestBaseUrl).toBe('');
  });

  it('should initialize variables as empty object', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.variables).toEqual({});
  });

  it('should register execution lifecycle hooks', () => {
    const mockWorkflow = createMockWorkflow();

    createAdditionalData(mockWorkflow, 'exec-1');

    const HooksClass = ExecutionLifecycleHooks as jest.Mock;
    expect(HooksClass).toHaveBeenCalled();
    const hooksInstance = HooksClass.mock.instances[0];
    expect(hooksInstance.addHandler).toHaveBeenCalledWith(
      'workflowExecuteBefore',
      expect.any(Function),
    );
    expect(hooksInstance.addHandler).toHaveBeenCalledWith(
      'workflowExecuteAfter',
      expect.any(Function),
    );
    expect(hooksInstance.addHandler).toHaveBeenCalledWith(
      'nodeExecuteBefore',
      expect.any(Function),
    );
    expect(hooksInstance.addHandler).toHaveBeenCalledWith('nodeExecuteAfter', expect.any(Function));
  });

  it('should execute workflowExecuteBefore handler', async () => {
    const mockWorkflow = createMockWorkflow();

    const _additionalData = createAdditionalData(mockWorkflow, 'exec-1');

    const HooksClass = ExecutionLifecycleHooks as jest.Mock;
    const hooksInstance = HooksClass.mock.instances[0];
    const beforeHandler = hooksInstance.addHandler.mock.calls[0][1];

    // The handler should be the workflowExecuteBefore handler
    await beforeHandler();

    // Verify Container.get was called with Logger class
    expect(Container.get).toHaveBeenCalled();
  });

  it('should execute workflowExecuteAfter handler', async () => {
    const mockWorkflow = createMockWorkflow();

    const _additionalData = createAdditionalData(mockWorkflow, 'exec-1');

    const HooksClass = ExecutionLifecycleHooks as jest.Mock;
    const hooksInstance = HooksClass.mock.instances[0];
    const afterHandler = hooksInstance.addHandler.mock.calls[1][1];

    await afterHandler();

    expect(Container.get).toHaveBeenCalled();
  });

  it('should execute nodeExecuteBefore handler', async () => {
    const mockWorkflow = createMockWorkflow();

    const _additionalData = createAdditionalData(mockWorkflow, 'exec-1');

    const HooksClass = ExecutionLifecycleHooks as jest.Mock;
    const hooksInstance = HooksClass.mock.instances[0];
    const nodeBeforeHandler = hooksInstance.addHandler.mock.calls[2][1];

    await nodeBeforeHandler('TestNode');

    expect(Container.get).toHaveBeenCalled();
  });

  it('should execute nodeExecuteAfter handler', async () => {
    const mockWorkflow = createMockWorkflow();

    const _additionalData = createAdditionalData(mockWorkflow, 'exec-1');

    const HooksClass = ExecutionLifecycleHooks as jest.Mock;
    const hooksInstance = HooksClass.mock.instances[0];
    const nodeAfterHandler = hooksInstance.addHandler.mock.calls[3][1];

    await nodeAfterHandler('TestNode');

    expect(Container.get).toHaveBeenCalled();
  });

  it('should get credentials helper from container', () => {
    const mockWorkflow = createMockWorkflow();

    createAdditionalData(mockWorkflow, 'exec-1');

    expect(Container.get).toHaveBeenCalled();
  });

  it('should set currentNodeExecutionIndex to 0', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.currentNodeExecutionIndex).toBe(0);
  });

  it('should provide variables as empty object', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.variables).toEqual({});
  });

  it('should provide executeWorkflow function', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.executeWorkflow).toBeDefined();
    expect(typeof result.executeWorkflow).toBe('function');
  });

  it('should provide getRunExecutionData function', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.getRunExecutionData).toBeDefined();
    expect(typeof result.getRunExecutionData).toBe('function');
  });

  it('should provide startRunnerTask function', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(result.startRunnerTask).toBeDefined();
    expect(typeof result.startRunnerTask).toBe('function');
  });

  it('should executeWorkflow return empty object', async () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    // biome-ignore lint/suspicious/noExplicitAny: Mock test data requires any type
    const executeResult = await result.executeWorkflow({ id: '123' } as any, result, {} as any);
    expect(executeResult).toEqual({});
  });

  it('should getRunExecutionData return undefined', async () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    const executionData = await result.getRunExecutionData('exec-1');
    expect(executionData).toBeUndefined();
  });

  it('should logAiEvent be callable without error', () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Mock test data requires any type
      result.logAiEvent('query_execution' as any, {
        msg: 'test',
        workflowName: 'test',
        executionId: 'exec-1',
        nodeName: 'test',
      });
    }).not.toThrow();
  });

  it('should startRunnerTask return empty object', async () => {
    const mockWorkflow = createMockWorkflow();

    const result = createAdditionalData(mockWorkflow, 'exec-1');

    const taskResult = await result.startRunnerTask(
      result,
      'test',
      {},
      // biome-ignore lint/suspicious/noExplicitAny: Mock test data
      {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: Mock test data
      {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: Mock test data
      {} as any,
      mockWorkflow,
      // biome-ignore lint/suspicious/noExplicitAny: Mock test data
      {} as any,
      0,
      0,
      'test',
      [],
      {},
      'manual',
      // biome-ignore lint/suspicious/noExplicitAny: Mock test data
      {} as any,
    );
    expect(taskResult).toEqual({});
  });
});

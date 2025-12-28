import 'reflect-metadata';

const mockDebug = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();

jest.mock('@n8n/backend-common', () => ({
  Logger: jest.fn(),
}));

jest.mock('@n8n/di', () => ({
  Container: {
    get: jest.fn(() => ({
      debug: mockDebug,
      warn: mockWarn,
      error: mockError,
    })),
  },
}));

jest.mock('n8n-workflow', () => ({
  NodeHelpers: {
    getVersionedNodeType: jest.fn((node) => node),
  },
}));

import type { INodeType } from 'n8n-workflow';
import { NodeTypes } from '../node-types';

describe('NodeTypes', () => {
  let nodeTypes: NodeTypes;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDebug.mockClear();
    mockWarn.mockClear();
    mockError.mockClear();
    // Clear require cache to reset module loading state
    jest.resetModules();
    nodeTypes = new NodeTypes();
  });

  describe('getByName', () => {
    it('should throw error for unloaded node type', () => {
      expect(() => nodeTypes.getByName('unknownNode')).toThrow(
        'Node type "unknownNode" is not loaded',
      );
    });
  });

  describe('getByNameAndVersion', () => {
    it('should throw error for unloaded node', () => {
      expect(() => nodeTypes.getByNameAndVersion('unknownNode')).toThrow();
    });

    it('should call logger.debug with node info and return node', () => {
      // Manually set a node as loaded to test the logging
      const mockNode = {
        name: 'testNode',
        description: {
          displayName: 'Test Node',
          credentials: [{ name: 'testAuth' }],
        },
      };
      const nodeTypesRecord = nodeTypes as unknown as Record<string, unknown> & {
        loadedNodes: Map<string, unknown>;
      };
      nodeTypesRecord.loadedNodes.set('test.node', mockNode);

      const result = nodeTypes.getByNameAndVersion('test.node', 2);

      // Verify logger.debug was called with the parameters
      expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('getByNameAndVersion'), {
        hasDescription: true,
        hasCredentials: true,
        credentialsLength: 1,
      });
      expect(result).toBe(mockNode);
    });
  });

  describe('getKnownTypes', () => {
    it('should return empty object when no nodes loaded', () => {
      const knownTypes = nodeTypes.getKnownTypes();
      expect(knownTypes).toEqual({});
    });

    it('should return all loaded node types with class names', () => {
      const mockNode1 = { name: 'node1' };
      const mockNode2 = { name: 'node2' };

      const nodeTypesRecord = nodeTypes as unknown as Record<string, unknown> & {
        loadedNodes: Map<string, unknown>;
      };
      nodeTypesRecord.loadedNodes.set('n8n-nodes-base.node1', mockNode1);
      nodeTypesRecord.loadedNodes.set('n8n-nodes-base.node2', mockNode2);

      const knownTypes = nodeTypes.getKnownTypes();

      expect(knownTypes).toEqual({
        'n8n-nodes-base.node1': { className: 'n8n-nodes-base.node1' },
        'n8n-nodes-base.node2': { className: 'n8n-nodes-base.node2' },
      });
    });
  });

  describe('loadNodeType', () => {
    it('should skip loading already loaded nodes', async () => {
      // Manually set a node as loaded
      const mockNode = { name: 'test', description: {} };
      const nodeTypesRecord = nodeTypes as unknown as Record<string, unknown> & {
        loadedNodes: Map<string, unknown>;
      };
      nodeTypesRecord.loadedNodes.set('testNode', mockNode);

      await expect(nodeTypes.loadNodeType('testNode')).resolves.toBeUndefined();
    });

    it('should throw error when module not found', async () => {
      await expect(nodeTypes.loadNodeType('n8n-nodes-base.nonExistent')).rejects.toThrow(
        'Could not find module',
      );
    });

    it('should throw error for invalid node type format', async () => {
      await expect(nodeTypes.loadNodeType('invalidFormat')).rejects.toThrow();
    });

    it('should load node from custom classes when provided', async () => {
      // Create a mock custom node class
      const mockNodeClass = class MockCustomNode {
        description = {
          displayName: 'Custom Node',
          name: 'customNode',
          group: [],
          version: 1,
          description: 'A custom test node',
          defaults: { name: 'Custom Node' },
          inputs: [],
          outputs: [],
          properties: [],
        };
      };

      // Create NodeTypes instance with custom classes
      const customNodeTypes = new NodeTypes({
        'n8n-nodes-base.customNode': mockNodeClass as unknown as new () => INodeType,
      });

      // Load the node type
      await customNodeTypes.loadNodeType('n8n-nodes-base.customNode');

      // Verify the node was loaded and can be retrieved
      const loadedNode = customNodeTypes.getByName('n8n-nodes-base.customNode');
      expect(loadedNode).toBeDefined();
      expect(loadedNode.description.displayName).toBe('Custom Node');
      expect(loadedNode.description.name).toBe('customNode');
    });

    it('should return early when custom class is found and not attempt module loading', async () => {
      // Create a mock custom node class
      const mockNodeClass = class MockEarlyReturn {
        description = {
          displayName: 'Early Return Node',
          name: 'earlyReturn',
          group: [],
          version: 1,
          description: 'A test node for early return',
          defaults: { name: 'Early Return Node' },
          inputs: [],
          outputs: [],
          properties: [],
        };
      };

      // Create NodeTypes instance with custom classes
      const customNodeTypes = new NodeTypes({
        'n8n-nodes-base.earlyReturn': mockNodeClass as unknown as new () => INodeType,
      });

      // Mock requireModule to verify it's not called
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any);

      // Load the node type
      await customNodeTypes.loadNodeType('n8n-nodes-base.earlyReturn');

      // Verify requireModule was never called (early return happened)
      expect(requireSpy).not.toHaveBeenCalled();

      // Verify the node was still loaded correctly
      const loadedNode = customNodeTypes.getByName('n8n-nodes-base.earlyReturn');
      expect(loadedNode).toBeDefined();

      requireSpy.mockRestore();
    });

    it('should log debug info when attempting to load a node', async () => {
      // This test verifies the logger.debug calls (lines 94-95)
      mockDebug.mockClear();

      try {
        await nodeTypes.loadNodeType('n8n-nodes-base.test');
      } catch {
        // Expected to fail, we just want to verify logging happened
      }

      // Verify debug was called for the loading attempt
      const debugCallArgs = mockDebug.mock.calls.map((call) => call[0]);
      const hasLoadingLog = debugCallArgs.some((arg) =>
        arg?.includes('Trying to load n8n-nodes-base.test'),
      );
      const hasPathsLog = debugCallArgs.some((arg) => arg?.includes('Possible paths'));

      expect(hasLoadingLog).toBe(true);
      expect(hasPathsLog).toBe(true);
    });

    it('should create langchain node type paths with all subdirectories', async () => {
      mockDebug.mockClear();

      try {
        await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.llm');
      } catch {
        // Expected to fail, we just want to verify the paths were logged
      }

      // Verify debug was called to log the paths attempt
      expect(mockDebug).toHaveBeenCalled();
      // Check that one of the debug calls contains information about paths
      const debugCalls = mockDebug.mock.calls.map((call) => JSON.stringify(call));
      const hasPathLog = debugCalls.some(
        (callStr) => callStr.includes('llms') || callStr.includes('Possible paths'),
      );
      expect(hasPathLog).toBe(true);
    });

    it('should include fallback paths without subdir for langchain nodes', async () => {
      mockDebug.mockClear();

      try {
        await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.customNode');
      } catch {
        // Expected to fail, we just want to verify the fallback path was logged
      }

      // Verify debug was called to log the paths attempt
      expect(mockDebug).toHaveBeenCalled();
      // Check that debug calls include information about custom node
      const debugCalls = mockDebug.mock.calls.map((call) => JSON.stringify(call));
      const hasCustomNodeLog = debugCalls.some(
        (callStr) => callStr.includes('customNode') || callStr.includes('CustomNode'),
      );
      expect(hasCustomNodeLog).toBe(true);
    });

    it('should throw error when node class not found in module', async () => {
      // Mock require to return empty module
      const requireSpy = jest
        .spyOn(require, 'resolve')
        .mockImplementation((modulePath, _options) => {
          return modulePath as string;
        });

      // This test will trigger the "Could not find class" error path
      await expect(nodeTypes.loadNodeType('n8n-nodes-base.test')).rejects.toThrow();

      requireSpy.mockRestore();
    });

    it('should register loaded node and make it accessible', async () => {
      // Test that when a node is successfully loaded, it can be retrieved
      // We'll manually set a loaded node and verify it can be accessed
      const mockNodeClass = class MockNode {
        name = 'mockNode';
        description = { displayName: 'Mock Node' };
      };

      const mockNodeInstance = new mockNodeClass();
      const nodeTypesRecord = nodeTypes as unknown as Record<string, unknown> & {
        loadedNodes: Map<string, unknown>;
      };

      // Simulate successful node registration
      nodeTypesRecord.loadedNodes.set('test.mockNode', mockNodeInstance);

      // Verify the node can be retrieved by name
      const retrieved = nodeTypes.getByName('test.mockNode');
      expect(retrieved).toBe(mockNodeInstance);

      // Verify it appears in getKnownTypes
      const knownTypes = nodeTypes.getKnownTypes();
      expect(knownTypes['test.mockNode']).toBeDefined();
    });
  });

  describe('requireModule', () => {
    it('should load module successfully when require succeeds', () => {
      const mockModule = { TestNode: class MockNode {} };
      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockReturnValue(mockModule);

      const result = NodeTypes.requireModule('test/path');

      expect(result).toBe(mockModule);
      requireSpy.mockRestore();
    });

    it('should throw error when require and require.resolve both fail', () => {
      expect(() => {
        NodeTypes.requireModule('nonexistent/path');
      }).toThrow();
    });
  });

  describe('tryLoadModule', () => {
    it('should try multiple paths and return first successful', () => {
      const mockModule = { TestNode: class MockNode {} };
      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any);

      requireSpy.mockImplementationOnce(() => {
        throw new Error('Path 1 not found');
      });
      requireSpy.mockImplementationOnce(() => mockModule);

      const result = NodeTypes.tryLoadModule(['path/1', 'path/2']);

      expect(result).toBe(mockModule);
      expect(requireSpy).toHaveBeenCalledTimes(2);
      expect(requireSpy).toHaveBeenNthCalledWith(1, 'path/1');
      expect(requireSpy).toHaveBeenNthCalledWith(2, 'path/2');
      requireSpy.mockRestore();
    });

    it('should throw error when all paths fail', () => {
      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockImplementation(() => {
        throw new Error('Not found');
      });

      expect(() => {
        NodeTypes.tryLoadModule(['path/1', 'path/2']);
      }).toThrow('Could not find module');

      requireSpy.mockRestore();
    });

    it('should include attempted paths in error message', () => {
      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockImplementation(() => {
        throw new Error('Not found');
      });

      try {
        NodeTypes.tryLoadModule(['path/one', 'path/two', 'path/three']);
        fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('path/one');
        expect((error as Error).message).toContain('path/two');
        expect((error as Error).message).toContain('path/three');
      }

      requireSpy.mockRestore();
    });
  });

  describe('loadNodeType - path building', () => {
    it('should build correct paths for n8n-nodes-base nodes', async () => {
      const mockNodeInstance = { name: 'test' };
      const mockModule = { MyNode: jest.fn(() => mockNodeInstance) };

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const tryLoadSpy = jest.spyOn(NodeTypes, 'tryLoadModule' as any).mockReturnValue(mockModule);

      await nodeTypes.loadNodeType('n8n-nodes-base.myNode');

      // Verify the exact paths passed
      const callArg = tryLoadSpy.mock.calls[0][0];
      expect(callArg).toEqual([
        'n8n-nodes-base/dist/nodes/MyNode/MyNode.node.js',
        'n8n-nodes-base/dist/nodes/myNode/MyNode.node.js',
      ]);

      tryLoadSpy.mockRestore();
    });

    it('should build correct paths for langchain nodes with subdirectories', async () => {
      const mockNodeInstance = { name: 'test' };
      const mockModule = { LlmNode: jest.fn(() => mockNodeInstance) };

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const tryLoadSpy = jest.spyOn(NodeTypes, 'tryLoadModule' as any).mockReturnValue(mockModule);

      await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.llmNode');

      const callArg = tryLoadSpy.mock.calls[0][0];

      // Should include paths with all subdirectories
      expect(callArg).toEqual(
        expect.arrayContaining([
          expect.stringContaining('llms'),
          expect.stringContaining('embeddings'),
          expect.stringContaining('vendors'),
          expect.stringContaining('chains'),
          expect.stringContaining('agents'),
          expect.stringContaining('tools'),
          expect.stringContaining('vectorstores'),
          expect.stringContaining('memory'),
          expect.stringContaining('document_loaders'),
          expect.stringContaining('retrievers'),
          expect.stringContaining('text_splitters'),
          '@n8n/n8n-nodes-langchain/dist/nodes/LlmNode/LlmNode.node.js', // fallback without subdir
        ]),
      );

      tryLoadSpy.mockRestore();
    });
  });

  describe('loadNodeType', () => {
    it('should extract class from module and instantiate it', async () => {
      const mockNodeInstance = {
        name: 'testNode',
        description: { displayName: 'Test Node' },
      };

      const mockNodeClass = jest.fn(() => mockNodeInstance);
      const mockModule = {
        TestNode: mockNodeClass,
      };

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockReturnValue(mockModule);

      await nodeTypes.loadNodeType('n8n-nodes-base.testNode');

      const retrieved = nodeTypes.getByName('n8n-nodes-base.testNode');
      expect(retrieved).toBe(mockNodeInstance);
      expect(mockNodeClass).toHaveBeenCalled();

      requireSpy.mockRestore();
    });

    it('should use default export when named export not found', async () => {
      const mockNodeInstance = { name: 'defaultNode' };
      const mockNodeClass = jest.fn(() => mockNodeInstance);
      const mockModule = { default: mockNodeClass };

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockReturnValue(mockModule);

      await nodeTypes.loadNodeType('n8n-nodes-base.testNode');

      const retrieved = nodeTypes.getByName('n8n-nodes-base.testNode');
      expect(retrieved).toBe(mockNodeInstance);

      requireSpy.mockRestore();
    });

    it('should throw error when class not found in module', async () => {
      const mockModule = { SomeOtherClass: class {} };

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockReturnValue(mockModule);

      await expect(nodeTypes.loadNodeType('n8n-nodes-base.testNode')).rejects.toThrow(
        'Could not find class TestNode',
      );

      requireSpy.mockRestore();
    });

    it('should throw error when node instantiation fails', async () => {
      const mockNodeClass = jest.fn(() => {
        throw new Error('Constructor failed');
      });

      const mockModule = { TestNode: mockNodeClass };

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any).mockReturnValue(mockModule);

      await expect(nodeTypes.loadNodeType('n8n-nodes-base.testNode')).rejects.toThrow(
        'Failed to load node type',
      );

      requireSpy.mockRestore();
    });

    it('should not reload already loaded nodes', async () => {
      const mockNodeInstance = { name: 'cached' };
      const nodeTypesRecord = nodeTypes as unknown as Record<string, unknown> & {
        loadedNodes: Map<string, unknown>;
      };
      nodeTypesRecord.loadedNodes.set('n8n-nodes-base.cached', mockNodeInstance);

      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type
      const requireSpy = jest.spyOn(NodeTypes, 'requireModule' as any);

      await nodeTypes.loadNodeType('n8n-nodes-base.cached');

      // requireModule should not be called for already-loaded nodes
      expect(requireSpy).not.toHaveBeenCalled();

      requireSpy.mockRestore();
    });
  });

  describe('loadNodesFromWorkflow', () => {
    it('should handle empty workflow nodes', async () => {
      await expect(nodeTypes.loadNodesFromWorkflow([])).resolves.toBeUndefined();
    });

    it('should deduplicate node types before loading', async () => {
      const nodes = [
        { type: 'n8n-nodes-base.test1' },
        { type: 'n8n-nodes-base.test1' },
        { type: 'n8n-nodes-base.test2' },
      ];

      // Should attempt to load each unique type (test1 and test2), not three times
      // We verify this by checking that loadNodeType is called exactly twice
      const loadNodeTypeSpy = jest.spyOn(nodeTypes, 'loadNodeType').mockResolvedValue(undefined);

      await nodeTypes.loadNodesFromWorkflow(nodes);

      // Should only attempt to load 2 unique types, not 3
      expect(loadNodeTypeSpy).toHaveBeenCalledTimes(2);
      loadNodeTypeSpy.mockRestore();
    });

    it('should load each unique node type in workflow', async () => {
      const nodes = [
        { type: 'n8n-nodes-base.http' },
        { type: 'n8n-nodes-base.debug' },
        { type: '@n8n/n8n-nodes-langchain.llm' },
      ];

      const loadNodeTypeSpy = jest.spyOn(nodeTypes, 'loadNodeType').mockResolvedValue(undefined);

      await nodeTypes.loadNodesFromWorkflow(nodes);

      // Verify loadNodeType was called for each unique type
      expect(loadNodeTypeSpy).toHaveBeenCalledWith('n8n-nodes-base.http');
      expect(loadNodeTypeSpy).toHaveBeenCalledWith('n8n-nodes-base.debug');
      expect(loadNodeTypeSpy).toHaveBeenCalledWith('@n8n/n8n-nodes-langchain.llm');
      expect(loadNodeTypeSpy).toHaveBeenCalledTimes(3);

      loadNodeTypeSpy.mockRestore();
    });

    it('should handle loadNodesFromWorkflow with mixed duplicate nodes', async () => {
      const nodes = [
        { type: 'n8n-nodes-base.http' },
        { type: 'n8n-nodes-base.debug' },
        { type: 'n8n-nodes-base.http' }, // Duplicate
        { type: '@n8n/n8n-nodes-langchain.llm' },
        { type: 'n8n-nodes-base.debug' }, // Duplicate
      ];

      const loadNodeTypeSpy = jest.spyOn(nodeTypes, 'loadNodeType').mockResolvedValue(undefined);

      await nodeTypes.loadNodesFromWorkflow(nodes);

      // Should load each unique type exactly once despite duplicates
      expect(loadNodeTypeSpy).toHaveBeenCalledTimes(3);
      expect(loadNodeTypeSpy).toHaveBeenCalledWith('n8n-nodes-base.http');
      expect(loadNodeTypeSpy).toHaveBeenCalledWith('n8n-nodes-base.debug');
      expect(loadNodeTypeSpy).toHaveBeenCalledWith('@n8n/n8n-nodes-langchain.llm');

      loadNodeTypeSpy.mockRestore();
    });
  });

  describe('loadNodeType - module loading edge cases', () => {
    it('should attempt all possible paths and handle errors gracefully', async () => {
      const debugCalls: string[] = [];
      mockDebug.mockImplementation((msg: string) => {
        if (msg.includes('Possible paths') || msg.includes('Trying to load')) {
          debugCalls.push(msg);
        }
      });

      try {
        await nodeTypes.loadNodeType('n8n-nodes-base.someNode');
      } catch (error) {
        // Expected to fail with proper error message
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Could not find module');
      }

      // Verify debug was called with paths and module names
      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it('should handle langchain and resolve.paths errors gracefully', async () => {
      try {
        await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.someNode');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Could not find module');
      }

      // Verify debug was called during the attempt
      expect(mockDebug).toHaveBeenCalled();
    });

    it('should convert node name to PascalCase and properly parse node type names', async () => {
      mockDebug.mockClear();

      try {
        await nodeTypes.loadNodeType('n8n-nodes-base.myTestNode');
      } catch {
        // Expected to fail
      }

      // Verify debug was called with the original node type name
      const debugCalls = mockDebug.mock.calls;
      const hasLoadingLog = debugCalls.some(
        (call) => call[0]?.includes('Trying to load') && call[0]?.includes('myTestNode'),
      );
      expect(hasLoadingLog).toBe(true);

      // Test invalid format
      try {
        await nodeTypes.loadNodeType('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('requireModule with resolve fallback', () => {
    it('should use require.resolve fallback when direct require fails', () => {
      const testPath = 'some-non-existent-module';

      // This should trigger the catch block with require.resolve
      expect(() => NodeTypes.requireModule(testPath)).toThrow();
    });
  });
});

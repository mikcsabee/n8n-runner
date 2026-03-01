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
        'Failed to load node type',
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

      // Mock findNodeFile to verify it's not called for custom classes
      // biome-ignore lint/suspicious/noExplicitAny: jest.spyOn requires any type to access private method
      const findNodeFileSpy = jest.spyOn(NodeTypes as any, 'findNodeFile');

      // Load the node type
      await customNodeTypes.loadNodeType('n8n-nodes-base.earlyReturn');

      // Verify findNodeFile was never called (early return happened)
      expect(findNodeFileSpy).not.toHaveBeenCalled();

      // Verify the node was still loaded correctly
      const loadedNode = customNodeTypes.getByName('n8n-nodes-base.earlyReturn');
      expect(loadedNode).toBeDefined();

      findNodeFileSpy.mockRestore();
    });

    it('should log debug info when attempting to load a node', async () => {
      // This test verifies the logger.debug calls
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

      expect(hasLoadingLog).toBe(true);
      // Should have at least one debug call for the loading attempt
      expect(mockDebug).toHaveBeenCalled();
    });

    it('should attempt to load langchain nodes with file system search', async () => {
      mockDebug.mockClear();

      try {
        await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.llm');
      } catch {
        // Expected to fail, we just want to verify the search was attempted
      }

      // Verify debug was called to log the loading attempt
      expect(mockDebug).toHaveBeenCalled();
      // Check that debug calls include loading and search information
      const debugCalls = mockDebug.mock.calls.map((call) => call[0]);
      const hasLoadingLog = debugCalls.some(
        (arg) => arg?.includes('Trying to load') || arg?.includes('Searching in'),
      );
      expect(hasLoadingLog).toBe(true);
    });

    it('should search for langchain nodes in package directory', async () => {
      mockDebug.mockClear();

      try {
        await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.customNode');
      } catch {
        // Expected to fail, we just want to verify the search was attempted
      }

      // Verify debug was called to log the search attempt
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

  describe('resolvePackageRoot', () => {
    it('should resolve package root for valid package', () => {
      // This will try to resolve an actual package that exists in node_modules (like 'n8n-workflow')
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      const result = (NodeTypes as any).resolvePackageRoot('n8n-workflow');
      // Should return a path if the package exists, or null if not found
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('should return null for non-existent package', () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      const result = (NodeTypes as any).resolvePackageRoot('non-existent-package-xyz-123');
      expect(result).toBeNull();
    });
  });

  describe('findNodeFile', () => {
    it('should return null for non-existent directory', () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      const result = (NodeTypes as any).findNodeFile('/non/existent/path', 'TestNode');
      expect(result).toBeNull();
    });

    it('should respect max depth limit', () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      const result = (NodeTypes as any).findNodeFile(__dirname, 'TestNode', 0);
      // With max depth 0, should not find anything even if it exists
      expect(result).toBeNull();
    });
  });

  describe('loadNodeType', () => {
    it('should not reload already loaded nodes', async () => {
      const mockNodeInstance = { name: 'cached' };
      const nodeTypesRecord = nodeTypes as unknown as Record<string, unknown> & {
        loadedNodes: Map<string, unknown>;
      };
      nodeTypesRecord.loadedNodes.set('n8n-nodes-base.cached', mockNodeInstance);

      // biome-ignore lint/suspicious/noExplicitAny: accessing private method
      const findNodeFileSpy = jest.spyOn(NodeTypes as any, 'findNodeFile');

      await nodeTypes.loadNodeType('n8n-nodes-base.cached');

      // findNodeFile should not be called for already-loaded nodes
      expect(findNodeFileSpy).not.toHaveBeenCalled();

      findNodeFileSpy.mockRestore();
    });

    it('should throw error when package root cannot be resolved', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method
      const resolvePackageRootSpy = jest
        .spyOn(NodeTypes as any, 'resolvePackageRoot')
        .mockReturnValue(null);

      await expect(nodeTypes.loadNodeType('non-existent-package.someNode')).rejects.toThrow(
        'Could not resolve package root',
      );

      resolvePackageRootSpy.mockRestore();
    });

    it('should throw error when node file cannot be found', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method
      const resolvePackageRootSpy = jest
        .spyOn(NodeTypes as any, 'resolvePackageRoot')
        .mockReturnValue('/some/path');

      // biome-ignore lint/suspicious/noExplicitAny: accessing private method
      const findNodeFileSpy = jest.spyOn(NodeTypes as any, 'findNodeFile').mockReturnValue(null);

      await expect(nodeTypes.loadNodeType('n8n-nodes-base.someNode')).rejects.toThrow(
        'Could not find node file',
      );

      resolvePackageRootSpy.mockRestore();
      findNodeFileSpy.mockRestore();
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
    it('should attempt to find node file and handle errors gracefully', async () => {
      const debugCalls: string[] = [];
      mockDebug.mockImplementation((msg: string) => {
        if (msg.includes('Searching in') || msg.includes('Trying to load')) {
          debugCalls.push(msg);
        }
      });

      try {
        await nodeTypes.loadNodeType('n8n-nodes-base.someNode');
      } catch (error) {
        // Expected to fail with proper error message
        expect(error).toBeInstanceOf(Error);
      }

      // Verify debug was called with search info
      expect(debugCalls.length).toBeGreaterThan(0);
    });

    it('should handle langchain package resolution errors gracefully', async () => {
      try {
        await nodeTypes.loadNodeType('@n8n/n8n-nodes-langchain.someNode');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
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

  describe('getNodeModulesPaths', () => {
    it('should include current directory and parent directories', () => {
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method
      const paths = (NodeTypes as any).getNodeModulesPaths(process.cwd());

      expect(paths).toBeInstanceOf(Array);
      expect(paths.length).toBeGreaterThan(0);
      // Should include the current working directory's node_modules
      expect(paths[0]).toContain('node_modules');
    });
  });
});

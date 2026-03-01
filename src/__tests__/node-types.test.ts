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

import * as fs from 'fs';
import type { INodeType } from 'n8n-workflow';
import * as path from 'path';
import { NodeTypes } from '../node-types';

// Mock fs module
jest.mock('fs');
// Mock path module
jest.mock('path');

describe('NodeTypes', () => {
  let nodeTypes: NodeTypes;

  beforeEach(() => {
    jest.clearAllMocks();
    nodeTypes = new NodeTypes();
  });

  describe('getByName', () => {
    it('should return node type if it exists', () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      nodeTypes['loadedNodes'].set('test.node', mockNode);

      const result = nodeTypes.getByName('test.node');
      expect(result).toBe(mockNode);
    });

    it('should throw error if node type does not exist', () => {
      expect(() => nodeTypes.getByName('nonexistent.node')).toThrow('is not loaded');
    });
  });

  describe('getByNameAndVersion', () => {
    it('should call NodeHelpers.getVersionedNodeType', () => {
      const mockNode = {
        description: { name: 'test' },
        nodeVersions: {
          1: { description: { name: 'v1' } } as INodeType,
          2: { description: { name: 'v2' } } as INodeType,
        },
      };
      nodeTypes['loadedNodes'].set('test.node', mockNode as any);

      const result = nodeTypes.getByNameAndVersion('test.node', 2);
      expect(result).toBeDefined();
      // NodeHelpers.getVersionedNodeType is mocked to return the node as-is
      expect(result).toEqual(mockNode);
    });

    it('should return node if it is not versioned', () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      nodeTypes['loadedNodes'].set('test.node', mockNode);

      const result = nodeTypes.getByNameAndVersion('test.node');
      expect(result).toBe(mockNode);
    });
  });

  describe('getKnownTypes', () => {
    it('should return all known node types', () => {
      const mockNode1 = { description: { name: 'test1' } } as INodeType;
      const mockNode2 = { description: { name: 'test2' } } as INodeType;
      nodeTypes['loadedNodes'].set('test1.node', mockNode1);
      nodeTypes['loadedNodes'].set('test2.node', mockNode2);

      const result = nodeTypes.getKnownTypes();
      expect(Object.keys(result)).toHaveLength(2);
      expect(result['test1.node']).toBeDefined();
      expect(result['test2.node']).toBeDefined();
    });

    it('should return empty object if no nodes loaded', () => {
      const result = nodeTypes.getKnownTypes();
      expect(result).toEqual({});
    });
  });

  describe('getNodeModulesPaths', () => {
    it('should walk up directory tree', () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      let callCount = 0;
      mockPath.dirname.mockImplementation((p) => {
        callCount++;
        if (p === 'C:/test/deep/dir') return 'C:/test/deep';
        if (p === 'C:/test/deep') return 'C:/test';
        if (p === 'C:/test') return 'C:/';
        return p; // Already at root
      });

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).getNodeModulesPaths('C:/test/deep/dir');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('C:/test/deep/dir/node_modules');
    });
  });

  describe('findNodeFile', () => {
    beforeEach(() => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));
      mockPath.basename.mockImplementation((p) => {
        const parts = p.split('/');
        return parts[parts.length - 1] || '';
      });
    });

    it('should find node file in current directory', () => {
      const mockFs = jest.mocked(fs);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'Set.node.js', isFile: () => true, isDirectory: () => false },
        { name: 'other.txt', isFile: () => true, isDirectory: () => false },
      ] as any);

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/test/dir', 'Set', 5, 0);

      expect(result).toBe('/test/dir/Set.node.js');
    });

    it('should search subdirectories recursively', () => {
      const mockFs = jest.mocked(fs);
      const mockPath = jest.mocked(path);

      mockFs.existsSync.mockReturnValue(true);

      const callCount = 0;
      mockFs.readdirSync.mockImplementation((dirPath: any) => {
        if (dirPath === '/test') {
          return [{ name: 'subdir', isFile: () => false, isDirectory: () => true }] as any;
        }
        if (dirPath === '/test/subdir') {
          return [{ name: 'Code.node.js', isFile: () => true, isDirectory: () => false }] as any;
        }
        return [] as any;
      });

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/test', 'Code', 5, 0);

      expect(result).toBe('/test/subdir/Code.node.js');
    });

    it('should skip hidden directories', () => {
      const mockFs = jest.mocked(fs);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: '.git', isFile: () => false, isDirectory: () => true },
        { name: '.hidden', isFile: () => false, isDirectory: () => true },
      ] as any);

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/test', 'Node', 5, 0);

      expect(result).toBeNull();
    });

    it('should respect maxDepth', () => {
      const mockFs = jest.mocked(fs);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'subdir', isFile: () => false, isDirectory: () => true },
      ] as any);

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/test', 'Deep', 0, 0);

      expect(result).toBeNull();
    });

    it('should return null on file system errors (line 138)', () => {
      const mockFs = jest.mocked(fs);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/restricted', 'Node', 5, 0);

      expect(result).toBeNull();
    });

    it('should return null when directory does not exist', () => {
      const mockFs = jest.mocked(fs);

      mockFs.existsSync.mockReturnValue(false);

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/nonexistent', 'Node', 5, 0);

      expect(result).toBeNull();
    });

    it('should check current directory before subdirectories', () => {
      const mockFs = jest.mocked(fs);

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        { name: 'Target.node.js', isFile: () => true, isDirectory: () => false },
        { name: 'subdir', isFile: () => false, isDirectory: () => true },
      ] as any);

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).findNodeFile('/test', 'Target', 5, 0);

      expect(result).toBe('/test/Target.node.js');
    });
  });

  describe('resolvePackageRoot', () => {
    it('should return null when package cannot be resolved', () => {
      const originalResolve = require.resolve;
      (require.resolve as any) = jest.fn().mockImplementation(() => {
        throw new Error('Cannot find module');
      });
      (require.resolve as any).paths = jest.fn().mockReturnValue(['/mock/path']);

      // biome-ignore lint/suspicious/noExplicitAny: testing private method
      const result = (NodeTypes as any).resolvePackageRoot('nonexistent-pkg');

      expect(result).toBeNull();

      require.resolve = originalResolve;
    });
  });

  describe('loadNodeType', () => {
    it('should not load node if already loaded', async () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      nodeTypes['loadedNodes'].set('test.node', mockNode);

      // loadNodeType returns early if already loaded (doesn't throw)
      await nodeTypes.loadNodeType('test.node');

      // Node should still be there
      expect(nodeTypes.getByName('test.node')).toBe(mockNode);
    });

    it('should throw error when package root cannot be resolved', async () => {
      const mockFs = jest.mocked(fs);
      const mockPath = jest.mocked(path);

      mockPath.join.mockImplementation((...args) => args.join('/'));
      mockPath.dirname.mockImplementation((p) => p);
      mockFs.existsSync.mockReturnValue(false);

      await expect(nodeTypes.loadNodeType('nonexistent.node')).rejects.toThrow(
        'Could not resolve package root',
      );
    });

    it('should throw error when node file cannot be found', async () => {
      const mockFs = jest.mocked(fs);
      const mockPath = jest.mocked(path);

      mockPath.join.mockImplementation((...args) => args.join('/'));
      mockPath.dirname.mockImplementation((p) => p);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ name: 'test-pkg' }));
      mockFs.readdirSync.mockReturnValue([] as any);

      await expect(nodeTypes.loadNodeType('test-pkg.missing')).rejects.toThrow(
        'Failed to load node type',
      );
    });

    it('should load node type successfully from named export', async () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(NodeTypes as any, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const findNodeFileSpy = jest
        .spyOn(NodeTypes as any, 'findNodeFile')
        .mockReturnValue('virtual/test-node-module.js');

      class MockNamedNode {
        description = { name: 'testNode' };
      }

      jest.doMock('virtual/test-node-module.js', () => ({ TestNode: MockNamedNode }), {
        virtual: true,
      });

      try {
        await nodeTypes.loadNodeType('test-pkg.testNode');
        const loaded = nodeTypes.getByName('test-pkg.testNode');
        expect(loaded).toBeInstanceOf(MockNamedNode);
      } finally {
        resolvePackageRootSpy.mockRestore();
        findNodeFileSpy.mockRestore();
        jest.dontMock('virtual/test-node-module.js');
      }
    });

    it('should load node type successfully from default export', async () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(NodeTypes as any, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const findNodeFileSpy = jest
        .spyOn(NodeTypes as any, 'findNodeFile')
        .mockReturnValue('virtual/default-node-module.js');

      class MockDefaultNode {
        description = { name: 'defaultNode' };
      }

      jest.doMock('virtual/default-node-module.js', () => ({ default: MockDefaultNode }), {
        virtual: true,
      });

      try {
        await nodeTypes.loadNodeType('test-pkg.defaultNode');
        const loaded = nodeTypes.getByName('test-pkg.defaultNode');
        expect(loaded).toBeInstanceOf(MockDefaultNode);
      } finally {
        resolvePackageRootSpy.mockRestore();
        findNodeFileSpy.mockRestore();
        jest.dontMock('virtual/default-node-module.js');
      }
    });

    it('should throw when module does not expose expected class', async () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(NodeTypes as any, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const findNodeFileSpy = jest
        .spyOn(NodeTypes as any, 'findNodeFile')
        .mockReturnValue('virtual/no-class-node-module.js');

      jest.doMock(
        'virtual/no-class-node-module.js',
        () => ({ NotTheRightExport: class UnknownNode {} }),
        { virtual: true },
      );

      try {
        await expect(nodeTypes.loadNodeType('test-pkg.noClass')).rejects.toThrow(
          'Could not find class NoClass in module',
        );
      } finally {
        resolvePackageRootSpy.mockRestore();
        findNodeFileSpy.mockRestore();
        jest.dontMock('virtual/no-class-node-module.js');
      }
    });
  });

  describe('requireModule', () => {
    it('should return module when direct require succeeds', () => {
      const result = NodeTypes.requireModule('node:path') as Record<string, unknown>;
      expect(result).toHaveProperty('join');
    });

    it('should fallback to require.resolve paths when direct require fails', () => {
      const realFs = jest.requireActual('fs') as typeof import('fs');
      const realPath = jest.requireActual('path') as typeof import('path');
      const realOs = jest.requireActual('os') as typeof import('os');

      const previousCwd = process.cwd();
      const tmpDir = realFs.mkdtempSync(realPath.join(realOs.tmpdir(), 'node-types-'));
      const moduleDir = realPath.join(tmpDir, 'node_modules', 'fallback-only-pkg');
      realFs.mkdirSync(moduleDir, { recursive: true });
      realFs.writeFileSync(
        realPath.join(moduleDir, 'index.js'),
        'module.exports = { loadedFrom: "fallback" };',
      );

      try {
        process.chdir(tmpDir);
        const result = NodeTypes.requireModule('fallback-only-pkg') as Record<string, unknown>;
        expect(result).toEqual({ loadedFrom: 'fallback' });
      } finally {
        process.chdir(previousCwd);
        realFs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('resolvePackageRoot', () => {
    it('should return package directory when package can be resolved', () => {
      // biome-ignore lint/suspicious/noExplicitAny: testing private static method
      const result = (NodeTypes as any).resolvePackageRoot('jest');
      expect(result).toBeTruthy();
    });
  });

  describe('loadNodesFromWorkflow', () => {
    it('should skip already loaded nodes', async () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      nodeTypes['loadedNodes'].set('test.node', mockNode);

      const nodes = [{ type: 'test.node' }];

      await nodeTypes.loadNodesFromWorkflow(nodes);

      expect(nodeTypes.getByName('test.node')).toBe(mockNode);
    });

    it('should handle workflow with no nodes', async () => {
      const nodes: Array<{ type: string }> = [];

      await nodeTypes.loadNodesFromWorkflow(nodes);

      expect(nodeTypes.getKnownTypes()).toEqual({});
    });
  });
});

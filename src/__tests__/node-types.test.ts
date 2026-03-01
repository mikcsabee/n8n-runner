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

// Mock fs.promises
const mockFsPromises = {
  access: jest.fn(),
  readdir: jest.fn(),
};

jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  promises: mockFsPromises,
}));

import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { INodeType, IVersionedNodeType } from 'n8n-workflow';
import { NodeTypes } from '../node-types';

// Mock path module
jest.mock('node:path');

type NodeTypesPrivateStatic = {
  packageNodeIndexCache: Map<string, Map<string, string>>;
  getNodeModulesPaths(startPath: string): string[];
  buildPackageIndex(baseDir: string, maxDepth?: number): Promise<Map<string, string>>;
  resolvePackageRoot(packageName: string): string | null;
  getNodeFilePath(packageRoot: string, className: string): Promise<string | null>;
};

type NodeTypesPrivateInstance = {
  loadedNodes: Map<string, INodeType | IVersionedNodeType>;
};

type MockDirent = Pick<Dirent, 'name' | 'isFile' | 'isDirectory'>;

const nodeTypesStatic = NodeTypes as unknown as NodeTypesPrivateStatic;

const getLoadedNodes = (instance: NodeTypes): NodeTypesPrivateInstance['loadedNodes'] =>
  (instance as unknown as NodeTypesPrivateInstance).loadedNodes;

describe('NodeTypes', () => {
  let nodeTypes: NodeTypes;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear the static package cache between tests
    nodeTypesStatic.packageNodeIndexCache.clear();
    nodeTypes = new NodeTypes();
  });

  describe('getByName', () => {
    it('should return node type if it exists', () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      getLoadedNodes(nodeTypes).set('test.node', mockNode);

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
      getLoadedNodes(nodeTypes).set('test.node', mockNode as unknown as IVersionedNodeType);

      const result = nodeTypes.getByNameAndVersion('test.node', 2);
      expect(result).toBeDefined();
      // NodeHelpers.getVersionedNodeType is mocked to return the node as-is
      expect(result).toEqual(mockNode);
    });

    it('should return node if it is not versioned', () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      getLoadedNodes(nodeTypes).set('test.node', mockNode);

      const result = nodeTypes.getByNameAndVersion('test.node');
      expect(result).toBe(mockNode);
    });
  });

  describe('getKnownTypes', () => {
    it('should return all known node types', () => {
      const mockNode1 = { description: { name: 'test1' } } as INodeType;
      const mockNode2 = { description: { name: 'test2' } } as INodeType;
      getLoadedNodes(nodeTypes).set('test1.node', mockNode1);
      getLoadedNodes(nodeTypes).set('test2.node', mockNode2);

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

      mockPath.dirname.mockImplementation((p) => {
        if (p === 'C:/test/deep/dir') return 'C:/test/deep';
        if (p === 'C:/test/deep') return 'C:/test';
        if (p === 'C:/test') return 'C:/';
        return p; // Already at root
      });

      const result = nodeTypesStatic.getNodeModulesPaths('C:/test/deep/dir');

      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('C:/test/deep/dir/node_modules');
    });
  });

  describe('buildPackageIndex', () => {
    beforeEach(() => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));
      mockPath.basename.mockImplementation((p) => {
        const parts = p.split('/');
        return parts[parts.length - 1] || '';
      });

      // Reset fs.promises mocks
      mockFsPromises.access.mockReset();
      mockFsPromises.readdir.mockReset();
    });

    it('should build index of node files in directory', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readdir.mockResolvedValue([
        { name: 'Set.node.js', isFile: () => true, isDirectory: () => false },
        { name: 'Code.node.js', isFile: () => true, isDirectory: () => false },
        { name: 'other.txt', isFile: () => true, isDirectory: () => false },
      ] as MockDirent[]);

      const result = await nodeTypesStatic.buildPackageIndex('/test/dir');

      expect(result.size).toBe(2);
      expect(result.get('Set')).toBe('/test/dir/Set.node.js');
      expect(result.get('Code')).toBe('/test/dir/Code.node.js');
    });

    it('should search subdirectories recursively', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);

      mockFsPromises.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === '/test') {
          return [{ name: 'subdir', isFile: () => false, isDirectory: () => true }] as MockDirent[];
        }
        if (dirPath === '/test/subdir') {
          return [
            { name: 'Code.node.js', isFile: () => true, isDirectory: () => false },
          ] as MockDirent[];
        }
        return [] as MockDirent[];
      });

      const result = await nodeTypesStatic.buildPackageIndex('/test');

      expect(result.get('Code')).toBe('/test/subdir/Code.node.js');
    });

    it('should skip hidden directories', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readdir.mockResolvedValue([
        { name: '.git', isFile: () => false, isDirectory: () => true },
        { name: '.hidden', isFile: () => false, isDirectory: () => true },
      ] as MockDirent[]);

      const result = await nodeTypesStatic.buildPackageIndex('/test');

      expect(result.size).toBe(0);
    });

    it('should respect maxDepth', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readdir.mockResolvedValue([
        { name: 'subdir', isFile: () => false, isDirectory: () => true },
      ] as MockDirent[]);

      const result = await nodeTypesStatic.buildPackageIndex('/test', 0);

      expect(result.size).toBe(0);
    });

    it('should handle file system errors gracefully', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readdir.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await nodeTypesStatic.buildPackageIndex('/restricted');

      expect(result.size).toBe(0);
    });

    it('should handle non-existent directory', async () => {
      mockFsPromises.access.mockRejectedValue(new Error('ENOENT'));

      const result = await nodeTypesStatic.buildPackageIndex('/nonexistent');

      expect(result.size).toBe(0);
    });

    it('should scan subdirectories in parallel', async () => {
      mockFsPromises.access.mockResolvedValue(undefined);
      mockFsPromises.readdir.mockImplementation(async (dirPath: string) => {
        if (dirPath === '/test') {
          return [
            { name: 'subdir1', isFile: () => false, isDirectory: () => true },
            { name: 'subdir2', isFile: () => false, isDirectory: () => true },
          ] as MockDirent[];
        }
        if (dirPath === '/test/subdir1') {
          return [
            { name: 'Node1.node.js', isFile: () => true, isDirectory: () => false },
          ] as MockDirent[];
        }
        if (dirPath === '/test/subdir2') {
          return [
            { name: 'Node2.node.js', isFile: () => true, isDirectory: () => false },
          ] as MockDirent[];
        }
        return [] as MockDirent[];
      });

      const result = await nodeTypesStatic.buildPackageIndex('/test');

      expect(result.size).toBe(2);
      expect(result.get('Node1')).toBe('/test/subdir1/Node1.node.js');
      expect(result.get('Node2')).toBe('/test/subdir2/Node2.node.js');
    });
  });

  describe('getNodeFilePath', () => {
    beforeEach(() => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));
    });

    it('should return node file path and cache package index', async () => {
      const buildPackageIndexSpy = jest
        .spyOn(nodeTypesStatic, 'buildPackageIndex')
        .mockResolvedValue(new Map([['Set', '/mock/pkg/dist/nodes/Set.node.js']]));

      try {
        const first = await nodeTypesStatic.getNodeFilePath('/mock/pkg', 'Set');
        const second = await nodeTypesStatic.getNodeFilePath('/mock/pkg', 'Set');

        expect(first).toBe('/mock/pkg/dist/nodes/Set.node.js');
        expect(second).toBe('/mock/pkg/dist/nodes/Set.node.js');
        expect(buildPackageIndexSpy).toHaveBeenCalledTimes(1);
        expect(buildPackageIndexSpy).toHaveBeenCalledWith('/mock/pkg/dist/nodes');
      } finally {
        buildPackageIndexSpy.mockRestore();
      }
    });

    it('should return null when class name is not in package index', async () => {
      const buildPackageIndexSpy = jest
        .spyOn(nodeTypesStatic, 'buildPackageIndex')
        .mockResolvedValue(new Map());

      try {
        const result = await nodeTypesStatic.getNodeFilePath('/mock/pkg', 'MissingNode');

        expect(result).toBeNull();
      } finally {
        buildPackageIndexSpy.mockRestore();
      }
    });

    it('should keep a separate cache per package root', async () => {
      const buildPackageIndexSpy = jest
        .spyOn(nodeTypesStatic, 'buildPackageIndex')
        .mockImplementation(async (baseDir: string) => {
          if (baseDir === '/pkg-a/dist/nodes') {
            return new Map([['NodeA', '/pkg-a/dist/nodes/NodeA.node.js']]);
          }
          return new Map([['NodeB', '/pkg-b/dist/nodes/NodeB.node.js']]);
        });

      try {
        const packageAResult = await nodeTypesStatic.getNodeFilePath('/pkg-a', 'NodeA');
        const packageBResult = await nodeTypesStatic.getNodeFilePath('/pkg-b', 'NodeB');

        expect(packageAResult).toBe('/pkg-a/dist/nodes/NodeA.node.js');
        expect(packageBResult).toBe('/pkg-b/dist/nodes/NodeB.node.js');
        expect(buildPackageIndexSpy).toHaveBeenCalledTimes(2);
      } finally {
        buildPackageIndexSpy.mockRestore();
      }
    });
  });

  describe('resolvePackageRoot', () => {
    it('should return null when package cannot be resolved', () => {
      const result = nodeTypesStatic.resolvePackageRoot('definitely-missing-pkg-xyz');

      expect(result).toBeNull();
    });
  });

  describe('loadNodeType', () => {
    it('should not load node if already loaded', async () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      getLoadedNodes(nodeTypes).set('test.node', mockNode);

      // loadNodeType returns early if already loaded (doesn't throw)
      await nodeTypes.loadNodeType('test.node');

      // Node should still be there
      expect(nodeTypes.getByName('test.node')).toBe(mockNode);
    });

    it('should throw error when package root cannot be resolved', async () => {
      const mockPath = jest.mocked(path);

      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(nodeTypesStatic, 'resolvePackageRoot')
        .mockReturnValue(null);

      try {
        await expect(nodeTypes.loadNodeType('nonexistent.node')).rejects.toThrow(
          'Could not resolve package root',
        );
      } finally {
        resolvePackageRootSpy.mockRestore();
      }
    });

    it('should throw error when node file cannot be found', async () => {
      const mockPath = jest.mocked(path);

      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(nodeTypesStatic, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const getNodeFilePathSpy = jest
        .spyOn(nodeTypesStatic, 'getNodeFilePath')
        .mockResolvedValue(null);

      try {
        await expect(nodeTypes.loadNodeType('test-pkg.missing')).rejects.toThrow(
          'Could not find node file',
        );
      } finally {
        resolvePackageRootSpy.mockRestore();
        getNodeFilePathSpy.mockRestore();
      }
    });

    it('should load node type successfully from named export', async () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(nodeTypesStatic, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const getNodeFilePathSpy = jest
        .spyOn(nodeTypesStatic, 'getNodeFilePath')
        .mockResolvedValue('virtual/test-node-module.js');

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
        getNodeFilePathSpy.mockRestore();
        jest.dontMock('virtual/test-node-module.js');
      }
    });

    it('should load node type successfully from default export', async () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(nodeTypesStatic, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const getNodeFilePathSpy = jest
        .spyOn(nodeTypesStatic, 'getNodeFilePath')
        .mockResolvedValue('virtual/default-node-module.js');

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
        getNodeFilePathSpy.mockRestore();
        jest.dontMock('virtual/default-node-module.js');
      }
    });

    it('should throw when module does not expose expected class', async () => {
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => args.join('/'));

      const resolvePackageRootSpy = jest
        .spyOn(nodeTypesStatic, 'resolvePackageRoot')
        .mockReturnValue('/mock/pkg');
      const getNodeFilePathSpy = jest
        .spyOn(nodeTypesStatic, 'getNodeFilePath')
        .mockResolvedValue('virtual/no-class-node-module.js');

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
        getNodeFilePathSpy.mockRestore();
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
      const realFs = jest.requireActual('node:fs') as typeof import('node:fs');
      const realPath = jest.requireActual('node:path') as typeof import('node:path');
      const realOs = jest.requireActual('node:os') as typeof import('node:os');

      // Mock path module to use actual implementations for this test
      const mockPath = jest.mocked(path);
      mockPath.join.mockImplementation((...args) => realPath.join(...args));
      mockPath.dirname.mockImplementation((p) => realPath.dirname(p));

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
      const result = nodeTypesStatic.resolvePackageRoot('jest');
      expect(result).toBeTruthy();
    });
  });

  describe('loadNodesFromWorkflow', () => {
    it('should skip already loaded nodes', async () => {
      const mockNode = { description: { name: 'test' } } as INodeType;
      getLoadedNodes(nodeTypes).set('test.node', mockNode);

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

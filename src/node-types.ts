import { promises as fsPromises } from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@n8n/backend-common';
import { Container } from '@n8n/di';
import type { IDataObject, INodeType, INodeTypes, IVersionedNodeType } from 'n8n-workflow';
import { NodeHelpers } from 'n8n-workflow';

export type NodeConstructor<T = object> = new (...args: unknown[]) => T;

/**
 * NodeTypes implementation that can dynamically load nodes
 */
export class NodeTypes implements INodeTypes {
  private loadedNodes: Map<string, INodeType | IVersionedNodeType> = new Map();
  private logger: Logger;
  private static packageNodeIndexCache: Map<string, Map<string, string>> = new Map();

  constructor(private customClasses?: Record<string, NodeConstructor>) {
    this.logger = Container.get(Logger);
  }

  getByName(nodeType: string): INodeType | IVersionedNodeType {
    const node = this.loadedNodes.get(nodeType);
    if (!node) {
      throw new Error(`Node type "${nodeType}" is not loaded`);
    }
    return node;
  }

  getByNameAndVersion(nodeType: string, version?: number): INodeType {
    const node = this.getByName(nodeType);
    const versionedNode = NodeHelpers.getVersionedNodeType(node, version);

    this.logger.debug(`[NodeTypes] getByNameAndVersion(${nodeType}, ${version}):`, {
      hasDescription: !!versionedNode.description,
      hasCredentials: !!versionedNode.description?.credentials,
      credentialsLength: versionedNode.description?.credentials?.length,
    });

    return versionedNode;
  }

  getKnownTypes(): IDataObject {
    const knownTypes: IDataObject = {};
    for (const [name] of this.loadedNodes) {
      knownTypes[name] = { className: name };
    }
    return knownTypes;
  }

  /**
   * Attempts to require a single module path, with require.resolve fallback
   * Extracted to a separate method to make it testable
   */
  public static requireModule(modulePath: string): unknown {
    try {
      return require(modulePath);
    } catch (_e) {
      // If the module is not found locally, try resolving from multiple locations
      const searchPaths: string[] = [
        process.cwd(), // Current working directory
        ...NodeTypes.getNodeModulesPaths(process.cwd()), // All parent node_modules
        ...(require.resolve.paths(modulePath) || []),
      ];

      const resolvedPath = require.resolve(modulePath, {
        paths: searchPaths,
      });
      return require(resolvedPath);
    }
  }

  /**
   * Get all possible node_modules paths by walking up the directory tree
   */
  private static getNodeModulesPaths(startPath: string): string[] {
    const paths: string[] = [];
    let currentPath = startPath;

    // Walk up the directory tree
    while (true) {
      const nodeModulesPath = path.join(currentPath, 'node_modules');
      paths.push(nodeModulesPath);

      const parentPath = path.dirname(currentPath);
      // Stop when we reach the root
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    return paths;
  }

  /**
   * Build an index of all node files in a package directory
   * This scans the directory tree once and caches the results
   */
  private static async buildPackageIndex(
    baseDir: string,
    maxDepth: number = 5,
  ): Promise<Map<string, string>> {
    const index = new Map<string, string>();

    const scanDirectory = async (dir: string, currentDepth: number = 0): Promise<void> => {
      if (currentDepth > maxDepth) {
        return;
      }

      try {
        const exists = await fsPromises
          .access(dir)
          .then(() => true)
          .catch(() => false);
        if (!exists) {
          return;
        }

        const entries = await fsPromises.readdir(dir, { withFileTypes: true });

        // Collect all subdirectories to scan in parallel
        const subdirs: string[] = [];

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.node.js')) {
            // Extract class name from filename (e.g., "MyNode.node.js" -> "MyNode")
            const className = entry.name.replace('.node.js', '');
            const filePath = path.join(dir, entry.name);
            index.set(className, filePath);
          } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
            subdirs.push(path.join(dir, entry.name));
          }
        }

        // Scan subdirectories in parallel
        await Promise.all(subdirs.map((subdir) => scanDirectory(subdir, currentDepth + 1)));
      } catch (_e) {
        // Ignore permission errors and continue
      }
    };

    await scanDirectory(baseDir);
    return index;
  }

  /**
   * Get the node file path from cache or build the index
   */
  private static async getNodeFilePath(
    packageRoot: string,
    className: string,
  ): Promise<string | null> {
    const searchDir = path.join(packageRoot, 'dist', 'nodes');

    // Check if we have a cached index for this package
    if (!NodeTypes.packageNodeIndexCache.has(packageRoot)) {
      const index = await NodeTypes.buildPackageIndex(searchDir);
      NodeTypes.packageNodeIndexCache.set(packageRoot, index);
    }

    const packageIndex = NodeTypes.packageNodeIndexCache.get(packageRoot);
    return packageIndex?.get(className) || null;
  }

  /**
   * Resolve the root directory of a package
   */
  private static resolvePackageRoot(packageName: string): string | null {
    try {
      const packageJsonPath = require.resolve(`${packageName}/package.json`, {
        paths: [
          process.cwd(),
          ...NodeTypes.getNodeModulesPaths(process.cwd()),
          ...(require.resolve.paths(packageName) || []),
        ],
      });
      return path.dirname(packageJsonPath);
    } catch (_e) {
      return null;
    }
  }

  /**
   * Dynamically load a node type from n8n-nodes-base or langchain
   */
  async loadNodeType(nodeTypeName: string): Promise<void> {
    if (this.loadedNodes.has(nodeTypeName)) {
      return; // Already loaded
    }

    // Parse the node type name
    // Format: "n8n-nodes-base.nodeName" or "@n8n/n8n-nodes-langchain.nodeName"
    const lastDotIndex = nodeTypeName.lastIndexOf('.');
    const packageName = nodeTypeName.substring(0, lastDotIndex);
    const nodeName = nodeTypeName.substring(lastDotIndex + 1);
    // Convert camelCase to PascalCase for the class name
    const className = nodeName.charAt(0).toUpperCase() + nodeName.slice(1);

    try {
      if (this.customClasses) {
        const NodeClass = this.customClasses[nodeTypeName] as new () =>
          | INodeType
          | IVersionedNodeType;
        if (NodeClass) {
          const nodeInstance = new NodeClass();
          this.loadedNodes.set(nodeTypeName, nodeInstance);
          return;
        }
      }

      this.logger.debug(
        `[NodeTypes] Trying to load ${nodeTypeName}, className: ${className}, packageName: ${packageName}`,
      );

      // Resolve the package root directory
      const packageRoot = NodeTypes.resolvePackageRoot(packageName);
      if (!packageRoot) {
        throw new Error(`Could not resolve package root for ${packageName}`);
      }

      this.logger.debug(`[NodeTypes] Package root: ${packageRoot}`);

      // Get the node file path using the cache
      const nodeFilePath = await NodeTypes.getNodeFilePath(packageRoot, className);

      if (!nodeFilePath) {
        throw new Error(
          `Could not find node file for ${className} in ${path.join(packageRoot, 'dist', 'nodes')}`,
        );
      }

      this.logger.debug(`[NodeTypes] Found node file: ${nodeFilePath}`);

      // Load the module
      const nodeModule = require(nodeFilePath);

      // The node class is usually the default export or named export matching the class name
      const mod = nodeModule as Record<string, unknown>;
      const NodeClass = (mod[className] || mod.default) as new () => INodeType | IVersionedNodeType;

      if (!NodeClass) {
        throw new Error(`Could not find class ${className} in module`);
      }

      // Instantiate the node
      const nodeInstance = new NodeClass();

      // Register the node
      this.loadedNodes.set(nodeTypeName, nodeInstance);
    } catch (_e) {
      throw new Error(
        `Failed to load node type "${nodeTypeName}": ${_e instanceof Error ? _e.message : String(_e)}`,
      );
    }
  }

  /**
   * Load all nodes required by a workflow
   */
  async loadNodesFromWorkflow(nodes: Array<{ type: string }>): Promise<void> {
    const uniqueTypes = new Set(nodes.map((n) => n.type));

    // Load all nodes in parallel
    await Promise.all(Array.from(uniqueTypes).map((nodeType) => this.loadNodeType(nodeType)));
  }
}

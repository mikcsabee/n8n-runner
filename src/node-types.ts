import * as fs from 'fs';
import * as path from 'path';
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
   * Recursively search for a node file in a directory
   */
  private static findNodeFile(
    baseDir: string,
    className: string,
    maxDepth: number = 5,
    currentDepth: number = 0,
  ): string | null {
    if (currentDepth > maxDepth) {
      return null;
    }

    try {
      if (!fs.existsSync(baseDir)) {
        return null;
      }

      const entries = fs.readdirSync(baseDir, { withFileTypes: true });

      // First, check if the target file exists in current directory
      const targetFileName = `${className}.node.js`;
      for (const entry of entries) {
        if (entry.isFile() && entry.name === targetFileName) {
          return path.join(baseDir, entry.name);
        }
      }

      // Then, recursively search subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const found = NodeTypes.findNodeFile(
            path.join(baseDir, entry.name),
            className,
            maxDepth,
            currentDepth + 1,
          );
          if (found) {
            return found;
          }
        }
      }
    } catch (e) {
      // Ignore permission errors and continue
      return null;
    }

    return null;
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
    } catch (e) {
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

      // Search for the node file in the package directory
      const searchDir = path.join(packageRoot, 'dist', 'nodes');
      
      this.logger.debug(`[NodeTypes] Searching in: ${searchDir}`);

      const nodeFilePath = NodeTypes.findNodeFile(searchDir, className);

      if (!nodeFilePath) {
        throw new Error(
          `Could not find node file for ${className} in ${searchDir}`,
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
    } catch (error) {
      throw new Error(
        `Failed to load node type "${nodeTypeName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Load all nodes required by a workflow
   */
  async loadNodesFromWorkflow(nodes: Array<{ type: string }>): Promise<void> {
    const uniqueTypes = new Set(nodes.map((n) => n.type));

    for (const nodeType of uniqueTypes) {
      await this.loadNodeType(nodeType);
    }
  }
}

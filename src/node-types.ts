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
    const path = require('path');
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
   * Attempts to load a module from a list of possible paths
   * Uses requireModule to load each path
   */
  public static tryLoadModule(possiblePaths: string[]): unknown {
    let lastError: Error | null = null;

    for (const modulePath of possiblePaths) {
      try {
        return NodeTypes.requireModule(modulePath);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw new Error(
      `Could not find module. Tried paths: ${possiblePaths.join(', ')}. Last error: ${lastError?.message}`,
    );
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

      // Build possible module paths
      const possiblePaths: string[] = [];

      if (packageName === 'n8n-nodes-base') {
        // Try direct paths first
        possiblePaths.push(
          `n8n-nodes-base/dist/nodes/${className}/${className}.node.js`,
          `n8n-nodes-base/dist/nodes/${nodeName}/${className}.node.js`,
        );
        
        // Try common subdirectories for n8n-nodes-base
        const subdirs = [
          'Transform',
          'Files',
          'Code',
          'Data',
          'Helpers',
          'Flow',
          'DateTime',
        ];
        for (const subdir of subdirs) {
          possiblePaths.push(
            `n8n-nodes-base/dist/nodes/${subdir}/${className}/${className}.node.js`,
          );
        }
      } else if (packageName === '@n8n/n8n-nodes-langchain') {
        // Langchain nodes can be in different subdirectories
        const subdirs = [
          'llms',
          'embeddings',
          'vendors',
          'chains',
          'agents',
          'tools',
          'vectorstores',
          'memory',
          'document_loaders',
          'retrievers',
          'text_splitters',
        ];
        for (const subdir of subdirs) {
          possiblePaths.push(
            `@n8n/n8n-nodes-langchain/dist/nodes/${subdir}/${className}/${className}.node.js`,
          );
        }
        // Also try without subdir
        possiblePaths.push(`@n8n/n8n-nodes-langchain/dist/nodes/${className}/${className}.node.js`);
      }

      this.logger.debug(
        `[NodeTypes] Trying to load ${nodeTypeName}, className: ${className}, packageName: ${packageName}`,
      );
      this.logger.debug(`[NodeTypes] Possible paths: ${JSON.stringify(possiblePaths)}`);

      const nodeModule = NodeTypes.tryLoadModule(possiblePaths);

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

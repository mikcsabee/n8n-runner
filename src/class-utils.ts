import path from 'node:path';
import { Logger } from '@n8n/backend-common';
import { Container } from '@n8n/di';

export type Constructor<T = object> = new (...args: unknown[]) => T;

// Helper function to get the package path from a class constructor
export function getPathForClass(classConstructor: Constructor): string | null {
  const logger = Container.get(Logger);

  try {
    for (const [modulePath, moduleObj] of Object.entries(require.cache)) {
      if (moduleObj?.exports) {
        // Check if this module exports our class
        const exports = moduleObj.exports;
        if (
          exports === classConstructor ||
          //exports.MDPrompt === classConstructor ||
          Object.values(exports).includes(classConstructor)
        ) {
          // Extract package name from the module path
          const match = modulePath.match(/node_modules[\\/]([^[\\/]+)/);
          if (match) {
            return modulePath;
          }

          // For local packages, try to find package.json
          let currentDir = path.dirname(modulePath);
          while (currentDir && currentDir !== path.parse(currentDir).root) {
            const packageJsonPath = path.join(currentDir, 'package.json');
            try {
              const pkg = require(packageJsonPath);
              if (pkg?.name) {
                return currentDir;
              }
            } catch {
              currentDir = path.dirname(currentDir);
            }
          }
        }
      }
    }
    logger.warn('Could not determine path for class constructor.', { classConstructor });
  } catch (error) {
    logger.error('Error in getPathForClass:', { error });
  }

  return null;
}

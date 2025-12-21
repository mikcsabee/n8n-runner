import 'reflect-metadata';

const mockWarn = jest.fn();
const mockError = jest.fn();

jest.mock('@n8n/backend-common', () => ({
  Logger: jest.fn(),
}));

jest.mock('@n8n/di', () => ({
  Container: {
    get: jest.fn(() => ({
      warn: mockWarn,
      error: mockError,
    })),
  },
}));

import { type Constructor, getPathForClass } from '../class-utils';

describe('getPathForClass', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWarn.mockClear();
    mockError.mockClear();
  });

  it('should find a local module path', () => {
    // Use the actual getPathForClass function itself as it's exported
    const result = getPathForClass(getPathForClass as unknown as Constructor);

    // Should find the class-utils module in the project
    expect(result).toBeTruthy();
    expect(result).toContain('n8n-runner');
  });

  it('should find a module in node_modules', () => {
    // Load a real class from node_modules
    const NodeHelpers = require('n8n-workflow').NodeHelpers;

    const result = getPathForClass(NodeHelpers);

    // Should find the n8n-workflow module in node_modules
    expect(result).toBeTruthy();
    expect(result).toContain('node_modules');
    expect(result).toContain('n8n-workflow');
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('should return null when class is not found in require.cache', () => {
    class NotLoadedClass {}

    const result = getPathForClass(NotLoadedClass);

    expect(result).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith('Could not determine path for class constructor.', {
      classConstructor: NotLoadedClass,
    });
  });

  it('should handle error gracefully and return null', () => {
    class ErrorClass {}

    // Mock Object.entries to throw an error
    const originalEntries = Object.entries;
    Object.entries = jest.fn(() => {
      throw new Error('Test error');
    });

    const result = getPathForClass(ErrorClass);

    expect(result).toBeNull();
    expect(mockError).toHaveBeenCalledWith('Error in getPathForClass:', {
      error: expect.any(Error),
    });

    // Cleanup
    Object.entries = originalEntries;
  });

  it('should work with regular expressions for Unix and Windows paths', () => {
    // Test that the regex pattern works correctly
    const windowsPath = 'C:\\project\\node_modules\\package\\index.js';
    const unixPath = '/home/user/project/node_modules/package/index.js';

    const match1 = windowsPath.match(/node_modules[\\/]([^[\\/]+)/);
    const match2 = unixPath.match(/node_modules[\\/]([^[\\/]+)/);

    expect(match1).toBeTruthy();
    expect(match1?.[1]).toBe('package');
    expect(match2).toBeTruthy();
    expect(match2?.[1]).toBe('package');
  });
});

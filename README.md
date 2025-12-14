# n8n-runner

A lightweight library for executing n8n workflows programmatically.

## Overview

This package provides a reusable library that allows you to execute n8n workflows from within Node.js applications without requiring a full n8n instance. It handles workflow execution, node loading, and credential management.

## Features

- **No Database Required** - Execute workflows from JSON without persistent storage
- **Full Node Support** - Dynamic loading of n8n node types (n8n-nodes-base and @n8n/n8n-nodes-langchain)
- **Credential Management** - Complete credentials system with decryption and expression resolution
- **Pluggable Architecture** - Implement custom credential providers to load credentials from any source
- **Execution Hooks** - Built-in logging and monitoring of workflow execution lifecycle

## Installation

```bash
npm install n8n-runner
```

## Quick Start

### Basic Usage

```typescript
import { Runner } from 'n8n-runner';
import type { ICredentialsProvider } from 'n8n-runner';

// Define your credentials provider
const credentialsProvider: ICredentialsProvider = {
  getCredentialData(id: string, type: string) {
    // Load credentials from your source (file, database, env vars, etc.)
    return {
      id,
      name: 'My Credential',
      type,
      data: 'ENCRYPTED_BASE64_STRING',
    };
  },
};

// Create and initialize runner
const runner = new Runner();
await runner.init(credentialsProvider);

// Execute a workflow
const workflow = {
  name: 'My Workflow',
  nodes: [/* workflow nodes */],
  connections: {/* node connections */},
};

const result = await runner.execute(workflow);

if (result.success) {
  console.log('Workflow executed successfully:', result.data);
} else {
  console.error('Workflow failed:', result.error);
}
```

## API Reference

### `Runner` Class

The main class for workflow execution.

#### Methods

**`async init(credentialsProvider: ICredentialsProvider): Promise<void>`**

Initializes the runner with a credentials provider. Must be called before executing workflows.

- `credentialsProvider` - Object implementing `ICredentialsProvider` interface

**`async execute(workflow: unknown): Promise<ExecutionResult>`**

Executes a workflow and returns the result.

- `workflow` - Workflow object with `name` and `nodes` properties
- Returns `ExecutionResult` with `success`, `data`, and optional `error` fields

### Interfaces

**`ICredentialsProvider`**

Implement this interface to provide credentials from your source:

```typescript
interface ICredentialsProvider {
  getCredentialData(id: string, type: string): {
    id: string;
    name: string;
    type: string;
    data: string;
  };
}
```

**`ExecutionResult`**

```typescript
interface ExecutionResult {
  success: boolean;
  executionId?: string;
  data?: unknown;
  error?: unknown;
}
```

## Workflow Format

Workflows should have the following structure:

```json
{
  "name": "My Workflow",
  "nodes": [
    {
      "id": "1",
      "name": "Start Node",
      "type": "n8n-nodes-base.start",
      "position": [250, 300],
      "parameters": {}
    }
  ],
  "connections": {},
  "staticData": {},
  "settings": {}
}
```

**Required fields:**
- `name` - Workflow name
- `nodes` - Array of workflow nodes

**Optional fields:**
- `id` - Workflow ID (auto-generated if not provided)
- `connections` - Node connections object
- `staticData` - Static workflow data
- `settings` - Workflow settings

## Custom Credential Provider Example

Here's an example of implementing a credentials provider that loads from a JSON file:

```typescript
import { Runner } from 'n8n-runner';
import type { ICredentialsProvider } from 'n8n-runner';
import fs from 'fs';

const credentialsFile = JSON.parse(
  fs.readFileSync('./credentials.json', 'utf-8')
);

const fileCredentialsProvider: ICredentialsProvider = {
  getCredentialData(id: string, type: string) {
    const credential = credentialsFile[id];
    if (!credential) {
      throw new Error(`Credential ${id} not found`);
    }
    return credential;
  },
};

const runner = new Runner();
await runner.init(fileCredentialsProvider);
```


## Building

```bash
npm run build
```

Compiles TypeScript to JavaScript in the `dist/` directory.

## Dependencies

- `@n8n/backend-common` - Logging and common utilities
- `@n8n/di` - Dependency injection container
- `n8n-core` - Workflow execution engine
- `n8n-workflow` - Workflow definitions and types

## License

ISC

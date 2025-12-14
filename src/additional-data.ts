import { Logger } from '@n8n/backend-common';
import { Container } from '@n8n/di';
import { ExecutionLifecycleHooks } from 'n8n-core';
import type { INode, IWorkflowExecuteAdditionalData, Workflow } from 'n8n-workflow';
import { CredentialsHelper } from './credentials-helper';

/**
 * Creates IWorkflowExecuteAdditionalData for workflow execution
 * Configures execution lifecycle hooks for logging via Logger
 */
export function createAdditionalData(
  workflow: Workflow,
  executionId: string,
): IWorkflowExecuteAdditionalData {
  const logger = Container.get(Logger);

  // Convert INodes object to INode[] array for ExecutionLifecycleHooks
  const nodes: INode[] = Object.values(workflow.nodes);

  // Create execution lifecycle hooks
  const hooks = new ExecutionLifecycleHooks('internal', executionId, {
    id: workflow.id,
    name: workflow.name || '',
    nodes,
    connections: workflow.connectionsBySourceNode,
    active: false,
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    activeVersionId: null,
    settings: workflow.settings,
  });

  // Add handlers for logging via Logger
  hooks.addHandler('workflowExecuteBefore', async () => {
    logger.debug('Starting workflow execution...');
  });

  hooks.addHandler('workflowExecuteAfter', async () => {
    logger.debug('Workflow execution completed');
  });

  hooks.addHandler('nodeExecuteBefore', async (nodeName) => {
    logger.debug(`Executing node: ${nodeName}`);
  });

  hooks.addHandler('nodeExecuteAfter', async (nodeName) => {
    logger.debug(`Node ${nodeName} completed`);
  });

  // Get credentials helper from DI container
  const credentialsHelper = Container.get(CredentialsHelper);

  logger.debug('Creating additionalData with credentialsHelper', {
    hasHelper: !!credentialsHelper,
    helperType: credentialsHelper?.constructor?.name,
  });

  // Return workflow execution additional data with hooks and credentials helper
  return {
    hooks,
    credentialsHelper,
    currentNodeExecutionIndex: 0,
    restApiUrl: '',
    instanceBaseUrl: '',
    formWaitingBaseUrl: '',
    webhookBaseUrl: '',
    webhookWaitingBaseUrl: '',
    webhookTestBaseUrl: '',
    variables: {},
    executeWorkflow: async () => ({}),
    async getRunExecutionData() {
      return undefined;
    },
    logAiEvent: () => {},
    startRunnerTask: async () => ({}),
    externalSecretsProxy: {} as unknown,
  } as unknown as IWorkflowExecuteAdditionalData;
}

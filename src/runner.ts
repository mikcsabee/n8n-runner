import { Logger } from '@n8n/backend-common';
import { Container } from '@n8n/di';
import { WorkflowExecute } from 'n8n-core';
import type { WorkflowParameters } from 'n8n-workflow';
import { Workflow } from 'n8n-workflow';
import { createAdditionalData } from './additional-data';
import { CredentialTypes } from './credential-types';
import { CredentialsHelper } from './credentials-helper';
import { CredentialsOverwrites } from './credentials-overwrites';
import type { ICredentialsProvider } from './credentials-provider';
import { NodeTypes } from './node-types';

export interface ExecutionResult {
  success: boolean;
  executionId?: string;
  data?: unknown;
  error?: unknown;
}

const testVar: any = 22; // To test CI linting

export class Runner {
  private logger!: Logger;
  private nodeTypes!: NodeTypes;
  private initialized = false;

  async init(credentialsProvider: ICredentialsProvider): Promise<void> {
    if (this.initialized) return;

    this.logger = Container.get(Logger);
    this.nodeTypes = new NodeTypes();

    // Register credential services in DI container
    Container.set(CredentialTypes, new CredentialTypes());
    Container.set(CredentialsOverwrites, new CredentialsOverwrites());
    Container.set(
      CredentialsHelper,
      new CredentialsHelper(
        Container.get(CredentialTypes),
        Container.get(CredentialsOverwrites),
        credentialsProvider,
      ),
    );

    this.initialized = true;
    this.logger.debug('Runner initialized');
  }

  async execute(workflow: WorkflowParameters): Promise<ExecutionResult> {
    if (!this.initialized) {
      throw new Error('Runner not initialized. Call init() first.');
    }

    this.logger.debug(`Executing workflow: ${workflow.name}`);

    // Load all node types required by this workflow
    this.logger.debug('Loading node types...');
    await this.nodeTypes.loadNodesFromWorkflow(workflow.nodes);
    this.logger.debug('Node types loaded successfully');

    // Ensure workflow has required fields
    if (!workflow.id) {
      workflow.id = `workflow-${Date.now()}`;
    }

    // Set nodeTypes to our instance
    const workflowParams: WorkflowParameters = {
      ...workflow,
      nodeTypes: this.nodeTypes,
    };

    // Create Workflow instance with our NodeTypes implementation
    const workflowInstance = new Workflow(workflowParams);

    // Create additional data with execution hooks
    const executionId = `execution-${Date.now()}`;
    const additionalData = createAdditionalData(workflowInstance, executionId);

    // Execute workflow using WorkflowExecute
    const workflowExecute = new WorkflowExecute(additionalData, 'internal');

    try {
      const data = await workflowExecute.run(workflowInstance);

      this.logger.debug(`Workflow execution completed with status: ${data.status}`);

      return {
        success: data.status === 'success',
        data,
      };
    } catch (error) {
      this.logger.error(
        `Workflow execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

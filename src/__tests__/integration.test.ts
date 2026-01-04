import {
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type INodeTypes,
  NodeConnectionTypes,
  type WorkflowParameters,
} from 'n8n-workflow';
import type { ICredentialsProvider } from '../credentials-provider';
import { Runner } from '../runner';

const testWorkflow: WorkflowParameters = {
  name: 'Integration',
  nodeTypes: undefined as unknown as INodeTypes,
  nodes: [
    {
      parameters: {
        myString: 'HellO',
      },
      type: 'my-nodes.testNode',
      typeVersion: 1,
      position: [0, 0],
      id: 'ce21aab9-4b74-45c4-b26e-312bb5dc3a8d',
      name: 'Test',
    },
  ],
  pinData: {},
  connections: {},
  active: false,
  settings: {
    executionOrder: 'v1',
  },
  id: '8EoQNwza40rmX5cF',
};

class TestNode implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'TestNode',
    name: 'testNode',
    group: ['input'],
    version: 1,
    description: 'Test Node',
    defaults: {
      name: 'Test Node',
    },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    properties: [
      {
        displayName: 'My String',
        name: 'myString',
        type: 'string',
        default: '',
        placeholder: 'Placeholder value',
        description: 'The description text',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();

    let item: INodeExecutionData;
    let myString: string;

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      myString = this.getNodeParameter('myString', itemIndex, '') as string;
      item = items[itemIndex];

      item.json.myString = myString.toLocaleLowerCase();
    }

    return [items];
  }
}

class DummyCredentialsProvider implements ICredentialsProvider {
  getCredentialData(
    id: string,
    type: string,
  ): { id: string; name: string; type: string; data: string } {
    throw new Error(`Credential not found: ${id} - ${type}`);
  }
}

describe('Integration', () => {
  it('should execute a simple workflow', async () => {
    const runner = new Runner();

    const customclasses = {
      'my-nodes.testNode': TestNode,
    };

    await runner.init(new DummyCredentialsProvider(), customclasses);

    const result = await runner.execute(testWorkflow);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      data: {
        executionData: expect.anything(),
        manualData: undefined,
        parentExecution: undefined,
        pushRef: undefined,
        resultData: {
          error: undefined,
          lastNodeExecuted: 'Test',
          metadata: undefined,
          pinData: undefined,
          runData: {
            Test: [
              {
                data: {
                  main: [
                    [
                      {
                        json: {
                          myString: 'hello',
                        },
                        pairedItem: {
                          input: undefined,
                          item: 0,
                        },
                      },
                    ],
                  ],
                },
                executionIndex: 0,
                executionStatus: 'success',
                executionTime: expect.any(Number),
                hints: [],
                metadata: undefined,
                source: [],
                startTime: expect.any(Number),
              },
            ],
          },
        },
        startData: expect.anything(),
        validateSignature: undefined,
        version: 1,
        waitTill: undefined,
      },
      finished: true,
      mode: 'internal',
      startedAt: expect.any(Date),
      status: 'success',
      stoppedAt: expect.any(Date),
    });
  });
});

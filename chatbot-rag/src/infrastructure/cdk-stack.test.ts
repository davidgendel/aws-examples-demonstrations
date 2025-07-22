import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ChatbotRagStack } from './cdk-stack';

describe('ChatbotRagStack', () => {
  test('Stack creates RDS instance', () => {
    const app = new cdk.App();
    // Create the stack
    const stack = new ChatbotRagStack(app, 'TestStack');
    // Prepare the template
    const template = Template.fromStack(stack);

    // Assert that the stack creates an RDS instance
    template.resourceCountIs('AWS::RDS::DBInstance', 1);
  });

  test('Stack creates Lambda functions', () => {
    const app = new cdk.App();
    const stack = new ChatbotRagStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Assert that the stack creates Lambda functions
    template.resourceCountIs('AWS::Lambda::Function', 3); // Including the rotation function
  });

  test('Stack creates API Gateway', () => {
    const app = new cdk.App();
    const stack = new ChatbotRagStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Assert that the stack creates API Gateway
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
  });

  test('Stack creates S3 buckets', () => {
    const app = new cdk.App();
    const stack = new ChatbotRagStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Assert that the stack creates S3 buckets
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  test('Lambda has correct permissions', () => {
    const app = new cdk.App();
    const stack = new ChatbotRagStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Assert that Lambda has permissions to access Bedrock
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: [
              'bedrock:InvokeModel',
              'bedrock:InvokeModelWithResponseStream',
              'bedrock:ApplyGuardrail',
            ],
            Effect: 'Allow',
            Resource: '*',
          },
        ],
      },
    });
  });
  
  test('WAF is configured correctly', () => {
    const app = new cdk.App();
    const stack = new ChatbotRagStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Assert that WAF is configured with the expected rules
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Rules: [
        {
          Name: 'AWSManagedRulesCommonRuleSet',
          Priority: 1,
        },
        {
          Name: 'AWSManagedRulesSQLiRuleSet',
          Priority: 2,
        },
        {
          Name: 'AWSManagedRulesAmazonIpReputationList',
          Priority: 3,
        },
        {
          Name: 'RateLimitRule',
          Priority: 4,
        }
      ]
    });
  });
});

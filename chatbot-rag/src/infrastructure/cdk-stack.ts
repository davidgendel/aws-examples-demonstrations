import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { WebSocketLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

export class ChatbotRagStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Load configuration
    const configPath = path.join(__dirname, '../../config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Create security group for RDS
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      description: 'Security group for RDS PostgreSQL instance',
      allowAllOutbound: true,
    });

    // Allow connections to PostgreSQL from anywhere (restricted by security group)
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow connections to PostgreSQL'
    );

    // Create database credentials secret
    const dbCredentials = new secretsmanager.Secret(this, 'DatabaseCredentials', {
      description: 'Credentials for the chatbot database',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'chatbot_admin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\',
      },
    });
    
    // Configure automatic rotation for database credentials
    const rotationLambda = new lambda.Function(this, 'SecretRotationFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64, // Graviton3 ARM64 architecture
      handler: 'rotation-handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../backend')),
      memorySize: 256, // Optimized for Graviton3 efficiency
      environment: {
        SECRETS_MANAGER_ENDPOINT: `https://secretsmanager.${this.region}.amazonaws.com`
      },
      timeout: cdk.Duration.minutes(5),
    });
    
    // Grant the rotation Lambda permissions to call Secrets Manager
    dbCredentials.grantRead(rotationLambda);
    dbCredentials.grantWrite(rotationLambda);
    
    // Add additional permissions for rotation Lambda
    rotationLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'rds:DescribeDBInstances',
        'rds:ModifyDBInstance',
        'rds:DescribeDBClusters',
        'rds:ModifyDBCluster',
      ],
      resources: ['*'], // RDS actions require wildcard for describe operations
    }));
    
    // Add VPC permissions for rotation Lambda
    rotationLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateNetworkInterface',
        'ec2:DeleteNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DetachNetworkInterface',
      ],
      resources: ['*'],
    }));
    
    // Add rotation schedule
    dbCredentials.addRotationSchedule('RotationSchedule', {
      automaticallyAfter: cdk.Duration.days(90), // Rotate every 90 days
      rotationLambda: rotationLambda,
    });

    // Create RDS PostgreSQL instance
    const database = new rds.DatabaseInstance(this, 'ChatbotDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: config.database.allocatedStorage,
      storageEncrypted: true,
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentials),
      databaseName: 'chatbot',
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publiclyAccessible: true, // Make the database publicly accessible
    });

    // Add automatic rotation to database credentials
    dbCredentials.addRotationSchedule('DatabaseCredentialsRotation', {
      rotationLambda: rotationLambda,
      automaticallyAfter: cdk.Duration.days(90), // Rotate every 90 days
    });

    // Create S3 bucket for documents
    const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `chatbot-documents-${this.account}-${this.region}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create S3 bucket for website assets
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `chatbot-website-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create Lambda execution role
    const lambdaRole = new iam.Role(this, 'ChatbotLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add permissions for Bedrock
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:ApplyGuardrail',
      ],
      resources: ['*'],
    }));

    // Add permissions for Secrets Manager
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'secretsmanager:GetSecretValue',
      ],
      resources: [dbCredentials.secretArn],
    }));

    // Add permissions for S3
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
        's3:PutObject',
      ],
      resources: [
        documentBucket.bucketArn,
        `${documentBucket.bucketArn}/*`,
      ],
    }));

    // Add permissions for Textract
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'textract:AnalyzeDocument',
      ],
      resources: ['*'],
    }));

    // Create log groups with different retention periods
    const criticalLogs = new logs.LogGroup(this, 'CriticalLogs', {
      logGroupName: '/aws/lambda/ChatbotRagStack-Critical',
      retention: logs.RetentionDays.ONE_WEEK, // 7 days for critical logs
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const standardLogs = new logs.LogGroup(this, 'StandardLogs', {
      logGroupName: '/aws/lambda/ChatbotRagStack-Standard',
      retention: logs.RetentionDays.THREE_DAYS, // 3 days for standard logs
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const debugLogs = new logs.LogGroup(this, 'DebugLogs', {
      logGroupName: '/aws/lambda/ChatbotRagStack-Debug',
      retention: logs.RetentionDays.TWELVE_HOURS, // 12 hours for debug logs
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create main chatbot Lambda function
    const chatbotFunction = new lambda.Function(this, 'ChatbotFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64, // Graviton3 ARM64 architecture
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../backend')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 384, // Optimized for Graviton3 (25% reduction from 512MB)
      role: lambdaRole,
      environment: {
        DB_SECRET_ARN: dbCredentials.secretArn,
        BEDROCK_MODEL_ID: config.bedrock.modelId,
        REGION: this.region,
        CRITICAL_LOG_GROUP: criticalLogs.logGroupName,
        STANDARD_LOG_GROUP: standardLogs.logGroupName,
        DEBUG_LOG_GROUP: debugLogs.logGroupName
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Create Lambda version for provisioned concurrency
    const chatbotVersion = chatbotFunction.currentVersion;

    // Create Lambda alias for provisioned concurrency
    const chatbotAlias = new lambda.Alias(this, 'ChatbotFunctionAlias', {
      aliasName: 'live',
      version: chatbotVersion,
    });

    // Configure provisioned concurrency if enabled
    if (config.lambda?.chatbot?.provisionedConcurrency?.enabled) {
      chatbotAlias.addAutoScaling({
        minCapacity: config.lambda.chatbot.provisionedConcurrency.concurrentExecutions,
        maxCapacity: config.lambda.chatbot.provisionedConcurrency.concurrentExecutions * 2,
      });

      // Add provisioned concurrency configuration
      new lambda.CfnProvisionedConcurrencyConfig(this, 'ChatbotProvisionedConcurrency', {
        functionName: chatbotFunction.functionName,
        qualifier: chatbotAlias.aliasName,
        provisionedConcurrencyCount: config.lambda.chatbot.provisionedConcurrency.concurrentExecutions,
      });
    }

    // Create document processor Lambda function
    const documentProcessorFunction = new lambda.Function(this, 'DocumentProcessorFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64, // Graviton3 ARM64 architecture
      handler: 'document-processor.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../backend')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 640, // Optimized for Graviton3 (37% reduction from 1024MB)
      role: lambdaRole,
      environment: {
        DB_SECRET_ARN: dbCredentials.secretArn,
        DOCUMENT_BUCKET: documentBucket.bucketName,
        REGION: this.region,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Add S3 trigger for document processing
    documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3.NotificationDestination(documentProcessorFunction)
    );

    // Create API Gateway
    const api = new apigateway.RestApi(this, 'ChatbotApi', {
      restApiName: 'Chatbot RAG API',
      description: 'API for the RAG chatbot solution',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
    });

    // Create API key
    const apiKey = api.addApiKey('ChatbotApiKey', {
      apiKeyName: 'ChatbotApiKey',
      description: 'API key for chatbot access',
    });

    // Create usage plan
    const usagePlan = api.addUsagePlan('ChatbotUsagePlan', {
      name: 'ChatbotUsagePlan',
      description: 'Usage plan for chatbot API',
      throttle: {
        rateLimit: config.api.throttling.ratePerMinute,
        burstLimit: config.api.throttling.ratePerHour,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    // Add resources and methods to API Gateway
    const chatResource = api.root.addResource('chat');
    const functionToUse = config.lambda?.chatbot?.provisionedConcurrency?.enabled ? chatbotAlias : chatbotFunction;
    chatResource.addMethod('POST', new apigateway.LambdaIntegration(functionToUse), {
      apiKeyRequired: true,
    });

    // Create WebSocket API for streaming responses
    const webSocketApi = new apigwv2.WebSocketApi(this, 'ChatbotWebSocketApi', {
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration('ConnectIntegration', functionToUse)
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration('DisconnectIntegration', functionToUse)
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration('DefaultIntegration', functionToUse)
      }
    });

    // Add route for sending messages
    webSocketApi.addRoute('sendMessage', {
      integration: new WebSocketLambdaIntegration('SendMessageIntegration', functionToUse)
    });
    
    // Add route for heartbeat
    webSocketApi.addRoute('heartbeat', {
      integration: new WebSocketLambdaIntegration('HeartbeatIntegration', functionToUse)
    });

    // Deploy the WebSocket API
    const webSocketStage = new apigwv2.WebSocketStage(this, 'ChatbotWebSocketStage', {
      webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant permissions for the Lambda function to manage WebSocket connections
    const lambdaForPermissions = config.lambda?.chatbot?.provisionedConcurrency?.enabled ? chatbotAlias : chatbotFunction;
    lambdaForPermissions.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'execute-api:ManageConnections'
      ],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${webSocketApi.apiId}/${webSocketStage.stageName}/POST/@connections/*`
      ]
    }));

    // Update Lambda environment with WebSocket API URL
    lambdaForPermissions.addEnvironment('WEBSOCKET_API_URL', webSocketStage.url);

    // Create CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'ChatbotDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
    });

    // Grant CloudFront access to S3 bucket
    websiteBucket.grantRead(distribution.originAccessIdentity);

    // Create WAF Web ACL
    const webAcl = new wafv2.CfnWebACL(this, 'ChatbotWebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      rules: [
        // AWS Managed Rules
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSetMetric',
          },
        },
        // SQL Injection Protection
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'SQLiRuleSetMetric',
          },
        },
        // IP Reputation Lists
        {
          name: 'AWSManagedRulesAmazonIpReputationList',
          priority: 3,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesAmazonIpReputationList',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'IpReputationMetric',
          },
        },
        // Rate Limiting
        {
          name: 'RateLimitRule',
          priority: 4,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 100,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitMetric',
          },
        },
      ],
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'ChatbotWebAcl',
      },
    });

    // Associate WAF with API Gateway
    new wafv2.CfnWebACLAssociation(this, 'ChatbotWebAclAssociation', {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });

    // Add CloudWatch alarms
    new cloudwatch.Alarm(this, 'ApiErrorRateAlarm', {
      metric: api.metricServerError({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'API Gateway 5XX error rate is too high',
    });

    new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: chatbotFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Lambda function error rate is too high',
    });

    new cloudwatch.Alarm(this, 'DatabaseCpuAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBInstanceIdentifier: database.instanceIdentifier,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'Database CPU utilization is too high',
    });

    // Create CloudWatch dashboard for monitoring cache performance
    new cloudwatch.Dashboard(this, 'BedrockCacheDashboard', {
      dashboardName: 'BedrockPromptCacheMonitoring',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Lambda Invocations',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Invocations',
                dimensionsMap: {
                  FunctionName: chatbotFunction.functionName
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(1)
              })
            ]
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda Duration',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/Lambda',
                metricName: 'Duration',
                dimensionsMap: {
                  FunctionName: chatbotFunction.functionName
                },
                statistic: 'Average',
                period: cdk.Duration.minutes(1)
              })
            ]
          })
        ],
        [
          new cloudwatch.LogQueryWidget({
            title: 'Cache Hit Rate',
            logGroupNames: [chatbotFunction.logGroup.logGroupName],
            view: cloudwatch.LogQueryVisualizationType.PIE,
            width: 12,
            height: 6,
            query: `
              fields @timestamp, @message
              | filter @message like "Response served from Bedrock cache" or @message like "Response generated (not from cache)"
              | stats count(*) as count by if(@message like "Response served from Bedrock cache", "Cache Hit", "Cache Miss") as CacheStatus
              | sort count desc
            `
          }),
          new cloudwatch.LogQueryWidget({
            title: 'Cache Hit Rate Over Time',
            logGroupNames: [chatbotFunction.logGroup.logGroupName],
            view: cloudwatch.LogQueryVisualizationType.LINE,
            width: 12,
            height: 6,
            query: `
              fields @timestamp, @message
              | filter @message like "Response served from Bedrock cache" or @message like "Response generated (not from cache)"
              | stats count(*) as count by bin(5m), if(@message like "Response served from Bedrock cache", "Cache Hit", "Cache Miss") as CacheStatus
              | sort @timestamp asc
            `
          })
        ]
      ]
    });
    
    // Create a comprehensive dashboard
    new cloudwatch.Dashboard(this, 'ChatbotDashboard', {
      dashboardName: 'ChatbotMonitoring',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API Requests',
            left: [api.metricCount()],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'API Latency',
            left: [api.metricLatency()],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'API Errors',
            left: [
              api.metricClientError(),
              api.metricServerError(),
            ],
            width: 8,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Lambda Invocations',
            left: [chatbotFunction.metricInvocations()],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda Duration',
            left: [chatbotFunction.metricDuration()],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Lambda Errors',
            left: [chatbotFunction.metricErrors()],
            width: 8,
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Database CPU',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/RDS',
                metricName: 'CPUUtilization',
                dimensionsMap: {
                  DBInstanceIdentifier: database.instanceIdentifier,
                },
              }),
            ],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Database Connections',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/RDS',
                metricName: 'DatabaseConnections',
                dimensionsMap: {
                  DBInstanceIdentifier: database.instanceIdentifier,
                },
              }),
            ],
            width: 8,
          }),
          new cloudwatch.GraphWidget({
            title: 'Database Free Storage',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/RDS',
                metricName: 'FreeStorageSpace',
                dimensionsMap: {
                  DBInstanceIdentifier: database.instanceIdentifier,
                },
              }),
            ],
            width: 8,
          }),
        ],
      ],
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID',
    });

    new cdk.CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'DocumentBucketName', {
      value: documentBucket.bucketName,
      description: 'S3 bucket name for documents',
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket name for website assets',
    });

    new cdk.CfnOutput(this, 'WebSocketApiUrl', {
      value: webSocketStage.url,
      description: 'WebSocket API URL for streaming responses',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });
    
    new cdk.CfnOutput(this, 'DatabaseSecurityGroupId', {
      value: dbSecurityGroup.securityGroupId,
      description: 'Database security group ID',
    });
  }
}

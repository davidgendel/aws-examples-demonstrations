"""
CDK stack for the chatbot RAG solution.
"""
import json
import os
from pathlib import Path
from typing import List

import aws_cdk as cdk
import aws_cdk.aws_apigateway as apigateway
import aws_cdk.aws_apigatewayv2 as apigwv2
import aws_cdk.aws_apigatewayv2_integrations as apigwv2_integrations
import aws_cdk.aws_cloudfront as cloudfront
import aws_cdk.aws_cloudfront_origins as origins
import aws_cdk.aws_cloudwatch as cloudwatch
import aws_cdk.aws_ec2 as ec2
import aws_cdk.aws_events as events
import aws_cdk.aws_events_targets as targets
import aws_cdk.aws_iam as iam
import aws_cdk.aws_lambda as lambda_
import aws_cdk.aws_logs as logs
import aws_cdk.aws_rds as rds
import aws_cdk.aws_s3 as s3
import aws_cdk.aws_secretsmanager as secretsmanager
import aws_cdk.aws_wafv2 as wafv2
from constructs import Construct


class ChatbotRagStack(cdk.Stack):
    """CDK stack for the chatbot RAG solution."""

    def __init__(self, scope: Construct, id: str, **kwargs) -> None:
        """
        Initialize the stack.
        
        Args:
            scope: CDK construct scope
            id: CDK construct ID
            **kwargs: Additional arguments
        """
        super().__init__(scope, id, **kwargs)

        # Load configuration
        config_path = Path(__file__).parent.parent.parent / "config.json"
        with open(config_path, "r") as f:
            self.config = json.load(f)

        # Create all infrastructure components
        self.db_security_group = self._create_database_security_group()
        self.db_credentials = self._create_database_credentials()
        self.db_instance = self._create_database_instance()
        self.s3_buckets = self._create_s3_buckets()
        self.lambda_role = self._create_lambda_role()
        self.log_groups = self._create_log_groups()
        self.lambda_functions = self._create_lambda_functions()
        self.api_gateway = self._create_api_gateway()
        self.websocket_api = self._create_websocket_api()
        self.cloudfront = self._create_cloudfront_distribution()
        self.waf = self._create_waf()
        self.monitoring = self._create_monitoring()
        self.outputs = self._create_outputs()

    def _create_database_security_group(self) -> ec2.SecurityGroup:
        """Create and configure the database security group."""
        db_security_group = ec2.SecurityGroup(
            self, "DatabaseSecurityGroup",
            description="Security group for RDS PostgreSQL instance",
            allow_all_outbound=True,
        )

        # Allow connections to PostgreSQL from anywhere (restricted by security group)
        db_security_group.add_ingress_rule(
            ec2.Peer.any_ipv4(),
            ec2.Port.tcp(5432),
            "Allow connections to PostgreSQL"
        )
        
        return db_security_group

    def _create_database_credentials(self) -> secretsmanager.Secret:
        """Create database credentials secret."""
        db_credentials = secretsmanager.Secret(
            self, "DatabaseCredentials",
            description="Credentials for the chatbot database",
            generate_secret_string=secretsmanager.SecretStringGenerator(
                secret_string_template=json.dumps({"username": "chatbot_admin"}),
                generate_string_key="password",
                exclude_characters='"@/\\'
            )
        )
        
        # Configure automatic rotation
        rotation_lambda = self._create_rotation_lambda()
        self._configure_rotation_permissions(rotation_lambda, db_credentials)
        
        # Add rotation schedule
        db_credentials.add_rotation_schedule(
            "RotationSchedule",
            automatically_after=cdk.Duration.days(90),  # Rotate every 90 days
            rotation_lambda=rotation_lambda,
        )
        
        return db_credentials

    def _create_rotation_lambda(self) -> lambda_.Function:
        """Create the database credentials rotation Lambda function."""
        return lambda_.Function(
            self, "SecretRotationFunction",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.ARM_64,  # Graviton3 ARM64 architecture
            handler="rotation_handler.handler",
            code=lambda_.Code.from_asset(str(Path(__file__).parent.parent / "backend")),
            memory_size=256,  # Optimized for Graviton3 efficiency
            environment={
                "SECRETS_MANAGER_ENDPOINT": f"https://secretsmanager.{self.region}.amazonaws.com"
            },
            timeout=cdk.Duration.minutes(5),
        )

    def _configure_rotation_permissions(self, rotation_lambda: lambda_.Function, db_credentials: secretsmanager.Secret) -> None:
        """Configure permissions for the rotation Lambda function."""
        # Grant the rotation Lambda permissions to call Secrets Manager
        db_credentials.grant_read(rotation_lambda)
        db_credentials.grant_write(rotation_lambda)
        
        # Add additional permissions for rotation Lambda
        rotation_lambda.add_to_role_policy(iam.PolicyStatement(
            actions=[
                "rds:DescribeDBInstances",
                "rds:ModifyDBInstance",
                "rds:DescribeDBClusters",
                "rds:ModifyDBCluster",
            ],
            resources=["*"],  # RDS actions require wildcard for describe operations
        ))
        
        # Add VPC permissions for rotation Lambda
        rotation_lambda.add_to_role_policy(iam.PolicyStatement(
            actions=[
                "ec2:CreateNetworkInterface",
                "ec2:DeleteNetworkInterface",
                "ec2:DescribeNetworkInterfaces",
                "ec2:DetachNetworkInterface",
            ],
            resources=["*"],
        ))

    def _create_database_instance(self) -> rds.DatabaseInstance:
        """Create the RDS PostgreSQL database instance."""
        database = rds.DatabaseInstance(
            self, "ChatbotDatabase",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_15_4
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.T4G,
                ec2.InstanceSize.MICRO
            ),
            allocated_storage=self.config["database"]["allocatedStorage"],
            storage_encrypted=True,
            security_groups=[self.db_security_group],
            credentials=rds.Credentials.from_secret(self.db_credentials),
            database_name="chatbot",
            backup_retention=cdk.Duration.days(7),
            deletion_protection=False,
            removal_policy=cdk.RemovalPolicy.DESTROY,
            publicly_accessible=True,  # Make the database publicly accessible
        )
        
        return database

    def _create_s3_buckets(self) -> dict:
        document_bucket = s3.Bucket(
            self, "DocumentBucket",
            bucket_name=f"chatbot-documents-{self.account}-{self.region}",
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=cdk.RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        # Create S3 bucket for website assets
        website_bucket = s3.Bucket(
            self, "WebsiteBucket",
            bucket_name=f"chatbot-website-{self.account}-{self.region}",
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=cdk.RemovalPolicy.DESTROY,
            auto_delete_objects=True,
        )

        # Create Lambda execution role
        lambda_role = iam.Role(
            self, "ChatbotLambdaRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name("service-role/AWSLambdaBasicExecutionRole"),
            ],
        )

        # Add permissions for Bedrock
        lambda_role.add_to_policy_statement(
            iam.PolicyStatement(
                actions=[
                    "bedrock:InvokeModel",
                    "bedrock:InvokeModelWithResponseStream",
                    "bedrock:ApplyGuardrail",
                ],
                resources=["*"],
            )
        )

        # Add permissions for Secrets Manager
        lambda_role.add_to_policy_statement(
            iam.PolicyStatement(
                actions=[
                    "secretsmanager:GetSecretValue",
                ],
                resources=[db_credentials.secret_arn],
            )
        )

        # Add permissions for S3
        lambda_role.add_to_policy_statement(
            iam.PolicyStatement(
                actions=[
                    "s3:GetObject",
                    "s3:PutObject",
                ],
                resources=[
                    document_bucket.bucket_arn,
                    f"{document_bucket.bucket_arn}/*",
                ],
            )
        )

        # Add permissions for Textract
        lambda_role.add_to_policy_statement(
            iam.PolicyStatement(
                actions=[
                    "textract:AnalyzeDocument",
                ],
                resources=["*"],
            )
        )

        # Create log groups with different retention periods
        critical_logs = logs.LogGroup(
            self, "CriticalLogs",
            log_group_name="/aws/lambda/ChatbotRagStack-Critical",
            retention=logs.RetentionDays.ONE_WEEK,  # 7 days for critical logs
            removal_policy=cdk.RemovalPolicy.DESTROY,
        )

        standard_logs = logs.LogGroup(
            self, "StandardLogs",
            log_group_name="/aws/lambda/ChatbotRagStack-Standard",
            retention=logs.RetentionDays.THREE_DAYS,  # 3 days for standard logs
            removal_policy=cdk.RemovalPolicy.DESTROY,
        )

        debug_logs = logs.LogGroup(
            self, "DebugLogs",
            log_group_name="/aws/lambda/ChatbotRagStack-Debug",
            retention=logs.RetentionDays.TWELVE_HOURS,  # 12 hours for debug logs
            removal_policy=cdk.RemovalPolicy.DESTROY,
        )

        # Create main chatbot Lambda function
        chatbot_function = lambda_.Function(
            self, "ChatbotFunction",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.ARM_64,  # Graviton3 ARM64 architecture
            handler="lambda_handler.handler",
            code=lambda_.Code.from_asset(str(Path(__file__).parent.parent / "backend")),
            timeout=cdk.Duration.seconds(30),
            memory_size=384,  # Optimized for Graviton3 (25% reduction from 512MB)
            role=lambda_role,
            environment={
                "DB_SECRET_ARN": db_credentials.secret_arn,
                "BEDROCK_MODEL_ID": config["bedrock"]["modelId"],
                "REGION": self.region,
                "CRITICAL_LOG_GROUP": critical_logs.log_group_name,
                "STANDARD_LOG_GROUP": standard_logs.log_group_name,
                "DEBUG_LOG_GROUP": debug_logs.log_group_name
            },
            log_retention=logs.RetentionDays.ONE_WEEK,
        )

        # Create Lambda version for provisioned concurrency
        chatbot_version = chatbot_function.current_version

        # Create Lambda alias for provisioned concurrency
        chatbot_alias = lambda_.Alias(
            self, "ChatbotFunctionAlias",
            alias_name="live",
            version=chatbot_version,
        )

        # Configure provisioned concurrency if enabled
        if config.get("lambda", {}).get("chatbot", {}).get("provisionedConcurrency", {}).get("enabled"):
            concurrent_executions = config["lambda"]["chatbot"]["provisionedConcurrency"]["concurrentExecutions"]
            
            # Add auto scaling to the alias
            scaling = chatbot_alias.add_auto_scaling(
                min_capacity=concurrent_executions,
                max_capacity=concurrent_executions * 2,
            )
            
            # Add provisioned concurrency configuration
            lambda_.CfnProvisionedConcurrencyConfig(
                self, "ChatbotProvisionedConcurrency",
                function_name=chatbot_function.function_name,
                qualifier=chatbot_alias.alias_name,
                provisioned_concurrency_config=concurrent_executions,
            )

        # Create document processor Lambda function
        document_processor_function = lambda_.Function(
            self, "DocumentProcessorFunction",
            runtime=lambda_.Runtime.PYTHON_3_12,
            architecture=lambda_.Architecture.ARM_64,  # Graviton3 ARM64 architecture
            handler="document_processor.handler",
            code=lambda_.Code.from_asset(str(Path(__file__).parent.parent / "backend")),
            timeout=cdk.Duration.minutes(5),
            memory_size=640,  # Optimized for Graviton3 (37% reduction from 1024MB)
            role=lambda_role,
            environment={
                "DB_SECRET_ARN": db_credentials.secret_arn,
                "DOCUMENT_BUCKET": document_bucket.bucket_name,
                "REGION": self.region,
            },
            log_retention=logs.RetentionDays.ONE_WEEK,
        )

        # Add S3 trigger for document processing
        document_bucket.add_event_notification(
            s3.EventType.OBJECT_CREATED,
            s3.LambdaDestination(document_processor_function)
        )

        # Create API Gateway
        api = apigateway.RestApi(
            self, "ChatbotApi",
            rest_api_name="Chatbot RAG API",
            description="API for the RAG chatbot solution",
            default_cors_preflight_options=apigateway.CorsOptions(
                allow_origins=apigateway.Cors.ALL_ORIGINS,
                allow_methods=apigateway.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "X-Amz-Date", "Authorization", "X-Api-Key"],
            ),
        )

        # Create API key
        api_key = api.add_api_key(
            "ChatbotApiKey",
            api_key_name="ChatbotApiKey",
            description="API key for chatbot access",
        )

        # Create usage plan
        usage_plan = api.add_usage_plan(
            "ChatbotUsagePlan",
            name="ChatbotUsagePlan",
            description="Usage plan for chatbot API",
            throttle=apigateway.ThrottleSettings(
                rate_limit=config["api"]["throttling"]["ratePerMinute"],
                burst_limit=config["api"]["throttling"]["ratePerHour"],
            ),
        )

        usage_plan.add_api_key(api_key)
        usage_plan.add_api_stage(
            stage=api.deployment_stage
        )

        # Add resources and methods to API Gateway
        chat_resource = api.root.add_resource("chat")
        function_to_use = chatbot_alias if config.get("lambda", {}).get("chatbot", {}).get("provisionedConcurrency", {}).get("enabled") else chatbot_function
        chat_resource.add_method(
            "POST",
            apigateway.LambdaIntegration(function_to_use),
            api_key_required=True,
        )

        # Create WebSocket API for streaming responses
        websocket_api = apigwv2.WebSocketApi(
            self, "ChatbotWebSocketApi",
            connect_route_options=apigwv2.WebSocketRouteOptions(
                integration=apigwv2_integrations.WebSocketLambdaIntegration(
                    "ConnectIntegration", function_to_use
                )
            ),
            disconnect_route_options=apigwv2.WebSocketRouteOptions(
                integration=apigwv2_integrations.WebSocketLambdaIntegration(
                    "DisconnectIntegration", function_to_use
                )
            ),
            default_route_options=apigwv2.WebSocketRouteOptions(
                integration=apigwv2_integrations.WebSocketLambdaIntegration(
                    "DefaultIntegration", function_to_use
                )
            )
        )

        # Add route for sending messages
        websocket_api.add_route(
            "sendMessage",
            integration=apigwv2_integrations.WebSocketLambdaIntegration(
                "SendMessageIntegration", function_to_use
            )
        )
        
        # Add route for heartbeat
        websocket_api.add_route(
            "heartbeat",
            integration=apigwv2_integrations.WebSocketLambdaIntegration(
                "HeartbeatIntegration", function_to_use
            )
        )

        # Deploy the WebSocket API
        websocket_stage = apigwv2.WebSocketStage(
            self, "ChatbotWebSocketStage",
            web_socket_api=websocket_api,
            stage_name="prod",
            auto_deploy=True,
        )

        # Grant permissions for the Lambda function to manage WebSocket connections
        lambda_for_permissions = chatbot_alias if config.get("lambda", {}).get("chatbot", {}).get("provisionedConcurrency", {}).get("enabled") else chatbot_function
        lambda_for_permissions.add_to_role_policy(
            iam.PolicyStatement(
                actions=[
                    "execute-api:ManageConnections"
                ],
                resources=[
                    f"arn:aws:execute-api:{self.region}:{self.account}:{websocket_api.api_id}/{websocket_stage.stage_name}/POST/@connections/*"
                ]
            )
        )

        # Update Lambda environment with WebSocket API URL
        lambda_for_permissions.add_environment("WEBSOCKET_API_URL", websocket_stage.url)

        # Create CloudFront distribution
        distribution = cloudfront.Distribution(
            self, "ChatbotDistribution",
            default_behavior=cloudfront.BehaviorOptions(
                origin=origins.S3Origin(website_bucket),
                viewer_protocol_policy=cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy=cloudfront.CachePolicy.CACHING_OPTIMIZED,
            ),
            default_root_object="index.html",
        )

        # Grant CloudFront access to S3 bucket
        website_bucket.grant_read(distribution.origin_access_identity)

        # Create WAF Web ACL
        web_acl = wafv2.CfnWebACL(
            self, "ChatbotWebAcl",
            scope="REGIONAL",
            default_action={"allow": {}},
            rules=[
                # AWS Managed Rules
                {
                    "name": "AWSManagedRulesCommonRuleSet",
                    "priority": 1,
                    "override_action": {"none": {}},
                    "statement": {
                        "managed_rule_group_statement": {
                            "vendor_name": "AWS",
                            "name": "AWSManagedRulesCommonRuleSet",
                        }
                    },
                    "visibility_config": {
                        "sampled_requests_enabled": True,
                        "cloud_watch_metrics_enabled": True,
                        "metric_name": "CommonRuleSetMetric",
                    },
                },
                # SQL Injection Protection
                {
                    "name": "AWSManagedRulesSQLiRuleSet",
                    "priority": 2,
                    "override_action": {"none": {}},
                    "statement": {
                        "managed_rule_group_statement": {
                            "vendor_name": "AWS",
                            "name": "AWSManagedRulesSQLiRuleSet",
                        }
                    },
                    "visibility_config": {
                        "sampled_requests_enabled": True,
                        "cloud_watch_metrics_enabled": True,
                        "metric_name": "SQLiRuleSetMetric",
                    },
                },
                # IP Reputation Lists
                {
                    "name": "AWSManagedRulesAmazonIpReputationList",
                    "priority": 3,
                    "override_action": {"none": {}},
                    "statement": {
                        "managed_rule_group_statement": {
                            "vendor_name": "AWS",
                            "name": "AWSManagedRulesAmazonIpReputationList",
                        }
                    },
                    "visibility_config": {
                        "sampled_requests_enabled": True,
                        "cloud_watch_metrics_enabled": True,
                        "metric_name": "IpReputationMetric",
                    },
                },
                # Rate Limiting
                {
                    "name": "RateLimitRule",
                    "priority": 4,
                    "action": {"block": {}},
                    "statement": {
                        "rate_based_statement": {
                            "limit": 100,
                            "aggregate_key_type": "IP",
                        }
                    },
                    "visibility_config": {
                        "sampled_requests_enabled": True,
                        "cloud_watch_metrics_enabled": True,
                        "metric_name": "RateLimitMetric",
                    },
                },
            ],
            visibility_config={
                "sampled_requests_enabled": True,
                "cloud_watch_metrics_enabled": True,
                "metric_name": "ChatbotWebAcl",
            },
        )

        # Associate WAF with API Gateway
        wafv2.CfnWebACLAssociation(
            self, "ChatbotWebAclAssociation",
            resource_arn=api.deployment_stage.stage_arn,
            web_acl_arn=web_acl.attr_arn,
        )

        # Add CloudWatch alarms
        cloudwatch.Alarm(
            self, "ApiErrorRateAlarm",
            metric=api.metric_server_error(
                period=cdk.Duration.minutes(5),
                statistic="Sum",
            ),
            threshold=5,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            alarm_description="API Gateway 5XX error rate is too high",
        )

        cloudwatch.Alarm(
            self, "LambdaErrorAlarm",
            metric=chatbot_function.metric_errors(
                period=cdk.Duration.minutes(5),
                statistic="Sum",
            ),
            threshold=3,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            alarm_description="Lambda function error rate is too high",
        )

        cloudwatch.Alarm(
            self, "DatabaseCpuAlarm",
            metric=cloudwatch.Metric(
                namespace="AWS/RDS",
                metric_name="CPUUtilization",
                dimensions_map={
                    "DBInstanceIdentifier": database.instance_identifier,
                },
                period=cdk.Duration.minutes(5),
                statistic="Average",
            ),
            threshold=80,
            evaluation_periods=3,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            alarm_description="Database CPU utilization is too high",
        )

        # Create CloudWatch dashboard for monitoring cache performance
        cloudwatch.Dashboard(
            self, "BedrockCacheDashboard",
            dashboard_name="BedrockPromptCacheMonitoring",
            widgets=[
                [
                    cloudwatch.GraphWidget(
                        title="Lambda Invocations",
                        left=[
                            cloudwatch.Metric(
                                namespace="AWS/Lambda",
                                metric_name="Invocations",
                                dimensions_map={
                                    "FunctionName": chatbot_function.function_name
                                },
                                statistic="Sum",
                                period=cdk.Duration.minutes(1)
                            )
                        ]
                    ),
                    cloudwatch.GraphWidget(
                        title="Lambda Duration",
                        left=[
                            cloudwatch.Metric(
                                namespace="AWS/Lambda",
                                metric_name="Duration",
                                dimensions_map={
                                    "FunctionName": chatbot_function.function_name
                                },
                                statistic="Average",
                                period=cdk.Duration.minutes(1)
                            )
                        ]
                    )
                ],
                [
                    cloudwatch.LogQueryWidget(
                        title="Cache Hit Rate",
                        log_group_names=[chatbot_function.log_group.log_group_name],
                        view=cloudwatch.LogQueryVisualizationType.PIE,
                        width=12,
                        height=6,
                        query="""
                            fields @timestamp, @message
                            | filter @message like "Response served from Bedrock cache" or @message like "Response generated (not from cache)"
                            | stats count(*) as count by if(@message like "Response served from Bedrock cache", "Cache Hit", "Cache Miss") as CacheStatus
                            | sort count desc
                        """
                    ),
                    cloudwatch.LogQueryWidget(
                        title="Cache Hit Rate Over Time",
                        log_group_names=[chatbot_function.log_group.log_group_name],
                        view=cloudwatch.LogQueryVisualizationType.LINE,
                        width=12,
                        height=6,
                        query="""
                            fields @timestamp, @message
                            | filter @message like "Response served from Bedrock cache" or @message like "Response generated (not from cache)"
                            | stats count(*) as count by bin(5m), if(@message like "Response served from Bedrock cache", "Cache Hit", "Cache Miss") as CacheStatus
                            | sort @timestamp asc
                        """
                    )
                ]
            ]
        )
        
        # Create a comprehensive dashboard
        cloudwatch.Dashboard(
            self, "ChatbotDashboard",
            dashboard_name="ChatbotMonitoring",
            widgets=[
                [
                    cloudwatch.GraphWidget(
                        title="API Requests",
                        left=[api.metric_count()],
                        width=8,
                    ),
                    cloudwatch.GraphWidget(
                        title="API Latency",
                        left=[api.metric_latency()],
                        width=8,
                    ),
                    cloudwatch.GraphWidget(
                        title="API Errors",
                        left=[
                            api.metric_client_error(),
                            api.metric_server_error(),
                        ],
                        width=8,
                    ),
                ],
                [
                    cloudwatch.GraphWidget(
                        title="Lambda Invocations",
                        left=[chatbot_function.metric_invocations()],
                        width=8,
                    ),
                    cloudwatch.GraphWidget(
                        title="Lambda Duration",
                        left=[chatbot_function.metric_duration()],
                        width=8,
                    ),
                    cloudwatch.GraphWidget(
                        title="Lambda Errors",
                        left=[chatbot_function.metric_errors()],
                        width=8,
                    ),
                ],
                [
                    cloudwatch.GraphWidget(
                        title="Database CPU",
                        left=[
                            cloudwatch.Metric(
                                namespace="AWS/RDS",
                                metric_name="CPUUtilization",
                                dimensions_map={
                                    "DBInstanceIdentifier": database.instance_identifier,
                                },
                            ),
                        ],
                        width=8,
                    ),
                    cloudwatch.GraphWidget(
                        title="Database Connections",
                        left=[
                            cloudwatch.Metric(
                                namespace="AWS/RDS",
                                metric_name="DatabaseConnections",
                                dimensions_map={
                                    "DBInstanceIdentifier": database.instance_identifier,
                                },
                            ),
                        ],
                        width=8,
                    ),
                    cloudwatch.GraphWidget(
                        title="Database Free Storage",
                        left=[
                            cloudwatch.Metric(
                                namespace="AWS/RDS",
                                metric_name="FreeStorageSpace",
                                dimensions_map={
                                    "DBInstanceIdentifier": database.instance_identifier,
                                },
                            ),
                        ],
                        width=8,
                    ),
                ],
            ],
        )

        # Add outputs
        cdk.CfnOutput(
            self, "ApiKeyId",
            value=api_key.key_id,
            description="API Key ID",
        )

        cdk.CfnOutput(
            self, "CloudFrontDomain",
            value=distribution.distribution_domain_name,
            description="CloudFront distribution domain name",
        )

        cdk.CfnOutput(
            self, "DocumentBucketName",
            value=document_bucket.bucket_name,
            description="S3 bucket name for documents",
        )

        cdk.CfnOutput(
            self, "WebsiteBucketName",
            value=website_bucket.bucket_name,
            description="S3 bucket name for website assets",
        )

        cdk.CfnOutput(
            self, "WebSocketApiUrl",
            value=websocket_stage.url,
            description="WebSocket API URL for streaming responses",
        )

        cdk.CfnOutput(
            self, "DatabaseEndpoint",
            value=database.instance_endpoint.hostname,
            description="RDS PostgreSQL endpoint",
        )
        
        cdk.CfnOutput(
            self, "DatabaseSecurityGroupId",
            value=db_security_group.security_group_id,
            description="Database security group ID",
        )

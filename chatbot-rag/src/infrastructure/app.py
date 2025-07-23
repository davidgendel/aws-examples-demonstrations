#!/usr/bin/env python3
"""
CDK app entry point for the chatbot RAG solution.
"""
import os

import aws_cdk as cdk

from .cdk_stack import ChatbotRagStack


def main():
    """Main entry point for the CDK app."""
    try:
        app = cdk.App()
        
        # Get region from environment or use default
        region = os.environ.get("CDK_DEPLOY_REGION", os.environ.get("AWS_REGION", "us-east-1"))
        
        # Create the stack
        ChatbotRagStack(
            app, "ChatbotRagStack",
            env=cdk.Environment(
                account=os.environ.get("CDK_DEPLOY_ACCOUNT", os.environ.get("CDK_DEFAULT_ACCOUNT")),
                region=region
            ),
            description="Serverless RAG chatbot solution with Graviton3 ARM64 architecture"
        )
        
        app.synth()
    except Exception as e:
        print(f"Error initializing CDK app: {e}")
        raise


if __name__ == "__main__":
    main()

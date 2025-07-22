#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ChatbotRagStack } from './cdk-stack';

const app = new cdk.App();
new ChatbotRagStack(app, 'ChatbotRagStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1'
  },
  description: 'Low-cost RAG chatbot solution for small businesses'
});

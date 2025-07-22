#!/usr/bin/env node
const readline = require('readline');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Default configuration
const defaultConfig = {
  region: 'us-east-1',
  bedrock: {
    modelId: 'amazon.nova-lite-v1',
    guardrails: {
      createDefault: true
    }
  },
  database: {
    instanceType: 'db.t4g.micro',
    allocatedStorage: 20
  },
  api: {
    throttling: {
      ratePerMinute: 10,
      ratePerHour: 100
    }
  },
  lambda: {
    chatbot: {
      provisionedConcurrency: {
        enabled: true,
        concurrentExecutions: 1
      }
    }
  },
  widget: {
    defaultTheme: {
      primaryColor: '#4287f5',
      secondaryColor: '#f5f5f5',
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      borderRadius: '8px'
    }
  }
};

// Configuration questions
const questions = [
  {
    name: 'region',
    message: 'AWS Region to deploy to:',
    default: defaultConfig.region,
    validate: (value) => {
      const validRegions = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-northeast-1', 'ap-southeast-1', 'ap-southeast-2'];
      return validRegions.includes(value) ? true : 'Please enter a valid AWS region';
    }
  },
  {
    name: 'modelId',
    message: 'Bedrock model ID:',
    default: defaultConfig.bedrock.modelId,
    validate: (value) => {
      const validModels = ['amazon.nova-lite-v1', 'anthropic.claude-v2', 'anthropic.claude-instant-v1'];
      return validModels.includes(value) ? true : 'Please enter a valid Bedrock model ID';
    }
  },
  {
    name: 'databaseType',
    message: 'Database instance type:',
    default: defaultConfig.database.instanceType,
    validate: (value) => {
      const validTypes = ['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium'];
      return validTypes.includes(value) ? true : 'Please enter a valid database instance type';
    }
  },
  {
    name: 'provisionedConcurrency',
    message: 'Enable provisioned concurrency for Lambda? (yes/no):',
    default: defaultConfig.lambda.chatbot.provisionedConcurrency.enabled ? 'yes' : 'no',
    validate: (value) => {
      return ['yes', 'no', 'y', 'n'].includes(value.toLowerCase()) ? true : 'Please enter yes or no';
    }
  },
  {
    name: 'primaryColor',
    message: 'Primary color for the widget (hex code):',
    default: defaultConfig.widget.defaultTheme.primaryColor,
    validate: (value) => {
      return /^#[0-9A-F]{6}$/i.test(value) ? true : 'Please enter a valid hex color code (e.g., #4287f5)';
    }
  }
];

// Ask questions sequentially
async function askQuestions() {
  const config = { ...defaultConfig };
  
  for (const question of questions) {
    const answer = await new Promise((resolve) => {
      rl.question(`${question.message} (${question.default}) `, (answer) => {
        const value = answer.trim() || question.default;
        if (question.validate) {
          const validationResult = question.validate(value);
          if (validationResult !== true) {
            console.log(`\x1b[31m${validationResult}\x1b[0m`);
            resolve(question.default);
          } else {
            resolve(value);
          }
        } else {
          resolve(value);
        }
      });
    });
    
    // Update config based on answers
    switch (question.name) {
      case 'region':
        config.region = answer;
        break;
      case 'modelId':
        config.bedrock.modelId = answer;
        break;
      case 'databaseType':
        config.database.instanceType = answer;
        break;
      case 'provisionedConcurrency':
        config.lambda.chatbot.provisionedConcurrency.enabled = 
          ['yes', 'y'].includes(answer.toLowerCase());
        break;
      case 'primaryColor':
        config.widget.defaultTheme.primaryColor = answer;
        break;
    }
  }
  
  rl.close();
  return config;
}

// Main function
async function main() {
  console.log('\x1b[36m=== Chatbot RAG Setup Wizard ===\x1b[0m\n');
  console.log('This wizard will help you configure and deploy the chatbot solution.\n');
  
  // Check AWS credentials
  try {
    console.log('Checking AWS credentials...');
    execSync('aws sts get-caller-identity', { stdio: 'ignore' });
    console.log('\x1b[32m✓ AWS credentials valid\x1b[0m');
  } catch (error) {
    console.log('\x1b[31m✗ AWS credentials not configured or invalid\x1b[0m');
    console.log('Please run "aws configure" to set up your credentials.');
    process.exit(1);
  }
  
  // Check Node.js version
  try {
    console.log('Checking Node.js version...');
    const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    const versionMatch = nodeVersion.match(/v(\d+)\./);
    if (versionMatch && parseInt(versionMatch[1]) >= 18) {
      console.log(`\x1b[32m✓ Node.js version ${nodeVersion} is compatible\x1b[0m`);
    } else {
      console.log(`\x1b[31m✗ Node.js version ${nodeVersion} is not compatible\x1b[0m`);
      console.log('Please install Node.js 18 or higher.');
      process.exit(1);
    }
  } catch (error) {
    console.log('\x1b[31m✗ Error checking Node.js version\x1b[0m');
    process.exit(1);
  }
  
  // Check CDK version
  try {
    console.log('Checking AWS CDK version...');
    execSync('npx cdk --version', { stdio: 'ignore' });
    console.log('\x1b[32m✓ AWS CDK is installed\x1b[0m');
  } catch (error) {
    console.log('\x1b[31m✗ AWS CDK is not installed\x1b[0m');
    console.log('Installing AWS CDK...');
    try {
      execSync('npm install -g aws-cdk', { stdio: 'inherit' });
      console.log('\x1b[32m✓ AWS CDK installed successfully\x1b[0m');
    } catch (installError) {
      console.log('\x1b[31m✗ Failed to install AWS CDK\x1b[0m');
      process.exit(1);
    }
  }
  
  // Ask configuration questions
  const config = await askQuestions();
  
  // Save configuration
  console.log('\nSaving configuration...');
  fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
  console.log('\x1b[32m✓ Configuration saved to config.json\x1b[0m');
  
  // Ask to proceed with deployment
  const deployAnswer = await new Promise((resolve) => {
    rl.question('\nDo you want to deploy the solution now? (yes/no): ', (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
  
  if (['yes', 'y'].includes(deployAnswer)) {
    console.log('\nDeploying solution...');
    try {
      execSync('./deploy.sh', { stdio: 'inherit' });
      console.log('\n\x1b[32m✓ Deployment completed successfully!\x1b[0m');
    } catch (error) {
      console.log('\n\x1b[31m✗ Deployment failed\x1b[0m');
      console.log('Please check the error messages above and try again.');
    }
  } else {
    console.log('\nYou can deploy the solution later by running "./deploy.sh"');
  }
  
  console.log('\nSetup wizard completed.');
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});

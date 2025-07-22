/**
 * Lambda function for rotating database credentials in Secrets Manager
 */
const { 
  SecretsManagerClient, 
  GetSecretValueCommand,
  UpdateSecretVersionStageCommand,
  PutSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');
const { Client } = require('pg');

const secretsManagerClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

exports.handler = async (event) => {
  console.log('Starting secret rotation');
  
  // Parse event
  const { SecretId, ClientRequestToken, Step } = event;
  
  // Validate event
  if (!SecretId || !ClientRequestToken || !Step) {
    throw new Error('Missing required parameters in event');
  }
  
  // Execute the appropriate step
  switch (Step) {
    case 'createSecret':
      await createSecret(SecretId, ClientRequestToken);
      break;
    case 'setSecret':
      await setSecret(SecretId, ClientRequestToken);
      break;
    case 'testSecret':
      await testSecret(SecretId, ClientRequestToken);
      break;
    case 'finishSecret':
      await finishSecret(SecretId, ClientRequestToken);
      break;
    default:
      throw new Error(`Invalid step: ${Step}`);
  }
  
  console.log(`Successfully completed step ${Step} for secret ${SecretId}`);
  return { 'statusCode': 200 };
};

// Step 1: Create a new secret version
async function createSecret(secretId, token) {
  console.log(`Creating new secret version for ${secretId}`);
  
  try {
    // Get the current secret value
    const getSecretCommand = new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT'
    });
    
    const currentSecret = await secretsManagerClient.send(getSecretCommand);
    const secretValue = JSON.parse(currentSecret.SecretString);
    
    // Generate a new password
    const newPassword = generatePassword();
    
    // Create new secret with the new password
    const newSecretValue = {
      ...secretValue,
      password: newPassword
    };
    
    // Put the new secret value with AWSPENDING stage
    const putSecretCommand = new PutSecretValueCommand({
      SecretId: secretId,
      ClientRequestToken: token,
      SecretString: JSON.stringify(newSecretValue),
      VersionStages: ['AWSPENDING']
    });
    
    await secretsManagerClient.send(putSecretCommand);
    console.log('Successfully created new secret version');
  } catch (error) {
    console.error('Error creating new secret version:', error);
    throw error;
  }
}

// Step 2: Update the database with the new credentials
async function setSecret(secretId, token) {
  console.log(`Setting new secret in database for ${secretId}`);
  
  try {
    // Get the current secret
    const getCurrentCommand = new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT'
    });
    
    const currentSecret = await secretsManagerClient.send(getCurrentCommand);
    const currentSecretValue = JSON.parse(currentSecret.SecretString);
    
    // Get the pending secret
    const getPendingCommand = new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSPENDING'
    });
    
    const pendingSecret = await secretsManagerClient.send(getPendingCommand);
    const pendingSecretValue = JSON.parse(pendingSecret.SecretString);
    
    // Connect to the database using current credentials
    const client = new Client({
      host: currentSecretValue.host,
      port: currentSecretValue.port,
      database: currentSecretValue.dbname,
      user: currentSecretValue.username,
      password: currentSecretValue.password,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    await client.connect();
    
    // Update the user's password in the database
    await client.query(`ALTER USER ${pendingSecretValue.username} WITH PASSWORD '${pendingSecretValue.password}'`);
    
    await client.end();
    console.log('Successfully updated database user password');
  } catch (error) {
    console.error('Error setting new secret in database:', error);
    throw error;
  }
}

// Step 3: Test the new credentials
async function testSecret(secretId, token) {
  console.log(`Testing new secret for ${secretId}`);
  
  try {
    // Get the pending secret
    const getPendingCommand = new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSPENDING'
    });
    
    const pendingSecret = await secretsManagerClient.send(getPendingCommand);
    const secretValue = JSON.parse(pendingSecret.SecretString);
    
    // Try to connect to the database with the new credentials
    const client = new Client({
      host: secretValue.host,
      port: secretValue.port,
      database: secretValue.dbname,
      user: secretValue.username,
      password: secretValue.password,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    await client.connect();
    
    // Execute a simple query to verify the connection
    await client.query('SELECT 1');
    
    await client.end();
    console.log('Successfully tested new secret');
  } catch (error) {
    console.error('Error testing new secret:', error);
    throw error;
  }
}

// Step 4: Finish the rotation by promoting the new secret to AWSCURRENT
async function finishSecret(secretId, token) {
  console.log(`Finishing secret rotation for ${secretId}`);
  
  try {
    // Get the current version
    const getSecretCommand = new GetSecretValueCommand({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT'
    });
    
    const currentVersion = await secretsManagerClient.send(getSecretCommand);
    
    // Check if the current version is already using our token
    if (currentVersion.VersionId === token) {
      console.log('Secret is already current, no action needed');
      return;
    }
    
    // Update the version stages
    const updateVersionCommand = new UpdateSecretVersionStageCommand({
      SecretId: secretId,
      VersionStage: 'AWSCURRENT',
      MoveToVersionId: token,
      RemoveFromVersionId: currentVersion.VersionId
    });
    
    await secretsManagerClient.send(updateVersionCommand);
    console.log('Successfully finished secret rotation');
  } catch (error) {
    console.error('Error finishing secret rotation:', error);
    throw error;
  }
}

// Generate a secure random password
function generatePassword(length = 16) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
  let password = '';
  
  // Ensure at least one character from each category
  password += getRandomChar('abcdefghijklmnopqrstuvwxyz');
  password += getRandomChar('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  password += getRandomChar('0123456789');
  password += getRandomChar('!#$%&()*+,-./:;<=>?@[]^_`{|}~');
  
  // Fill the rest of the password
  for (let i = 4; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  
  // Shuffle the password
  return password.split('').sort(() => 0.5 - Math.random()).join('');
}

// Get a random character from a charset
function getRandomChar(charset) {
  return charset.charAt(Math.floor(Math.random() * charset.length));
}

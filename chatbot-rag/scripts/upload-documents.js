#!/usr/bin/env node

const { S3Client, PutObjectCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');
const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// Parse command line arguments
const args = process.argv.slice(2);
let folderPath = './documents';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--folder' && i + 1 < args.length) {
    folderPath = args[i + 1];
    i++;
  }
}

// Load configuration
const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf8'));

// Initialize AWS SDK v3 clients
const region = config.region || 'us-east-1';
const s3Client = new S3Client({ region });
const cfClient = new CloudFormationClient({ region });

// Get stack outputs
async function getStackOutputs() {
  const stackName = 'ChatbotRagStack';
  
  try {
    const command = new DescribeStacksCommand({ StackName: stackName });
    const response = await cfClient.send(command);
    const outputs = {};
    
    if (response.Stacks && response.Stacks[0].Outputs) {
      response.Stacks[0].Outputs.forEach(output => {
        outputs[output.OutputKey] = output.OutputValue;
      });
    }
    
    return outputs;
  } catch (error) {
    console.error('Error getting stack outputs:', error);
    throw error;
  }
}

// Extract metadata from file
async function extractFileMetadata(filePath) {
  const fileName = path.basename(filePath);
  const fileExt = path.extname(filePath).toLowerCase();
  const fileStat = await stat(filePath);
  
  // Basic metadata
  const metadata = {
    fileName,
    fileSize: fileStat.size,
    lastModified: fileStat.mtime.toISOString(),
    fileType: fileExt.substring(1) // Remove the dot
  };
  
  // Try to extract more metadata based on file type
  try {
    if (fileExt === '.md' || fileExt === '.txt') {
      // For markdown and text files, try to extract title from first line
      const content = await readFile(filePath, 'utf8');
      const firstLine = content.split('\n')[0].trim();
      
      if (firstLine.length > 0 && firstLine.length < 100) {
        metadata.title = firstLine;
      }
    }
    
    // Add more metadata extraction for other file types as needed
    
  } catch (error) {
    console.warn(`Warning: Could not extract additional metadata from ${filePath}:`, error.message);
  }
  
  return metadata;
}

// Upload a file to S3
async function uploadFile(filePath, bucketName) {
  try {
    // Extract metadata from file
    const metadata = await extractFileMetadata(filePath);
    
    const fileContent = await readFile(filePath);
    const fileName = path.basename(filePath);
    
    // Convert metadata to S3 metadata format (all values must be strings)
    const s3Metadata = {};
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        s3Metadata[key] = String(value);
      }
    });
    
    const params = {
      Bucket: bucketName,
      Key: `documents/${fileName}`,
      Body: fileContent,
      ContentType: getContentType(fileName),
      Metadata: s3Metadata
    };
    
    const command = new PutObjectCommand(params);
    const result = await s3Client.send(command);
    console.log(`Uploaded ${fileName} to s3://${bucketName}/documents/${fileName} with metadata`);
    return result;
  } catch (error) {
    console.error(`Error uploading ${filePath}:`, error);
    throw error;
  }
}

// Get content type based on file extension
function getContentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  
  const contentTypes = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.csv': 'text/csv',
    '.json': 'application/json'
  };
  
  return contentTypes[extension] || 'application/octet-stream';
}

// Process all files in a directory
async function processDirectory(dirPath, bucketName) {
  try {
    const files = await readdir(dirPath);
    
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const fileStat = await stat(filePath);
      
      if (fileStat.isDirectory()) {
        await processDirectory(filePath, bucketName);
      } else {
        await uploadFile(filePath, bucketName);
      }
    }
  } catch (error) {
    console.error(`Error processing directory ${dirPath}:`, error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    console.log(`Processing documents from ${folderPath}...`);
    
    // Get bucket name from stack outputs
    const outputs = await getStackOutputs();
    const bucketName = outputs.DocumentBucketName;
    
    if (!bucketName) {
      throw new Error('Document bucket name not found in stack outputs. Make sure the stack is deployed.');
    }
    
    // Process the directory
    await processDirectory(folderPath, bucketName);
    
    console.log('Document upload complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

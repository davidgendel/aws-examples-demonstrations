# Troubleshooting Guide

This guide covers common issues you might encounter with the RAG Chatbot solution and how to resolve them.

## Deployment Issues

### Error: "The security token included in the request is invalid"

**Cause**: Your AWS credentials are invalid or expired.

**Solution**:
1. Verify your AWS credentials are correctly configured:
   ```bash
   aws configure list
   ```
2. If needed, update your credentials:
   ```bash
   aws configure
   ```

### Error: "Resource already exists"

**Cause**: A resource with the same name already exists in your AWS account.

**Solution**:
1. Delete the existing resource or modify the stack name in the CDK code.
2. Run `npm run deploy` again.

## API Issues

### Error: "API Gateway endpoint not responding"

**Cause**: The API Gateway endpoint might be misconfigured or the Lambda function might have an error.

**Solution**:
1. Check the Lambda function logs in CloudWatch:
   ```bash
   aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/ChatbotRagStack"
   ```
2. View the specific log stream:
   ```bash
   aws logs get-log-events --log-group-name "/aws/lambda/ChatbotRagStack-ChatbotFunction" --log-stream-name "LATEST"
   ```

### Error: "API Key invalid"

**Cause**: The API key is incorrect or not included in the request.

**Solution**:
1. Verify the API key in your configuration:
   ```bash
   aws apigateway get-api-keys
   ```
2. Make sure the API key is correctly included in the widget configuration.

## Database Issues

### Error: "Could not connect to database"

**Cause**: The Lambda function cannot connect to the RDS instance.

**Solution**:
1. Check that the security group allows connections from Lambda's IP ranges.
2. Verify the database credentials in Secrets Manager:
   ```bash
   aws secretsmanager list-secrets
   ```
3. Check the RDS instance status:
   ```bash
   aws rds describe-db-instances
   ```
4. Ensure the database is publicly accessible and the security group allows inbound connections on port 5432.
5. If you're deploying in a region other than us-east-1, you'll need to update the security group rules with the appropriate IP ranges for your region:
   ```bash
   # Get your database security group ID
   aws cloudformation describe-stacks --stack-name "ChatbotRagStack" --query "Stacks[0].Outputs[?OutputKey=='DatabaseSecurityGroupId'].OutputValue" --output text
   
   # Add rules for your specific region
   # Replace sg-xxxxxxxx with your security group ID and REGION with your region code
   aws ec2 authorize-security-group-ingress \
       --group-id sg-xxxxxxxx \
       --protocol tcp \
       --port 5432 \
       --cidr "CIDR_BLOCK_FOR_YOUR_REGION" \
       --region REGION
   ```

### Error: "pgvector extension not available"

**Cause**: The pgvector extension is not installed in the PostgreSQL database.

**Solution**:
1. Connect to the database using a PostgreSQL client.
2. Run the following SQL command:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

## Document Processing Issues

### Error: "Failed to process document"

**Cause**: The document format is not supported or the file is corrupted.

**Solution**:
1. Check that the document format is supported (PDF, TXT, MD, HTML, PNG, JPG).
2. Try converting the document to a different format.
3. Check the document processor Lambda logs in CloudWatch.

### Error: "Document too large"

**Cause**: The document exceeds the size limit.

**Solution**:
1. Split the document into smaller files.
2. Compress images in the document.
3. Remove unnecessary content from the document.

## Widget Integration Issues

### Error: "Widget not displaying"

**Cause**: The widget script is not correctly loaded or the container element is missing.

**Solution**:
1. Check that the script is correctly included in your HTML:
   ```html
   <script src="https://your-cloudfront-distribution.cloudfront.net/widget.js"></script>
   ```
2. Verify that the container element exists:
   ```html
   <div id="chatbot-container"></div>
   ```
3. Check for JavaScript errors in the browser console.

### Error: "Widget not connecting to API"

**Cause**: The API endpoint or API key is incorrect.

**Solution**:
1. Verify the API endpoint and API key in the widget configuration.
2. Check for CORS issues in the browser console.
3. Make sure the API Gateway CORS settings allow requests from your domain.

## Performance Issues

### Issue: "Slow response times"

**Cause**: The Lambda function might be cold starting or the model might be taking time to generate responses.

**Solution**:
1. Consider using Provisioned Concurrency for the Lambda function.
2. Optimize the RAG query to retrieve fewer documents.
3. Use a faster Bedrock model (though this may increase costs).

### Issue: "High costs"

**Cause**: Excessive usage or inefficient configuration.

**Solution**:
1. Review CloudWatch metrics to identify high-usage components.
2. Implement caching for common queries.
3. Adjust the rate limiting settings in the API Gateway.
4. Consider using a smaller RDS instance type during low-usage periods.

## Contact Support

If you continue to experience issues after trying these troubleshooting steps, please:

1. Check the AWS Service Health Dashboard for any ongoing service disruptions.
2. Review the AWS documentation for the specific services you're using.
3. Contact AWS Support if you have a support plan.

For bugs or feature requests related to this solution, please open an issue on the GitHub repository.

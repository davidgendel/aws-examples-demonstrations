# Comprehensive Troubleshooting Guide

This guide provides solutions for common issues you might encounter during deployment and operation of your RAG Chatbot.

## 🚨 Emergency Quick Fixes

### Deployment Failed Completely
```bash
# Try these commands in order:
./deploy.sh --recover    # Resume from last successful step
./deploy.sh --clean      # Clean up and start fresh
./deploy.sh              # Run full deployment again
```

### Chatbot Not Working on Website
1. Wait 10 minutes (AWS needs time to propagate changes)
2. Check browser console for JavaScript errors (F12 → Console tab)
3. Verify the integration code is exactly as provided
4. Clear browser cache and try again

### High AWS Costs
1. Check CloudWatch dashboard for unusual usage spikes
2. Verify rate limiting is enabled in API Gateway
3. Consider reducing database instance size temporarily
4. Contact AWS support if costs seem incorrect

## 📋 Pre-Deployment Issues

### AWS Account Setup Problems

**Issue**: "Cannot create AWS account"
- **Cause**: Credit card declined or verification issues
- **Solution**: 
  - Use a different credit card
  - Contact your bank to authorize AWS charges
  - Try creating account from a different browser/device

**Issue**: "AWS CLI not found"
- **Cause**: AWS CLI not installed or not in system PATH
- **Solution**:
  ```bash
  # Windows (run as administrator)
  msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi
  
  # Mac
  brew install awscli
  
  # Linux
  sudo apt install awscli  # Ubuntu/Debian
  sudo yum install awscli  # CentOS/RHEL
  ```

**Issue**: "AWS credentials invalid"
- **Cause**: Incorrect Access Key or Secret Key
- **Solution**:
  1. Go to AWS Console → IAM → Users → Your User → Security Credentials
  2. Create new Access Key (deactivate old one)
  3. Run `aws configure` with new credentials
  4. Test with: `aws sts get-caller-identity`

### Python Environment Issues

**Issue**: "Python not found"
- **Cause**: Python not installed or not in system PATH
- **Solution**:
  ```bash
  # Check if Python is installed
  python3 --version
  
  # If not found, install:
  # Windows: Download from python.org
  # Mac: brew install python3
  # Linux: sudo apt install python3 python3-pip
  ```

**Issue**: "pip not found"
- **Cause**: pip not installed with Python
- **Solution**:
  ```bash
  # Install pip
  python3 -m ensurepip --upgrade
  
  # Or download get-pip.py and run:
  python3 get-pip.py
  ```

**Issue**: "Virtual environment creation failed"
- **Cause**: Insufficient permissions or disk space
- **Solution**:
  ```bash
  # Check disk space
  df -h .
  
  # Try creating venv in different location
  python3 -m venv ~/chatbot-venv
  source ~/chatbot-venv/bin/activate
  ```

## 🔧 Deployment Issues

### Permission Errors

**Issue**: "Access denied" or "Insufficient permissions"
- **Cause**: AWS user lacks required permissions
- **Solution**:
  1. In AWS Console, go to IAM → Users → Your User
  2. Click "Attach policies directly"
  3. Add "AdministratorAccess" policy (for initial deployment)
  4. After deployment, you can reduce permissions

**Issue**: "Cannot assume role"
- **Cause**: Cross-account role issues or trust policy problems
- **Solution**:
  1. Ensure you're deploying to the correct AWS account
  2. Check that your user has `sts:AssumeRole` permissions
  3. Verify the role trust policy allows your user

### Resource Limit Issues

**Issue**: "Service limit exceeded"
- **Cause**: AWS account limits reached
- **Solution**:
  1. Check AWS Service Quotas console
  2. Request limit increases for:
     - Lambda concurrent executions
     - RDS instances
     - VPC resources
  3. Consider deploying in a different region

**Issue**: "Availability Zone has no available capacity"
- **Cause**: AWS capacity issues in selected AZ
- **Solution**:
  1. Try deploying in a different region
  2. Wait and retry (capacity issues are usually temporary)
  3. Modify CDK code to use different AZ

### Network and Connectivity Issues

**Issue**: "Timeout connecting to AWS services"
- **Cause**: Network connectivity or firewall issues
- **Solution**:
  1. Check internet connection
  2. Verify corporate firewall allows AWS API calls
  3. Try using different network (mobile hotspot)
  4. Configure proxy settings if needed:
     ```bash
     export HTTP_PROXY=http://proxy.company.com:8080
     export HTTPS_PROXY=http://proxy.company.com:8080
     ```

**Issue**: "SSL certificate verification failed"
- **Cause**: Corporate firewall or proxy intercepting SSL
- **Solution**:
  ```bash
  # Temporary workaround (not recommended for production)
  export AWS_CA_BUNDLE=""
  
  # Better solution: Configure proper certificates
  export AWS_CA_BUNDLE=/path/to/corporate/ca-bundle.crt
  ```

## 🗄️ Database Issues

### Connection Problems

**Issue**: "Cannot connect to database"
- **Cause**: Security group rules or network configuration
- **Solution**:
  1. Check RDS instance status in AWS Console
  2. Verify security group allows inbound connections on port 5432
  3. For regions other than us-east-1, update security group rules:
     ```bash
     # Get your database security group ID
     aws cloudformation describe-stacks --stack-name "ChatbotRagStack" \
       --query "Stacks[0].Outputs[?OutputKey=='DatabaseSecurityGroupId'].OutputValue" \
       --output text
     
     # Add rule for your region (replace sg-xxxxxxxx and REGION)
     aws ec2 authorize-security-group-ingress \
       --group-id sg-xxxxxxxx \
       --protocol tcp \
       --port 5432 \
       --cidr "0.0.0.0/0" \
       --region REGION
     ```

**Issue**: "Database credentials not found"
- **Cause**: Secrets Manager secret not created or accessible
- **Solution**:
  1. Check Secrets Manager in AWS Console
  2. Verify Lambda has permission to access secret
  3. Manually create secret if missing:
     ```bash
     aws secretsmanager create-secret \
       --name "ChatbotRagStack-DatabaseSecret" \
       --description "Database credentials for RAG chatbot" \
       --secret-string '{"username":"postgres","password":"your-password","host":"your-host","port":5432,"dbname":"chatbot"}'
     ```

### Performance Issues

**Issue**: "Database queries are slow"
- **Cause**: Insufficient database resources or missing indexes
- **Solution**:
  1. Upgrade RDS instance type (t4g.micro → t4g.small)
  2. Check for missing indexes on vector columns
  3. Monitor database performance in CloudWatch
  4. Consider read replicas for high-traffic scenarios

**Issue**: "Database storage full"
- **Cause**: Too many documents or large document sizes
- **Solution**:
  1. Increase allocated storage in RDS
  2. Clean up old document chunks:
     ```bash
     python -m scripts.cleanup_database --older-than 30
     ```
  3. Optimize document chunking strategy

## 🤖 API and Lambda Issues

### Function Errors

**Issue**: "Lambda function timeout"
- **Cause**: Function taking too long to process
- **Solution**:
  1. Increase Lambda timeout in CDK configuration
  2. Optimize database queries
  3. Implement connection pooling
  4. Consider using provisioned concurrency

**Issue**: "Lambda out of memory"
- **Cause**: Insufficient memory allocation
- **Solution**:
  1. Increase Lambda memory in CDK configuration
  2. Optimize code to use less memory
  3. Process documents in smaller batches

**Issue**: "Cold start issues"
- **Cause**: Lambda functions not warmed up
- **Solution**:
  1. Enable provisioned concurrency in config.json:
     ```json
     "lambda": {
       "chatbot": {
         "provisionedConcurrency": {
           "enabled": true,
           "concurrentExecutions": 2
         }
       }
     }
     ```
  2. Implement Lambda warming strategies

### API Gateway Issues

**Issue**: "API Gateway 403 Forbidden"
- **Cause**: API key missing or invalid
- **Solution**:
  1. Check API key in AWS Console → API Gateway → API Keys
  2. Verify API key is included in widget configuration
  3. Ensure API key is associated with usage plan

**Issue**: "CORS errors in browser"
- **Cause**: Cross-origin requests blocked
- **Solution**:
  1. Verify CORS is enabled in API Gateway
  2. Check that your domain is allowed in CORS settings
  3. Add wildcard (*) for testing (not recommended for production)

**Issue**: "Rate limiting errors"
- **Cause**: Too many requests from single source
- **Solution**:
  1. Increase rate limits in config.json
  2. Implement client-side request queuing
  3. Use exponential backoff in widget

## 📄 Document Processing Issues

### Upload Problems

**Issue**: "Document upload fails"
- **Cause**: File format not supported or file too large
- **Solution**:
  1. Check supported formats: PDF, TXT, DOCX, MD, HTML, PNG, JPG
  2. Reduce file size (max 10MB per file)
  3. Convert to supported format
  4. Check S3 bucket permissions

**Issue**: "Text extraction fails"
- **Cause**: Corrupted file or unsupported format
- **Solution**:
  1. Try opening file in original application
  2. Re-save file in same format
  3. Convert to plain text format
  4. Check Textract service limits

### Processing Errors

**Issue**: "Chunking fails"
- **Cause**: Document structure issues or memory problems
- **Solution**:
  1. Break large documents into smaller files
  2. Remove complex formatting
  3. Check document for special characters
  4. Increase Lambda memory allocation

**Issue**: "Embedding generation fails"
- **Cause**: Bedrock service issues or quota limits
- **Solution**:
  1. Check Bedrock service status
  2. Verify model access in Bedrock console
  3. Request quota increases if needed
  4. Retry with exponential backoff

## 🌐 Widget Integration Issues

### Display Problems

**Issue**: "Widget not appearing on website"
- **Cause**: JavaScript errors or incorrect integration
- **Solution**:
  1. Check browser console for errors (F12 → Console)
  2. Verify script URL is correct and accessible
  3. Ensure container div exists: `<div id="chatbot-container"></div>`
  4. Check for conflicting CSS or JavaScript

**Issue**: "Widget appears but doesn't respond"
- **Cause**: API connectivity issues
- **Solution**:
  1. Check network tab in browser dev tools
  2. Verify API endpoint is accessible
  3. Check API key configuration
  4. Test API directly with curl:
     ```bash
     curl -X POST "https://your-api-endpoint/chat" \
       -H "Content-Type: application/json" \
       -H "x-api-key: your-api-key" \
       -d '{"message": "test"}'
     ```

### Styling Issues

**Issue**: "Widget doesn't match website design"
- **Cause**: CSS conflicts or theme configuration
- **Solution**:
  1. Customize theme in widget initialization:
     ```javascript
     SmallBizChatbot.init({
       containerId: 'chatbot-container',
       theme: {
         primaryColor: '#your-brand-color',
         fontFamily: 'Your-Font, sans-serif',
         borderRadius: '8px'
       }
     });
     ```
  2. Add custom CSS to override widget styles
  3. Use browser dev tools to inspect and modify styles

## 💰 Cost and Billing Issues

### Unexpected Charges

**Issue**: "AWS bill higher than expected"
- **Cause**: Unexpected usage or resource configuration
- **Solution**:
  1. Check AWS Cost Explorer for detailed breakdown
  2. Review CloudWatch metrics for usage spikes
  3. Verify rate limiting is working
  4. Check for runaway processes or loops
  5. Consider setting up billing alerts

**Issue**: "Free tier exceeded"
- **Cause**: Usage beyond AWS free tier limits
- **Solution**:
  1. Monitor free tier usage in AWS Console
  2. Optimize resource usage
  3. Consider pausing non-essential resources
  4. Upgrade to paid tier if needed

### Resource Optimization

**Issue**: "Want to reduce costs"
- **Solution**:
  1. Use smaller RDS instance during low-traffic periods
  2. Disable provisioned concurrency if not needed
  3. Implement more aggressive caching
  4. Clean up old logs and data regularly
  5. Use reserved instances for predictable workloads

## 🔍 Monitoring and Debugging

### Log Analysis

**Issue**: "Need to debug issues"
- **Solution**:
  1. Check CloudWatch logs:
     ```bash
     aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/ChatbotRagStack"
     aws logs get-log-events --log-group-name "/aws/lambda/ChatbotRagStack-ChatbotFunction" --log-stream-name "LATEST"
     ```
  2. Enable debug logging in Lambda functions
  3. Use X-Ray tracing for performance analysis
  4. Set up CloudWatch alarms for critical metrics

### Performance Monitoring

**Issue**: "Want to monitor performance"
- **Solution**:
  1. Set up CloudWatch dashboard
  2. Monitor key metrics:
     - Lambda duration and errors
     - API Gateway latency and errors
     - Database connections and query time
     - Bedrock API calls and latency
  3. Set up alerts for threshold breaches
  4. Use AWS Personal Health Dashboard

## 🆘 Emergency Procedures

### Complete System Failure

1. **Check AWS Service Health Dashboard** for outages
2. **Review recent changes** in CloudFormation
3. **Rollback to previous version** if needed:
   ```bash
   aws cloudformation cancel-update-stack --stack-name ChatbotRagStack
   ```
4. **Contact AWS Support** if infrastructure issues persist

### Data Recovery

1. **Database issues**: Restore from automated backup
2. **Document loss**: Re-upload from local documents folder
3. **Configuration loss**: Restore from backup files in `.deployment_backup`

### Security Incidents

1. **Rotate API keys** immediately
2. **Check CloudTrail logs** for suspicious activity
3. **Update security groups** to restrict access
4. **Contact AWS Security** if breach suspected

## 📞 Getting Additional Help

### Self-Help Resources
1. **AWS Documentation**: docs.aws.amazon.com
2. **AWS Forums**: forums.aws.amazon.com
3. **Stack Overflow**: stackoverflow.com (tag: aws)
4. **GitHub Issues**: Check the project repository

### Professional Support
1. **AWS Support Plans**: Consider Business or Enterprise support
2. **AWS Professional Services**: For complex deployments
3. **Third-party consultants**: For ongoing maintenance

### Contact Information
- **Emergency**: Use AWS Support (if you have a support plan)
- **Non-urgent**: Create GitHub issue in project repository
- **Developer**: Contact the person who provided this solution

## 📝 Prevention Tips

1. **Regular backups**: Automate database and configuration backups
2. **Monitoring**: Set up comprehensive monitoring and alerting
3. **Testing**: Test changes in development environment first
4. **Documentation**: Keep deployment notes and configuration changes
5. **Updates**: Regularly update dependencies and AWS services
6. **Security**: Regularly review and update security configurations

Remember: Most issues can be resolved by following this guide systematically. When in doubt, start with the simplest solutions first!

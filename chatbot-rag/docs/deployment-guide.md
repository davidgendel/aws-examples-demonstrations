# RAG Chatbot Deployment Guide for Non-Developers

This guide will walk you through deploying your RAG Chatbot step-by-step, even if you have no technical background.

## 📋 What You'll Need

Before starting, make sure you have:

1. **A computer** (Windows, Mac, or Linux)
2. **An AWS account** (we'll help you set this up)
3. **About 30 minutes** of your time
4. **Your business documents** (PDFs, Word docs, etc.) that you want the chatbot to learn from

## 💰 Cost Information

Your chatbot will cost approximately:
- **Small business (50 users/day)**: $29.76/month
- **Growing business (150 users/day)**: $33.52/month
- **Medium business (500 users/day)**: $72.41/month

*These costs include everything: hosting, AI processing, database, and security.*

## 🚀 Step-by-Step Deployment

### Step 1: Set Up Your AWS Account

1. **Create an AWS Account**:
   - Go to [aws.amazon.com](https://aws.amazon.com)
   - Click "Create an AWS Account"
   - Follow the signup process (you'll need a credit card)
   - Choose the "Basic Support" plan (it's free)

2. **Set Up AWS CLI** (this lets your computer talk to AWS):
   
   **For Windows:**
   ```cmd
   # Download and install from: https://aws.amazon.com/cli/
   # After installation, open Command Prompt and run:
   aws configure
   ```
   
   **For Mac:**
   ```bash
   # Install using Homebrew (if you don't have it, get it from brew.sh)
   brew install awscli
   aws configure
   ```
   
   **For Linux:**
   ```bash
   sudo apt install awscli  # Ubuntu/Debian
   # or
   sudo yum install awscli  # CentOS/RHEL
   aws configure
   ```

3. **Configure AWS CLI**:
   When you run `aws configure`, you'll be asked for:
   - **Access Key ID**: Get this from AWS Console → IAM → Users → Your User → Security Credentials
   - **Secret Access Key**: You'll get this with the Access Key
   - **Region**: Choose the region closest to you (e.g., `us-east-1` for US East Coast)
   - **Output format**: Just press Enter (uses default)

### Step 2: Download the Chatbot Code

1. **Download the code**:
   - Go to the GitHub repository (your developer will provide this link)
   - Click the green "Code" button
   - Click "Download ZIP"
   - Extract the ZIP file to a folder on your computer

2. **Open Terminal/Command Prompt**:
   - **Windows**: Press `Win + R`, type `cmd`, press Enter
   - **Mac**: Press `Cmd + Space`, type "Terminal", press Enter
   - **Linux**: Press `Ctrl + Alt + T`

3. **Navigate to the folder**:
   ```bash
   cd path/to/your/chatbot-folder
   # For example: cd Downloads/chatbot-rag-main
   ```

### Step 3: Choose Your Deployment Method

#### Option A: Super Easy Setup Wizard (Recommended)

1. **Run the setup wizard**:
   ```bash
   python3 scripts/setup_wizard.py
   ```

2. **Follow the prompts**:
   - Enter your business name
   - Provide your email address
   - Choose your AWS region
   - Select your brand colors
   - Configure content filtering

3. **Wait for deployment** (15-20 minutes):
   The wizard handles everything automatically!

#### Option B: One-Click Deployment

1. **Make the script executable** (Mac/Linux only):
   ```bash
   chmod +x deploy.sh
   ```

2. **Run the deployment**:
   ```bash
   ./deploy.sh
   ```

3. **Follow the interactive setup**:
   The script will ask you questions like:
   - Your AWS region (e.g., `us-east-1`)
   - Your business name
   - Your email address
   - Your brand color (e.g., `#4287f5` for blue)

4. **Wait for deployment** (15-20 minutes):
   The script will show progress like:
   ```
   [Step 1/8 - 12%] Checking Prerequisites
   ✅ AWS credentials valid
   [Step 2/8 - 25%] Setting up Python Environment
   ✅ Python environment ready
   ```

### Step 4: Add Your Business Documents

1. **Create a documents folder**:
   ```bash
   mkdir documents
   ```

2. **Add your files**:
   - Copy your business documents (PDFs, Word docs, text files) into the `documents` folder
   - Supported formats: PDF, TXT, DOCX, MD, HTML, PNG, JPG

3. **Upload documents to your chatbot**:
   ```bash
   python3 -m scripts.upload_documents --folder ./documents
   ```

### Step 5: Add the Chatbot to Your Website

After deployment, you'll get code that looks like this:

```html
<!-- Add this to your website's HTML -->
<script src="https://your-unique-url.cloudfront.net/widget.js"></script>
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container',
    theme: {
      primaryColor: '#4287f5',
      fontFamily: 'Arial, sans-serif'
    }
  });
</script>
<div id="chatbot-container"></div>
```

**How to add it to your website:**

1. **WordPress**: Add to a Custom HTML block or in Appearance → Theme Editor
2. **Squarespace**: Add to a Code Block
3. **Wix**: Add to an HTML Component
4. **Shopify**: Add to your theme's template files
5. **Custom website**: Add to your HTML file where you want the chatbot to appear

## 🔧 Managing Your Chatbot

### Adding More Documents
```bash
# Add new files to the documents folder, then run:
python3 -m scripts.upload_documents --folder ./documents
```

### Updating Your Chatbot
```bash
# If you make changes to configuration:
./deploy.sh
```

### Viewing Usage and Costs
1. Go to [AWS Console](https://console.aws.amazon.com)
2. Navigate to CloudWatch → Dashboards
3. Look for "ChatbotRag" dashboard

## 🆘 If Something Goes Wrong

### Common Issues and Solutions

**"AWS credentials not configured"**
- Run `aws configure` again
- Make sure you entered the correct Access Key and Secret Key

**"Python not found"**
- Install Python from [python.org](https://python.org)
- Make sure to check "Add Python to PATH" during installation

**"Permission denied"**
- Your AWS user needs more permissions
- In AWS Console, go to IAM → Users → Your User → Attach Policy → AdministratorAccess

**"Deployment failed"**
- Run `./deploy.sh --recover` to resume from where it failed
- Check the `deployment.log` file for error details

**"Script not found"**
- Make sure you're in the correct directory
- Make the script executable: `chmod +x deploy.sh`

**"Chatbot not responding"**
- Wait 5-10 minutes after deployment (AWS needs time to set everything up)
- Check that you copied the integration code correctly
- Look for JavaScript errors in your browser's developer console (F12 → Console)

### Validation and Testing

Before deploying, you can run validation checks:
```bash
# Check if everything is ready for deployment
python3 scripts/deployment_validator.py --pre-deployment

# After deployment, verify everything works
python3 scripts/deployment_validator.py --post-deployment
```

### Recovery Options

If deployment fails:
```bash
# Resume from last successful step
./deploy.sh --recover

# Start completely fresh
./deploy.sh --clean
./deploy.sh
```

### Getting Help

1. **Check the troubleshooting guide**: `docs/troubleshooting.md`
2. **View deployment logs**: `cat deployment.log`
3. **Run validation**: `python3 scripts/deployment_validator.py`
4. **Contact support**: Email the developer who provided this solution

## 🎯 Success Checklist

After deployment, you should have:
- ✅ A working chatbot on your website
- ✅ Documents uploaded to the knowledge base
- ✅ AWS resources running (costing ~$30/month)
- ✅ Integration code added to your website
- ✅ Ability to add more documents anytime

## 📊 Monitoring Your Chatbot

### Monthly Tasks
- Check AWS billing dashboard for costs
- Review chatbot usage in CloudWatch
- Add new business documents as needed

### Quarterly Tasks
- Review and update your knowledge base
- Check for any AWS service updates
- Consider upgrading database size if usage grows

## 🔒 Security Notes

Your chatbot includes:
- ✅ Content filtering (blocks inappropriate content)
- ✅ Rate limiting (prevents abuse)
- ✅ Data encryption (protects your information)
- ✅ PII detection (blocks personal information)
- ✅ Web application firewall (blocks attacks)

## 💡 Tips for Success

1. **Start small**: Begin with 5-10 key documents
2. **Use clear filenames**: Name files descriptively (e.g., "product-catalog-2024.pdf")
3. **Update regularly**: Add new documents monthly
4. **Test frequently**: Ask your chatbot questions to ensure it's working well
5. **Monitor costs**: Check AWS billing weekly for the first month

## 📞 Support

If you need help:
1. First, check this guide and the troubleshooting section
2. Look at the deployment log file for error messages
3. Try the recovery option: `./deploy.sh --recover`
4. Run validation checks: `python3 scripts/deployment_validator.py`
5. Contact your developer or AWS support

Remember: This is a one-time setup process. Once deployed, your chatbot will run automatically and only needs occasional document updates!

## 🎉 What's Next?

Once your chatbot is deployed:

1. **Test it thoroughly** - Ask various questions to see how it responds
2. **Customize the appearance** - Match your brand colors and fonts
3. **Add more documents** - Keep expanding your knowledge base
4. **Monitor performance** - Check usage and costs regularly
5. **Get feedback** - Ask your customers what they think

**Congratulations!** You now have a professional AI chatbot that will help your customers 24/7! 🚀

# 🚀 RAG Chatbot Quick Start Guide

**Get your AI chatbot running in 20 minutes!** This guide is designed for non-developers.

## 📋 What You Need (5 minutes)

1. **A computer** (Windows, Mac, or Linux)
2. **An AWS account** (free to create, ~$30/month to run)
3. **Your business documents** (PDFs, Word docs, etc.)

## 🎯 Three Ways to Deploy

### Option 1: Super Easy (Recommended for beginners)
```bash
# Download, extract the code, then run:
python3 scripts/setup_wizard.py
```

### Option 2: One-Click Deploy
```bash
# Download, extract the code, then run:
./deploy.sh
```

### Option 3: Step-by-Step (If you want control)
Follow the detailed guide in `docs/deployment-guide.md`

---

## 🚀 Super Easy Deployment (Option 1)

### Step 1: Set Up AWS (One-time setup)

1. **Create AWS Account**: Go to [aws.amazon.com](https://aws.amazon.com) → "Create Account"
2. **Install AWS CLI**:
   - **Windows**: Download from [AWS CLI Windows](https://aws.amazon.com/cli/)
   - **Mac**: `brew install awscli`
   - **Linux**: `sudo apt install awscli`
3. **Configure AWS**: Run `aws configure` and enter your credentials

### Step 2: Download and Run

1. **Download the chatbot code** (your developer will provide the link)
2. **Extract the ZIP file** to a folder
3. **Open terminal/command prompt** in that folder
4. **Run the setup wizard**:
   ```bash
   python3 scripts/setup_wizard.py
   ```

### Step 3: Follow the Wizard

The wizard will ask you simple questions like:
- Your business name
- Your email
- Your preferred colors
- Which AWS region to use

Then it automatically deploys everything!

### Step 4: Add Your Documents

1. **Create a documents folder**: `mkdir documents`
2. **Add your files**: Copy PDFs, Word docs, etc. to the `documents` folder
3. **Upload them**: `python3 -m scripts.upload_documents --folder ./documents`

### Step 5: Add to Your Website

Copy this code to your website where you want the chatbot:

```html
<script src="https://YOUR_UNIQUE_URL/widget.js"></script>
<script>
  SmallBizChatbot.init({
    containerId: 'chatbot-container'
  });
</script>
<div id="chatbot-container"></div>
```

**Done!** Your chatbot is live! 🎉

---

## 🔧 One-Click Deploy (Option 2)

If you're comfortable with terminals:

```bash
# Make executable and run
chmod +x deploy.sh
./deploy.sh
```

This script will:
- ✅ Check all requirements
- ✅ Set up Python environment
- ✅ Deploy to AWS
- ✅ Configure everything
- ✅ Give you integration code

---

## 💰 Cost Breakdown

| Business Size | Users/Day | Monthly Cost |
|---------------|-----------|--------------|
| Small | 50 | $29.76 |
| Growing | 150 | $33.52 |
| Medium | 500+ | $72.41 |

*Includes everything: AI, hosting, database, security*

---

## 🆘 If Something Goes Wrong

### Quick Fixes
```bash
# Resume failed deployment
./deploy.sh --recover

# Start completely fresh
./deploy.sh --clean
./deploy.sh

# Check what went wrong
cat deployment.log
```

### Common Issues

**"AWS credentials not configured"**
→ Run `aws configure` with your AWS keys

**"Python not found"**
→ Install Python from [python.org](https://python.org)

**"Permission denied"**
→ Your AWS user needs more permissions (add AdministratorAccess)

**"Deployment failed"**
→ Check `deployment.log` file for details

**"Script not found"**
→ Make sure you're in the correct directory and the script is executable:
```bash
chmod +x deploy.sh
chmod +x scripts/setup_wizard.py
```

---

## 📚 What Gets Created

Your deployment creates:
- 🤖 **AI Chatbot** (Amazon Bedrock)
- 🗄️ **Database** (PostgreSQL with vector search)
- 🌐 **API** (Lambda + API Gateway)
- 🔒 **Security** (WAF + Content filtering)
- 📁 **File Storage** (S3 buckets)
- 🚀 **CDN** (CloudFront for fast loading)

---

## 🎯 Success Checklist

After deployment, you should have:
- ✅ Chatbot widget code for your website
- ✅ CloudFront URL for the widget
- ✅ API endpoint that responds to messages
- ✅ Documents uploaded to knowledge base
- ✅ AWS resources running (~$30/month)

---

## 🔄 Managing Your Chatbot

### Add More Documents
```bash
# Add files to documents folder, then:
python3 -m scripts.upload_documents --folder ./documents
```

### Update Configuration
```bash
# Edit config.json, then:
./deploy.sh
```

### Monitor Costs
1. Go to [AWS Console](https://console.aws.amazon.com)
2. Navigate to "Billing & Cost Management"
3. Check your monthly spend

### View Usage
1. Go to AWS Console → CloudWatch
2. Look for "ChatbotRag" dashboard

---

## 🎨 Customization

### Change Colors/Fonts
Edit the widget initialization:
```javascript
SmallBizChatbot.init({
  containerId: 'chatbot-container',
  theme: {
    primaryColor: '#your-color',
    fontFamily: 'Your-Font, sans-serif'
  }
});
```

### Add More Features
- Enable/disable streaming responses
- Adjust cache settings
- Customize rate limiting
- Add custom CSS styling

---

## 📞 Getting Help

1. **First**: Check `docs/troubleshooting.md`
2. **Second**: Look at `deployment.log` for errors
3. **Third**: Try the recovery option
4. **Fourth**: Validate your setup:
   ```bash
   python3 scripts/deployment_validator.py --pre-deployment
   ```
5. **Last**: Contact your developer or AWS support

---

## 🎉 You're Done!

Your AI chatbot is now:
- ✅ **Live** on your website
- ✅ **Learning** from your documents
- ✅ **Secure** with content filtering
- ✅ **Scalable** for your business growth
- ✅ **Cost-effective** at ~$30/month

**Next Steps:**
1. Test your chatbot with various questions
2. Add more documents as your business grows
3. Monitor usage and costs monthly
4. Customize the appearance to match your brand

**Congratulations!** You now have a professional AI chatbot powered by AWS! 🚀

---

*Need the detailed technical guide? See `docs/deployment-guide.md`*
*Having issues? See `docs/troubleshooting.md`*

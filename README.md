# 🏆 PSA Grading Service - Professional Card Authentication Platform

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-blue.svg)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://www.docker.com/)
[![Production Ready](https://img.shields.io/badge/Production-Ready-brightgreen.svg)](https://github.com/yourusername/psa-grading-app)
[![Security Hardened](https://img.shields.io/badge/Security-Hardened-red.svg)](https://github.com/yourusername/psa-grading-app)

> **Enterprise-grade PSA (Professional Sports Authenticator) grading service platform for Pokemon card authentication with video proof system, Shopify integration, and comprehensive admin dashboard.**

## 📋 Table of Contents

- [🚀 Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [⚡ Quick Start](#-quick-start)
- [🐳 Docker Development](#-docker-development)
- [🌐 Production Deployment](#-production-deployment)
- [🔧 Configuration](#-configuration)
- [📡 API Documentation](#-api-documentation)
- [🛡️ Security](#️-security)
- [🧪 Testing](#-testing)
- [📚 Documentation](#-documentation)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## 🚀 Features

### 🎯 **Core Functionality**
- **🎥 Video Proof System**: Secure token-based video uploads with real-time validation
- **🔍 PSA Status Tracking**: Automated scraping of PSA website for real-time status updates
- **🃏 TaskMaster Integration**: Search and verify 1,018+ Pokemon cards with visual confirmation
- **🔒 Secure Authentication**: JWT + session-based auth with granular access control
- **📱 QR Code Generation**: Automatic QR codes linking to video proofs and tracking
- **📧 Email Notifications**: Brevo/Replitmail integration for automated communications

### 🛒 **E-commerce Integration**
- **🛍️ Shopify Integration**: Seamless checkout and order management
- **💰 Multi-tier Pricing**: Value ($25), Regular ($45), Express ($80) PSA services
- **📦 Order Processing**: Complete workflow from submission to PSA shipment
- **🧾 Invoice Generation**: Automatic billing and payment tracking

### 👑 **Admin Dashboard**
- **📊 Analytics Dashboard**: Real-time statistics and revenue tracking
- **📋 Request Management**: Comprehensive grading request administration
- **🎬 Video Management**: Secure video viewing and admin controls
- **⚙️ Settings Panel**: Pricing, delays, and notification configuration
- **🔐 Security Controls**: Rate limiting, CSRF protection, and audit logs

### 🔧 **Technical Excellence**
- **🐳 Docker Ready**: Multi-stage builds for development and production
- **🚀 CI/CD Pipeline**: GitHub Actions with automated testing and deployment
- **🛡️ Enterprise Security**: Helmet headers, CORS, rate limiting, input validation
- **📈 Performance Optimized**: Connection pooling, caching, and efficient queries
- **📝 Comprehensive Logging**: Winston with structured JSON logs and rotation

## 🏗️ Architecture

### **System Overview**
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Backend       │    │   External      │
│                 │    │                  │    │   Services      │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Admin Panel │ │◄──►│ │ Express API  │ │◄──►│ │ PSA Website │ │
│ │ (React)     │ │    │ │ + Routes     │ │    │ │ (Scraping)  │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Client      │ │◄──►│ │ Video System │ │◄──►│ │ TaskMaster  │ │
│ │ Portal      │ │    │ │ + Security   │ │    │ │ API         │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Shopify     │ │◄──►│ │ PostgreSQL   │ │◄──►│ │ Brevo Email │ │
│ │ Integration │ │    │ │ Database     │ │    │ │ Service     │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### **Technology Stack**

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | Node.js + Express | REST API server with middleware stack |
| **Frontend** | React + Shopify Polaris | Admin dashboard and client interfaces |
| **Database** | PostgreSQL 15+ | Transactional data with ACID compliance |
| **Authentication** | JWT + Express Sessions | Secure multi-layer authentication |
| **File Storage** | Multer + Filesystem | Video uploads with validation |
| **Email Service** | Brevo API + Nodemailer | Notifications and communications |
| **Web Scraping** | Puppeteer + Cheerio | PSA website status monitoring |
| **Security** | Helmet + CSRF + Rate Limiting | Enterprise-grade protection |
| **Deployment** | Docker + GitHub Actions | Automated CI/CD pipeline |

## ⚡ Quick Start

### **Prerequisites**
- Node.js 18+ and npm
- PostgreSQL 15+ database
- Git for version control

### **1. Clone and Install**
```bash
# Clone the repository
git clone https://github.com/yourusername/psa-grading-app.git
cd psa-grading-app

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### **2. Configure Environment**
```bash
# Edit .env with your configuration
nano .env

# Required variables (see Configuration section below):
# - DATABASE_URL=postgresql://...
# - ADMIN_PASSWORD=your-secure-password
# - SESSION_SECRET=your-session-secret
# - PSA_SECRET=your-psa-secret
# - JWT_SECRET=your-jwt-secret
# - BREVO_API_KEY=your-brevo-key (optional)
```

### **3. Database Setup**
```bash
# The database schema is automatically created on first run
# Just ensure your PostgreSQL database exists and is accessible
```

### **4. Start Development**
```bash
# Start the development server
npm run dev

# Access the application:
# - Main app: http://localhost:5000
# - Admin dashboard: http://localhost:5000/admin
# - Client portal: http://localhost:5000/client-dashboard
```

## 🐳 Docker Development

### **Development with Docker Compose**
```bash
# Start all services (app + PostgreSQL + Redis)
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

### **Development Environment**
- **Hot Reload**: Source code changes automatically restart the server
- **Database**: PostgreSQL with persistent data volume
- **Redis**: Optional caching layer for session storage
- **Networking**: All services connected via Docker network

### **Production Build**
```bash
# Build production image
docker build -t psa-grading-app:latest .

# Run production container
docker run -p 5000:5000 --env-file .env psa-grading-app:latest
```

## 🌐 Production Deployment

### **🤖 Automated GitHub Actions Deployment**

The application includes a comprehensive CI/CD pipeline for automated deployment:

#### **1. Setup GitHub Secrets**
Configure these secrets in your GitHub repository (`Settings > Secrets and variables > Actions`):

```bash
# Server Connection
PRODUCTION_HOST=your-server-ip
PRODUCTION_USER=your-server-user
PRODUCTION_SSH_KEY=your-private-ssh-key
DOMAIN=your-domain.com

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname?sslmode=require

# Application Secrets
ADMIN_PASSWORD=your-secure-admin-password
SESSION_SECRET=your-session-secret
PSA_SECRET=your-psa-secret
JWT_SECRET=your-jwt-secret
PSA_CLIENT_SECRET=your-client-secret

# External Services
BREVO_API_KEY=your-brevo-api-key
PSA_EMAIL=your-psa-email
PSA_PASSWORD=your-psa-password
```

#### **2. Deployment Workflow**
The GitHub Actions workflow automatically:
- ✅ Runs security scans and tests
- 🐳 Builds and pushes Docker images
- 🚀 Deploys to staging on `develop` branch
- 🏭 Deploys to production on `main` branch (with approval)
- 💾 Creates automatic backups before deployment
- 🔍 Performs health checks post-deployment
- 🔄 Automatic rollback on deployment failure

#### **3. Manual Deployment Trigger**
```bash
# Trigger manual deployment via GitHub UI
# Go to Actions → Deploy → Run workflow
# Select environment: staging/production
```

### **📋 Manual VPS Deployment**

For manual deployment on VPS/OVH, see our comprehensive guides:
- 📖 **[Complete OVH Deployment Guide](GUIDE_DEPLOIEMENT_OVH_FINAL.md)** - Step-by-step VPS setup (35 minutes)
- 🔐 **[Configuration Secrets Guide](CONFIGURATION_SECRETS_GUIDE.md)** - Environment variables setup
- 🛡️ **[Security Configuration](DEPLOYMENT_SECURITY_FIXES_COMPLETED.md)** - Production security hardening

### **🔧 Server Requirements**
- **OS**: Ubuntu 20.04+ (recommended)
- **CPU**: 2+ cores
- **RAM**: 4GB+ (8GB recommended)
- **Storage**: 20GB+ SSD
- **Network**: Public IP with domain/subdomain
- **Services**: Nginx, PostgreSQL, Node.js 18+, PM2

## 🔧 Configuration

### **🌍 Environment Variables**

#### **Core Application**
```bash
# Environment
NODE_ENV=production                    # production/development
PORT=5000                             # Application port
TRUST_PROXY=true                      # Enable for reverse proxy

# Domain Configuration
DOMAIN=your-domain.com                # Primary domain
PUBLIC_URL=https://your-domain.com    # Public URL for callbacks
ALLOWED_ORIGINS=https://your-domain.com,https://www.your-domain.com
```

#### **🔐 Security Secrets** (Required)
```bash
# Authentication
ADMIN_PASSWORD=YourSecurePassword123!    # Admin panel password
SESSION_SECRET=your-64-char-secret       # Session encryption key
PSA_SECRET=your-64-char-secret          # PSA token generation
JWT_SECRET=your-64-char-secret          # JWT signing key  
PSA_CLIENT_SECRET=your-64-char-secret   # Client authentication
```

#### **🗄️ Database**
```bash
# PostgreSQL Connection
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require

# Connection Pool Settings (optional)
DB_POOL_MIN=2                         # Minimum connections
DB_POOL_MAX=20                        # Maximum connections
```

#### **📧 Email Services**
```bash
# Brevo Email Service (primary)
BREVO_API_KEY=xkeysib-your-api-key    # Brevo transactional emails

# PSA Account (for scraping)
PSA_EMAIL=your-psa-account@email.com  # PSA website account
PSA_PASSWORD=your-psa-password        # PSA website password
```

#### **🎛️ Optional Features**
```bash
# TaskMaster Integration
TASKMASTER_API_URL=https://taskmaster-api.com  # Card database API
TASKMASTER_API_KEY=your-taskmaster-key         # API authentication

# Logging and Monitoring
LOG_LEVEL=info                        # debug/info/warn/error
ENABLE_METRICS=true                   # Performance metrics
```

### **🔑 Generating Secure Secrets**

Use these commands to generate cryptographically secure secrets:

```bash
# Generate all secrets at once
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "PSA_SECRET=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "PSA_CLIENT_SECRET=$(openssl rand -hex 32)"

# Generate individual 64-character secrets
openssl rand -hex 32
```

### **📋 Service Configuration**

#### **Brevo Email Setup**
1. Create account at [app.brevo.com](https://app.brevo.com)
2. Navigate to **Settings → API Keys**
3. Generate new API key (format: `xkeysib-...`)
4. Add key to `BREVO_API_KEY` environment variable

#### **PSA Account Setup**
1. Create dedicated PSA account at [psacard.co.jp](https://www.psacard.co.jp)
2. **Important**: Use business account, not personal
3. Configure strong password and note credentials
4. Add to `PSA_EMAIL` and `PSA_PASSWORD` variables

#### **Database Setup**
```sql
-- Create database and user
CREATE DATABASE psa_grading;
CREATE USER psa_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE psa_grading TO psa_user;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

## 📡 API Documentation

### **🔐 Authentication Endpoints**

#### **Admin Authentication**
```bash
# Admin login
POST /api/admin/login
Content-Type: application/json

{
  "password": "admin-password"
}

# Response
{
  "success": true,
  "message": "Admin logged in successfully",
  "session_id": "session-token"
}
```

#### **Client Authentication**
```bash
# Client login/signup
POST /api/client/auth
Content-Type: application/json

{
  "email": "customer@example.com",
  "submission_id": "PSA1234567890"
}

# Response
{
  "success": true,
  "token": "jwt-token",
  "customer": { /* customer data */ }
}
```

### **📋 Grading Request Endpoints**

#### **Create Grading Request**
```bash
# Submit new grading request
POST /api/grading
Content-Type: application/json

{
  "customer_email": "customer@example.com",
  "grading_type": "regular",          # value/regular/express
  "card_source": "website",           # website/whatnot
  "card_name": "Charizard Base Set",
  "card_series": "Base Set",
  "card_number": "4/102",
  "card_rarity": "Holo Rare",
  "card_year": 1999,
  "comments": "Excellent condition"
}

# Response
{
  "success": true,
  "request": {
    "id": 123,
    "submission_id": "PSA1702847293456",
    "status": "pending",
    "price": 45.00,
    "estimated_completion": "2024-02-15T10:00:00Z"
  }
}
```

#### **Get Grading Requests**
```bash
# List all requests (admin)
GET /api/admin/grading

# Get specific request
GET /api/grading/:id

# Client request lookup
GET /api/client/request/:submission_id
Authorization: Bearer jwt-token
```

### **🎥 Video Upload Endpoints**

#### **Upload Video Proof**
```bash
# Upload video with secure token
POST /api/video/upload/:submission_id?token=secure-token&ts=timestamp
Content-Type: multipart/form-data

# Form data:
# - video: video file (max 50MB, .webm/.mp4/.mov)
# - duration: video duration in seconds
# - startTime: recording start timestamp

# Response
{
  "success": true,
  "message": "Video uploaded successfully",
  "video": {
    "url": "/api/video/file/PSA1234567890",
    "size": 15728640,
    "duration": 120
  }
}
```

#### **Access Video**
```bash
# Stream video with secure token
GET /api/video/file/:submission_id?token=access-token&ts=timestamp

# Returns: Video stream with range support for smooth playback
```

### **🔍 Search and Verification**

#### **TaskMaster Card Search**
```bash
# Search cards in TaskMaster database
GET /api/cards/search?query=charizard

# Response
{
  "success": true,
  "cards": [
    {
      "tm_card_id": "TM001",
      "name": "Charizard",
      "series": "Base Set",
      "number": "4/102",
      "rarity": "Holo Rare",
      "image_url": "https://cdn.example.com/charizard.jpg"
    }
  ]
}
```

#### **QR Code Generation**
```bash
# Generate QR code for submission
POST /api/admin/qr/generate/:submission_id

# Response
{
  "success": true,
  "qr_code": {
    "image_path": "qr-codes/qr-PSA1234567890-1702847293.png",
    "recording_url": "https://domain.com/video-record?id=PSA1234567890&token=...&ts=...",
    "generated_at": "2024-01-15T10:30:00Z"
  }
}
```

### **📊 Admin Management**

#### **Dashboard Statistics**
```bash
# Get dashboard metrics
GET /api/admin/dashboard

# Response
{
  "success": true,
  "stats": {
    "total_requests": 1247,
    "pending_requests": 45,
    "uploaded_videos": 892,
    "total_revenue": 45680.00,
    "monthly_revenue": 8950.00,
    "grading_types": {
      "value": 234,
      "regular": 567,
      "express": 446
    }
  }
}
```

#### **Video Management**
```bash
# List videos with filters
GET /api/admin/videos?status=uploaded&grading_type=regular&page=1&limit=50

# Update video status
PUT /api/admin/videos/:id
{
  "video_status": "validated",
  "admin_notes": "Video approved for PSA submission"
}
```

### **🔒 Security Features**

#### **Rate Limiting**
- **General**: 100 requests per 15 minutes per IP
- **Admin Login**: 5 attempts per 15 minutes per IP
- **Client Auth**: 10 attempts per 15 minutes per IP
- **Video Upload**: 20 uploads per 5 minutes per IP

#### **CSRF Protection**
- All state-changing operations require CSRF tokens
- Tokens validated server-side with secure random generation
- Headers: `X-CSRF-Token` or form field `_csrf`

#### **Input Validation**
- All inputs sanitized and validated
- File type validation using magic bytes
- SQL injection prevention with parameterized queries
- XSS protection with output encoding

## 🛡️ Security

### **🛡️ Security Architecture**

Our application implements enterprise-grade security measures:

#### **Authentication & Authorization**
- **Multi-layer Authentication**: JWT tokens + Express sessions for different user types
- **Secure Password Storage**: Bcrypt hashing with salt rounds
- **Session Management**: Secure cookies with HttpOnly, Secure, and SameSite flags
- **Token Rotation**: Automatic JWT refresh and expiration handling

#### **Data Protection**
- **Input Validation**: All user inputs validated and sanitized
- **SQL Injection Prevention**: Parameterized queries and ORM protection
- **XSS Protection**: Content Security Policy and output encoding
- **File Upload Security**: Magic byte validation, size limits, and secure storage

#### **Network Security**
- **HTTPS Enforcement**: Strict Transport Security (HSTS) headers
- **CORS Configuration**: Restricted cross-origin resource sharing
- **Rate Limiting**: Granular limits for different endpoint types
- **Firewall Ready**: UFW configuration scripts included

#### **Infrastructure Security**
- **Reverse Proxy**: Nginx configuration with security headers
- **SSL/TLS**: Let's Encrypt automation with certificate renewal
- **Process Isolation**: Non-root user execution and container security
- **Secret Management**: Environment-based configuration with secure generation

### **🔒 Security Configuration**

#### **Helmet Security Headers**
```javascript
// Implemented security headers
{
  "Content-Security-Policy": "default-src 'self'",
  "X-Frame-Options": "DENY", 
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload"
}
```

#### **Rate Limiting Configuration**
| Endpoint Type | Limit | Window | Purpose |
|---------------|-------|--------|---------|
| General API | 100 req | 15 min | Overall protection |
| Admin Login | 5 req | 15 min | Brute force prevention |
| Client Auth | 10 req | 15 min | Account protection |
| Video Upload | 20 req | 5 min | Resource protection |
| PSA Scraping | 30 req | 1 hour | External API respect |

#### **File Upload Security**
- **Magic Byte Validation**: Real content type checking beyond extensions
- **Size Limits**: 50MB maximum for videos, 5MB for images
- **Allowed Types**: `.webm`, `.mp4`, `.mov` for videos; `.jpg`, `.png` for images
- **Storage Isolation**: Uploads stored outside web root with controlled access
- **Virus Scanning**: Ready for integration with antivirus solutions

### **🚨 Security Monitoring**

#### **Audit Logging**
```bash
# Security events automatically logged:
# - Authentication attempts (success/failure)
# - Admin access and actions  
# - File upload attempts
# - Rate limit violations
# - CSRF token validation failures
# - Database connection issues
```

#### **Security Validation Scripts**
```bash
# Run comprehensive security validation
npm run security:validate

# Run final security audit
npm run security:validate-final

# Check for vulnerabilities
npm audit --audit-level high
```

### **🔐 Production Security Checklist**

#### **Before Deployment**
- [ ] All secrets generated with `openssl rand -hex 32`
- [ ] Database credentials are unique and strong
- [ ] SSL certificates configured and auto-renewing
- [ ] Firewall rules configured (UFW/iptables)
- [ ] Regular backup procedures established
- [ ] Monitoring and alerting configured

#### **Regular Maintenance**
- [ ] Monitor security logs for anomalies
- [ ] Update dependencies monthly (`npm audit`)
- [ ] Rotate secrets every 90 days
- [ ] Review and test backup procedures
- [ ] Validate SSL certificate renewals
- [ ] Monitor resource usage and performance

#### **Incident Response**
- [ ] Security incident response plan documented
- [ ] Admin contact information current
- [ ] Backup restoration procedures tested
- [ ] Rollback procedures validated
- [ ] Emergency access procedures documented

## 🧪 Testing

### **🧪 Test Suite**

#### **Running Tests**
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run security validation
npm run security:validate

# Run end-to-end tests
npm run test:e2e
```

#### **Test Categories**

**Unit Tests**
- Authentication functions
- Utility functions (QR code, video validation)
- Database models and queries
- Security token generation/validation

**Integration Tests**
- API endpoint testing
- Database operations
- File upload workflows
- Email service integration

**Security Tests**
- CSRF protection validation
- Rate limiting verification
- Input sanitization testing
- Authentication bypass attempts

**End-to-End Tests**
- Complete user workflows
- Admin dashboard functionality
- Video upload and validation
- PSA status update simulation

### **🔍 Quality Assurance**

#### **Code Quality Tools**
```bash
# ESLint for code quality
npx eslint . --ext .js,.jsx

# Security audit
npm audit --audit-level high

# Dependency vulnerability check
npm run security:validate-final
```

#### **Performance Testing**
```bash
# Load testing endpoints (example)
curl -X POST http://localhost:5000/api/grading \
  -H "Content-Type: application/json" \
  -d '{"customer_email":"test@example.com","grading_type":"regular"}'

# Monitor response times and error rates
# Use tools like Apache Bench (ab) or Artillery for load testing
```

#### **Database Testing**
```bash
# Test database connection
NODE_ENV=test npm run db:test

# Run database migrations in test environment  
NODE_ENV=test npm run db:migrate

# Seed test data
NODE_ENV=test npm run db:seed
```

## 📚 Documentation

### **📖 Additional Documentation**

#### **Deployment Guides**
- 🚀 **[GitHub Actions Deployment](.github/workflows/deploy.yml)** - Automated CI/CD pipeline
- 📋 **[OVH Manual Deployment](GUIDE_DEPLOIEMENT_OVH_FINAL.md)** - Complete VPS setup guide  
- 🔐 **[Secrets Configuration](CONFIGURATION_SECRETS_GUIDE.md)** - Environment variables guide
- 🛡️ **[Security Implementation](DEPLOYMENT_SECURITY_FIXES_COMPLETED.md)** - Security measures documentation

#### **Technical Documentation**
- 🏗️ **[Architecture Overview](replit.md)** - System design and technical decisions
- 📊 **[Database Schema](server/database/init.js)** - Complete database structure
- 🔌 **[API Reference](server/routes/)** - Detailed endpoint documentation
- 🎥 **[Video System](server/utils/videoProof.js)** - Video upload and security implementation

#### **User Guides**
- 👤 **[User Manual](README_UTILISATEUR_FINAL.md)** - End-user documentation
- 👑 **[Admin Guide](public/admin.html)** - Administrator interface guide
- 📱 **[Client Portal Guide](public/client-dashboard.html)** - Customer self-service portal

### **🔧 Development Resources**

#### **Project Structure**
```
psa-grading-app/
├── 📁 server/                     # Backend Node.js application
│   ├── 📁 routes/                 # API route handlers
│   ├── 📁 middleware/             # Express middleware
│   ├── 📁 utils/                  # Utility functions
│   ├── 📁 services/               # External service integrations
│   └── 📄 index.js               # Main server entry point
├── 📁 client/                     # React admin dashboard
│   ├── 📁 src/                    # React source code
│   └── 📄 vite.config.js         # Vite build configuration
├── 📁 public/                     # Static client interfaces
├── 📁 scripts/                    # Deployment and utility scripts
├── 📁 .github/workflows/          # GitHub Actions CI/CD
├── 🐳 Dockerfile                 # Container configuration
├── 🐳 docker-compose.yml         # Development environment
└── 📄 package.json               # Dependencies and scripts
```

#### **Key Components**

| Component | Purpose | Files |
|-----------|---------|-------|
| **Authentication** | User and admin auth | `middleware/auth.js`, `utils/clientAuth.js` |
| **Video System** | Secure uploads | `routes/video.js`, `utils/videoProof.js` |
| **PSA Integration** | Status scraping | `services/psaScraper.js`, `routes/psa.js` |
| **Email Service** | Notifications | `utils/emailService.js`, `utils/brevo.js` |
| **Database** | Data models | `database/init.js`, `config/database.js` |
| **Security** | Protection layers | `middleware/performance.js`, CSP headers |

#### **Development Workflow**
1. **Setup**: Clone repo, install dependencies, configure environment
2. **Development**: Use `npm run dev` for hot-reload development
3. **Testing**: Run test suite with `npm test` before commits
4. **Security**: Validate with `npm run security:validate`  
5. **Deployment**: Push to `develop` for staging, `main` for production

## 🤝 Contributing

### **🤝 How to Contribute**

We welcome contributions to the PSA Grading Service platform! Here's how you can help:

#### **🚀 Getting Started**
1. **Fork** the repository on GitHub
2. **Clone** your fork locally: `git clone https://github.com/yourusername/psa-grading-app.git`
3. **Install** dependencies: `npm install`
4. **Configure** environment: Copy `.env.example` to `.env` and configure
5. **Start** development server: `npm run dev`

#### **🔄 Development Workflow**
```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make your changes
# Write tests for new functionality
# Ensure all tests pass: npm test

# Commit with clear message
git commit -m "Add: New feature description"

# Push to your fork
git push origin feature/your-feature-name

# Create Pull Request on GitHub
```

#### **📋 Contribution Guidelines**

**Code Standards**
- Follow existing code style and ESLint configuration
- Write clear, self-documenting code with comments for complex logic
- Ensure all functions have proper error handling
- Add JSDoc comments for public functions

**Testing Requirements**
- Write unit tests for new utility functions
- Add integration tests for new API endpoints
- Ensure security features are properly tested
- Maintain or improve test coverage

**Security Considerations**
- Never commit secrets or API keys
- Validate all user inputs appropriately
- Follow OWASP security guidelines
- Test for common vulnerabilities (XSS, CSRF, injection)

**Documentation**
- Update README.md for new features
- Document API changes in appropriate sections
- Add inline code comments for complex logic
- Update deployment guides if needed

#### **🐛 Bug Reports**
When reporting bugs, please include:
- **Environment**: OS, Node.js version, browser (if applicable)
- **Steps to Reproduce**: Clear steps to reproduce the issue
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Screenshots**: If applicable
- **Logs**: Relevant error messages or logs

#### **💡 Feature Requests**
For new features, please provide:
- **Use Case**: Why is this feature needed?
- **Proposed Solution**: How would you implement it?
- **Alternatives**: Any alternative approaches considered?
- **Impact**: Who would benefit from this feature?

#### **🏆 Recognition**
Contributors are recognized in our:
- GitHub contributor list
- Release notes for significant contributions
- Special thanks for security improvements
- Credit in documentation for major features

### **📞 Support and Community**

#### **Getting Help**
- 📖 **Documentation**: Check existing docs first
- 🐛 **Issues**: Search existing GitHub issues
- 💬 **Discussions**: Use GitHub Discussions for questions
- 📧 **Contact**: Reach out to maintainers for urgent issues

#### **Code of Conduct**
- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Focus on what's best for the community

## 📄 License

### **📄 MIT License**

```
MIT License

Copyright (c) 2024 PSA Grading Service

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### **🎯 Third-Party Licenses**

This project uses several open-source libraries. Major dependencies include:

- **Express.js**: MIT License - Web framework
- **React**: MIT License - UI library  
- **PostgreSQL**: PostgreSQL License - Database
- **Shopify Polaris**: MIT License - UI components
- **Helmet**: MIT License - Security middleware
- **Winston**: MIT License - Logging library

See `package.json` for complete dependency list and their respective licenses.

---

## 🚀 Ready to Get Started?

1. **⭐ Star this repository** if you find it useful
2. **🍴 Fork the project** to start contributing  
3. **📖 Read the documentation** to understand the system
4. **🛠️ Set up your development environment** with Docker
5. **🚀 Deploy to production** using our automated pipeline

**Built with ❤️ for the Pokemon card collecting community**

---

*Last updated: September 2024 | Version 1.0.0 | Production Ready*
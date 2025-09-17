# 🤝 Contributing to PSA Grading Service

Thank you for your interest in contributing to the PSA Grading Service platform! This document provides guidelines and information for contributors.

## 📋 Table of Contents

- [🚀 Getting Started](#-getting-started)
- [🔄 Development Workflow](#-development-workflow)
- [📋 Contribution Guidelines](#-contribution-guidelines)
- [🧪 Testing Requirements](#-testing-requirements)
- [🛡️ Security Guidelines](#️-security-guidelines)
- [📖 Documentation Standards](#-documentation-standards)
- [🐛 Bug Reports](#-bug-reports)
- [💡 Feature Requests](#-feature-requests)
- [🏆 Recognition](#-recognition)
- [📞 Support](#-support)

## 🚀 Getting Started

### **Prerequisites**
- Node.js 18+ and npm
- PostgreSQL 15+ database
- Git for version control
- Docker (optional, for containerized development)

### **Development Setup**
1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/yourusername/psa-grading-app.git
   cd psa-grading-app
   ```

3. **Install** dependencies:
   ```bash
   npm install
   ```

4. **Configure** environment:
   ```bash
   cp .env.example .env
   # Edit .env with your development configuration
   ```

5. **Start** development server:
   ```bash
   npm run dev
   ```

6. **Verify** setup by accessing:
   - Main app: http://localhost:5000
   - Admin dashboard: http://localhost:5000/admin
   - Client portal: http://localhost:5000/client-dashboard

## 🔄 Development Workflow

### **Branch Strategy**
```bash
# Create feature branch from main
git checkout main
git pull origin main
git checkout -b feature/your-feature-name

# For bug fixes
git checkout -b bugfix/issue-description

# For documentation
git checkout -b docs/update-description
```

### **Making Changes**
1. **Write clear, focused commits**:
   ```bash
   git commit -m "Add: Video upload validation for large files"
   git commit -m "Fix: CSRF token validation in admin panel"
   git commit -m "Update: API documentation for new endpoints"
   ```

2. **Test your changes**:
   ```bash
   # Run test suite
   npm test
   
   # Run security validation
   npm run security:validate
   
   # Test specific functionality
   npm run test:integration
   ```

3. **Push and create Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   # Create PR on GitHub with clear description
   ```

### **Pull Request Process**
1. **Ensure your PR includes**:
   - Clear description of changes
   - Reference to related issues (if any)
   - Screenshots for UI changes
   - Updated documentation (if needed)

2. **PR will be reviewed for**:
   - Code quality and style
   - Security considerations
   - Test coverage
   - Documentation completeness

3. **After approval**:
   - Changes will be merged to main
   - Feature branch will be deleted
   - You'll be credited as a contributor

## 📋 Contribution Guidelines

### **Code Quality Standards**

#### **JavaScript/Node.js Style**
```javascript
// ✅ Good: Clear function with proper error handling
export const validateGradingRequest = async (requestData) => {
  try {
    // Validate required fields
    if (!requestData.customer_email || !requestData.grading_type) {
      throw new Error('Missing required fields');
    }
    
    // Additional validation logic
    return { valid: true, data: requestData };
  } catch (error) {
    console.error('Validation error:', error);
    return { valid: false, error: error.message };
  }
};

// ❌ Avoid: Unclear function without error handling
const validate = (data) => {
  return data.email && data.type;
};
```

#### **React Component Style**
```jsx
// ✅ Good: Clear component with proper PropTypes
import React, { useState, useEffect } from 'react';
import { Card, Button, Banner } from '@shopify/polaris';

const GradingRequestCard = ({ request, onStatusUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleStatusUpdate = async (newStatus) => {
    setLoading(true);
    setError(null);
    
    try {
      await onStatusUpdate(request.id, newStatus);
    } catch (err) {
      setError('Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card sectioned>
      {error && <Banner status="critical">{error}</Banner>}
      {/* Component content */}
    </Card>
  );
};

export default GradingRequestCard;
```

#### **Database Queries**
```javascript
// ✅ Good: Parameterized queries with error handling
export const getGradingRequest = async (submissionId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM grading_requests WHERE submission_id = $1',
      [submissionId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Request not found');
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

// ❌ Avoid: SQL injection vulnerability
const bad = async (id) => {
  return pool.query(`SELECT * FROM grading_requests WHERE id = ${id}`);
};
```

### **File Organization**
```
├── server/
│   ├── routes/           # API route handlers
│   │   ├── admin.js      # Admin-specific routes
│   │   ├── grading.js    # Core grading functionality
│   │   └── video.js      # Video upload/management
│   ├── middleware/       # Express middleware
│   ├── utils/           # Utility functions
│   └── services/        # External service integrations
├── client/
│   ├── src/
│   │   ├── components/   # Reusable React components
│   │   ├── pages/        # Page-level components
│   │   └── utils/        # Client-side utilities
├── public/              # Static files
├── scripts/             # Deployment and utility scripts
└── docs/               # Additional documentation
```

## 🧪 Testing Requirements

### **Test Coverage**
All contributions should maintain or improve test coverage:

```bash
# Run full test suite
npm test

# Run with coverage report
npm run test:coverage

# Run specific test file
npm test -- --grep "grading requests"
```

### **Required Tests**

#### **Unit Tests**
```javascript
// Example unit test
import { validateSecureToken } from '../utils/videoProof.js';

describe('Video Proof Security', () => {
  test('should validate correct token', () => {
    const submissionId = 'PSA1234567890';
    const timestamp = Date.now();
    const token = generateSecureToken(submissionId, timestamp, 'upload');
    
    const result = validateSecureToken(submissionId, token, timestamp, 'upload');
    expect(result.valid).toBe(true);
  });
  
  test('should reject expired token', () => {
    const submissionId = 'PSA1234567890';
    const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000); // 25 hours ago
    const token = generateSecureToken(submissionId, oldTimestamp, 'upload');
    
    const result = validateSecureToken(submissionId, token, oldTimestamp, 'upload');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('TOKEN_EXPIRED');
  });
});
```

#### **Integration Tests**
```javascript
// Example integration test
describe('Grading Request API', () => {
  test('should create new grading request', async () => {
    const requestData = {
      customer_email: 'test@example.com',
      grading_type: 'regular',
      card_name: 'Charizard',
      card_series: 'Base Set'
    };
    
    const response = await request(app)
      .post('/api/grading')
      .send(requestData)
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.request.submission_id).toMatch(/^PSA\d+$/);
  });
});
```

#### **Security Tests**
```javascript
// Example security test
describe('Security Middleware', () => {
  test('should block requests without CSRF token', async () => {
    await request(app)
      .post('/api/admin/update-status')
      .send({ status: 'approved' })
      .expect(403);
  });
  
  test('should rate limit excessive requests', async () => {
    // Make multiple requests quickly
    const promises = Array(10).fill().map(() => 
      request(app).post('/api/admin/login').send({ password: 'wrong' })
    );
    
    const results = await Promise.all(promises);
    const rateLimited = results.some(r => r.status === 429);
    expect(rateLimited).toBe(true);
  });
});
```

## 🛡️ Security Guidelines

### **Security Best Practices**

#### **Input Validation**
```javascript
// ✅ Always validate and sanitize inputs
import validator from 'validator';

const validateEmail = (email) => {
  if (!email || !validator.isEmail(email)) {
    throw new Error('Invalid email format');
  }
  return validator.normalizeEmail(email);
};

const sanitizeSubmissionId = (id) => {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid submission ID');
  }
  
  // Allow only alphanumeric and dashes
  const sanitized = id.replace(/[^a-zA-Z0-9-]/g, '');
  if (sanitized.length === 0 || sanitized.length > 50) {
    throw new Error('Invalid submission ID format');
  }
  
  return sanitized;
};
```

#### **Secret Management**
```javascript
// ✅ Use environment variables for secrets
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is required');
  process.exit(1);
}

// ❌ Never hardcode secrets
const BAD_SECRET = 'hardcoded-secret-123'; // Don't do this!
```

#### **File Upload Security**
```javascript
// ✅ Validate file types using magic bytes
import { fileTypeFromBuffer } from 'file-type';

const validateVideoFile = async (buffer) => {
  const fileType = await fileTypeFromBuffer(buffer);
  
  if (!fileType) {
    throw new Error('Unable to determine file type');
  }
  
  const allowedTypes = ['webm', 'mp4', 'mov'];
  if (!allowedTypes.includes(fileType.ext)) {
    throw new Error(`File type ${fileType.ext} not allowed`);
  }
  
  return fileType;
};
```

### **Security Checklist**
Before submitting security-related changes:

- [ ] All user inputs are validated and sanitized
- [ ] No secrets are hardcoded or committed
- [ ] SQL queries use parameterized statements
- [ ] File uploads are properly validated
- [ ] Authentication and authorization are properly implemented
- [ ] Rate limiting is in place for sensitive endpoints
- [ ] Error messages don't leak sensitive information
- [ ] HTTPS is enforced in production
- [ ] Security headers are properly configured

## 📖 Documentation Standards

### **Code Documentation**
```javascript
/**
 * Generates a secure QR code for PSA submission with video recording URL
 * @param {string} submissionId - Unique PSA submission identifier
 * @param {Object} requestData - Grading request data for QR code context
 * @param {string} requestData.card_name - Name of the card being graded
 * @param {string} requestData.customer_email - Customer email address
 * @param {string} requestData.grading_type - Type of PSA grading service
 * @returns {Promise<Object>} QR code data including image path and recording URL
 * @throws {Error} If submission ID is invalid or QR generation fails
 * 
 * @example
 * const qrData = await generateCompleteQRCode('PSA1234567890', {
 *   card_name: 'Charizard Base Set',
 *   customer_email: 'customer@example.com',
 *   grading_type: 'regular'
 * });
 * console.log(`QR code saved to: ${qrData.image_path}`);
 */
export const generateCompleteQRCode = async (submissionId, requestData = {}) => {
  // Implementation here
};
```

### **API Documentation**
When adding new endpoints, document them in the README:

```markdown
#### **New Endpoint Name**
```bash
# Brief description
POST /api/new/endpoint
Content-Type: application/json
Authorization: Bearer jwt-token (if required)

{
  "parameter": "value",
  "required_field": "example"
}

# Response
{
  "success": true,
  "data": {
    "result": "value"
  }
}
```

### **README Updates**
When adding significant features:
1. Update the Features section
2. Add to API Documentation if applicable
3. Update installation/configuration if needed
4. Add to troubleshooting if relevant

## 🐛 Bug Reports

### **Before Reporting**
1. **Search existing issues** to avoid duplicates
2. **Test with latest version** to ensure bug still exists
3. **Check documentation** to verify expected behavior

### **Bug Report Template**
```markdown
## Bug Description
Clear and concise description of the bug.

## Environment
- OS: [e.g., Ubuntu 20.04, macOS 12.0, Windows 11]
- Node.js Version: [e.g., 18.17.0]
- Browser: [e.g., Chrome 115, Firefox 116] (if applicable)
- PSA Grading App Version: [e.g., 1.0.0]

## Steps to Reproduce
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

## Expected Behavior
What you expected to happen.

## Actual Behavior
What actually happened.

## Screenshots/Logs
If applicable, add screenshots or log output.

## Additional Context
Any other context about the problem.
```

### **Priority Levels**
- **🔴 Critical**: Security vulnerabilities, data loss, system crashes
- **🟠 High**: Core functionality broken, major features unusable
- **🟡 Medium**: Minor features affected, workarounds available
- **🟢 Low**: Cosmetic issues, minor inconveniences

## 💡 Feature Requests

### **Feature Request Template**
```markdown
## Feature Summary
Brief description of the proposed feature.

## Problem Statement
What problem does this feature solve? Who would benefit?

## Proposed Solution
Detailed description of how you envision the feature working.

## Alternative Solutions
Any alternative approaches you've considered.

## Implementation Considerations
- Technical requirements
- Security implications
- Performance impact
- Backward compatibility

## Additional Context
Mockups, examples, or related issues.
```

### **Feature Evaluation Criteria**
- **User Value**: How many users would benefit?
- **Technical Feasibility**: How complex is the implementation?
- **Security Impact**: Does it introduce new security considerations?
- **Maintenance Burden**: Long-term maintenance requirements?
- **Alignment**: Does it fit with project goals and architecture?

## 🏆 Recognition

### **Contributors Hall of Fame**
We recognize contributors in several ways:

#### **GitHub Recognition**
- Listed in GitHub contributor statistics
- Mentioned in release notes for significant contributions
- Special badges for security improvements and major features

#### **Types of Contributions**
- 🐛 **Bug Fixes**: Resolving issues and improving stability
- ✨ **Features**: Adding new functionality and capabilities
- 🛡️ **Security**: Identifying and fixing security vulnerabilities
- 📖 **Documentation**: Improving guides, API docs, and examples
- 🧪 **Testing**: Adding tests and improving test coverage
- 🎨 **UI/UX**: Enhancing user interface and experience
- ⚡ **Performance**: Optimizing speed and resource usage

#### **Special Recognition**
- **Security Champions**: Contributors who identify and fix security issues
- **Documentation Heroes**: Contributors who significantly improve documentation
- **Community Leaders**: Contributors who help onboard new developers

### **Contribution Statistics**
- Total commits and lines of code
- Issues resolved and features implemented
- Test coverage improvements
- Documentation contributions

## 📞 Support

### **Getting Help**

#### **Documentation First**
1. Check the [README.md](README.md) for setup and usage instructions
2. Review [API Documentation](README.md#-api-documentation) for endpoint details
3. Read [Deployment Guides](GUIDE_DEPLOIEMENT_OVH_FINAL.md) for production setup
4. Consult [Security Documentation](README.md#️-security) for security practices

#### **Community Support**
- **GitHub Issues**: For bug reports and feature requests
- **GitHub Discussions**: For questions and community support
- **Pull Request Reviews**: Get feedback on your contributions

#### **Direct Contact**
For sensitive security issues or urgent matters:
- **Security Issues**: Create a private security advisory on GitHub
- **Maintainer Contact**: Reach out through GitHub profile

### **Response Times**
- **Security Issues**: Within 24 hours
- **Bug Reports**: Within 3-5 business days
- **Feature Requests**: Within 1 week
- **Pull Requests**: Within 3-5 business days

### **Code of Conduct**

We are committed to providing a welcoming and inclusive environment:

#### **Our Standards**
- **Be Respectful**: Treat all community members with respect and kindness
- **Be Inclusive**: Welcome people of all backgrounds and experience levels
- **Be Constructive**: Provide helpful feedback and support others' learning
- **Be Professional**: Maintain professional communication in all interactions

#### **Unacceptable Behavior**
- Harassment, discrimination, or personal attacks
- Trolling, insulting comments, or intentionally disruptive behavior
- Publishing private information without consent
- Any behavior that would be inappropriate in a professional setting

#### **Enforcement**
- First violation: Warning and guidance
- Repeated violations: Temporary restriction from community participation
- Severe violations: Permanent ban from the project

### **Community Guidelines**
- **Ask Questions**: No question is too basic - we all started somewhere
- **Share Knowledge**: Help others learn and grow
- **Give Credit**: Acknowledge others' contributions and ideas
- **Stay Focused**: Keep discussions relevant to the project
- **Be Patient**: Remember that contributors are volunteers with limited time

---

## 🚀 Ready to Contribute?

1. **⭐ Star the repository** to show your support
2. **🍴 Fork the project** to your GitHub account
3. **📋 Pick an issue** from our [Issues](https://github.com/yourusername/psa-grading-app/issues) page
4. **💻 Start coding** following our guidelines
5. **📤 Submit a pull request** with your improvements

**Together, we're building the best PSA grading platform for the Pokemon community!**

---

*Thank you for contributing to PSA Grading Service! 🙏*
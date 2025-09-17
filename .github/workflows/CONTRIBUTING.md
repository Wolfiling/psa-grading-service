# 🤝 Contributing to PSA Grading App

Thank you for your interest in contributing to PSA Grading App! This guide will help you get started and ensure your contributions are valuable and well-integrated.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Issue Reporting](#issue-reporting)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Security](#security)

## 🤝 Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct:

- **Be respectful** and inclusive in all interactions
- **Be collaborative** and help others learn and contribute
- **Be patient** with newcomers and different skill levels
- **Be professional** in all communications
- **Report violations** to the project maintainers

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** installed
- **npm** or **yarn** package manager
- **Git** for version control
- **Docker** (optional, for containerized development)
- **PostgreSQL** database (local or remote)

### Quick Start

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/psa-grading-app.git
   cd psa-grading-app
   ```

2. **Set up development environment**
   ```bash
   # Install dependencies
   npm install
   
   # Copy environment template
   cp .env.template .env.local
   
   # Edit .env.local with your local configuration
   nano .env.local
   ```

3. **Start development server**
   ```bash
   # Run in development mode
   npm run dev
   ```

4. **Verify setup**
   - Open http://localhost:5000 in your browser
   - Ensure the application loads without errors

## 🛠️ Development Setup

### Local Database Setup

**Option 1: Docker (Recommended)**
```bash
# Start PostgreSQL container
docker run --name psa-postgres \
  -e POSTGRES_DB=psa_grading_dev \
  -e POSTGRES_USER=psa_user \
  -e POSTGRES_PASSWORD=psa_password \
  -p 5432:5432 \
  -d postgres:15

# Your DATABASE_URL in .env.local:
# DATABASE_URL=postgresql://psa_user:psa_password@localhost:5432/psa_grading_dev
```

**Option 2: Local PostgreSQL**
```bash
# Install PostgreSQL and create database
createdb psa_grading_dev
```

### Environment Configuration

Required environment variables in `.env.local`:

```bash
# Application
NODE_ENV=development
PORT=5000

# Database
DATABASE_URL=postgresql://psa_user:psa_password@localhost:5432/psa_grading_dev

# Security (development values)
ADMIN_PASSWORD=dev123!
SESSION_SECRET=dev_session_secret
PSA_SECRET=dev_psa_secret
JWT_SECRET=dev_jwt_secret
PSA_CLIENT_SECRET=dev_client_secret

# External Services (optional for development)
BREVO_API_KEY=your_test_key
PSA_EMAIL=your_test_email
PSA_PASSWORD=your_test_password
```

## 📝 Contributing Guidelines

### Types of Contributions

We welcome the following types of contributions:

- 🐛 **Bug fixes** - Fix existing issues
- ✨ **New features** - Add new functionality
- 📚 **Documentation** - Improve docs and guides
- 🎨 **UI/UX improvements** - Enhance user experience
- ⚡ **Performance optimizations** - Make the app faster
- 🔒 **Security improvements** - Enhance security measures
- 🧪 **Tests** - Add or improve test coverage
- 🔧 **Tooling** - Improve development experience

### Before You Start

1. **Check existing issues** - Look for related issues or feature requests
2. **Create an issue first** - For major changes, discuss them in an issue first
3. **Get assignment** - Wait for maintainer assignment to avoid duplicate work
4. **Fork and branch** - Create a feature branch from `develop`

### Branching Strategy

```
main          # Production branch
├── develop   # Development branch  
├── feature/  # New features
├── bugfix/   # Bug fixes
├── hotfix/   # Critical production fixes
└── release/  # Release preparation
```

**Branch naming convention:**
- `feature/short-description` - New features
- `bugfix/issue-number-description` - Bug fixes
- `hotfix/critical-issue-description` - Critical fixes
- `docs/improvement-description` - Documentation

## 🔄 Pull Request Process

### 1. Prepare Your Branch

```bash
# Create and switch to feature branch
git checkout develop
git pull origin develop
git checkout -b feature/my-awesome-feature

# Make your changes
# ... code, commit, code, commit ...

# Push to your fork
git push origin feature/my-awesome-feature
```

### 2. Create Pull Request

1. **Open PR** against `develop` branch (not `main`)
2. **Fill out PR template** completely
3. **Link related issues** using keywords (fixes #123)
4. **Add reviewers** from the team
5. **Mark as draft** if still in progress

### 3. Review Process

- **Automated checks** must pass (CI/CD, tests, linting)
- **Code review** by at least 1 maintainer
- **Security review** for sensitive changes
- **Manual testing** in review environment

### 4. After Approval

- **Squash and merge** (preferred) or regular merge
- **Delete feature branch** after merge
- **Monitor deployment** to staging

## 🐛 Issue Reporting

### Bug Reports

Use our [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.yml) and include:

- **Clear description** of the issue
- **Steps to reproduce** the problem
- **Expected vs actual behavior**
- **Screenshots** if applicable
- **Environment details** (browser, OS, etc.)
- **Error messages** from console

### Feature Requests

Use our [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.yml) and include:

- **Problem statement** - What problem does this solve?
- **Proposed solution** - How should it work?
- **User stories** - Who benefits and how?
- **Acceptance criteria** - What defines "done"?
- **Business impact** - Why is this valuable?

## 🏗️ Development Workflow

### Daily Development

```bash
# Start your day
git checkout develop
git pull origin develop

# Create feature branch  
git checkout -b feature/my-feature

# Development cycle
npm run dev          # Start development server
npm run test:watch   # Run tests in watch mode
npm run lint         # Check code style

# Commit your work
git add .
git commit -m "feat: add user authentication"

# Before pushing
npm run test         # Run all tests
npm run lint         # Final style check
git push origin feature/my-feature
```

### Available Scripts

```bash
# Development
npm run dev           # Start dev server with hot reload
npm run build         # Build for production
npm run start         # Start production server

# Testing  
npm run test          # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Generate coverage report

# Code Quality
npm run lint          # ESLint check
npm run lint:fix      # Auto-fix linting issues
npm run format        # Prettier formatting

# Security
npm run security:validate  # Security validation
npm audit                  # Check for vulnerabilities

# Database
npm run db:migrate    # Run database migrations
npm run db:seed       # Seed development data
```

## 📏 Coding Standards

### JavaScript/Node.js

```javascript
// Use modern ES6+ syntax
const getUserById = async (id) => {
  try {
    const user = await User.findById(id);
    return user;
  } catch (error) {
    logger.error('Failed to fetch user:', error);
    throw new Error('User not found');
  }
};

// Use meaningful variable names
const isUserAuthenticated = checkUserAuth();
const activeUsers = users.filter(user => user.isActive);

// Add JSDoc comments for functions
/**
 * Validates PSA card data
 * @param {Object} cardData - The card data to validate
 * @param {string} cardData.name - Card name
 * @param {number} cardData.year - Card year
 * @returns {boolean} True if valid
 */
const validateCardData = (cardData) => {
  // Implementation
};
```

### CSS/Styling

```css
/* Use BEM methodology */
.card-list {}
.card-list__item {}
.card-list__item--active {}

/* Mobile-first approach */
.container {
  width: 100%;
  padding: 1rem;
}

@media (min-width: 768px) {
  .container {
    max-width: 1200px;
    margin: 0 auto;
  }
}
```

### File Organization

```
src/
├── components/          # Reusable UI components
├── pages/              # Page-specific components
├── services/           # Business logic and API calls
├── utils/              # Utility functions
├── config/             # Configuration files
├── middleware/         # Express middleware
├── routes/             # API route handlers
└── tests/              # Test files
```

### Naming Conventions

- **Files:** `kebab-case.js` (e.g., `user-service.js`)
- **Functions:** `camelCase` (e.g., `getUserById`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `API_BASE_URL`)
- **Classes:** `PascalCase` (e.g., `UserService`)
- **Components:** `PascalCase` (e.g., `CardList`)

## 🧪 Testing

### Test Structure

We use **Vitest** for testing:

```javascript
// tests/user.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, getUserById } from '../src/services/user-service.js';

describe('User Service', () => {
  beforeEach(() => {
    // Setup test data
  });

  it('should create a new user', async () => {
    const userData = { name: 'John Doe', email: 'john@example.com' };
    const user = await createUser(userData);
    
    expect(user).toBeDefined();
    expect(user.id).toBeTruthy();
    expect(user.name).toBe('John Doe');
  });

  it('should handle invalid user data', async () => {
    const invalidData = { name: '' };
    
    await expect(createUser(invalidData))
      .rejects
      .toThrow('Name is required');
  });
});
```

### Test Categories

1. **Unit Tests** - Individual functions/components
2. **Integration Tests** - API endpoints, database operations
3. **E2E Tests** - Full user workflows (planned)

### Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npm run test user.test.js

# Run tests with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Test Guidelines

- **Write tests first** (TDD when possible)
- **Test edge cases** and error conditions
- **Keep tests simple** and focused
- **Use descriptive test names**
- **Mock external dependencies**
- **Aim for >80% code coverage**

## 🔒 Security

### Security Practices

- **Never commit secrets** (API keys, passwords, tokens)
- **Use environment variables** for sensitive configuration
- **Validate all input** from users and external APIs
- **Sanitize data** before database operations
- **Use HTTPS** in all environments
- **Keep dependencies updated**

### Security Checklist

Before submitting PRs involving security-sensitive areas:

- [ ] Input validation implemented
- [ ] SQL injection prevention verified
- [ ] XSS protection in place
- [ ] Authentication/authorization correct
- [ ] No secrets in code
- [ ] Error handling doesn't leak information
- [ ] Rate limiting applied where needed

### Reporting Security Issues

**DO NOT** create public GitHub issues for security vulnerabilities. Instead:

1. **Email** security@psa-grading-app.com
2. **Use** GitHub Security Advisories
3. **Follow** our [Security Policy](.github/SECURITY.md)

## 📊 Performance

### Performance Guidelines

- **Optimize database queries** - Use indexes, avoid N+1 queries
- **Minimize API calls** - Cache when possible
- **Optimize images** - Compress and resize appropriately  
- **Use lazy loading** - For images and components
- **Monitor bundle size** - Keep JavaScript bundles small

### Performance Testing

```bash
# Run performance tests (if available)
npm run test:performance

# Check bundle size
npm run build:analyze

# Profile application
npm run profile
```

## 📚 Documentation

### Documentation Standards

- **Keep README updated** with setup instructions
- **Document API endpoints** with examples
- **Add inline comments** for complex logic
- **Update changelog** for notable changes
- **Include screenshots** for UI changes

### Documentation Types

1. **README.md** - Project overview and setup
2. **API Documentation** - Endpoint specifications
3. **User Guide** - How to use the application
4. **Developer Guide** - Development setup and practices
5. **Deployment Guide** - Production deployment instructions

## 🎯 Project Priorities

### Current Focus Areas

1. **Core PSA Integration** - Improve card grading workflow
2. **User Experience** - Streamline submission process
3. **Admin Dashboard** - Better management tools
4. **Performance** - Faster loading and processing
5. **Mobile Experience** - Responsive design improvements

### Contribution Priorities

**High Priority:**
- Bug fixes affecting core functionality
- Security improvements
- Performance optimizations
- Mobile responsiveness issues

**Medium Priority:**
- New features that enhance user workflow
- UI/UX improvements
- Test coverage improvements
- Documentation updates

**Low Priority:**
- Code refactoring (unless it improves maintainability)
- Nice-to-have features
- Cosmetic improvements

## 🤝 Community

### Getting Help

- **GitHub Discussions** - For general questions and ideas
- **GitHub Issues** - For bugs and feature requests  
- **Email** - developers@psa-grading-app.com for direct communication

### Recognition

Contributors will be recognized in:

- **Contributors file** in the repository
- **Release notes** for significant contributions
- **Hall of Fame** for security researchers
- **Special mentions** in documentation

## 📋 Checklist for First-Time Contributors

- [ ] Fork the repository
- [ ] Set up development environment
- [ ] Read this contributing guide
- [ ] Pick a "good first issue" to work on
- [ ] Create feature branch
- [ ] Make your changes
- [ ] Write/update tests
- [ ] Run all tests and linting
- [ ] Submit pull request
- [ ] Respond to review feedback
- [ ] Celebrate your contribution! 🎉

---

## 🙏 Thank You

Thank you for contributing to PSA Grading App! Your efforts help make this project better for everyone in the Pokemon card grading community.

**Happy coding!** 🚀
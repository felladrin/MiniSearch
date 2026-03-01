# Security Policy

## Supported Versions

Only the latest version of MiniSearch receives security updates.

| Version | Supported |
|---------|------------|
| Latest  | ✅         |
| Older   | ❌         |

## Reporting a Vulnerability

### Private Vulnerability Reporting

We strongly encourage using GitHub's [Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature to report security vulnerabilities.

**Do not report security vulnerabilities through public issues.**

### How to Report

1. **Preferred**: Use GitHub's Private Vulnerability Reporting
2. **Alternative**: Email the maintainer privately at: (contact can be provided upon request)

When reporting a vulnerability, please include:
- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested mitigations (if known)

### What to Expect

- We will acknowledge receipt of your report within 48 hours
- We will provide a detailed response within 7 days
- We will work with you to understand and validate the report
- We will coordinate disclosure timing to minimize user risk

## Security Scope

### In Scope

- Vulnerabilities in the MiniSearch web application
- Security issues in the Docker container configuration
- Authentication and authorization bypasses
- Cross-site scripting (XSS) vulnerabilities
- Information disclosure issues
- Remote code execution vulnerabilities
- Privilege escalation in the application context

### Out of Scope

- Issues in third-party dependencies (report to respective projects)
- Vulnerabilities in the underlying browser or Node.js runtime
- Physical attacks on infrastructure
- Social engineering attacks
- Denial of service attacks that don't indicate a vulnerability
- Issues requiring physical access to user devices

## Threat Model

### MiniSearch's Security Boundaries

MiniSearch is designed as a privacy-focused search application with the following security assumptions:

**Trust Boundaries:**
- **Browser Environment**: The application runs entirely in the user's browser
- **Server Component**: Optional backend for search and AI processing
- **AI Models**: Local or remote AI processing with configurable endpoints

**Data Flow:**
- User queries are sent to SearXNG instances (configurable)
- AI processing can be local (WebLLM/Wllama) or remote (API endpoints)
- Search history is stored locally in the browser
- No tracking or analytics by default

**Security Controls:**
- Optional access key protection for deployment
- Configurable AI endpoints for privacy
- Local-first data storage
- No third-party tracking or analytics

**Potential Risks:**
- Malicious SearXNG instances could log queries
- Remote AI endpoints could access user queries
- Browser extensions could interfere with the application
- Man-in-the-middle attacks without HTTPS

## Security Best Practices

### For Users

- Always use HTTPS when accessing MiniSearch instances
- Configure trusted SearXNG instances
- Use local AI models for maximum privacy
- Set access keys for deployed instances
- Keep browsers updated

### For Deployers

- Use the official Docker image
- Configure environment variables securely
- Set up proper access controls
- Use HTTPS in production
- Regularly update dependencies
- Monitor for security advisories

## Security Features

- **Access Key Protection**: Optional password-based access control
- **Configurable Endpoints**: Users control search and AI providers
- **Local Processing**: AI models can run entirely in the browser
- **No Tracking**: Built without analytics or tracking
- **HTTPS Ready**: Designed for secure deployment

## Security Updates

Security updates will be:
- Released as new versions
- Announced in release notes
- Coordinated with dependency updates when applicable

## Security Team

The MiniSearch security team is currently the project maintainer:
- [@felladrin](https://github.com/felladrin) - Project Maintainer

## Acknowledgments

We thank security researchers who help us keep MiniSearch secure. All valid security reports will be acknowledged in our release notes (with reporter permission).

## Related Resources

- [GitHub Security Advisories](https://docs.github.com/en/code-security/security-advisories)
- [OWASP Web Security Testing Guide](https://owasp.org/www-project-web-security-testing-guide/)
- [Mozilla Security Guidelines](https://infosec.mozilla.org/guidelines)

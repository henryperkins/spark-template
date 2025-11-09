# Security Documentation & Threat Model

This document outlines the security architecture, threat model, and Content Security Policy (CSP) implementation for the Agentic RAG application.

## Security Architecture

### Zero Trust Principles

The application implements a zero-trust security model where:

1. **No implicit trust**: Every request is authenticated and authorized
2. **Least privilege**: Components have minimal required permissions
3. **Assume breach**: Security controls assume the system is already compromised
4. **Verify explicitly**: All access is authenticated and encrypted

### Security Layers

```
┌─────────────────────────────────────────┐
│  Layer 14: Infrastructure Security      │
│  - Cloudflare WAF, DDoS protection      │
├─────────────────────────────────────────┤
│  Layer 13: Application Security         │
│  - CSP, HSTS, Secure Headers            │
├─────────────────────────────────────────┤
│  Layer 12: Data Security                │
│  - Encryption at rest and in transit    │
├─────────────────────────────────────────┤
│  Layer 11: Identity & Access            │
│  - OAuth 2.0, PKCE, Token Management    │
├─────────────────────────────────────────┤
│  Layer 10: API Security                 │
│  - Rate limiting, Input validation      │
├─────────────────────────────────────────┤
│  Layer 9: Monitoring & Logging          │
│  - Audit trails, Security events        │
└─────────────────────────────────────────┘
```

## Content Security Policy (CSP)

### Implementation

CSP is enforced at the Cloudflare Worker level for all SPA responses:

```typescript
// In worker/index.ts
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self' https://api.openai.com https://*.openai.azure.com https://login.microsoftonline.com",
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')
```

### Policy Directives

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Only allow resources from same origin |
| `script-src` | `'self'` | No inline scripts, no external scripts |
| `style-src` | `'self' 'unsafe-inline'` | Allow inline styles for shadcn/ui |
| `img-src` | `'self' data:` | Allow images and data URIs |
| `connect-src` | `'self' https://api.openai.com ...` | Allow API connections to trusted endpoints |
| `font-src` | `'self'` | Only allow fonts from same origin |
| `object-src` | `'none'` | Disable plugins and Flash |
| `frame-ancestors` | `'none'` | Prevent clickjacking |
| `base-uri` | `'self'` | Prevent base tag manipulation |
| `form-action` | `'self'` | Only allow form submissions to same origin |

### Additional Security Headers

```typescript
// In worker/index.ts
headers.set('X-Content-Type-Options', 'nosniff')
headers.set('X-Frame-Options', 'DENY')
headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
```

## Threat Model

### Threat Actors

1. **External Attackers**: Malicious users attempting unauthorized access
2. **Compromised Users**: Legitimate users with stolen credentials
3. **Insider Threats**: Malicious or negligent internal users
4. **Supply Chain**: Compromised dependencies or build tools

### Attack Vectors

#### 1. Cross-Site Scripting (XSS)

**Threat**: Injection of malicious scripts through user input

**Mitigations**:
- CSP prevents inline script execution
- SafeMarkdown component sanitizes all user content
- All user input is escaped before rendering
- React's built-in XSS protection

**Testing**:
```typescript
// In test/security/xss.test.ts
test('prevents XSS in markdown rendering', () => {
  const maliciousInput = '<script>alert("xss")</script>'
  const sanitized = SafeMarkdown({ content: maliciousInput })
  expect(sanitized).not.toContain('<script>')
})
```

#### 2. Token Leakage

**Threat**: OAuth tokens exposed in client-side code

**Mitigations**:
- Worker-side OAuth flows only
- Tokens stored in Cloudflare KV, never localStorage
- PKCE (Proof Key for Code Exchange) implementation
- Token rotation and expiration

**Implementation**:
```typescript
// In src/hooks/use-oauth.ts
const initiateOAuth = useCallback(async (config: OAuthConfig) => {
  // Generate PKCE challenge
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  
  // Store verifier securely (Worker-mediated)
  await fetch('/api/oauth/store-verifier', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codeVerifier, state })
  })
}, [])
```

#### 3. Server-Side Request Forgery (SSRF)

**Threat**: Worker making unauthorized requests to internal services

**Mitigations**:
- Strict allowlist for external API calls
- Network segmentation in Cloudflare
- Request validation and sanitization
- Timeout and size limits on all external requests

**CSP Protection**:
```typescript
// Only allow specific domains in connect-src
"connect-src 'self' https://api.openai.com https://*.openai.azure.com https://login.microsoftonline.com"
```

#### 4. Data Exfiltration

**Threat**: Unauthorized extraction of sensitive documents or queries

**Mitigations**:
- Namespace isolation per tenant
- End-to-end encryption for sensitive data
- Audit logging of all data access
- Rate limiting on data export operations

#### 5. Supply Chain Attacks

**Threat**: Compromised npm packages or build tools

**Mitigations**:
- Dependency scanning with `npm audit`
- Lock file versioning
- Signed commits and verified builds
- Minimal dependency footprint

### Security Controls Matrix

| Control | Implementation | Effectiveness |
|---------|---------------|---------------|
| **CSP** | Worker-level headers | High |
| **OAuth Security** | PKCE + Worker flows | High |
| **Input Validation** | Zod schemas + sanitization | High |
| **Encryption** | TLS 1.3 + at-rest encryption | High |
| **Audit Logging** | Telemetry + error tracking | Medium |
| **Rate Limiting** | Cloudflare + application level | Medium |
| **Dependency Scanning** | npm audit + lock files | Medium |

## Security Testing

### Automated Security Tests

```typescript
// In test/security/csp.test.ts
test('CSP headers are correctly set', async ({ page }) => {
  const response = await page.goto('/')
  const csp = response.headers()['content-security-policy']
  
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("object-src 'none'")
})

// In test/security/oauth.test.ts
test('OAuth tokens are not exposed in client', async ({ page }) => {
  await page.goto('/')
  const pageSource = await page.content()
  
  expect(pageSource).not.toMatch(/ghp_[a-zA-Z0-9]{36}/) // GitHub token pattern
  expect(pageSource).not.toMatch(/sl\.[a-zA-Z0-9_-]{100,}/) // Dropbox token pattern
})
```

### Penetration Testing Checklist

- [ ] XSS payload injection in all input fields
- [ ] CSRF token validation
- [ ] OAuth flow manipulation
- [ ] File upload restrictions
- [ ] API rate limiting bypass attempts
- [ ] SQL injection (if applicable)
- [ ] Command injection in integrations
- [ ] Path traversal in file operations

## Incident Response

### Security Event Classification

| Severity | Examples | Response Time |
|----------|----------|---------------|
| **Critical** | Data breach, RCE, auth bypass | Immediate |
| **High** | XSS, token leakage, SSRF | 1 hour |
| **Medium** | Rate limiting bypass, info disclosure | 4 hours |
| **Low** | CSP violations, minor misconfigurations | 24 hours |

### Incident Response Playbook

1. **Detection**: Web Vitals monitoring, error tracking, audit logs
2. **Containment**: Isolate affected components, revoke tokens
3. **Investigation**: Analyze logs, reproduce issue, assess impact
4. **Remediation**: Apply patches, update CSP, rotate secrets
5. **Recovery**: Restore services, monitor for recurrence
6. **Post-mortem**: Document lessons, update security controls

## Compliance & Auditing

### Data Protection

- **GDPR**: User data deletion, consent management
- **CCPA**: Data access requests, opt-out mechanisms
- **HIPAA**: PHI handling (if applicable)
- **SOC 2**: Security controls documentation

### Audit Trail

All security-relevant events are logged:

```typescript
// In src/lib/services/telemetry.ts
interface SecurityEvent {
  type: 'security_event'
  event: 'auth_success' | 'auth_failure' | 'token_refresh' | 'data_access'
  userId?: string
  ipAddress?: string
  userAgent?: string
  timestamp: string
}
```

## Security Roadmap

### Q1 2025
- [ ] Implement Web Application Firewall (WAF) rules
- [ ] Add DDoS protection configuration
- [ ] Complete security audit and penetration testing
- [ ] Implement security headers automation

### Q2 2025
- [ ] Add intrusion detection system (IDS)
- [ ] Implement advanced threat protection
- [ ] Complete SOC 2 Type I certification
- [ ] Add security information and event management (SIEM)

### Q3 2025
- [ ] Implement zero-trust network architecture
- [ ] Add behavioral analytics
- [ ] Complete SOC 2 Type II certification
- [ ] Implement automated security response

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CSP Quick Reference](https://content-security-policy.com/)
- [Cloudflare Security Best Practices](https://developers.cloudflare.com/fundamentals/security/)
- [React Security Best Practices](https://reactjs.org/docs/security.html)
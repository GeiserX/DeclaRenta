# Security Policy

DeclaRenta processes sensitive financial and tax data. Your data never leaves your machine — all processing happens locally (browser or CLI).

## Reporting Security Issues

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please use GitHub's private vulnerability reporting:

1. Go to https://github.com/GeiserX/DeclaRenta/security/advisories
2. Click "Report a vulnerability"
3. Fill out the form with details

We will respond within **48 hours** and work with you to understand and address the issue.

### What to Include

- Type of issue (e.g., XSS, data leak, incorrect tax calculation)
- Full paths of affected source files
- Step-by-step instructions to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact assessment and potential attack scenarios

### Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | Current release    |

Only the latest version receives security updates.

## Privacy Architecture

DeclaRenta is designed so that **no financial data ever leaves your machine**:

- **Browser mode**: All processing happens in-browser via JavaScript. No server calls except ECB exchange rates (public data).
- **CLI mode**: Runs entirely on your local machine. Network calls only for ECB rates (cacheable).
- **No analytics, no tracking, no telemetry**.
- **No user accounts, no authentication**.

### Data Flow

```
IBKR XML file → [your browser/CLI] → Tax report (local)
                       ↓
              ECB rates API (public, cacheable)
```

### What We Do NOT Do

- Upload your broker data to any server
- Store any financial information
- Track usage or collect analytics
- Require authentication or accounts

## Security Best Practices

### For Contributors

1. **Never add network calls** that send user financial data anywhere
2. **Validate all input** from XML files (malformed XML should not crash)
3. **Use Decimal.js** for all monetary calculations (never floating-point)
4. **Never log** financial amounts, NIF, or personal data

### For Users

1. **Download from official sources** only (GitHub releases, npm)
2. **Verify the domain** if using the web version
3. **Keep updated** to the latest version
4. **Review the source** — it's open source for exactly this reason

## Contact

For security questions that aren't vulnerabilities, open a GitHub Discussion.

---

*Last updated: April 2026*

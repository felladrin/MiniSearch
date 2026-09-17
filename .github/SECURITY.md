# Security Policy

## Supported Versions

Only the latest version of MiniSearch receives security updates.

| Version | Supported |
|---------|------------|
| Latest  | ✅         |
| Older   | ❌         |

## Reporting a Vulnerability

### Private Vulnerability Reporting

Report security vulnerabilities through GitHub's [Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) feature. It is the only reporting channel, so every report stays private and tracked in one place.

**Do not report security vulnerabilities through public issues.**

### What to Include

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
- AI processing can be local (Wllama) or remote (API endpoints)
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

## Native & WebAssembly Module Trust Model

A few of MiniSearch's dependencies ship native code or WebAssembly rather than auditable JavaScript. They run with the application's privileges, so they are held to a stricter install-time policy than the rest of the dependency tree.

### Inventory

| Module | Type | Where it runs | Why it is trusted |
| --- | --- | --- | --- |
| `onnxruntime-node` | Native (Node addon) | Server-side reranker, CPU only | Microsoft-published ONNX Runtime; exact pin; its install script is **denied** (see below), so nothing is fetched at install time |
| `@wllama/wllama` | WebAssembly | Browser inference | Published wllama project; exact pin; no install script |
| `@huggingface/tokenizers` | Native (Node addon) | Server-side tokenization | Hugging Face-published; exact pin; no install script |
| `hash-wasm` | WebAssembly | argon2id hashing (browser and server) | Widely-used, audited WASM hash library; exact pin; no install script |
| `@moonshine-ai/moonshine-wasm` | WebAssembly | Browser dictation | Exact pin; no install script |

### What is verified at install

1. **Exact pins** — every native/WASM dependency is declared with a single exact version in `package.json` (no `^`/`~`), so a newer publish can never be installed without a deliberate change.
2. **Lockfile integrity** — `package-lock.json` pins each tarball with a SHA-512 `integrity` hash; `npm ci` refuses any tarball that does not match.
3. **Install-script policy** — `package.json#allowScripts` records an explicit allow/deny decision for every package in the tree that ships an install script, and `.npmrc` sets `strict-allow-scripts = true`, so an install script with no recorded decision **fails the install** instead of warning. (The `.npmrc` layer can only allow, never deny, which is why the policy lives in `package.json`.)
4. **Registry signatures** — `npm run native-module-check` (`scripts/native-module-integrity.cjs`) re-checks the pins, the lockfile, the policy coverage and `npm audit signatures` for every tracked module, and runs in CI.

### Install-script decisions

- **`onnxruntime-node` — denied.** Its postinstall downloads a CUDA 12 nupkg on linux/x64 and unpacks it with `adm-zip`, which follows symlinks at the extraction destination (GHSA-vwc7-r8mq-g2x9, unfixed upstream). Both inference services pin `executionProviders: ["cpu"]`, so those GPU binaries are never loaded; the CPU runtime (`onnxruntime_binding.node` + `libonnxruntime.so`) ships inside the package tarball itself. Denying the script removes the download and the symlink-traversal exposure entirely.
- **`protobufjs` — denied.** Its postinstall only prints a version-scheme advisory to stderr; nothing in the installed package depends on it running. Denying keeps the set of executed install scripts minimal.
- **`fsevents@2.3.3` — allowed, pinned.** The optional macOS file watcher compiles in its install script; denying it would break file watching on macOS developer machines. The allow is pinned to the exact locked version, so a bump requires a fresh decision.

### What is NOT verified

- **Binary semantics.** A registry signature proves the tarball came from the npm registry unmodified; it does not prove the native/WASM binary is free of malicious behaviour. Native and WASM payloads are opaque and are not human-audited here.
- **Runtime downloads.** Model files fetched at use time (HuggingFace, `download.moonshine.ai`, the text-to-speech engine's CDN hosts) are outside the install-time gate; their trust model is documented in [docs/security.md](../docs/security.md).
- **Future approvals.** An install script added by a later version or a new dependency is only as trustworthy as the review behind the `approve-scripts` entry that covers it.

### Approving a new install script

Under `strict-allow-scripts`, any package that ships an install script without a recorded decision fails the install. To unblock it, a maintainer must:

1. Read the script first (`npm view <pkg> scripts`, or the unpacked tarball) and decide whether it is acceptable.
2. Record the decision: `npm approve-scripts <pkg>` writes a version-pinned `"<name>@<version>": true` entry to `package.json#allowScripts` (`allow-scripts-pin` is on); `npm deny-scripts <pkg>` writes `"<name>": false`, denying every version of the package.
3. Update the decision list above in the same PR, with the reasoning.

### Reviewing a version bump

Because native/WASM deps are exact pins, a Renovate bump arrives as a one-line version change and is reviewed like any dependency PR, plus: if the new version ships an install script not covered by the pinned policy, the install fails until the script is reviewed and re-approved. `npm run native-module-check` re-verifies pins, lockfile integrity and registry signatures in CI on every change.

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

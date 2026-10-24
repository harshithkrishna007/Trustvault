# TrustVault — Threat Model

## 1. Project Overview

TrustVault is a document-management application that allows authenticated users to upload, view, download, rename, and share documents according to their permissions. It uses a React frontend, an Express backend, and SQLite for persistent storage.

This threat model identifies the main assets, trust boundaries, potential attacks, security controls, and residual risks in the application.

## 2. Assets to Protect

- **Documents:** Uploaded files and their contents.
- **User accounts:** User identities, password hashes, roles, and account status.
- **Document permissions:** Ownership and read/edit grants.
- **Authentication sessions:** Session identifiers used to authenticate requests.
- **Audit records:** History of successful, denied, and failed security-sensitive operations.
- **Document metadata:** Names, categories, MIME types, file sizes, and hashes.
- **Application secrets:** Session secrets and environment configuration.

## 3. Trust Boundaries

1. **Browser to API:** All client requests are untrusted. The server must validate authentication, permissions, and input independently of frontend controls.
2. **API to database:** SQL operations must use parameterized queries and enforce database constraints.
3. **API to file storage:** Uploaded files must be stored under server-controlled names and served only after authorization.
4. **User to user:** A user's identity and permissions must not allow access to another user's private documents without an explicit grant or administrative authority.
5. **Application to audit records:** Security-sensitive operations should be recorded consistently, and audit integrity should be verifiable.

## 4. Threats and Mitigations

### T1 — Unauthorized Document Access

**Threat:** A user changes a document ID in a request to read or download another user's document.

**Impact:** Confidential documents may be exposed.

**Mitigations:**
- Authenticate requests on the server.
- Check document ownership, administrative privileges, or an explicit access grant for each document request.
- Return a not-found response when the requester has no access, reducing document-existence disclosure.
- Apply authorization checks to downloads, edits, and other document operations.
- Test that one user cannot access another user's documents without permission.

**Residual risk:** Authorization bugs or missing checks on newly added endpoints could expose documents.

### T2 — Privilege Escalation

**Threat:** A viewer or other unauthorized user attempts to upload documents, change permissions, rename documents, or delete documents.

**Impact:** Unauthorized modification, deletion, or sharing of sensitive information.

**Mitigations:**
- Enforce roles and document-level permissions on the server.
- Restrict upload functionality to permitted roles.
- Restrict grant management to document owners and administrators.
- Restrict deletion to owners and administrators.
- Validate every requested permission against the allowed values.

**Residual risk:** Incorrect role assignments or inconsistent checks between endpoints could allow unintended actions.

### T3 — Broken Sharing and Revocation

**Threat:** A user grants access to an invalid or disabled account, or a revoked user continues to access a document.

**Impact:** Documents remain accessible to unintended recipients.

**Mitigations:**
- Validate the target account before creating a grant.
- Permit only supported permission levels (`read` and `edit`).
- Check grants on subsequent requests rather than relying on cached authorization.
- Record permission changes and revocations in the audit trail.

**Residual risk:** A user who already downloaded a document can retain their downloaded copy after access is revoked.

### T4 — Authentication and Session Abuse

**Threat:** An attacker steals, guesses, or reuses a session identifier, or accesses an account that has been disabled.

**Impact:** Account impersonation and unauthorized document access.

**Mitigations:**
- Require authentication for protected API routes.
- Check that the authenticated account still exists and is enabled.
- Use secure session configuration appropriate to the deployment environment.
- Protect session cookies with `HttpOnly`, `Secure` in HTTPS deployments, and an appropriate `SameSite` policy.
- Use strong password hashing and protect session secrets through environment configuration.
- Apply login rate limiting and secure logout/session invalidation.

**Residual risk:** The effectiveness of these controls depends on the actual session, password, cookie, and deployment configuration.

### T5 — Malicious File Uploads

**Threat:** A user uploads an oversized, unexpected, or malicious file.

**Impact:** Storage exhaustion, unsafe file handling, or exploitation of downstream file-processing software.

**Mitigations:**
- Limit uploads to 10 MB and one file per request.
- Allow only the application's supported MIME types.
- Generate random server-side storage keys rather than using user-supplied filenames as paths.
- Store files outside publicly served static directories.
- Calculate a SHA-256 hash for integrity checking.
- Use parameterized database statements for metadata operations.

**Residual risk:** MIME types supplied by clients can be forged. File extensions and MIME checks alone do not prove that file contents are safe. Content validation and malware scanning may be needed for higher-risk deployments.

### T6 — SQL Injection and Invalid Input

**Threat:** An attacker submits crafted values through document names, identifiers, permissions, or other API fields.

**Impact:** Unauthorized data access, modification, or application errors.

**Mitigations:**
- Use parameterized SQL statements.
- Validate names, categories, permissions, and required fields on the server.
- Enforce database constraints and foreign keys.
- Avoid constructing SQL statements by concatenating user input.

**Residual risk:** Every new endpoint must follow the same validation and query practices.

### T7 — Audit Log Tampering or Failure

**Threat:** Audit records are modified, deleted, omitted, or become inconsistent with security-sensitive operations.

**Impact:** Investigations become unreliable and unauthorized activity may go undetected.

**Mitigations:**
- Record relevant operations with actor, action, target, outcome, and timestamp information.
- Link events using previous-event hashes and compute hashes from the stored event payload.
- Maintain an audit head representing the latest event hash.
- Verify the hash chain using the project's audit verification script.
- Restrict access to audit records to authorized administrators.
- Keep audit logging and related database updates transactionally consistent where appropriate.

**Residual risk:** A hash chain stored in the same writable database is not tamper-proof against an attacker who can rewrite the database and recompute the hashes. Stronger protection would require externally protected or append-only audit storage.

### T8 — Cross-Site Request Forgery (CSRF)

**Threat:** A malicious website causes a logged-in user's browser to send an unintended state-changing request.

**Impact:** Unauthorized changes, permission grants, or deletions.

**Mitigations:**
- Use appropriate session-cookie `SameSite` settings.
- Add CSRF tokens or another suitable CSRF defense for cookie-authenticated state-changing requests.
- Validate request origins where appropriate.
- Do not rely on CORS alone as a CSRF defense.

**Residual risk:** Actual protection depends on the implemented session and CSRF configuration and must be verified.

### T9 — Cross-Site Scripting (XSS)

**Threat:** Attacker-controlled document metadata is rendered as executable content in the frontend.

**Impact:** Session abuse or actions performed in a user's browser.

**Mitigations:**
- Render untrusted metadata as text rather than injecting it as HTML.
- Avoid unsafe HTML rendering APIs.
- Validate and encode data appropriately for its output context.
- Consider a Content Security Policy.

**Residual risk:** Frontend rendering changes may introduce new unsafe output paths.

### T10 — Denial of Service and Resource Exhaustion

**Threat:** An attacker sends repeated requests or large uploads to consume CPU, memory, storage, or database resources.

**Impact:** The service becomes slow or unavailable.

**Mitigations:**
- Limit upload size and file count.
- Configure request and session limits appropriate to the deployment.
- Apply rate limiting to login and other abuse-prone endpoints.
- Monitor disk usage and database health.
- Handle upload and database errors without exposing internal details.

**Residual risk:** The upload-size limit alone does not prevent request flooding or storage exhaustion over time.

### T11 — Sensitive Data Exposure

**Threat:** Database files, uploaded documents, credentials, or internal errors are exposed through public hosting, source control, or logs.

**Impact:** Confidentiality loss and account compromise.

**Mitigations:**
- Keep secrets in environment variables rather than source control.
- Exclude local databases, uploaded files, and environment files from Git unless there is a deliberate, safe reason to include them.
- Store uploaded files outside publicly served directories.
- Avoid returning stack traces or sensitive internal data in API errors.
- Use HTTPS in production.
- Protect database backups and deployment storage.

**Residual risk:** Misconfigured deployment storage or accidentally committed sensitive files can bypass application-level protections.

## 5. Security Testing Plan

The following checks should be run and their actual results recorded before release:

- [ ] Unauthenticated requests to protected endpoints are rejected.
- [ ] A user cannot list or download another user's private documents without a grant.
- [ ] A viewer cannot upload, rename, or delete documents unless explicitly permitted by the implemented policy.
- [ ] A non-owner cannot grant or revoke document permissions.
- [ ] Invalid permission values and disabled target accounts are rejected.
- [ ] Revoked access fails on subsequent requests.
- [ ] Oversized and unsupported uploads are rejected.
- [ ] Audit events are created for relevant successful and denied operations.
- [ ] The audit verification script detects altered, missing, or incorrectly linked events.
- [ ] A clean database can be initialized using the documented setup instructions.
- [ ] Production configuration uses HTTPS and appropriately protected session cookies.

Do not mark a check as passing until it has actually been executed and its result confirmed.

## 6. Out of Scope and Known Limitations

Unless separately implemented and tested, the following should not be assumed to be present:

- Multi-factor authentication.
- Malware scanning or deep file-content validation.
- External, immutable audit-log storage.
- Automated backup restoration testing.
- Enterprise identity-provider integration.
- Comprehensive rate limiting and denial-of-service protection.
- Formal penetration testing.

These are acknowledged limitations rather than claims that the application is secure against every possible attack.

## 7. Security Principles

TrustVault follows these intended principles:

- **Deny by default:** Access is granted only when the server verifies an applicable permission.
- **Least privilege:** Users receive only the permissions required for their work.
- **Server-side enforcement:** Frontend restrictions are not treated as security controls.
- **Accountability:** Sensitive actions should generate audit events.
- **Defense in depth:** Input validation, database constraints, authorization, and storage controls complement one another.
- **Honest verification:** Security claims are supported by tests and configuration review rather than assumptions.

## 8. Final Assessment

This threat model describes the intended protections and remaining risks for TrustVault. It is not, by itself, proof that every control is implemented correctly. Release readiness depends on reviewing the current code, executing the security tests, verifying audit integrity, and confirming the production configuration.

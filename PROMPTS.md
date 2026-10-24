# AI Prompt and Usage Log — TrustVault

## Introduction

During the development of TrustVault, I used ChatGPT as a coding assistant to understand implementation choices, improve the user interface, review backend logic, and identify potential security issues. I treated AI-generated code as a suggestion rather than assuming it was correct. I reviewed the code, made changes where needed, and checked that the existing functionality continued to work.

This document records five areas where AI assistance was relevant to my development process.

## Entry 1  — Document Authorization and Access Control

**My request:**

Help me review the document API in TrustVault and ensure that users can access only documents they own or have been explicitly granted permission to access.

**What the AI produced:**

ChatGPT helped me identify the authorization checks that should be applied to document operations. It explained the importance of checking the authenticated user's identity, document ownership, and granted permissions on the server instead of relying on frontend restrictions.

**Problem identified during review:**

A user interface restriction alone cannot prevent unauthorized access. If the backend does not independently verify permissions for every document operation, a user may attempt to access another user's document by changing a document ID in an API request.

**What I did and how I verified it:**

I focused my review on the backend document routes and the permission checks used for document operations. I also identified cross-user document access as a critical security test. Before treating this as verified, I need to run automated tests proving that one user cannot read, modify, or delete another user's document without the required permission.



## Entry 2 — Audit Trail and Administrator Access

**My request:**

Help me implement and review an audit log for TrustVault that records important actions and allows only administrators to view audit events.

**What the AI produced:**

ChatGPT helped me develop an audit API route that checks the authenticated session and administrator role before returning audit events. It also helped me work with the existing audit database structure and consider verification of the audit event hash chain.

**Problem identified during review:**

Audit records are security-sensitive because they may reveal document activity and user information. The backend must enforce administrator-only access; hiding the audit page from other roles in the frontend is not sufficient. Audit integrity checks also need to detect modified event payloads or broken hash links.

**What I did and how I verified it:**

I integrated the audit route with the existing SQLite database and added a separate verification script, `server/verify-audit.js`, to check audit event hashes and chain consistency. I reviewed the administrator access check and the integrity verification logic. I must record the actual test results for administrator access, non-administrator denial, and audit-chain verification before claiming these checks passed.



## Entry 3  — Authentication and Session Security

**My request:**

Help me review the authentication and session handling in TrustVault and identify important security checks before deployment.

**What the AI produced:**

ChatGPT provided guidance on validating authenticated users on the server and checking authorization before returning protected information. It also helped me understand why access decisions should be enforced by backend middleware or route handlers rather than by frontend navigation alone.

**Problem identified during review:**

A protected page is not secure merely because unauthenticated users cannot see its link. Every protected API endpoint must verify the session and enforce the relevant role or resource permissions. Disabled accounts must also be prevented from performing protected actions.

**What I did and how I verified it:**

I used these checks as a review checklist for the existing authentication and protected API routes. I kept the existing working functionality and focused on identifying missing backend checks rather than making unnecessary architectural changes. The final verification should include unauthenticated requests, invalid sessions, and attempts by disabled accounts to use protected endpoints.

**Related commit:**

[Insert the actual commit hash or GitHub commit URL containing the authentication changes or tests reviewed.]

## Entry 4  — SQLite Database and Persistence

**My request:**

Help me review the SQLite database setup for TrustVault so that the application can create and maintain its required tables and persist data reliably.

**What the AI produced:**

ChatGPT helped me review the database initialization code, table relationships, indexes, and migration logic. The review included the users, documents, grants, audit events, and audit heads tables.

**Problem identified during review:**

Database setup must work when the application starts from a clean environment, not only when an existing local database already contains the expected tables. Schema changes also need to account for databases created by earlier versions.

**What I did and how I verified it:**

I reviewed `server/db.js`, which initializes the SQLite database, enables foreign key enforcement, configures database settings, creates the required tables and indexes, and adds the `event_payload` column when it is missing from an older audit schema. I preserved the existing initialization approach. A clean-clone setup test and a migration test against an older database should be recorded with their actual results.



## Entry 5 — Security Testing and Final Review

**My request:**

Help me identify the most important security checks to complete before publishing TrustVault to GitHub and deploying it.

**What the AI produced:**

ChatGPT helped me prioritize security verification over unnecessary feature changes. The main areas were cross-user document isolation, role-based access control, administrator-only audit access, audit integrity, database initialization, and documenting the security assumptions and limitations.

**Problem identified during review:**

A feature working correctly in the browser does not prove that its API is secure. In particular, cross-user document access must be tested at the backend, and audit access must be tested using different roles. Documentation alone cannot replace executable security tests.

**What I did and how I verified it:**

I prioritized reviewing the existing backend and preserving working features. The remaining verification checklist includes automated tests for cross-user document access, role restrictions, unauthenticated requests, and audit access; a successful audit integrity check; and confirmation that setup instructions work from a clean clone. I will report only the checks that I actually execute and their observed results.



## Additional AI Context

- **AI tool used:** ChatGPT.
- **Purpose of AI assistance:** Code review, implementation guidance, debugging support, security checklist preparation, and documentation assistance.
- **Reusable instructions or context files:** [List any project instructions, prompts, or context files actually supplied to the AI. If none were used, state "None".]
- **Human review:** I reviewed AI-generated suggestions against the existing application structure and requirements. I aimed to preserve working functionality and avoid making changes that were not necessary.
- **Limitations:** AI review does not guarantee that the application is secure. Automated tests, manual authorization checks, and deployment verification are still necessary.

## Final Note

This log is intended to provide a transparent record of AI assistance during development. Dates, implementation details, test outcomes, and commit references should correspond to the actual project history. Where a security test has not yet been run, it is recorded as pending rather than as a successful result.

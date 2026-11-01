# Security Policy

## Supported scope

Security fixes apply to the current `main` branch. This repository contains a small client-side JavaScript library, a custom vocabulary list and a vendored MIT dictionary artifact. Historical credential exposure still requires provider-side revocation or rotation even when the affected revision is no longer current.

## Reporting a vulnerability

Do not publish credentials, private URLs, proof-of-concept payloads or exploitable details in public issues, pull requests or discussions.

Use GitHub's private vulnerability reporting from the repository Security tab when available. If private reporting is unavailable, contact the maintainer privately before public disclosure. Include the affected file or component, impact, minimal reproduction steps and the affected commit, but never include a live secret value.

## Credentials and repository contents

Never commit API keys, OAuth tokens, passwords, private keys, cookies, session files or production environment files. The public vocabulary data and the vendored dictionary are not secret material; do not add unrelated user or production data to this repository.

If a credential may have been exposed:
1. identify its type and provider without reproducing its value;
2. revoke or rotate it at the provider;
3. verify the replacement through the provider's owner-controlled process;
4. remove the exposed value from reachable Git history where appropriate, but do not treat history rewriting as revocation.

## Automated controls

- Gitleaks scans the full Git history on pull requests, pushes to `main` and a weekly schedule.
- Dependabot monitors GitHub Actions only. This repository has no npm dependency manifest or production package-install step.
- The workflow uses full immutable commit SHAs and read-only token permissions.

## Responsible testing

Test only repositories, accounts and data that you are authorized to access. Do not use exposed credentials, access another person's data, perform destructive provider operations or run denial-of-service tests.

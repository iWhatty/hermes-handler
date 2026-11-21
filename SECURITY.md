# Security Policy

## Supported versions

Security fixes are applied to the latest published release. Older releases may require upgrading before a fix is available.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/iWhatty/hermes-handler/security/advisories/new). If private reporting is unavailable, contact `WATT3D@protonmail.com` with the subject `HermesHandler security report`.

Include:

- the affected package version and runtime;
- a minimal reproduction or proof of concept;
- the expected and observed behavior;
- the potential impact; and
- any suggested mitigation.

Do not include secrets, private application data, or credentials in the report. Please avoid public disclosure until maintainers have investigated and coordinated a fix.

## Scope

Useful reports include issues involving message ownership, response correlation, origin/source validation, malformed envelope handling, resource cleanup, transferables, or denial-of-service behavior caused by routing and timeout logic.

Application-specific authorization policies and insecure transport configuration outside HermesHandler are generally the consuming application's responsibility, but reports showing unsafe or misleading package defaults are welcome.

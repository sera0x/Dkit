# Security policy

Dkit stores secrets. Please report security issues privately instead of opening a public issue.

Use GitHub's private vulnerability reporting on this repository. Include the affected version or commit, a clear reproduction, and the impact. Do not include live credentials or other people's data.

Supported versions: the latest release and the current `main` branch. Older releases may not receive fixes.

Useful scope:

- Authentication, session handling, project access, and team permissions
- Secret storage, masking, history, rollback, and encryption
- The CLI installer, release checksums, and update path
- The HTTP API, cron runner, monitors, log drain, media uploads, and cache endpoints

Out of scope: findings that need a compromised host, a compromised operator account, or a browser extension with full page access.

If you are unsure whether something is a vulnerability, report it privately anyway.

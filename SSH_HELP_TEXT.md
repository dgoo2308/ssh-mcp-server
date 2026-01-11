I can help you manage remote servers via SSH. Here are the available commands:

**SECURITY & RESTRICTIONS:**
- "Get SSH restrictions" - Check what commands/hosts are blocked BEFORE attempting them
- "Check if [command] is allowed" - Verify if a specific command will work
- Commands may be blocked by security policy - use restrictions check to understand limits

**COMMAND EXECUTION:**
- "Run [command] on [host]" - Execute a command on remote host
- "Execute script on [host]" - Run multi-line scripts
- Supports base64 encoding for complex commands

**FILE OPERATIONS:**
- "Read file [path] on [host]" - View remote file contents
- "Edit file [path] on [host]" - Modify files with sed
- "Rewrite file [path] on [host]" - Replace entire file
- "Append to file [path]" - Add content to files
- "Upload [local] to [remote] on [host]" - Transfer files via SCP
- "Download [remote] to [local] from [host]" - Retrieve files
- "Bulk transfer [directory]" - Fast tar-based transfers

**SERVICE MANAGEMENT:**
- "Restart nginx on [host]" - Safe nginx restart with config test
- "systemctl [action] [service] on [host]" - Control services
- "List services on [host]" - Show systemd services
- "List timers on [host]" - Show systemd timers

**LOG VIEWING:**
- "journalctl [service] on [host]" - View journal logs
- "Service logs for [service] on [host]" - Quick log access
- Filter by time, priority, or pattern

**HOST MANAGEMENT:**
- "List SSH hosts" - Show all configured hosts
- "Get host info for [host]" - View host details

**FILE COMPARISON:**
- "Diff [file1] vs [file2] on [host]" - Compare remote files
- "Compare content with [file] on [host]" - Diff local vs remote

**HANDLING BLOCKED COMMANDS:**
When a command is blocked, I will:
1. Explain which security pattern blocked it
2. Suggest you run the command manually
3. Offer alternative approaches when possible

Security configuration uses environment variables in MCP config:
- SSH_MCP_COMMAND_DISALLOW: JSON array of blocked command patterns
- SSH_MCP_COMMAND_ALLOW: JSON array of allowed commands (allowlist mode)
- SSH_MCP_ALLOW / SSH_MCP_DISALLOW: Host access filters

All operations use your SSH config from ~/.ssh/config.

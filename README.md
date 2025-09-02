# SSH Remote Commands MCP Server

An MCP (Model Context Protocol) server that enables SSH remote command execution using your existing SSH config, with advanced base64 encoding support and built-in security filtering. Perfect for managing IoT devices and remote Odoo deployments safely without escaping headaches!

## 🚀 Features

### Core Functionality
- **SSH Config Integration**: Automatically reads your `~/.ssh/config` file
- **Include Support**: Handles SSH config `Include` directives seamlessly
- **Host Management**: List and inspect all configured SSH hosts
- **Base64 Encoding**: Eliminates command escaping issues entirely
- **Security Filtering**: Built-in command filtering prevents dangerous operations

### Command Execution
- **Simple Commands**: Execute basic commands with optional base64 encoding
- **Complex Scripts**: Execute multi-line scripts with automatic base64 encoding
- **Multiple Interpreters**: Support for bash, sh, python, node, etc.
- **Timeout Protection**: Configurable timeouts prevent hanging connections

### File Operations
- **Upload Files**: Transfer files and directories to remote hosts via SCP
- **Download Files**: Retrieve files and directories from remote hosts
- **Bulk Transfer**: High-performance directory transfers using tar streaming
- **Edit Files**: Line-based editing with replace, insert, and delete operations
- **Rewrite Files**: Complete file content replacement with backup support
- **Append to Files**: Add content to the end of files
- **Auto Directory Creation**: Automatically creates parent directories
- **Secure Transfer**: Uses your existing SSH keys and security settings
- **Base64 Content Handling**: Safe handling of special characters and multi-line content

## 🛠 Installation

### Quick Install (Recommended)

Run the install script to automatically clone, build, and configure:

```bash
curl -sSL https://raw.githubusercontent.com/v-odoo-testing/ssh-mcp-server/main/install.sh | bash
```

Or clone manually:

```bash
git clone git@github.com:v-odoo-testing/ssh-mcp-server.git ~/git/ssh_mcp
cd ~/git/ssh_mcp
npm install
npm run build
```

## ⚙️ Configuration

### Claude Desktop Configuration

Add this to your Claude Desktop `claude_desktop_config.json`:

**Basic Configuration:**

```json
{
  "mcpServers": {
    "ssh-remote-commands": {
      "command": "node",
      "args": ["/Users/dgoo2308/git/ssh_mcp/build/index.js"],
      "env": {
        "SSH_MCP_COMMAND_DISALLOW": "[\"rm *\", \"rm -rf *\", \"shutdown.*\"]"
      }
    }
  }
}
```

## 🎯 Using with Claude Desktop

Once configured, you can use natural language commands with Claude Desktop:

### **Quick Commands**
```
"Check if the Odoo service is running on my production server"
"Update the REMOTE variable in /etc/vct-iot/vct-iot.env to use IP 167.71.218.232"
"Show me the last 20 lines of logs from my IoT sensor"
"Deploy the new backup script to all my Odoo servers"
```

### **File Editing Examples**
```
"Replace all occurrences of 'old-server.com' with 'new-server.com' in my nginx config"
"Change the worker count to 8 in the Odoo configuration file"
"Add a new cron job to run sensor calibration daily at 2 AM"
"Update the database connection string in my application config"
```

### **Environment Management**
```
"Set DEBUG=false in all environment files across my IoT devices"
"Update the API endpoint in my sensor configuration files"
"Change the log level to INFO in my production services"
"Replace the old certificate path with the new one in all configs"
```

### **Bulk Operations**
```
"Check disk space on all my servers and show me which ones are running low"
"Update the sensor threshold values across all my IoT devices"
"Deploy the latest firmware to all Raspberry Pi sensors"
"Backup all Odoo databases and compress the files"
"Download entire nginx config directory from production server"
"Upload my entire project folder to the development server"
```

### SSH Config Example

Your `~/.ssh/config` might look like this:

```ssh-config
# Main SSH configuration
Include ~/.ssh/config.d/*

# IoT Devices
Host rpi-sensor-1
    HostName 192.168.1.100
    User pi
    Port 22
    IdentityFile ~/.ssh/id_rsa_iot

Host rpi-sensor-2
    HostName 192.168.1.101
    User pi
    Port 22
    IdentityFile ~/.ssh/id_rsa_iot

# Odoo Production Server
Host odoo-prod
    HostName production.example.com
    User odoo
    Port 2222
    ProxyJump bastion.example.com
    IdentityFile ~/.ssh/id_rsa_prod

# Development Server
Host odoo-dev
    HostName dev.example.com
    User developer
    Port 22
    IdentityFile ~/.ssh/id_rsa_dev

# Bastion Host
Host bastion.example.com
    User admin
    IdentityFile ~/.ssh/id_rsa_bastion
    ServerAliveInterval 60
```

## 🔒 Security Configuration

The SSH MCP server includes built-in security filtering to prevent dangerous command execution. Commands are filtered using configurable allow/disallow lists.

### Default Security Settings

By default, these dangerous commands are **blocked**:

```bash
# Destructive file operations
rm *, rm -rf *, rm -rf /
find .* -delete, find .* -exec rm

# System operations  
shutdown.*, reboot.*, halt.*, poweroff.*
init 0, init 6

# Disk operations
dd if=*, mkfs.*, fdisk, parted
> /dev/sd.*

# Process operations
killall.*, pkill.*

# Permission changes
chmod 777 *, chown -R * /

# Fork bombs and malicious patterns
:(){ :|:& };:, fork.*bomb

# History manipulation
history -c, unset HISTFILE
```

### Environment Variables

Configure command filtering using these environment variables:

**`SSH_MCP_COMMAND_DISALLOW`** - JSON array of command patterns to block:
```json
[
  "rm *",
  "rm -rf *", 
  "shutdown.*",
  "reboot.*",
  "dd if=*"
]
```

**`SSH_MCP_COMMAND_ALLOW`** - JSON array of command patterns to explicitly allow:
```json
[
  "systemctl *",
  "docker *",
  "git *",
  "npm *",
  "python *"
]
```

### Pattern Matching

Command patterns support wildcards:
- `*` matches any characters
- `?` matches single character  
- Patterns are case-insensitive
- `rm *` blocks `rm file.txt`, `RM -RF /home`, etc.

### Configuration Examples

**Restrictive (allow-list only):**
```json
{
  "env": {
    "SSH_MCP_COMMAND_ALLOW": "[\"systemctl status *\", \"docker ps\", \"git status\"]",
    "SSH_MCP_COMMAND_DISALLOW": "[\"rm *\", \"shutdown.*\"]"
  }
}
```

**Permissive (block dangerous only):**
```json
{
  "env": {
    "SSH_MCP_COMMAND_DISALLOW": "[\"rm -rf *\", \"shutdown.*\", \"dd if=*\"]"
  }
}
```

**Development environment (minimal restrictions):**
```json
{
  "env": {
    "SSH_MCP_COMMAND_DISALLOW": "[\"rm -rf /\", \"shutdown.*\"]"
  }
}
```

### Host Access Filtering

You can also restrict which SSH hosts can be accessed:

**`SSH_MCP_ALLOW`** - JSON array of host patterns to allow:
```json
["*.example.com", "dev-*", "staging-server"]
```

**`SSH_MCP_DISALLOW`** - JSON array of host patterns to block:
```json
["prod-*", "*.internal"]
```

## 🔧 Available Tools

### 1. ssh_execute_command
Execute single commands with optional base64 encoding:

**Simple command:**
```json
{
  "host": "rpi-sensor-1",
  "command": "sudo systemctl status odoo",
  "timeout": 30
}
```

**Complex command with base64 encoding:**
```json
{
  "host": "odoo-prod",
  "command": "ps aux | grep 'odoo' | grep -v grep | awk '{print $2, $11}' | while read pid cmd; do echo \"PID: $pid, CMD: $cmd\"; done",
  "useBase64": true,
  "timeout": 30
}
```

### 2. ssh_execute_script
Execute multi-line scripts (always uses base64 encoding):

```json
{
  "host": "odoo-prod",
  "script": "#!/bin/bash\n\n# Check Odoo service status\nsudo systemctl status odoo\n\n# Check database connectivity\nsudo -u odoo psql -d postgres -c \"SELECT version();\"\n\n# Check disk space\ndf -h /opt/odoo\n\n# Check recent logs\nsudo tail -20 /var/log/odoo/odoo.log",
  "interpreter": "bash",
  "timeout": 60
}
```

### 3. ssh_list_hosts
List all available SSH hosts from your config:

```json
{}
```

### 4. ssh_get_host_info
Get detailed information about a specific host:

```json
{
  "host": "odoo-prod"
}
```

### 5. ssh_upload_file
Upload files or directories to remote hosts with automatic directory creation:

**Single file upload:**
```json
{
  "host": "odoo-dev",
  "localPath": "/Users/dgoo2308/my-addon.zip",
  "remotePath": "/opt/odoo/addons/my-addon.zip",
  "createDirectories": true,
  "preservePermissions": true
}
```

**Directory upload (recursive):**
```json
{
  "host": "rpi-sensor-1",
  "localPath": "/Users/dgoo2308/iot-configs",
  "remotePath": "/etc/iot-configs",
  "recursive": true,
  "createDirectories": true,
  "preservePermissions": true
}
```

### 6. ssh_download_file
Download files or directories from remote hosts with automatic directory creation:

**Single file download:**
```json
{
  "host": "rpi-sensor-1",
  "remotePath": "/var/log/sensor.log",
  "localPath": "/Users/dgoo2308/Downloads/sensor.log",
  "createDirectories": true,
  "preservePermissions": true
}
```

**Directory download (recursive):**
```json
{
  "host": "odoo-prod",
  "remotePath": "/etc/nginx/conf.d",
  "localPath": "/Users/dgoo2308/backups/nginx-config",
  "recursive": true,
  "createDirectories": true,
  "preservePermissions": true
}
```

### 6.1. ssh_bulk_transfer ⚡ NEW!
Ultra-efficient directory transfers using tar streaming - perfect for large directories with many files:

**Download entire directory structure:**
```json
{
  "host": "vct_remote_root",
  "direction": "download",
  "remotePath": "/etc/nginx/conf.d",
  "localPath": "/Volumes/DG1T Media/vct_remote/nginx_conf_bulk",
  "compression": "gzip",
  "preservePermissions": true,
  "createDirectories": true,
  "excludePatterns": ["*.log", "*.tmp", ".git"]
}
```

**Upload entire project to server:**
```json
{
  "host": "odoo-prod",
  "direction": "upload",
  "localPath": "/Users/dgoo2308/my-odoo-addon",
  "remotePath": "/opt/odoo/addons/my-addon",
  "compression": "gzip",
  "preservePermissions": true,
  "createDirectories": true,
  "excludePatterns": ["__pycache__", "*.pyc", ".git"]
}
```

**Bulk transfer benefits:**
- ⚡ **10x faster** than SCP for directories with many small files
- 🗜️ **Built-in compression** (gzip, bzip2, xz, or none)
- 🔄 **Single SSH connection** instead of multiple SCP calls
- 📁 **Preserves symlinks, permissions, timestamps**
- 🚫 **Exclude patterns** support (like rsync)
- 📊 **Transfer duration** reporting

### 7. ssh_edit_file
Edit specific lines in files using reliable sed commands with regex pattern support:

> **✅ Fixed in v0.1.1**: Pattern replacements like `REMOTE=.*` now work correctly! The sed command generation has been completely rewritten for better reliability across different Linux distributions.

**Pattern Replacement Features:**
- **Regex Support**: Patterns like `KEY=.*`, `server.*\.com`, `^#.*` work as expected
- **Smart Escaping**: Only escapes delimiters, preserves regex functionality  
- **Base64 Safety**: Complex patterns automatically use base64 encoding
- **Cross-Platform**: Works on OpenWrt, Ubuntu, CentOS, Alpine, etc.
- **Automatic Backups**: Creates `.bak` files before editing

**Replace line by number:**
```json
{
  "host": "odoo-prod",
  "filePath": "/opt/odoo/config/odoo.conf",
  "operation": "replace",
  "lineNumber": 15,
  "content": "workers = 8",
  "backup": true
}
```

**Replace by pattern (Environment Variables):**
```json
{
  "host": "rpi-sensor-1", 
  "filePath": "/etc/vct-iot/vct-iot.env",
  "operation": "replace",
  "pattern": "REMOTE=.*",
  "content": "REMOTE=167.71.218.232",
  "backup": true
}
```

**Replace by pattern (Service Configuration):**
```json
{
  "host": "odoo-prod",
  "filePath": "/etc/systemd/system/odoo.service", 
  "operation": "replace",
  "pattern": "ExecStart=.*",
  "content": "ExecStart=/usr/bin/python3 /opt/odoo/odoo-bin -c /etc/odoo/odoo.conf",
  "backup": true
}
```

**Replace by pattern (Configuration Values):**
```json
{
  "host": "rpi-sensor-2",
  "filePath": "/opt/config/sensor.conf",
  "operation": "replace", 
  "pattern": "threshold.*=.*",
  "content": "threshold_temp = 25.5",
  "backup": true
}
```

**Insert new line:**
```json
{
  "host": "odoo-dev",
  "filePath": "/opt/odoo/addons/my_module/__manifest__.py",
  "operation": "insert",
  "lineNumber": 10,
  "content": "    'version': '1.0.1',",
  "backup": true
}
```

**Delete line:**
```json
{
  "host": "rpi-sensor-2",
  "filePath": "/etc/crontab",
  "operation": "delete",
  "pattern": ".*old-sensor-job.*",
  "backup": true
}
```

### 8. ssh_rewrite_file
Completely replace file contents:

```json
{
  "host": "odoo-prod",
  "filePath": "/opt/odoo/scripts/backup.sh",
  "content": "#!/bin/bash\n\n# Enhanced backup script\nDATE=$(date +%Y%m%d_%H%M%S)\nBACKUP_DIR=\"/opt/backups/odoo\"\n\n# Create backup directory\nmkdir -p \"$BACKUP_DIR\"\n\n# Dump database\nsudo -u postgres pg_dump odoo_production > \"$BACKUP_DIR/odoo_db_$DATE.sql\"\n\n# Backup filestore\ntar -czf \"$BACKUP_DIR/filestore_$DATE.tar.gz\" /opt/odoo/data/filestore\n\necho \"Backup completed: $DATE\"",
  "backup": true,
  "createDirectories": true
}
```

### 9. ssh_append_to_file
Append content to files:

```json
{
  "host": "rpi-sensor-1",
  "filePath": "/var/log/sensor.log",
  "content": "2024-01-15 10:30:00 - Manual log entry: Sensor calibration completed",
  "newline": true,
  "createFile": true
}
```

### 10. ssh_read_file ⚡ NEW!
Read the contents of a file from a remote host:

```json
{
  "host": "odoo-prod",
  "filePath": "/etc/nginx/conf.d/odoo.conf"
}
```

**Response includes:**
- File content as string
- Content length and line count
- Success/failure status
- Error details if file not found

### 11. ssh_diff_file ⚡ NEW!
Compare content with a remote file and return the diff:

```json
{
  "host": "odoo-prod",
  "filePath": "/etc/nginx/conf.d/odoo.conf",
  "content": "# Updated nginx configuration\nupstream odoo {\n    server 127.0.0.1:8069;\n}\n\nserver {\n    server_name odoo.example.com;\n    # ... rest of config\n}",
  "contextLines": 3
}
```

**Perfect for:**
- Validating configuration changes before applying them
- Comparing local config templates with remote files
- Reviewing differences between current and proposed content
- Ensuring file changes are exactly what you expect

### 12. ssh_diff_files ⚡ NEW!
Compare two files on the remote host and return the diff:

```json
{
  "host": "odoo-prod", 
  "filePath1": "/etc/nginx/conf.d/odoo.conf",
  "filePath2": "/etc/nginx/conf.d/odoo.conf.backup",
  "contextLines": 5
}
```

**Use cases:**
- Compare current config with backup
- Check differences between staging and production configs
- Validate file changes after updates
- Compare different versions of configuration files

### 13. ssh_restart_nginx ⚡ NEW!
Safely restart nginx server with configuration validation:

```json
{
  "host": "odoo-prod",
  "testOnly": false
}
```

**Test configuration only:**
```json
{
  "host": "odoo-prod",
  "testOnly": true
}
```

**Safety features:**
- Always runs `nginx -t` to validate configuration first
- Attempts graceful reload before full restart
- Falls back to full restart if reload fails
- Returns detailed status including config validation results
- Shows service status after restart to confirm success

### 14. ssh_list_services ⚡ NEW!
List systemd services and their status:

```json
{
  "host": "odoo-prod",
  "pattern": "nginx*",
  "showAll": false
}
```

**List all active services:**
```json
{
  "host": "odoo-prod",
  "showAll": false
}
```

**List all services including inactive:**
```json
{
  "host": "odoo-prod", 
  "showAll": true
}
```

**Response includes:**
- Service unit name, load status, active state, sub-state
- Service description
- Parsed service count
- Raw systemctl output for detailed analysis

### 15. ssh_list_timers ⚡ NEW!
List systemd timers and their status:

```json
{
  "host": "odoo-prod",
  "showAll": false
}
```

**Show all timers including inactive:**
```json
{
  "host": "odoo-prod",
  "showAll": true
}
```

**Response includes:**
- Next run time and time left
- Last run time and time passed
- Timer unit name and associated service
- Complete timer scheduling information

**Perfect for monitoring:**
- SSL certificate renewal (`certbot-renew.timer`)
- Log rotation (`logrotate.timer`) 
- System maintenance tasks
- Backup schedules
- Custom application timers

### 16. ssh_systemctl ⚡ NEW!
Control systemd services with comprehensive service management:

**Start a service:**
```json
{
  "host": "odoo-prod",
  "action": "start",
  "service": "nginx",
  "followStatus": true
}
```

**Stop a service:**
```json
{
  "host": "odoo-prod",
  "action": "stop",
  "service": "postgresql",
  "followStatus": true
}
```

**Restart Odoo service:**
```json
{
  "host": "odoo-prod",
  "action": "restart",
  "service": "odoo",
  "followStatus": true
}
```

**Check service status:**
```json
{
  "host": "odoo-prod",
  "action": "status",
  "service": "nginx",
  "followStatus": true
}
```

**Enable service at boot:**
```json
{
  "host": "odoo-prod",
  "action": "enable",
  "service": "postgresql",
  "followStatus": true
}
```

**Available actions:**
- `start` - Start the service
- `stop` - Stop the service  
- `restart` - Restart the service
- `reload` - Reload service configuration
- `status` - Show detailed service status
- `enable` - Enable service at boot
- `disable` - Disable service at boot
- `mask` - Mask the service (prevent it from being started)
- `unmask` - Unmask the service

**Response includes:**
- Service action success/failure status
- Detailed service status (load state, active state, sub-state)
- Main process PID if running
- Complete systemctl output
- Parsed service information for easy consumption

### 17. ssh_journalctl ⚡ NEW!
View systemd journal logs with advanced filtering and time options:

**Get recent logs for a service:**
```json
{
  "host": "odoo-prod",
  "service": "nginx",
  "since": "2 minutes ago",
  "lines": 50
}
```

**Get error logs only:**
```json
{
  "host": "odoo-prod", 
  "service": "odoo",
  "since": "1 hour ago",
  "priority": "err",
  "lines": 100
}
```

**Get logs for specific time range:**
```json
{
  "host": "odoo-prod",
  "service": "postgresql",
  "since": "2024-01-15 09:00:00",
  "until": "2024-01-15 17:00:00",
  "lines": 200
}
```

**Follow logs in real-time (limited time):**
```json
{
  "host": "odoo-prod",
  "service": "nginx",
  "follow": true,
  "timeout": 30
}
```

**Get system-wide logs:**
```json
{
  "host": "odoo-prod",
  "since": "today",
  "priority": "warning",
  "lines": 100
}
```

**Time format examples:**
- `"2 minutes ago"` - Relative time
- `"1 hour ago"` - Relative time
- `"today"` - Start of current day
- `"yesterday"` - Start of previous day
- `"2024-01-15 12:00:00"` - Absolute timestamp
- `"2024-01-15"` - Start of specific date

**Priority levels:**
- `emerg` - Emergency (system unusable)
- `alert` - Alert (action must be taken immediately)
- `crit` - Critical conditions
- `err` - Error conditions
- `warning` - Warning conditions
- `notice` - Normal but significant conditions
- `info` - Informational messages
- `debug` - Debug-level messages

**Response includes:**
- Parsed log entries with timestamps and content
- Total number of log entries retrieved
- Complete raw journalctl output
- Success/failure status
- Filtering parameters used

### 18. ssh_service_logs ⚡ NEW!
Quick access to service logs with smart defaults for common patterns:

**Get recent logs (default pattern):**
```json
{
  "host": "odoo-prod",
  "service": "odoo",
  "pattern": "recent",
  "timeRange": "5m",
  "lines": 100
}
```

**Get error logs only:**
```json
{
  "host": "odoo-prod",
  "service": "postgresql",
  "pattern": "errors",
  "timeRange": "1h",
  "lines": 50
}
```

**Get startup logs:**
```json
{
  "host": "odoo-prod",
  "service": "nginx",
  "pattern": "startup",
  "lines": 200
}
```

**Get all logs for today:**
```json
{
  "host": "odoo-prod",
  "service": "odoo",
  "pattern": "all",
  "lines": 500
}
```

**Available patterns:**
- `recent` - Recent logs within specified time range (default: 5 minutes)
- `errors` - Error-level logs and above within time range
- `startup` - Logs since last service start (captures startup sequence)
- `all` - All logs for today (useful for comprehensive analysis)

**Smart defaults by pattern:**
- `recent`: Shows logs from last 5 minutes, 100 lines max
- `errors`: Shows error-level logs, filters for error keywords
- `startup`: Shows logs from today, 200 lines to capture startup sequence
- `all`: Shows logs from today, 500 lines minimum for comprehensive view

**Analysis features:**
- Error counting for `errors` pattern (shows number of actual error messages)
- Startup detection for `startup` pattern (shows if recent startup activity found)
- Smart keyword filtering for relevant log entries
- Convenience mode flag for easy identification

**Time range examples:**
- `"2m"` - Last 2 minutes
- `"5m"` - Last 5 minutes (default)
- `"1h"` - Last 1 hour
- `"today"` - Since start of today
- `"1d"` - Last 24 hours

**Perfect for:**
- Quick troubleshooting: `ssh_service_logs` with `errors` pattern
- Service monitoring: `ssh_service_logs` with `recent` pattern
- Startup debugging: `ssh_service_logs` with `startup` pattern
- Comprehensive analysis: `ssh_service_logs` with `all` pattern
- Integration with monitoring systems and dashboards

## 🎯 Use Cases

### Odoo Development & Operations
```bash
# Deploy new addon
"Upload my-addon.zip to odoo-prod and extract it"

# Check service status
"Check if Odoo is running on odoo-prod"

# Service management with systemctl
"Restart the Odoo service on odoo-prod"
"Stop PostgreSQL service temporarily on odoo-dev"
"Enable nginx service at boot on all servers"
"Check detailed status of all running services"

# Advanced log analysis with journalctl
"Show error logs from Odoo service in the last hour"
"Get PostgreSQL startup logs from this morning"
"Follow nginx access logs in real-time for 2 minutes"
"Show all systemd logs with warning priority from today"

# Quick troubleshooting with service logs
"Get recent error logs from odoo service"
"Show startup sequence logs for postgresql"
"Check all logs from nginx service today"

# Database operations
"Execute a database backup script on odoo-prod"

# Performance monitoring
"Show CPU and memory usage on odoo-prod"
"List all systemd timers and their schedules"

# Configuration management
"Update worker count in Odoo config file"

# Code deployment
"Replace old function with new implementation in Python module"

# Log management
"Append deployment log entry with timestamp"
```

### IoT Device Management
```bash
# Sensor monitoring
"Check temperature sensor readings from rpi-sensor-1"

# Firmware updates
"Upload and install firmware update on all IoT devices"

# Data collection
"Download sensor logs from the last 24 hours"

# System maintenance
"Update system packages on all Raspberry Pi devices"

# Network diagnostics
"Check network connectivity from all IoT devices"

# Configuration updates
"Edit sensor thresholds in config files across all devices"

# Script deployment
"Deploy new monitoring script to all IoT devices"

# Log maintenance
"Append maintenance log entries after system updates"
```

## 🔐 Security Features

- **Command Filtering**: Built-in allow/disallow lists prevent dangerous commands
- **Pattern Matching**: Flexible wildcard patterns catch command variations
- **Default Protection**: Blocks destructive operations like `rm *`, `shutdown`, disk formatting
- **Host Filtering**: Restrict access to specific SSH hosts with patterns
- **SSH Key Management**: Uses your existing SSH keys and security settings
- **Config Respect**: Honors all SSH config directives (ProxyJump, IdentityFile, etc.)
- **No Credential Storage**: Never stores or transmits SSH credentials
- **Timeout Protection**: Prevents runaway processes with configurable timeouts
- **Base64 Safety**: Eliminates injection risks through command escaping
- **Script Validation**: Multi-line scripts are validated line-by-line

## 🧠 Base64 Encoding Strategy

This MCP server uses a smart base64 encoding strategy to handle complex content safely while maintaining readability for simple operations.

### When Base64 is Used:

1. **Always for Scripts**: Multi-line scripts (`ssh_execute_script`) always use base64
2. **Always for File Content**: File rewrite and append operations use base64 for content
3. **Optional for Commands**: Single commands can optionally use base64 (`useBase64: true`)
4. **Smart for File Editing**: Line editing uses base64 internally within commands

### Encoding Strategies by Operation:

**Command Execution:**
```bash
# Simple command (no base64):
ssh server "systemctl status nginx"

# Complex command (with base64):
# Your command: ps aux | grep "my app" | awk '{print $2}' | xargs kill
# Becomes: echo 'cHMgYXV4IHwgZ3JlcCAibXkgYXBwIiB8IGF3ayAne3ByaW50ICQyfScgfCB4YXJncyBraWxs' | base64 -d | bash
```

**File Operations:**
```bash
# File content (always base64):
echo 'SGVsbG8gV29ybGQhCkZyb20gbXkgZmlsZSE=' | base64 -d > /path/to/file

# Line editing (base64 within sed commands):
echo 'SGVsbG8gV29ybGQh' | base64 -d | sed -i '5s/.*/'"$(echo 'TmV3IGxpbmUgY29udGVudA==' | base64 -d)"'/' /path/to/file
```

### Why This Approach?

**For Simple Commands:**
- Direct execution is faster and more readable
- No encoding overhead for basic operations
- Easier debugging and logging

**For Complex Content:**
- **No Escaping Hell**: Eliminates quote and special character issues
- **Multi-line Safety**: Handles scripts and file content perfectly
- **Special Characters**: Unicode, symbols, and control characters work seamlessly
- **Injection Prevention**: Base64 prevents command injection attacks
- **Consistency**: Same encoding method across different shells and systems

### Before vs After Examples:

**Complex Command - Before (Escaping Hell):**
```bash
ssh server 'ps aux | grep "my app" | awk '"'"'{print $2}'"'"' | xargs kill'
```

**Complex Command - After (Base64):**
```bash
ssh server "echo 'cHMgYXV4IHwgZ3JlcCAibXkgYXBwIiB8IGF3ayAne3ByaW50ICQyfScgfCB4YXJncyBraWxs' | base64 -d | bash"
```

**File Content with Special Characters:**
```bash
# Content: #!/bin/bash\necho "Hello $USER"\ndate '+%Y-%m-%d %H:%M:%S'
# Base64: IyEvYmluL2Jhc2gKZWNobyAiSGVsbG8gJFVTRVIiCmRhdGUgJysrWS0lbS0lZCAlSDolTTolUyc=
ssh server "echo 'IyEvYmluL2Jhc2gKZWNobyAiSGVsbG8gJFVTRVIiCmRhdGUgJysrWS0lbS0lZCElSDolTTolUyc=' | base64 -d > /opt/script.sh"
```

## 🔧 Pattern Replacement Reliability (v0.1.1)

### What Was Fixed

The `ssh_edit_file` function has been completely rewritten to solve pattern replacement issues:

**Before (v0.1.0 - Broken):**
- Pattern `REMOTE=.*` would be over-escaped and fail to match
- Complex nested quoting caused shell parsing errors  
- Base64 command substitution inside sed commands was unreliable

**After (v0.1.1 - Fixed):**
- Regex patterns work correctly: `REMOTE=.*`, `KEY=.*`, `^#.*`, etc.
- Smart escaping preserves regex functionality
- Base64 encoding used only when needed for complex content
- Temporary sed script files for maximum reliability

### Pattern Examples That Now Work

```bash
# Environment variables
REMOTE=.*  → REMOTE=167.71.218.232
DEBUG=.*   → DEBUG=false
API_KEY=.* → API_KEY=new-secret-key

# Configuration patterns  
workers.*=.*     → workers = 8
threshold.*=.*   → threshold_temp = 25.5
^#.*listen.*     → listen 80;

# Service configurations
ExecStart=.*     → ExecStart=/usr/bin/python3 /opt/app/main.py
User=.*          → User=odoo
Group=.*         → Group=odoo

# Network configurations
option ipaddr '.*'    → option ipaddr '192.168.1.100'
server .*\.example\.com → server new.example.com
```

### Cross-Platform Compatibility

The fix ensures reliability across different Linux distributions:

- **OpenWrt**: Works with BusyBox sed implementation
- **Ubuntu/Debian**: Compatible with GNU sed
- **CentOS/RHEL**: Works with GNU sed variations  
- **Alpine Linux**: Compatible with BusyBox sed
- **Embedded systems**: Handles limited `/tmp` space scenarios

## 📁 Project Structure

```
/Users/dgoo2308/git/ssh_mcp/
├── src/
│   └── index.ts          # Main MCP server implementation
├── build/                # Compiled JavaScript (generated)
├── package.json          # Node.js dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## 🚦 Development

### Build and Run
```bash
# Development with auto-rebuild
npm run dev

# Production build
npm run build

# Start the server
npm start
```

### Testing Commands
```bash
# Test SSH connectivity
ssh your-host "echo 'Connection successful'"

# Test base64 encoding
echo "echo 'Hello World'" | base64
# Output: ZWNobyAnSGVsbG8gV29ybGQnCg==

# Test decoding
echo 'ZWNobyAnSGVsbG8gV29ybGQnCg==' | base64 -d | bash
# Output: Hello World
```

## 🐛 Troubleshooting

### Common Issues

**1. Host Not Found**
```
Error: Host 'my-server' not found in SSH config
```
- Check that the host exists in your `~/.ssh/config`
- Verify include files are properly loaded
- Use `ssh_list_hosts` to see available hosts

**2. Permission Denied**
```
Error: SSH execution failed: Permission denied
```
- Ensure SSH keys have correct permissions (600)
- Test manual SSH connection: `ssh your-host`
- Check SSH agent: `ssh-add -l`

**3. Connection Timeout**
```
Error: Command timed out after 30 seconds
```
- Increase timeout value for long-running commands
- Check network connectivity
- Verify SSH service is running on target host

**4. Command Blocked by Security Filter**
```
Error: Command blocked by security policy. Matches disallowed pattern: 'rm *'
```
- The command matches a security pattern in `SSH_MCP_COMMAND_DISALLOW`
- Add command to `SSH_MCP_COMMAND_ALLOW` if needed
- Check the Security Configuration section above

**5. Base64 Not Found**
```
Error: base64: command not found
```
- Most modern systems have base64 installed
- On older systems, try using `openssl base64 -d` instead

**5. Pattern Replacement Not Working**
```
Error: File edited successfully but content unchanged
```
- **Check pattern syntax**: Use regex patterns like `KEY=.*` not literal strings
- **Verify file permissions**: Ensure file is writable by SSH user
- **Test pattern manually**: `ssh your-host "grep 'your-pattern' /path/to/file"`
- **Check for special characters**: Patterns with quotes may need base64 encoding
- **Line endings**: Windows line endings (`\r\n`) may cause issues

**6. File Edit Operation Failed**
```
Error: sed: can't read /tmp/sed_script_12345: No such file or directory
```
- **Disk space**: Check if `/tmp` has available space on target host
- **Permissions**: Ensure user can write to `/tmp` directory
- **Filesystem**: Some embedded systems have read-only `/tmp` - use `/var/tmp` instead

**7. Backup File Issues**
```
Error: cannot create backup file
```
- **Disk space**: Not enough space for backup file
- **Permissions**: User cannot write to target directory
- **Disable backup**: Set `"backup": false` if backups aren't needed

### Debug Steps

1. **Test SSH connectivity:**
```bash
ssh your-host "echo 'SSH working'"
```

2. **Test base64 encoding:**
```bash
echo "date" | base64  # Should output: ZGF0ZQo=
ssh your-host "echo 'ZGF0ZQo=' | base64 -d | bash"
```

3. **Check SSH config parsing:**
```bash
ssh -F ~/.ssh/config -T your-host
```

4. **Test pattern replacement manually:**
```bash
# Test if pattern matches
ssh your-host "grep 'REMOTE=.*' /etc/vct-iot/vct-iot.env"

# Test sed replacement
ssh your-host "sed 's/REMOTE=.*/REMOTE=167.71.218.232/g' /etc/vct-iot/vct-iot.env"

# Test with backup
ssh your-host "cp /etc/vct-iot/vct-iot.env /etc/vct-iot/vct-iot.env.bak && sed -i 's/REMOTE=.*/REMOTE=167.71.218.232/g' /etc/vct-iot/vct-iot.env"
```

5. **Test complex patterns with base64:**
```bash
# Create sed script
echo 's/pattern_with_special_chars/replacement/g' | base64
# Output: cy9wYXR0ZXJuX3dpdGhfc3BlY2lhbF9jaGFycy9yZXBsYWNlbWVudC9n

# Test the script
ssh your-host "echo 'cy9wYXR0ZXJuX3dpdGhfc3BlY2lhbF9jaGFycy9yZXBsYWNlbWVudC9n' | base64 -d > /tmp/test_sed && sed -f /tmp/test_sed /path/to/file"
```

## 📝 Example SSH Config Structure

```
~/.ssh/
├── config                 # Main configuration file
├── config.d/             # Include directory
│   ├── work.conf         # Work-related hosts
│   ├── iot.conf          # IoT device configurations
│   ├── odoo.conf         # Odoo server configurations
│   └── personal.conf     # Personal servers
├── id_rsa                # Default private key
├── id_rsa_work           # Work-specific key
├── id_rsa_iot            # IoT-specific key
└── id_rsa_odoo           # Odoo-specific key
```

## 🤝 Contributing

This MCP server is designed for your specific Odoo and IoT workflows. Feel free to extend it with additional features like:

- SSH tunnel management
- Database connection tools
- Container orchestration commands
- Custom script templates
- Monitoring and alerting integration

## 📄 License

MIT License - Use it however you need for your projects!

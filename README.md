# SSH Remote Commands MCP Server

An MCP (Model Context Protocol) server that enables SSH remote command execution using your existing SSH config, with advanced base64 encoding support for complex commands and scripts. Perfect for managing IoT devices and remote Odoo deployments without escaping headaches!

## 🚀 Features

### Core Functionality
- **SSH Config Integration**: Automatically reads your `~/.ssh/config` file
- **Include Support**: Handles SSH config `Include` directives seamlessly
- **Host Management**: List and inspect all configured SSH hosts
- **Base64 Encoding**: Eliminates command escaping issues entirely

### Command Execution
- **Simple Commands**: Execute basic commands with optional base64 encoding
- **Complex Scripts**: Execute multi-line scripts with automatic base64 encoding
- **Multiple Interpreters**: Support for bash, sh, python, node, etc.
- **Timeout Protection**: Configurable timeouts prevent hanging connections

### File Operations
- **Upload Files**: Transfer files to remote hosts via SCP
- **Download Files**: Retrieve files from remote hosts
- **Edit Files**: Line-based editing with replace, insert, and delete operations
- **Rewrite Files**: Complete file content replacement with backup support
- **Append to Files**: Add content to the end of files
- **Secure Transfer**: Uses your existing SSH keys and security settings
- **Base64 Content Handling**: Safe handling of special characters and multi-line content

## 🛠 Installation

1. **Create and navigate to the project directory:**
```bash
cd /Users/dgoo2308/git/ssh_mcp
```

2. **Install dependencies:**
```bash
npm install
```

3. **Build the project:**
```bash
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
      "env": {}
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
Upload files to remote hosts:

```json
{
  "host": "odoo-dev",
  "localPath": "/Users/dgoo2308/my-addon.zip",
  "remotePath": "/opt/odoo/addons/my-addon.zip"
}
```

### 6. ssh_download_file
Download files from remote hosts:

```json
{
  "host": "rpi-sensor-1",
  "remotePath": "/var/log/sensor.log",
  "localPath": "/Users/dgoo2308/Downloads/sensor.log"
}
```

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

## 🎯 Use Cases

### Odoo Development & Operations
```bash
# Deploy new addon
"Upload my-addon.zip to odoo-prod and extract it"

# Check service status
"Check if Odoo is running on odoo-prod"

# Database operations
"Execute a database backup script on odoo-prod"

# Log analysis
"Get the last 100 lines of Odoo logs from odoo-prod"

# Performance monitoring
"Show CPU and memory usage on odoo-prod"

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

- **SSH Key Management**: Uses your existing SSH keys and security settings
- **Config Respect**: Honors all SSH config directives (ProxyJump, IdentityFile, etc.)
- **No Credential Storage**: Never stores or transmits SSH credentials
- **Timeout Protection**: Prevents runaway processes with configurable timeouts
- **Base64 Safety**: Eliminates injection risks through command escaping

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

**4. Base64 Not Found**
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

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
- **Secure Transfer**: Uses your existing SSH keys and security settings

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
```

## 🔐 Security Features

- **SSH Key Management**: Uses your existing SSH keys and security settings
- **Config Respect**: Honors all SSH config directives (ProxyJump, IdentityFile, etc.)
- **No Credential Storage**: Never stores or transmits SSH credentials
- **Timeout Protection**: Prevents runaway processes with configurable timeouts
- **Base64 Safety**: Eliminates injection risks through command escaping

## 🧠 Why Base64 Encoding?

Base64 encoding solves common SSH command execution problems:

### Before (Escaping Hell):
```bash
ssh server 'ps aux | grep "my app" | awk '"'"'{print $2}'"'"' | xargs kill'
```

### After (Base64 Magic):
```bash
# Your command: ps aux | grep "my app" | awk '{print $2}' | xargs kill
# Becomes: echo 'cHMgYXV4IHwgZ3JlcCAibXkgYXBwIiB8IGF3ayAne3ByaW50ICQyfScgfCB4YXJncyBraWxs' | base64 -d | bash
```

**Benefits:**
- No more quote escaping nightmares
- Handles special characters perfectly
- Works with complex pipes and redirections
- Supports multi-line scripts seamlessly
- Eliminates shell interpretation issues

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

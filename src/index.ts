#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, exec } from 'child_process';
import { readFile, access } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { glob } from 'glob';

// const execAsync = promisify(exec); // Commented out - not currently used

interface SSHHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
  [key: string]: any;
}

interface ServerFilter {
  allow: string[];
  disallow: string[];
}

interface CommandFilter {
  allow: string[];
  disallow: string[];
}

// Per-host restriction rules
interface HostRule {
  commandAllow?: string[];
  commandDisallow?: string[];
  readonlyPaths?: string[];
  mode?: 'permissive' | 'strict' | 'allowlist' | 'readonly';
  inherit?: string;
}

interface HostRulesConfig {
  defaults?: HostRule;
  hosts?: { [pattern: string]: HostRule };
}

// Write operation patterns for readonly path detection
const WRITE_COMMAND_PATTERNS = [
  /^rm\s/i,
  /^rmdir\s/i,
  /^mv\s/i,
  /^cp\s.*\s+\//i,  // cp to a path
  /^mkdir\s/i,
  /^touch\s/i,
  /^chmod\s/i,
  /^chown\s/i,
  /^chgrp\s/i,
  />\s*\//,         // redirect to path
  />>\s*\//,        // append to path
  /\btee\s+\//i,    // tee to path
  /^dd\s/i,
  /^truncate\s/i,
  /^shred\s/i,
  /^install\s/i,
  /^ln\s/i,
  /^unlink\s/i,
  /^sed\s+-i/i,     // sed in-place
  /^perl\s+-.*i/i,  // perl in-place
];

class SSHMCPServer {
  private server: Server;
  private sshHosts: Map<string, SSHHost> = new Map();
  private serverFilter: ServerFilter;
  private commandFilter: CommandFilter;
  private hostRules: HostRulesConfig;

  constructor() {
    this.server = new Server(
      {
        name: 'ssh-remote-commands',
        version: '0.9.0',
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
        },
      }
    );

    this.serverFilter = this.loadServerFilter();
    this.commandFilter = this.loadCommandFilter();
    this.hostRules = this.loadHostRules();
    this.setupToolHandlers();
    this.setupPromptHandlers();
    this.setupErrorHandling();
  }

  private async loadSSHConfig(): Promise<void> {
    try {
      const sshConfigPath = join(homedir(), '.ssh', 'config');
      
      // Check if config file exists
      try {
        await access(sshConfigPath);
      } catch {
        console.error('SSH config file not found at ~/.ssh/config');
        return;
      }

      const configContent = await readFile(sshConfigPath, 'utf-8');
      await this.parseSSHConfig(configContent, sshConfigPath);
    } catch (error) {
      console.error('Error loading SSH config:', error);
    }
  }

  private async parseSSHConfig(content: string, basePath: string): Promise<void> {
    const lines = content.split('\n');
    let currentHost: SSHHost | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) continue;

      // Handle Include directive (case insensitive)
      if (line.toLowerCase().startsWith('include ')) {
        const includePath = line.substring(8).trim();
        await this.handleInclude(includePath, basePath);
        continue;
      }

      const [key, ...valueParts] = line.split(/\s+/);
      const value = valueParts.join(' ');

      if (key.toLowerCase() === 'host') {
        // Save previous host - each alias gets its own map entry
        if (currentHost) {
          const aliases = currentHost.host.split(/\s+/).filter(Boolean);
          for (const alias of aliases) {
            if (this.isHostAllowed(alias)) {
              this.sshHosts.set(alias, { ...currentHost, host: alias });
            }
          }
        }

        // Start new host (store raw value; aliases split when saving)
        currentHost = { host: value };
      } else if (currentHost && key && value) {
        // Add property to current host
        const lowerKey = key.toLowerCase();
        switch (lowerKey) {
          case 'hostname':
            currentHost.hostname = value;
            break;
          case 'user':
            currentHost.user = value;
            break;
          case 'port':
            currentHost.port = parseInt(value);
            break;
          case 'identityfile':
            currentHost.identityFile = value.replace('~', homedir());
            break;
          case 'proxyjump':
            currentHost.proxyJump = value;
            break;
          default:
            currentHost[lowerKey] = value;
        }
      }
    }

    // Save last host - each alias gets its own map entry
    if (currentHost) {
      const aliases = currentHost.host.split(/\s+/).filter(Boolean);
      for (const alias of aliases) {
        if (this.isHostAllowed(alias)) {
          this.sshHosts.set(alias, { ...currentHost, host: alias });
        }
      }
    }
  }

  private async handleInclude(includePath: string, basePath: string): Promise<void> {
    try {
      // Handle relative paths and wildcards
      let fullPath = includePath;
      if (!includePath.startsWith('/')) {
        fullPath = join(join(basePath, '..'), includePath);
      }
      
      // Replace ~ with home directory
      fullPath = fullPath.replace('~', homedir());

      // Handle wildcards using glob pattern matching
      if (fullPath.includes('*')) {
        try {
          const files = await glob(fullPath);
          console.error(`Found ${files.length} files matching pattern: ${fullPath}`);
          for (const file of files) {
            try {
              console.error(`Loading SSH config from: ${file}`);
              const includeContent = await readFile(file, 'utf-8');
              await this.parseSSHConfig(includeContent, file);
            } catch (error) {
              console.warn(`Could not load include file: ${file}`, error);
            }
          }
        } catch (error) {
          console.warn(`Could not expand glob pattern: ${fullPath}`, error);
        }
      } else {
        // Handle non-wildcard includes
        try {
          const includeContent = await readFile(fullPath, 'utf-8');
          await this.parseSSHConfig(includeContent, fullPath);
        } catch (error) {
          console.warn(`Could not load include file: ${fullPath}`, error);
        }
      }
    } catch (error) {
      console.warn(`Error processing include: ${includePath}`, error);
    }
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'ssh_execute_command',
          description: 'Execute a command on a remote host via SSH using your SSH config (with command filtering for security)',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              command: {
                type: 'string',
                description: 'Command to execute on the remote host',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in seconds (default: 30)',
                default: 30,
              },
              useBase64: {
                type: 'boolean',
                description: 'Use base64 encoding for complex commands to avoid escaping issues (default: false)',
                default: false,
              },
            },
            required: ['host', 'command'],
          },
        },
        {
          name: 'ssh_execute_script',
          description: 'Execute a multi-line script on a remote host via SSH with base64 encoding (with command filtering for security)',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              script: {
                type: 'string',
                description: 'Multi-line script to execute on the remote host',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in seconds (default: 60)',
                default: 60,
              },
              interpreter: {
                type: 'string',
                description: 'Script interpreter (default: bash)',
                default: 'bash',
              },
            },
            required: ['host', 'script'],
          },
        },
        {
          name: 'ssh_list_hosts',
          description: 'List all available SSH hosts from your SSH config',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'ssh_get_host_info',
          description: 'Get detailed information about a specific SSH host',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
            },
            required: ['host'],
          },
        },
        {
          name: 'ssh_upload_file',
          description: 'Upload a file or directory to a remote host via SCP',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              localPath: {
                type: 'string',
                description: 'Local file or directory path',
              },
              remotePath: {
                type: 'string',
                description: 'Remote destination path',
              },
              recursive: {
                type: 'boolean',
                description: 'Upload directory recursively (default: false)',
                default: false,
              },
              preservePermissions: {
                type: 'boolean',
                description: 'Preserve file permissions (default: true)',
                default: true,
              },
              createDirectories: {
                type: 'boolean',
                description: 'Create parent directories if they do not exist (default: true)',
                default: true,
              },
            },
            required: ['host', 'localPath', 'remotePath'],
          },
        },
        {
          name: 'ssh_download_file',
          description: 'Download a file or directory from a remote host via SCP',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              remotePath: {
                type: 'string',
                description: 'Remote file or directory path',
              },
              localPath: {
                type: 'string',
                description: 'Local destination path',
              },
              recursive: {
                type: 'boolean',
                description: 'Download directory recursively (default: false)',
                default: false,
              },
              preservePermissions: {
                type: 'boolean',
                description: 'Preserve file permissions (default: true)',
                default: true,
              },
              createDirectories: {
                type: 'boolean',
                description: 'Create parent directories if they do not exist (default: true)',
                default: true,
              },
            },
            required: ['host', 'remotePath', 'localPath'],
          },
        },
        {
          name: 'ssh_edit_file',
          description: 'Edit specific lines in a file on a remote host using sed commands',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
              operation: {
                type: 'string',
                enum: ['replace', 'insert', 'delete'],
                description: 'Type of edit operation to perform',
              },
              lineNumber: {
                type: 'number',
                description: 'Line number to edit (1-based). For insert, new content will be inserted after this line',
              },
              content: {
                type: 'string',
                description: 'Content to insert or replace with (not used for delete operation)',
              },
              pattern: {
                type: 'string',
                description: 'Pattern to match for replace operation (alternative to lineNumber)',
              },
              backup: {
                type: 'boolean',
                description: 'Create backup file before editing (default: true)',
                default: true,
              },
            },
            required: ['host', 'filePath', 'operation'],
          },
        },
        {
          name: 'ssh_rewrite_file',
          description: 'Completely rewrite/replace the contents of a file on a remote host',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
              content: {
                type: 'string',
                description: 'New content for the file',
              },
              backup: {
                type: 'boolean',
                description: 'Create backup file before rewriting (default: true)',
                default: true,
              },
              createDirectories: {
                type: 'boolean',
                description: 'Create parent directories if they do not exist (default: false)',
                default: false,
              },
            },
            required: ['host', 'filePath', 'content'],
          },
        },
        {
          name: 'ssh_append_to_file',
          description: 'Append content to the end of a file on a remote host',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
              content: {
                type: 'string',
                description: 'Content to append to the file',
              },
              newline: {
                type: 'boolean',
                description: 'Add a newline before appended content (default: true)',
                default: true,
              },
              createFile: {
                type: 'boolean',
                description: 'Create file if it does not exist (default: true)',
                default: true,
              },
            },
            required: ['host', 'filePath', 'content'],
          },
        },
        {
          name: 'ssh_bulk_transfer',
          description: 'Efficiently transfer entire directories using tar streaming over SSH',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              direction: {
                type: 'string',
                enum: ['download', 'upload'],
                description: 'Transfer direction: download (remote to local) or upload (local to remote)',
              },
              remotePath: {
                type: 'string',
                description: 'Remote directory path',
              },
              localPath: {
                type: 'string',
                description: 'Local directory path',
              },
              compression: {
                type: 'string',
                enum: ['none', 'gzip', 'bzip2', 'xz'],
                description: 'Compression method (default: gzip)',
                default: 'gzip',
              },
              preservePermissions: {
                type: 'boolean',
                description: 'Preserve file permissions and timestamps (default: true)',
                default: true,
              },
              excludePatterns: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Patterns to exclude from transfer (tar --exclude format)',
              },
              createDirectories: {
                type: 'boolean',
                description: 'Create parent directories if they do not exist (default: true)',
                default: true,
              },
            },
            required: ['host', 'direction', 'remotePath', 'localPath'],
          },
        },
        {
          name: 'ssh_read_file',
          description: 'Read the contents of a file from a remote host',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
            },
            required: ['host', 'filePath'],
          },
        },
        {
          name: 'ssh_diff_content',
          description: 'Compare user-provided content with a remote file and show differences',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the remote file to compare against',
              },
              content: {
                type: 'string',
                description: 'User content to compare with the remote file',
              },
              contextLines: {
                type: 'number',
                description: 'Number of context lines to show in diff (default: 3)',
                default: 3,
              },
            },
            required: ['host', 'filePath', 'content'],
          },
        },
        {
          name: 'ssh_compare_files',
          description: 'Compare two files on the remote host and return the differences',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath1: {
                type: 'string',
                description: 'Path to the first file on the remote host',
              },
              filePath2: {
                type: 'string',
                description: 'Path to the second file on the remote host',
              },
              contextLines: {
                type: 'number',
                description: 'Number of context lines to show in diff (default: 3)',
                default: 3,
              },
            },
            required: ['host', 'filePath1', 'filePath2'],
          },
        },
        {
          name: 'ssh_file_info',
          description: 'Get detailed file metadata and statistics without reading the content',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
            },
            required: ['host', 'filePath'],
          },
        },
        {
          name: 'ssh_verify_file',
          description: 'Verify file integrity, encoding, format, and detect potential issues',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
              expectedEncoding: {
                type: 'string',
                description: 'Expected character encoding (e.g., utf-8, ascii, iso-8859-1)',
              },
              expectedLineEnding: {
                type: 'string',
                enum: ['unix', 'windows', 'mac'],
                description: 'Expected line ending format',
              },
              maxSampleSize: {
                type: 'number',
                description: 'Maximum bytes to sample for analysis (default: 8192)',
                default: 8192,
              },
            },
            required: ['host', 'filePath'],
          },
        },
        {
          name: 'ssh_restart_nginx',
          description: 'Safely restart nginx server with configuration validation',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              testOnly: {
                type: 'boolean',
                description: 'Only test the configuration without restarting (default: false)',
                default: false,
              },
            },
            required: ['host'],
          },
        },
        {
          name: 'ssh_list_services',
          description: 'List systemd services and their status with smart filtering to show only useful services by default (running apps, failed services, etc.). Use showAll=true to see all services.',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              pattern: {
                type: 'string',
                description: 'Filter services by name pattern (optional)',
              },
              showAll: {
                type: 'boolean',
                description: 'Show all services including system/maintenance services (default: false - shows only useful services)',
                default: false,
              },
            },
            required: ['host'],
          },
        },
        {
          name: 'ssh_list_timers',
          description: 'List systemd timers and their status',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              showAll: {
                type: 'boolean',
                description: 'Show all timers including inactive ones (default: false)',
                default: false,
              },
            },
            required: ['host'],
          },
        },
        {
          name: 'ssh_systemctl',
          description: 'Control systemd services with comprehensive service management',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              action: {
                type: 'string',
                enum: ['start', 'stop', 'restart', 'reload', 'status', 'enable', 'disable', 'mask', 'unmask'],
                description: 'Systemctl action to perform',
              },
              service: {
                type: 'string',
                description: 'Service name (e.g., nginx, odoo, postgresql)',
              },
              followStatus: {
                type: 'boolean',
                description: 'Show detailed status after performing action (default: true)',
                default: true,
              },
            },
            required: ['host', 'action', 'service'],
          },
        },
        {
          name: 'ssh_journalctl',
          description: 'View systemd journal logs with advanced filtering and time options',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              service: {
                type: 'string',
                description: 'Filter logs for specific service (optional)',
              },
              since: {
                type: 'string',
                description: 'Show logs since this time (e.g., "2 minutes ago", "1 hour ago", "today", "2024-09-02 12:00:00")',
              },
              until: {
                type: 'string',
                description: 'Show logs until this time (same format as since)',
              },
              lines: {
                type: 'number',
                description: 'Number of recent log lines to show (default: 50)',
                default: 50,
              },
              priority: {
                type: 'string',
                enum: ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'],
                description: 'Show logs at this priority level and above',
              },
              follow: {
                type: 'boolean',
                description: 'Follow logs in real-time (default: false)',
                default: false,
              },
              timeout: {
                type: 'number',
                description: 'Timeout for follow mode in seconds (default: 30)',
                default: 30,
              },
            },
            required: ['host'],
          },
        },
        {
          name: 'ssh_service_logs',
          description: 'Quick access to service logs with smart defaults for common patterns',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              service: {
                type: 'string',
                description: 'Service name to get logs for',
              },
              pattern: {
                type: 'string',
                enum: ['recent', 'errors', 'startup', 'all'],
                description: 'Log pattern to show (default: recent)',
                default: 'recent',
              },
              timeRange: {
                type: 'string',
                description: 'Time range for logs (e.g., "2m", "5m", "1h", "today")',
                default: '5m',
              },
              lines: {
                type: 'number',
                description: 'Maximum number of lines to return (default: 100)',
                default: 100,
              },
            },
            required: ['host', 'service'],
          },
        },
        {
          name: 'ssh_replace_in_file',
          description: 'Replace content in a remote file via SSH using one of 4 modes: line range (start_line+end_line), pattern anchored (start_pattern+end_pattern), marker based (marker), or exact match (old_string). Picks mode based on which parameters are provided.',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file on the remote host',
              },
              new_content: {
                type: 'string',
                description: 'Replacement content',
              },
              start_line: {
                type: 'number',
                description: 'Mode 1 (line range): Starting line number (1-based, inclusive)',
              },
              end_line: {
                type: 'number',
                description: 'Mode 1 (line range): Ending line number (1-based, inclusive)',
              },
              start_pattern: {
                type: 'string',
                description: 'Mode 2 (pattern anchored): Regex matching the start boundary line',
              },
              end_pattern: {
                type: 'string',
                description: 'Mode 2 (pattern anchored): Regex matching the end boundary line',
              },
              inclusive: {
                type: 'boolean',
                description: 'Mode 2 (pattern anchored): Whether to replace the matched boundary lines too (default: true)',
                default: true,
              },
              marker: {
                type: 'string',
                description: 'Mode 3 (marker based): Marker name — replaces content between "# BEGIN: <marker>" and "# END: <marker>" comment lines (exclusive)',
              },
              old_string: {
                type: 'string',
                description: 'Mode 4 (exact match): Exact string to find and replace',
              },
              backup: {
                type: 'boolean',
                description: 'Create backup file before editing (default: true)',
                default: true,
              },
            },
            required: ['host', 'filePath', 'new_content'],
          },
        },
        {
          name: 'ssh_get_restrictions',
          description: 'Get current command and host restrictions/filters. Use this BEFORE attempting commands that might be blocked to understand what is allowed.',
          inputSchema: {
            type: 'object',
            properties: {
              checkCommand: {
                type: 'string',
                description: 'Optional: Check if a specific command would be allowed',
              },
              checkHost: {
                type: 'string',
                description: 'Optional: Check if a specific host is accessible',
              },
            },
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!args) {
        throw new McpError(ErrorCode.InvalidRequest, 'Missing arguments');
      }

      try {
        switch (name) {
          case 'ssh_execute_command':
            return await this.executeCommand(
              args.host as string, 
              args.command as string, 
              (args.timeout as number) || 30, 
              (args.useBase64 as boolean) || false
            );
          
          case 'ssh_execute_script':
            return await this.executeScript(
              args.host as string, 
              args.script as string, 
              (args.timeout as number) || 60, 
              (args.interpreter as string) || 'bash'
            );
          
          case 'ssh_list_hosts':
            return await this.listHosts();
          
          case 'ssh_get_host_info':
            return await this.getHostInfo(args.host as string);
          
          case 'ssh_upload_file':
            return await this.uploadFile(
              args.host as string, 
              args.localPath as string, 
              args.remotePath as string,
              (args.recursive as boolean) ?? false,
              (args.preservePermissions as boolean) ?? true,
              (args.createDirectories as boolean) ?? true
            );
          
          case 'ssh_download_file':
            return await this.downloadFile(
              args.host as string, 
              args.remotePath as string, 
              args.localPath as string,
              (args.recursive as boolean) ?? false,
              (args.preservePermissions as boolean) ?? true,
              (args.createDirectories as boolean) ?? true
            );
          
          case 'ssh_edit_file':
            return await this.editFile(
              args.host as string,
              args.filePath as string,
              args.operation as string,
              args.lineNumber as number,
              args.content as string,
              args.pattern as string,
              (args.backup as boolean) ?? true
            );
          
          case 'ssh_rewrite_file':
            return await this.rewriteFile(
              args.host as string,
              args.filePath as string,
              args.content as string,
              (args.backup as boolean) ?? true,
              (args.createDirectories as boolean) ?? false
            );
          
          case 'ssh_append_to_file':
            return await this.appendToFile(
              args.host as string,
              args.filePath as string,
              args.content as string,
              (args.newline as boolean) ?? true,
              (args.createFile as boolean) ?? true
            );
          
          case 'ssh_bulk_transfer':
            return await this.bulkTransfer(
              args.host as string,
              args.direction as string,
              args.remotePath as string,
              args.localPath as string,
              (args.compression as string) ?? 'gzip',
              (args.preservePermissions as boolean) ?? true,
              (args.excludePatterns as string[]) ?? [],
              (args.createDirectories as boolean) ?? true
            );
          
          case 'ssh_read_file':
            return await this.readFile(
              args.host as string,
              args.filePath as string
            );
          
          case 'ssh_diff_content':
            return await this.diffFile(
              args.host as string,
              args.filePath as string,
              args.content as string,
              (args.contextLines as number) ?? 3
            );
          
          case 'ssh_compare_files':
            return await this.diffFiles(
              args.host as string,
              args.filePath1 as string,
              args.filePath2 as string,
              (args.contextLines as number) ?? 3
            );
          
          case 'ssh_file_info':
            return await this.getFileInfo(
              args.host as string,
              args.filePath as string
            );
          
          case 'ssh_verify_file':
            return await this.verifyFile(
              args.host as string,
              args.filePath as string,
              args.expectedEncoding as string,
              args.expectedLineEnding as string,
              (args.maxSampleSize as number) ?? 8192
            );
          
          case 'ssh_restart_nginx':
            return await this.restartNginx(
              args.host as string,
              (args.testOnly as boolean) ?? false
            );
          
          case 'ssh_list_services':
            return await this.listServices(
              args.host as string,
              args.pattern as string,
              (args.showAll as boolean) ?? false
            );
          
          case 'ssh_list_timers':
            return await this.listTimers(
              args.host as string,
              (args.showAll as boolean) ?? false
            );
          
          case 'ssh_systemctl':
            return await this.systemctl(
              args.host as string,
              args.action as string,
              args.service as string,
              (args.followStatus as boolean) ?? true
            );
          
          case 'ssh_journalctl':
            return await this.journalctl(
              args.host as string,
              args.service as string,
              args.since as string,
              args.until as string,
              (args.lines as number) ?? 50,
              args.priority as string,
              (args.follow as boolean) ?? false,
              (args.timeout as number) ?? 30
            );
          
          case 'ssh_service_logs':
            return await this.serviceLogs(
              args.host as string,
              args.service as string,
              (args.pattern as string) ?? 'recent',
              (args.timeRange as string) ?? '5m',
              (args.lines as number) ?? 100
            );
          
          case 'ssh_replace_in_file':
            return await this.replaceInFile(
              args.host as string,
              args.filePath as string,
              args.new_content as string,
              args.start_line as number | undefined,
              args.end_line as number | undefined,
              args.start_pattern as string | undefined,
              args.end_pattern as string | undefined,
              (args.inclusive as boolean) ?? true,
              args.marker as string | undefined,
              args.old_string as string | undefined,
              (args.backup as boolean) ?? true
            );

          case 'ssh_get_restrictions':
            return await this.getRestrictions(
              args.checkCommand as string,
              args.checkHost as string
            );
          
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error}`);
      }
    });
  }

  private async executeCommand(host: string, command: string, timeout: number, useBase64: boolean = false): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Check if command is allowed (with per-host rules)
    const commandCheck = this.isCommandAllowed(command, host);
    if (!commandCheck.allowed) {
      // Return error as content instead of throwing - better visibility in Claude
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              host,
              command,
              success: false,
              blocked: true,
              error: 'COMMAND_BLOCKED',
              reason: commandCheck.reason,
              matchedPattern: commandCheck.matchedPattern,
              hostRule: commandCheck.hostRule,
              suggestions: commandCheck.suggestions,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }

    let finalCommand: string;
    
    if (useBase64) {
      // Encode command in base64 and decode on remote side
      const encodedCommand = Buffer.from(command).toString('base64');
      finalCommand = `echo '${encodedCommand}' | base64 -d | bash`;
    } else {
      finalCommand = command;
    }

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, finalCommand], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new McpError(ErrorCode.InternalError, `Command timed out after ${timeout} seconds`));
      }, timeout * 1000);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                command: useBase64 ? `[Base64 Encoded] ${command}` : command,
                exitCode: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                success: code === 0,
                encoding: useBase64 ? 'base64' : 'plain',
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new McpError(ErrorCode.InternalError, `SSH execution failed: ${error.message}`));
      });
    });
  }

  private async executeScript(host: string, script: string, timeout: number, interpreter: string = 'bash'): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Check if script content is allowed (with per-host rules)
    // For scripts, we check each line that looks like a command
    const scriptLines = script.split('\n').map(line => line.trim()).filter(line => 
      line && !line.startsWith('#') && !line.startsWith('echo ') // Skip comments and echo statements
    );
    
    for (const line of scriptLines) {
      const commandCheck = this.isCommandAllowed(line, host);
      if (!commandCheck.allowed) {
        // Return error as content instead of throwing - better visibility in Claude
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                script: script.split('\n').slice(0, 3).join('\n') + (script.split('\n').length > 3 ? '\n...' : ''),
                success: false,
                blocked: true,
                error: 'SCRIPT_BLOCKED',
                blockedLine: line,
                reason: commandCheck.reason,
                matchedPattern: commandCheck.matchedPattern,
                hostRule: commandCheck.hostRule,
                suggestions: commandCheck.suggestions,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    // Always use base64 for scripts to handle multi-line content safely
    const encodedScript = Buffer.from(script).toString('base64');
    const command = `echo '${encodedScript}' | base64 -d | ${interpreter}`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new McpError(ErrorCode.InternalError, `Script timed out after ${timeout} seconds`));
      }, timeout * 1000);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                script: script.split('\n').slice(0, 3).join('\n') + (script.split('\n').length > 3 ? '\n...' : ''),
                interpreter,
                exitCode: code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                success: code === 0,
                encoding: 'base64',
                lines: script.split('\n').length,
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new McpError(ErrorCode.InternalError, `SSH script execution failed: ${error.message}`));
      });
    });
  }

  private async listHosts(): Promise<any> {
    const hosts = Array.from(this.sshHosts.entries()).map(([alias, config]) => ({
      alias,
      hostname: config.hostname || alias,
      user: config.user,
      port: config.port || 22,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            hosts,
            total: hosts.length,
          }, null, 2),
        },
      ],
    };
  }

  private async getHostInfo(host: string): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(hostConfig, null, 2),
        },
      ],
    };
  }

  private async uploadFile(
    host: string, 
    localPath: string, 
    remotePath: string, 
    recursive: boolean = false, 
    preservePermissions: boolean = true,
    createDirectories: boolean = true
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    return new Promise((resolve, reject) => {
      // Build SCP command with proper options and escaping
      let scpOptions = [];
      
      if (recursive) {
        scpOptions.push('-r');
      }
      
      if (preservePermissions) {
        scpOptions.push('-p');
      }
      
      // Add compression for better performance over slower connections
      scpOptions.push('-C');
      
      // Properly escape paths that might contain spaces or special characters
      const escapedLocalPath = `"${localPath.replace(/"/g, '\\"')}"`;
      const escapedRemotePath = `"${host}:${remotePath.replace(/"/g, '\\"')}"`;
      
      let finalCommand: string;
      
      if (createDirectories) {
        // Create parent directory on remote host first, then upload
        const remoteDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
        const createDirCommand = `ssh "${host}" "mkdir -p '${remoteDir}'"`;
        const scpCommand = ['scp', ...scpOptions, escapedLocalPath, escapedRemotePath].join(' ');
        finalCommand = `${createDirCommand} && ${scpCommand}`;
      } else {
        finalCommand = ['scp', ...scpOptions, escapedLocalPath, escapedRemotePath].join(' ');
      }
      
      exec(finalCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new McpError(ErrorCode.InternalError, `SCP upload failed: Command failed: ${finalCommand}\nError: ${error.message}`));
          return;
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                localPath,
                remotePath,
                recursive,
                preservePermissions,
                createDirectories,
                success: true,
                message: recursive ? 'Directory uploaded successfully' : 'File uploaded successfully',
                command: finalCommand,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
              }, null, 2),
            },
          ],
        });
      });
    });
  }

  private async downloadFile(
    host: string, 
    remotePath: string, 
    localPath: string, 
    recursive: boolean = false, 
    preservePermissions: boolean = true,
    createDirectories: boolean = true
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    return new Promise((resolve, reject) => {
      // Build SCP command with proper options and escaping
      let scpOptions = [];
      
      if (recursive) {
        scpOptions.push('-r');
      }
      
      if (preservePermissions) {
        scpOptions.push('-p');
      }
      
      // Add compression for better performance over slower connections
      scpOptions.push('-C');
      
      // Properly escape paths that might contain spaces or special characters
      const escapedRemotePath = `"${host}:${remotePath.replace(/"/g, '\\"')}"`;
      const escapedLocalPath = `"${localPath.replace(/"/g, '\\"')}"`;
      
      let finalCommand: string;
      
      if (createDirectories) {
        // Create parent directory locally first, then download
        const localDir = localPath.substring(0, localPath.lastIndexOf('/'));
        const createDirCommand = `mkdir -p "${localDir}"`;
        const scpCommand = ['scp', ...scpOptions, escapedRemotePath, escapedLocalPath].join(' ');
        finalCommand = `${createDirCommand} && ${scpCommand}`;
      } else {
        finalCommand = ['scp', ...scpOptions, escapedRemotePath, escapedLocalPath].join(' ');
      }
      
      exec(finalCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new McpError(ErrorCode.InternalError, `SCP download failed: Command failed: ${finalCommand}\nError: ${error.message}`));
          return;
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                remotePath,
                localPath,
                recursive,
                preservePermissions,
                createDirectories,
                success: true,
                message: recursive ? 'Directory downloaded successfully' : 'File downloaded successfully',
                command: finalCommand,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
              }, null, 2),
            },
          ],
        });
      });
    });
  }

  private async editFile(
    host: string, 
    filePath: string, 
    operation: string, 
    lineNumber?: number, 
    content?: string, 
    pattern?: string, 
    backup: boolean = true
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Use base64 encoding for all content to avoid escaping issues
    let command = '';
    
    // Create backup if requested
    if (backup) {
      command += `[ -f "${filePath}" ] && cp "${filePath}" "${filePath}.bak"; `;
    }

    switch (operation) {
      case 'replace':
        if (lineNumber && content !== undefined) {
          // Replace specific line number using base64
          // For line replacement, we still need to use echo because sed needs the content in a variable
          // This is one case where echo is necessary, but we can use printf for safer handling
          const encodedContent = Buffer.from(content).toString('base64');
          command += `printf '%s' '${encodedContent}' | base64 -d | { read newline; sed -i '${lineNumber}s/.*/'"\$newline"'/' "${filePath}"; }`;
        } else if (pattern && content !== undefined) {
          // Replace by pattern using proper escaping and base64 for complex content
          // Escape special sed characters in pattern and replacement
          const escapedPattern = this.escapeSedPattern(pattern);
          const escapedContent = this.escapeSedReplacement(content);
          
          // For very complex patterns or content, use base64 with a temporary script
          if (this.needsBase64Encoding(pattern, content)) {
            const sedScript = `s/${escapedPattern}/${escapedContent}/g`;
            const encodedScript = Buffer.from(sedScript).toString('base64');
            command += `printf '%s' '${encodedScript}' | base64 -d > /tmp/sed_script_$$ && sed -i -f /tmp/sed_script_$$ "${filePath}"; rm -f /tmp/sed_script_$$`;
          } else {
            // Use direct sed command for simple cases
            command += `sed -i 's/${escapedPattern}/${escapedContent}/g' "${filePath}"`;
          }
        } else {
          throw new McpError(ErrorCode.InvalidRequest, 'Replace operation requires either lineNumber or pattern, and content');
        }
        break;
      
      case 'insert':
        if (lineNumber && content !== undefined) {
          // Insert new line using base64
          const encodedContent = Buffer.from(content).toString('base64');
          command += `echo '${encodedContent}' | base64 -d | { read newline; sed -i '${lineNumber}a\\'"\$newline" "${filePath}"; }`;
        } else {
          throw new McpError(ErrorCode.InvalidRequest, 'Insert operation requires lineNumber and content');
        }
        break;
      
      case 'delete':
        if (lineNumber) {
          // Delete specific line number
          command += `sed -i '${lineNumber}d' "${filePath}"`;
        } else if (pattern) {
          // Delete lines matching pattern
          const escapedPattern = this.escapeSedPattern(pattern);
          if (this.needsBase64Encoding(pattern, '')) {
            const sedScript = `/${escapedPattern}/d`;
            const encodedScript = Buffer.from(sedScript).toString('base64');
            command += `echo '${encodedScript}' | base64 -d > /tmp/sed_script_$$ && sed -i -f /tmp/sed_script_$$ "${filePath}"; rm -f /tmp/sed_script_$$`;
          } else {
            command += `sed -i '/${escapedPattern}/d' "${filePath}"`;
          }
        } else {
          throw new McpError(ErrorCode.InvalidRequest, 'Delete operation requires either lineNumber or pattern');
        }
        break;
      
      default:
        throw new McpError(ErrorCode.InvalidRequest, `Unknown operation: ${operation}`);
    }

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath,
                operation,
                lineNumber,
                pattern,
                content: operation === 'delete' ? undefined : content,
                backup,
                exitCode: code,
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                message: code === 0 ? 'File edited successfully' : 'Edit operation failed',
                encoding: 'base64',
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH edit file failed: ${error.message}`));
      });
    });
  }

  private async rewriteFile(
    host: string, 
    filePath: string, 
    content: string, 
    backup: boolean = true, 
    createDirectories: boolean = false
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Use base64 encoding to safely handle content with special characters
    const encodedContent = Buffer.from(content).toString('base64');
    
    let command = '';
    if (createDirectories) {
      command += `mkdir -p "$(dirname "${filePath}")"; `;
    }
    
    if (backup) {
      command += `[ -f "${filePath}" ] && cp "${filePath}" "${filePath}.bak"; `;
    }
    
    // Use base64 -d directly - the base64 content will be sent via stdin
    // This completely avoids shell interpretation of the base64 content
    command += `base64 -d > "${filePath}" && echo "WRITE_SUCCESS" || echo "WRITE_FAILED"`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Send the base64 content to stdin and close it
      // This is the key - we write the base64 content directly to stdin
      if (child.stdin) {
        child.stdin.write(encodedContent);
        child.stdin.end();
      }

      child.on('close', (code) => {
        // Check for actual write success/failure indicators
        const writeSuccessful = stdout.includes('WRITE_SUCCESS');
        const writeFailed = stdout.includes('WRITE_FAILED');
        
        // Determine if the operation actually succeeded
        const actualSuccess = code === 0 && writeSuccessful && !writeFailed;
        
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath,
                backup,
                createDirectories,
                contentLength: content.length,
                contentLines: content.split('\n').length,
                exitCode: code,
                success: actualSuccess,
                writeSuccessful,
                writeFailed,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                message: actualSuccess ? 'File rewritten successfully' : 'Rewrite operation failed',
                encoding: 'base64',
                debugInfo: {
                  commandLength: command.length,
                  base64Length: encodedContent.length,
                }
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH rewrite file failed: ${error.message}`));
      });
    });
  }

  private async appendToFile(
    host: string, 
    filePath: string, 
    content: string, 
    newline: boolean = true, 
    createFile: boolean = true
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Use base64 encoding to safely handle content with special characters
    const finalContent = newline && content.length > 0 && !content.startsWith('\n') ? '\n' + content : content;
    const encodedContent = Buffer.from(finalContent).toString('base64');
    
    let command = '';
    if (createFile) {
      command += `touch "${filePath}"; `;
    }
    
    // Use base64 -d with stdin to avoid shell interpretation of the base64 content
    command += `base64 -d >> "${filePath}"`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Send the base64 content to stdin and close it
      // This avoids shell interpretation of special characters in the base64 string
      if (child.stdin) {
        child.stdin.write(encodedContent);
        child.stdin.end();
      }

      child.on('close', (code) => {
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath,
                newline,
                createFile,
                contentLength: content.length,
                contentLines: content.split('\n').length,
                exitCode: code,
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                message: code === 0 ? 'Content appended successfully' : 'Append operation failed',
                encoding: 'base64',
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH append to file failed: ${error.message}`));
      });
    });
  }

  private async bulkTransfer(
    host: string,
    direction: string,
    remotePath: string,
    localPath: string,
    compression: string = 'gzip',
    preservePermissions: boolean = true,
    excludePatterns: string[] = [],
    createDirectories: boolean = true
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    return new Promise((resolve, reject) => {
      // Determine compression flags
      let tarFlags = 'f';
      let compressFlag = '';
      
      switch (compression) {
        case 'gzip':
          compressFlag = 'z';
          break;
        case 'bzip2':
          compressFlag = 'j';
          break;
        case 'xz':
          compressFlag = 'J';
          break;
        case 'none':
          compressFlag = '';
          break;
        default:
          compressFlag = 'z'; // Default to gzip
      }

      // Add preservation flag if requested
      if (preservePermissions) {
        tarFlags += 'p';
      }

      // Build exclude arguments
      const excludeArgs = excludePatterns.map(pattern => `--exclude="${pattern}"`).join(' ');

      let command: string;
      let workingDir: string;

      if (direction === 'download') {
        // Download: ssh host "cd remote && tar czf - ." | tar xzf - -C local
        if (createDirectories) {
          workingDir = localPath;
          // Create local directory first
          command = `mkdir -p "${localPath}" && ssh "${host}" "cd '${remotePath}' && tar c${compressFlag}${tarFlags} - ${excludeArgs} ." | tar x${compressFlag}${tarFlags} - -C "${localPath}"`;
        } else {
          command = `ssh "${host}" "cd '${remotePath}' && tar c${compressFlag}${tarFlags} - ${excludeArgs} ." | tar x${compressFlag}${tarFlags} - -C "${localPath}"`;
        }
      } else if (direction === 'upload') {
        // Upload: tar czf - -C local . | ssh host "cd remote && tar xzf -"
        if (createDirectories) {
          command = `tar c${compressFlag}${tarFlags} - ${excludeArgs} -C "${localPath}" . | ssh "${host}" "mkdir -p '${remotePath}' && cd '${remotePath}' && tar x${compressFlag}${tarFlags} -"`;
        } else {
          command = `tar c${compressFlag}${tarFlags} - ${excludeArgs} -C "${localPath}" . | ssh "${host}" "cd '${remotePath}' && tar x${compressFlag}${tarFlags} -"`;
        }
      } else {
        reject(new McpError(ErrorCode.InvalidRequest, `Invalid direction: ${direction}. Must be 'download' or 'upload'.`));
        return;
      }

      const startTime = Date.now();
      
      exec(command, { maxBuffer: 1024 * 1024 * 100 }, (error, stdout, stderr) => {
        const endTime = Date.now();
        const duration = endTime - startTime;

        if (error) {
          reject(new McpError(ErrorCode.InternalError, `Bulk transfer failed: Command failed: ${command}\nError: ${error.message}\nStderr: ${stderr}`));
          return;
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                direction,
                remotePath,
                localPath,
                compression,
                preservePermissions,
                excludePatterns,
                createDirectories,
                success: true,
                message: `Bulk ${direction} completed successfully`,
                command: command,
                duration: `${duration}ms`,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
              }, null, 2),
            },
          ],
        });
      });
    });
  }

  private async getFileInfo(host: string, filePath: string): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Use stat and ls to get comprehensive file information
    const command = `stat -c 'TYPE:%F SIZE:%s BLOCKS:%b BLKSIZE:%B INODE:%i LINKS:%h UID:%u GID:%g ATIME:%X MTIME:%Y CTIME:%Z MODE:%a DEVICE:%D' "${filePath}" 2>/dev/null || echo 'STAT_FAILED'; ls -la "${filePath}" 2>/dev/null || echo 'LS_FAILED'; file "${filePath}" 2>/dev/null || echo 'FILE_FAILED'`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const lines = stdout.split('\n');
        const statLine = lines.find(line => line.startsWith('TYPE:')) || '';
        const lsLine = lines.find(line => !line.startsWith('TYPE:') && !line.includes('_FAILED') && line.trim() && !line.includes(':')) || '';
        const fileLine = lines.find(line => line.includes(':') && !line.startsWith('TYPE:')) || '';

        let fileInfo: any = {
          host,
          filePath,
          exitCode: code,
          success: code === 0 && !stdout.includes('STAT_FAILED'),
          exists: !stdout.includes('STAT_FAILED'),
          accessible: !stdout.includes('LS_FAILED'),
        };

        if (!stdout.includes('STAT_FAILED')) {
          // Parse stat output
          const statParts: { [key: string]: string } = {};
          const statItems = statLine.split(' ');
          for (const item of statItems) {
            const [key, value] = item.split(':');
            if (key && value) {
              statParts[key] = value;
            }
          }

          fileInfo = {
            ...fileInfo,
            type: statParts.TYPE || 'unknown',
            size: parseInt(statParts.SIZE || '0'),
            blocks: parseInt(statParts.BLOCKS || '0'),
            blockSize: parseInt(statParts.BLKSIZE || '0'),
            inode: parseInt(statParts.INODE || '0'),
            links: parseInt(statParts.LINKS || '0'),
            uid: parseInt(statParts.UID || '0'),
            gid: parseInt(statParts.GID || '0'),
            permissions: {
              octal: statParts.MODE || '000',
              readable: (parseInt(statParts.MODE || '0') & 0o444) !== 0,
              writable: (parseInt(statParts.MODE || '0') & 0o222) !== 0,
              executable: (parseInt(statParts.MODE || '0') & 0o111) !== 0,
            },
            timestamps: {
              accessed: new Date(parseInt(statParts.ATIME || '0') * 1000).toISOString(),
              modified: new Date(parseInt(statParts.MTIME || '0') * 1000).toISOString(),
              changed: new Date(parseInt(statParts.CTIME || '0') * 1000).toISOString(),
            },
            device: statParts.DEVICE || 'unknown',
          };
        }

        if (!stdout.includes('LS_FAILED') && lsLine) {
          // Parse ls -la output for additional info
          const lsParts = lsLine.trim().split(/\s+/);
          if (lsParts.length >= 9) {
            fileInfo.permissions = {
              ...fileInfo.permissions,
              string: lsParts[0] || 'unknown',
            };
            fileInfo.owner = lsParts[2] || 'unknown';
            fileInfo.group = lsParts[3] || 'unknown';
          }
        }

        if (!stdout.includes('FILE_FAILED') && fileLine) {
          // Parse file command output
          const fileType = fileLine.split(':').slice(1).join(':').trim();
          fileInfo.mimeInfo = {
            description: fileType,
            isBinary: fileType.includes('binary') || fileType.includes('executable'),
            isText: fileType.includes('text') || fileType.includes('ASCII'),
            encoding: fileType.match(/\b(UTF-8|ASCII|ISO-8859|UTF-16)\b/i)?.[0] || 'unknown',
          };
        }

        fileInfo.message = fileInfo.success ? 'File information retrieved successfully' : 'Failed to get complete file information';

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify(fileInfo, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH file info failed: ${error.message}`));
      });
    });
  }

  private async verifyFile(
    host: string,
    filePath: string,
    expectedEncoding?: string,
    expectedLineEnding?: string,
    maxSampleSize: number = 8192
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Build command to analyze file with various tools
    let command = `
      echo "=== FILE EXISTS CHECK ===";
      [ -f "${filePath}" ] && echo "EXISTS:true" || echo "EXISTS:false";
      
      echo "=== FILE TYPE ===";
      file "${filePath}" 2>/dev/null || echo "FILE_FAILED";
      
      echo "=== SIZE INFO ===";
      wc -c "${filePath}" 2>/dev/null || echo "SIZE_FAILED";
      
      echo "=== LINE ENDINGS CHECK ===";
      head -c ${maxSampleSize} "${filePath}" 2>/dev/null | od -c | head -10 2>/dev/null || echo "OD_FAILED";
      
      echo "=== ENCODING CHECK ===";
      head -c ${maxSampleSize} "${filePath}" 2>/dev/null | hexdump -C | head -5 2>/dev/null || echo "HEX_FAILED";
      
      echo "=== CHARACTER ANALYSIS ===";
      head -c ${maxSampleSize} "${filePath}" 2>/dev/null | wc -l 2>/dev/null || echo "LINES_FAILED";
      head -c ${maxSampleSize} "${filePath}" 2>/dev/null | tr -d '\\0' | wc -c 2>/dev/null || echo "CHARS_FAILED";
      
      echo "=== BINARY CHECK ===";
      head -c ${maxSampleSize} "${filePath}" 2>/dev/null | grep -q '[\\0]' && echo "BINARY:true" || echo "BINARY:false";
    `;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const output = stdout;
        
        // Parse the output sections
        let verification: any = {
          host,
          filePath,
          maxSampleSize,
          exitCode: code,
          success: code === 0,
          exists: output.includes('EXISTS:true'),
          issues: [] as string[],
          warnings: [] as string[],
        };

        // File type analysis
        const fileTypeMatch = output.match(/=== FILE TYPE ===\s*([^\n=]+)/);
        if (fileTypeMatch && !fileTypeMatch[1].includes('FILE_FAILED')) {
          const fileType = fileTypeMatch[1].trim();
          verification.fileType = {
            description: fileType,
            isBinary: fileType.includes('binary') || fileType.includes('executable'),
            isText: fileType.includes('text') || fileType.includes('ASCII'),
            encoding: fileType.match(/\b(UTF-8|ASCII|ISO-8859|UTF-16)\b/i)?.[0] || 'unknown',
          };

          // Check encoding expectations
          if (expectedEncoding && verification.fileType.encoding !== 'unknown') {
            if (verification.fileType.encoding.toLowerCase() !== expectedEncoding.toLowerCase()) {
              verification.issues.push(`Encoding mismatch: expected ${expectedEncoding}, found ${verification.fileType.encoding}`);
            }
          }
        }

        // Size analysis
        const sizeMatch = output.match(/=== SIZE INFO ===\s*(\d+)/);
        if (sizeMatch) {
          verification.size = {
            bytes: parseInt(sizeMatch[1]),
            isEmpty: parseInt(sizeMatch[1]) === 0,
          };
          if (verification.size.isEmpty) {
            verification.warnings.push('File is empty');
          }
        }

        // Binary analysis
        verification.binary = {
          containsNullBytes: output.includes('BINARY:true'),
        };

        // Line ending analysis
        const odSection = output.match(/=== LINE ENDINGS CHECK ===[\s\S]*?(?==== |$)/)?.[0];
        if (odSection && !odSection.includes('OD_FAILED')) {
          const lineEndings = {
            unix: (odSection.match(/\\n/g) || []).length,
            windows: (odSection.match(/\\r\\n/g) || []).length,
            mac: (odSection.match(/\\r(?!\\n)/g) || []).length,
          };
          
          let detectedLineEnding = 'mixed';
          if (lineEndings.windows > 0 && lineEndings.unix === 0 && lineEndings.mac === 0) {
            detectedLineEnding = 'windows';
          } else if (lineEndings.unix > 0 && lineEndings.windows === 0 && lineEndings.mac === 0) {
            detectedLineEnding = 'unix';
          } else if (lineEndings.mac > 0 && lineEndings.windows === 0 && lineEndings.unix === 0) {
            detectedLineEnding = 'mac';
          }
          
          verification.lineEndings = {
            detected: detectedLineEnding,
            counts: lineEndings,
          };

          // Check line ending expectations
          if (expectedLineEnding && detectedLineEnding !== 'mixed') {
            if (detectedLineEnding !== expectedLineEnding) {
              verification.issues.push(`Line ending mismatch: expected ${expectedLineEnding}, found ${detectedLineEnding}`);
            }
          }
          
          if (detectedLineEnding === 'mixed') {
            verification.warnings.push('File contains mixed line endings');
          }
        }

        // Character analysis
        const linesMatch = output.match(/=== CHARACTER ANALYSIS ===\s*(\d+)/);
        const charsMatch = output.match(/CHARS_FAILED|LINES_FAILED/) ? null : output.match(/(\d+)\s*$/);
        if (linesMatch) {
          verification.content = {
            lines: parseInt(linesMatch[1]),
            estimatedChars: charsMatch ? parseInt(charsMatch[1]) : 0,
            sampleSize: maxSampleSize,
          };
        }

        // Overall assessment
        verification.assessment = {
          isValid: verification.issues.length === 0,
          hasWarnings: verification.warnings.length > 0,
          needsAttention: verification.issues.length > 0 || verification.warnings.length > 0,
        };

        if (!verification.exists) {
          verification.issues.push('File does not exist');
        }

        verification.message = verification.assessment.isValid ? 
          'File verification completed successfully' : 
          `File verification found ${verification.issues.length} issues and ${verification.warnings.length} warnings`;

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify(verification, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH verify file failed: ${error.message}`));
      });
    });
  }

  private escapeSedPattern(pattern: string): string {
    // Escape only the delimiter and backslashes in patterns
    // We want to preserve regex functionality (. * ^ $ [ ] should work as regex)
    // Only escape what would break the sed command structure
    return pattern
      .replace(/\\/g, '\\\\')  // Backslash must be escaped first
      .replace(/\//g, '\\/');  // Forward slash (delimiter)
  }

  private escapeSedReplacement(replacement: string): string {
    // Escape special sed characters in replacement strings
    // These characters have special meaning in sed replacements: & \ / and newlines
    return replacement
      .replace(/\\/g, '\\\\')  // Backslash must be escaped first
      .replace(/\//g, '\\/')   // Forward slash (delimiter)
      .replace(/&/g, '\\&')    // Ampersand (represents matched text)
      .replace(/\n/g, '\\n');  // Newlines
  }

  private needsBase64Encoding(pattern: string, content: string): boolean {
    // Determine if pattern or content needs base64 encoding due to complexity
    const complexChars = /['"$`\\(){}|;<>*?[\]~]/;
    const hasNewlines = /\n/;
    const hasUnicode = /[^\x00-\x7F]/;
    
    return complexChars.test(pattern) || 
           complexChars.test(content) || 
           hasNewlines.test(pattern) || 
           hasNewlines.test(content) ||
           hasUnicode.test(pattern) || 
           hasUnicode.test(content);
  }

  private async readFile(host: string, filePath: string): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Use cat to read the file content
    const command = `cat "${filePath}"`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath,
                exitCode: code,
                success: code === 0,
                content: code === 0 ? stdout : null,
                contentLength: code === 0 ? stdout.length : 0,
                contentLines: code === 0 ? stdout.split('\n').length : 0,
                stderr: stderr.trim(),
                message: code === 0 ? 'File read successfully' : 'Failed to read file',
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH read file failed: ${error.message}`));
      });
    });
  }

  private async diffFile(host: string, filePath: string, content: string, contextLines: number = 3): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Create temporary file with the new content using base64 encoding
    const encodedContent = Buffer.from(content).toString('base64');
    const tempFile = `/tmp/diff_content_$$_${Date.now()}`;
    
    const command = `echo '${encodedContent}' | base64 -d > "${tempFile}" && diff -u${contextLines > 0 ? contextLines : ''} "${filePath}" "${tempFile}"; DIFF_EXIT=$?; rm -f "${tempFile}"; exit $DIFF_EXIT`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // diff returns 0 if files are identical, 1 if different, 2 if error
        const filesIdentical = code === 0;
        const filesDifferent = code === 1;
        const diffError = code === 2;

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath,
                contextLines,
                exitCode: code,
                filesIdentical,
                filesDifferent,
                diffError,
                success: !diffError,
                diff: stdout.trim(),
                stderr: stderr.trim(),
                message: filesIdentical ? 'Files are identical' : 
                        filesDifferent ? 'Files differ' : 'Error generating diff',
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH diff file failed: ${error.message}`));
      });
    });
  }

  private async diffFiles(host: string, filePath1: string, filePath2: string, contextLines: number = 3): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Use diff to compare the two files
    const command = `diff -u${contextLines > 0 ? contextLines : ''} "${filePath1}" "${filePath2}"`;

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // diff returns 0 if files are identical, 1 if different, 2 if error
        const filesIdentical = code === 0;
        const filesDifferent = code === 1;
        const diffError = code === 2;

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath1,
                filePath2,
                contextLines,
                exitCode: code,
                filesIdentical,
                filesDifferent,
                diffError,
                success: !diffError,
                diff: stdout.trim(),
                stderr: stderr.trim(),
                message: filesIdentical ? 'Files are identical' : 
                        filesDifferent ? 'Files differ' : 'Error comparing files',
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH diff files failed: ${error.message}`));
      });
    });
  }

  private async restartNginx(host: string, testOnly: boolean = false): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Build command that first tests nginx config, then optionally restarts
    let command = 'nginx -t';
    if (!testOnly) {
      // Try reload first, fall back to restart if that fails
      command += ' && (systemctl reload nginx || systemctl restart nginx) && systemctl status nginx --no-pager -l';
    }

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const configValid = stderr.includes('syntax is ok') || stderr.includes('test is successful');
        const restarted = !testOnly && code === 0;
        
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                testOnly,
                exitCode: code,
                success: code === 0,
                configValid,
                restarted,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                message: testOnly ? 
                  (configValid ? 'Nginx configuration is valid' : 'Nginx configuration has errors') :
                  (code === 0 ? 'Nginx restarted successfully' : 'Nginx restart failed'),
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH nginx operation failed: ${error.message}`));
      });
    });
  }

  private async listServices(host: string, pattern?: string, showAll: boolean = false): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Build systemctl command
    let command = 'systemctl list-units --type=service --no-pager';
    if (showAll) {
      command += ' --all';
    }
    if (pattern) {
      command += ` '${pattern}'`;
    }
    
    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // Parse the output to extract service information
        const lines = stdout.split('\n');
        const services = [];
        let inServiceList = false;
        
        for (const line of lines) {
          // Skip empty lines
          if (!line.trim()) continue;
          
          // Find header line
          if (line.includes('UNIT') && line.includes('LOAD') && line.includes('ACTIVE') && line.includes('SUB')) {
            inServiceList = true;
            continue;
          }
          
          // Stop parsing when we hit the footer or end of service list
          if (inServiceList && (
              line.includes('loaded units listed') || 
              line.includes('LOAD   = Reflects') ||
              line.includes('ACTIVE = The high-level') ||
              line.includes('SUB    = The low-level') ||
              line.includes('To show all installed') ||
              line.match(/^\d+ loaded units listed/) ||
              line.trim() === '' && services.length > 0  // Empty line after services indicates end
            )) {
            break;
          }
          
          if (inServiceList) {
            // Parse service line
            const trimmedLine = line.trim();
            
            // Skip lines that start with special characters or don't look like service lines
            if (trimmedLine.startsWith('●') || !trimmedLine.includes('.service')) {
              continue;
            }
            
            const parts = trimmedLine.split(/\s+/);
            if (parts.length >= 4 && parts[0].endsWith('.service')) {
              services.push({
                unit: parts[0],
                load: parts[1],
                active: parts[2],
                sub: parts[3],
                description: parts.slice(4).join(' ')
              });
            }
          }
        }
        
        // Filter services for more useful output if not showing all
        let filteredServices = services;
        if (!showAll && !pattern) {
          filteredServices = this.filterUsefulServices(services);
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                showAll,
                exitCode: code,
                success: code === 0,
                services: filteredServices,
                serviceCount: filteredServices.length,
                ...((!showAll && !pattern) ? { 
                  totalServices: services.length, 
                  filtered: filteredServices.length < services.length 
                } : {}),
                message: !showAll && !pattern 
                  ? `Found ${filteredServices.length} useful services (${services.length} total)`
                  : `Found ${filteredServices.length} services`
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH list services failed: ${error.message}`));
      });
    });
  }

  private async listTimers(host: string, showAll: boolean = false): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Build systemctl command for timers
    let command = 'systemctl list-timers --no-pager';
    if (showAll) {
      command += ' --all';
    }

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // Parse the output to extract timer information
        const lines = stdout.split('\n');
        const timers = [];
        let inTimerList = false;
        
        for (const line of lines) {
          if (line.includes('NEXT') && line.includes('LEFT') && line.includes('LAST')) {
            inTimerList = true;
            continue;
          }
          if (inTimerList && line.trim() && !line.includes('timers listed')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 6) {
              // Parse the timer line - format can vary
              timers.push({
                next: parts[0] === 'n/a' ? null : parts[0] + ' ' + (parts[1] || ''),
                left: parts[0] === 'n/a' ? parts[1] : parts[2],
                last: parts[0] === 'n/a' ? parts[2] : parts[3],
                passed: parts[0] === 'n/a' ? parts[3] : parts[4],
                unit: parts[0] === 'n/a' ? parts[4] : parts[5],
                activates: parts.slice(parts[0] === 'n/a' ? 5 : 6).join(' ')
              });
            }
          }
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                showAll,
                exitCode: code,
                success: code === 0,
                timers,
                timerCount: timers.length,
                rawOutput: stdout.trim(),
                stderr: stderr.trim(),
                message: `Found ${timers.length} timers`,
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH list timers failed: ${error.message}`));
      });
    });
  }

  private async systemctl(host: string, action: string, service: string, followStatus: boolean = true): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Build systemctl command
    let command = `systemctl ${action} ${service}`;
    
    // Add status check after action if requested
    if (followStatus && !['status'].includes(action)) {
      command += ` && systemctl status ${service} --no-pager -l`;
    } else if (action === 'status') {
      command = `systemctl status ${service} --no-pager -l`;
    }

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // Parse service status from output
        const lines = stdout.split('\n');
        let serviceState = 'unknown';
        let activeState = 'unknown';
        let subState = 'unknown';
        let mainPid = null;
        let loadState = 'unknown';
        
        for (const line of lines) {
          if (line.includes('Loaded:')) {
            const loadMatch = line.match(/Loaded: ([^;]+)/);
            if (loadMatch) loadState = loadMatch[1].trim();
          }
          if (line.includes('Active:')) {
            const activeMatch = line.match(/Active: ([^\s]+)\s+\(([^)]+)\)/);
            if (activeMatch) {
              activeState = activeMatch[1];
              subState = activeMatch[2];
            }
          }
          if (line.includes('Main PID:')) {
            const pidMatch = line.match(/Main PID: ([0-9]+)/);
            if (pidMatch) mainPid = parseInt(pidMatch[1]);
          }
        }
        
        const actionSuccess = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask'].includes(action) ? code === 0 : true;
        const statusSuccess = action === 'status' ? code === 0 : true;
        
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                service,
                action,
                followStatus,
                exitCode: code,
                success: actionSuccess && statusSuccess,
                actionSuccess,
                serviceStatus: {
                  loadState,
                  activeState,
                  subState,
                  mainPid,
                  running: activeState === 'active' && subState === 'running'
                },
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                message: `Service ${action} ${actionSuccess ? 'completed successfully' : 'failed'}`,
                timestamp: new Date().toISOString()
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH systemctl failed: ${error.message}`));
      });
    });
  }

  private async journalctl(host: string, service?: string, since?: string, until?: string, lines: number = 50, priority?: string, follow: boolean = false, timeout: number = 30): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Build journalctl command
    let command = 'journalctl --no-pager';
    
    // Add service filter
    if (service) {
      command += ` -u ${service}`;
    }
    
    // Add time filters
    if (since) {
      command += ` --since="${since}"`;
    }
    if (until) {
      command += ` --until="${until}"`;
    }
    
    // Add priority filter
    if (priority) {
      command += ` -p ${priority}`;
    }
    
    // Add line limit
    if (lines && !follow) {
      command += ` -n ${lines}`;
    }
    
    // Add follow mode
    if (follow) {
      command += ` -f`;
    }

    return new Promise((resolve, reject) => {
      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let logEntries: Array<{timestamp: string | null; content: string}> = [];

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle timeout for follow mode
      let timer: NodeJS.Timeout | null = null;
      if (follow) {
        timer = setTimeout(() => {
          child.kill('SIGTERM');
        }, timeout * 1000);
      }

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        
        // Parse log entries
        const outputLines = stdout.split('\n').filter(line => line.trim());
        logEntries = outputLines.slice(0, outputLines.length).map(line => {
          // Try to parse systemd journal format
          const timestampMatch = line.match(/^([A-Z][a-z]{2} [0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})/);
          if (timestampMatch) {
            return {
              timestamp: timestampMatch[1],
              content: line.substring(timestampMatch[1].length).trim()
            };
          }
          return {
            timestamp: null,
            content: line
          };
        });
        
        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                service,
                since,
                until,
                lines,
                priority,
                follow,
                timeout,
                exitCode: code,
                success: code === 0,
                logEntries: logEntries.slice(-Math.min(lines, logEntries.length)),
                totalLines: logEntries.length,
                rawOutput: stdout.trim(),
                stderr: stderr.trim(),
                message: follow ? `Followed logs for ${timeout}s` : `Retrieved ${logEntries.length} log entries`,
                timestamp: new Date().toISOString()
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        if (timer) clearTimeout(timer);
        reject(new McpError(ErrorCode.InternalError, `SSH journalctl failed: ${error.message}`));
      });
    });
  }

  private async serviceLogs(host: string, service: string, pattern: string = 'recent', timeRange: string = '5m', lines: number = 100): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Determine parameters based on pattern
    let since: string | undefined;
    let priority: string | undefined;
    let actualLines = lines;
    
    switch (pattern) {
      case 'errors':
        priority = 'err';
        since = timeRange;
        break;
      case 'recent':
        since = timeRange;
        break;
      case 'startup':
        // Get logs since last service start
        since = 'today';
        actualLines = 200; // More lines to capture startup sequence
        break;
      case 'all':
        since = 'today';
        actualLines = Math.max(lines, 500); // Ensure we get substantial logs
        break;
      default:
        since = timeRange;
    }

    // Use the journalctl method internally
    try {
      const result = await this.journalctl(host, service, since, undefined, actualLines, priority, false, 30);
      
      // Parse the result and add pattern-specific analysis
      const originalData = JSON.parse(result.content[0].text);
      
      // Add pattern-specific insights
      let analysis = {};
      if (pattern === 'errors') {
        const errorCount = originalData.logEntries.filter((entry: any) => 
          entry.content.toLowerCase().includes('error') || 
          entry.content.toLowerCase().includes('failed') ||
          entry.content.toLowerCase().includes('critical')
        ).length;
        analysis = { errorCount, hasErrors: errorCount > 0 };
      } else if (pattern === 'startup') {
        const startupEntries = originalData.logEntries.filter((entry: any) => 
          entry.content.toLowerCase().includes('start') ||
          entry.content.toLowerCase().includes('init') ||
          entry.content.toLowerCase().includes('boot')
        );
        analysis = { startupEntries: startupEntries.length, recentStartup: startupEntries.length > 0 };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...originalData,
              pattern,
              timeRange,
              analysis,
              convenienceMode: true,
              message: `Retrieved ${originalData.totalLines} ${pattern} log entries for ${service}`,
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(ErrorCode.InternalError, `Service logs failed: ${error}`);
    }
  }

  private async replaceInFile(
    host: string,
    filePath: string,
    newContent: string,
    startLine?: number,
    endLine?: number,
    startPattern?: string,
    endPattern?: string,
    inclusive: boolean = true,
    marker?: string,
    oldString?: string,
    backup: boolean = true
  ): Promise<any> {
    const hostConfig = this.validateHostAccess(host);

    // Determine mode based on provided parameters
    let mode: string;
    if (startLine !== undefined && endLine !== undefined) {
      mode = 'line_range';
    } else if (startPattern !== undefined && endPattern !== undefined) {
      mode = 'pattern_anchored';
    } else if (marker !== undefined) {
      mode = 'marker_based';
    } else if (oldString !== undefined) {
      mode = 'exact_match';
    } else {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Must provide one of: start_line+end_line, start_pattern+end_pattern, marker, or old_string'
      );
    }

    // Encode new content as base64 to safely transfer arbitrary text
    const encodedContent = Buffer.from(newContent).toString('base64');

    // Build backup command prefix
    const backupCmd = backup ? `[ -f "${filePath}" ] && cp "${filePath}" "${filePath}.bak"; ` : '';

    let script: string;

    if (mode === 'line_range') {
      // Mode 1: Replace lines start_line..end_line (1-based, inclusive) with new_content
      // Strategy: use awk to output lines before start_line, then new_content, then lines after end_line
      script = `
set -e
${backupCmd}
TMPFILE=$(mktemp)
NEW_CONTENT=$(printf '%s' '${encodedContent}' | base64 -d)
awk -v start=${startLine} -v end=${endLine} -v newcontent="$NEW_CONTENT" '
BEGIN { printed = 0 }
NR < start { print }
NR == start { printf "%s\\n", newcontent; printed = 1 }
NR > start && NR <= end { next }
NR > end { print }
' "${filePath}" > "$TMPFILE"
mv "$TMPFILE" "${filePath}"
echo "REPLACE_SUCCESS:lines_${startLine}_to_${endLine}"
`;
    } else if (mode === 'pattern_anchored') {
      // Mode 2: Replace content between first line matching start_pattern and first subsequent line matching end_pattern
      // inclusive=true means the matched lines themselves are replaced; false means preserve them
      const inclusiveFlag = inclusive ? 1 : 0;
      script = `
set -e
${backupCmd}
TMPFILE=$(mktemp)
NEW_CONTENT=$(printf '%s' '${encodedContent}' | base64 -d)
awk -v start_pat='${startPattern!.replace(/'/g, "'\\''")}' -v end_pat='${endPattern!.replace(/'/g, "'\\''")}' -v incl=${inclusiveFlag} -v newcontent="$NEW_CONTENT" '
BEGIN { phase = 0; replaced = 0 }
phase == 0 {
  if ($0 ~ start_pat) {
    phase = 1
    replaced = 1
    if (!incl) { print }
    printf "%s\\n", newcontent
  } else {
    print
  }
  next
}
phase == 1 {
  if ($0 ~ end_pat) {
    phase = 2
    if (!incl) { print }
  }
  next
}
phase == 2 { print }
END { if (phase < 2 && replaced) { print "AWK_PATTERN_NOT_CLOSED" > "/dev/stderr" } }
' "${filePath}" > "$TMPFILE"
if grep -q "AWK_PATTERN_NOT_CLOSED" /dev/stderr 2>/dev/null; then
  rm -f "$TMPFILE"
  echo "REPLACE_FAILED:end_pattern_not_found"
  exit 1
fi
mv "$TMPFILE" "${filePath}"
echo "REPLACE_SUCCESS:pattern_anchored"
`;
    } else if (mode === 'marker_based') {
      // Mode 3: Replace content between "# BEGIN: <marker>" and "# END: <marker>" (exclusive of marker lines)
      const safeMarker = marker!.replace(/'/g, "'\\''");
      script = `
set -e
${backupCmd}
TMPFILE=$(mktemp)
NEW_CONTENT=$(printf '%s' '${encodedContent}' | base64 -d)
BEGIN_MARKER="# BEGIN: ${safeMarker}"
END_MARKER="# END: ${safeMarker}"
awk -v begin_marker="$BEGIN_MARKER" -v end_marker="$END_MARKER" -v newcontent="$NEW_CONTENT" '
BEGIN { phase = 0; found_begin = 0; found_end = 0 }
$0 == begin_marker {
  phase = 1
  found_begin = 1
  print
  printf "%s\\n", newcontent
  next
}
phase == 1 {
  if ($0 == end_marker) {
    phase = 2
    found_end = 1
    print
  }
  next
}
{ print }
END {
  if (!found_begin) { print "MARKER_BEGIN_NOT_FOUND" > "/dev/stderr" }
  else if (!found_end) { print "MARKER_END_NOT_FOUND" > "/dev/stderr" }
}
' "${filePath}" > "$TMPFILE"
STDERR_CHECK=$(awk -v begin_marker="$BEGIN_MARKER" -v end_marker="$END_MARKER" '
  $0 == begin_marker { found_begin = 1 }
  $0 == end_marker { found_end = 1 }
  END {
    if (!found_begin) print "MARKER_BEGIN_NOT_FOUND"
    else if (!found_end) print "MARKER_END_NOT_FOUND"
  }
' "${filePath}.bak" 2>/dev/null || awk -v begin_marker="$BEGIN_MARKER" -v end_marker="$END_MARKER" '
  $0 == begin_marker { found_begin = 1 }
  $0 == end_marker { found_end = 1 }
  END {
    if (!found_begin) print "MARKER_BEGIN_NOT_FOUND"
    else if (!found_end) print "MARKER_END_NOT_FOUND"
  }
' "${filePath}")
if [ -n "$STDERR_CHECK" ]; then
  rm -f "$TMPFILE"
  echo "REPLACE_FAILED:$STDERR_CHECK"
  exit 1
fi
mv "$TMPFILE" "${filePath}"
echo "REPLACE_SUCCESS:marker_based:${safeMarker}"
`;
    } else {
      // Mode 4: Exact string match — find old_string and replace with new_content
      // We use a Python script via base64 to handle arbitrary strings reliably
      const encodedOldString = Buffer.from(oldString!).toString('base64');
      script = `
set -e
${backupCmd}
OLD_CONTENT=$(printf '%s' '${encodedOldString}' | base64 -d)
NEW_CONTENT=$(printf '%s' '${encodedContent}' | base64 -d)
python3 - <<'PYEOF'
import sys, base64, os

old_bytes = base64.b64decode('${encodedOldString}')
new_bytes = base64.b64decode('${encodedContent}')
filepath = '${filePath.replace(/'/g, "'\\''")}'

with open(filepath, 'rb') as f:
    content = f.read()

if old_bytes not in content:
    print('REPLACE_FAILED:old_string_not_found')
    sys.exit(1)

new_content = content.replace(old_bytes, new_bytes, 1)
tmppath = filepath + '.tmp_replace'
with open(tmppath, 'wb') as f:
    f.write(new_content)
os.replace(tmppath, filepath)
print('REPLACE_SUCCESS:exact_match')
PYEOF
`;
    }

    return new Promise((resolve, reject) => {
      const encodedScript = Buffer.from(script).toString('base64');
      const command = `echo '${encodedScript}' | base64 -d | bash`;

      const child = spawn('ssh', [host, command], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const outputTrimmed = stdout.trim();
        const success = code === 0 && outputTrimmed.includes('REPLACE_SUCCESS');
        const failed = outputTrimmed.includes('REPLACE_FAILED');

        // Parse success info
        let linesAffected: string | null = null;
        const successMatch = outputTrimmed.match(/REPLACE_SUCCESS:([^\n]*)/);
        if (successMatch) {
          linesAffected = successMatch[1];
        }

        resolve({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                host,
                filePath,
                mode,
                backup,
                exitCode: code,
                success: success && !failed,
                modeDetail: linesAffected,
                newContentLength: newContent.length,
                newContentLines: newContent.split('\n').length,
                stdout: outputTrimmed,
                stderr: stderr.trim(),
                message: success && !failed
                  ? `File updated successfully using ${mode} mode`
                  : `Replace operation failed (mode: ${mode})`,
                ...(mode === 'line_range' ? { startLine, endLine } : {}),
                ...(mode === 'pattern_anchored' ? { startPattern, endPattern, inclusive } : {}),
                ...(mode === 'marker_based' ? { marker } : {}),
                ...(mode === 'exact_match' ? { oldStringLength: oldString!.length } : {}),
              }, null, 2),
            },
          ],
        });
      });

      child.on('error', (error) => {
        reject(new McpError(ErrorCode.InternalError, `SSH replace in file failed: ${error.message}`));
      });
    });
  }

  private async getRestrictions(checkCommand?: string, checkHost?: string): Promise<any> {
    const result: any = {
      commandFilter: {
        allowList: this.commandFilter.allow,
        disallowList: this.commandFilter.disallow,
        mode: this.commandFilter.allow.length > 0 ? 'allowlist' : 'blocklist',
        description: this.commandFilter.allow.length > 0 
          ? 'Only commands matching allow patterns are permitted'
          : 'Commands matching disallow patterns are blocked, all others permitted',
      },
      serverFilter: {
        allowList: this.serverFilter.allow,
        disallowList: this.serverFilter.disallow,
        mode: this.serverFilter.allow.length === 0 && this.serverFilter.disallow.length === 0
          ? 'unrestricted' 
          : this.serverFilter.allow.length > 0 ? 'allowlist' : 'blocklist',
      },
      hostRules: {
        rulesFile: process.env.SSH_MCP_RULES_FILE || join(homedir(), '.ssh', 'ssh_mcp_rules.json'),
        hasRules: Object.keys(this.hostRules.hosts || {}).length > 0,
        hostPatterns: Object.keys(this.hostRules.hosts || {}),
        defaults: this.hostRules.defaults || {},
      },
      envVars: {
        SSH_MCP_COMMAND_ALLOW: process.env.SSH_MCP_COMMAND_ALLOW || '(not set)',
        SSH_MCP_COMMAND_DISALLOW: process.env.SSH_MCP_COMMAND_DISALLOW || '(using defaults)',
        SSH_MCP_ALLOW: process.env.SSH_MCP_ALLOW || '(not set)',
        SSH_MCP_DISALLOW: process.env.SSH_MCP_DISALLOW || '(not set)',
        SSH_MCP_RULES_FILE: process.env.SSH_MCP_RULES_FILE || '(using default: ~/.ssh/ssh_mcp_rules.json)',
      },
    };

    // Check specific host if provided - get per-host rules
    if (checkHost) {
      const hostAllowed = this.isHostAllowed(checkHost);
      const hostExists = this.sshHosts.has(checkHost);
      const hostRules = this.getHostRules(checkHost);
      
      result.hostCheck = {
        host: checkHost,
        existsInConfig: hostExists,
        passesFilter: hostAllowed,
        accessible: hostExists && hostAllowed,
        reason: !hostExists 
          ? 'Host not found in SSH config'
          : !hostAllowed 
            ? 'Host blocked by server filter'
            : 'Host is accessible',
        matchedRulePattern: hostRules._matchedPattern || null,
        effectiveRules: hostRules._matchedPattern ? {
          mode: hostRules.mode,
          commandAllow: hostRules.commandAllow || [],
          commandDisallow: hostRules.commandDisallow || [],
          readonlyPaths: hostRules.readonlyPaths || [],
        } : null,
      };
    }

    // Check specific command if provided (uses host for per-host rules if provided)
    if (checkCommand) {
      const commandCheck = this.isCommandAllowed(checkCommand, checkHost);
      result.commandCheck = {
        command: checkCommand,
        allowed: commandCheck.allowed,
        reason: commandCheck.reason || (commandCheck.allowed ? 'Command is allowed' : 'Command is blocked'),
        matchedPattern: commandCheck.matchedPattern,
        hostRule: commandCheck.hostRule,
      };
    }

    // Add helpful suggestions
    result.suggestions = [];
    if (checkCommand && !result.commandCheck?.allowed) {
      if (result.commandCheck?.hostRule) {
        result.suggestions.push(
          `Command blocked by per-host rule "${result.commandCheck.hostRule}"`,
          `Update ~/.ssh/ssh_mcp_rules.json to allow this command for this host`,
          `Ask the user to run the command manually: "${checkCommand}"`
        );
      } else {
        result.suggestions.push(
          `To allow this command, update SSH_MCP_COMMAND_ALLOW in MCP config`,
          `Or add a per-host rule in ~/.ssh/ssh_mcp_rules.json`,
          `Ask the user to run the command manually: "${checkCommand}"`
        );
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private loadServerFilter(): ServerFilter {
    const defaultFilter: ServerFilter = { allow: [], disallow: [] };
    
    try {
      const allowEnv = process.env.SSH_MCP_ALLOW;
      const disallowEnv = process.env.SSH_MCP_DISALLOW;
      
      const allow = allowEnv ? JSON.parse(allowEnv) : [];
      const disallow = disallowEnv ? JSON.parse(disallowEnv) : [];
      
      if (!Array.isArray(allow)) {
        console.warn('SSH_MCP_ALLOW must be a JSON array, using empty array');
        return { allow: [], disallow: Array.isArray(disallow) ? disallow : [] };
      }
      
      if (!Array.isArray(disallow)) {
        console.warn('SSH_MCP_DISALLOW must be a JSON array, using empty array');
        return { allow, disallow: [] };
      }
      
      console.error(`Server filter loaded - Allow: ${allow.length} patterns, Disallow: ${disallow.length} patterns`);
      return { allow, disallow };
    } catch (error) {
      console.warn('Error parsing server filter environment variables:', error);
      return defaultFilter;
    }
  }

  private loadCommandFilter(): CommandFilter {
    const defaultDangerousCommands = [
      'rm *',
      'rm -rf *',
      'rm -rf /',
      'dd if=*',
      'mkfs.*',
      'fdisk',
      'parted',
      'shutdown.*',
      'reboot.*',
      'halt.*',
      'poweroff.*',
      'init 0',
      'init 6',
      'killall.*',
      'pkill.*',
      'chmod 777 *',
      'chown -R * /',
      'find .* -delete',
      'find .* -exec rm',
      '> /dev/sd.*',
      'cat /dev/urandom >',
      'fork.*bomb',
      ':(){ :|:& };:',
      'history -c',
      'unset HISTFILE'
    ];
    
    const defaultFilter: CommandFilter = { 
      allow: [], 
      disallow: defaultDangerousCommands 
    };
    
    try {
      const allowEnv = process.env.SSH_MCP_COMMAND_ALLOW;
      const disallowEnv = process.env.SSH_MCP_COMMAND_DISALLOW;
      
      const allow = allowEnv ? JSON.parse(allowEnv) : [];
      const disallow = disallowEnv ? JSON.parse(disallowEnv) : defaultDangerousCommands;
      
      if (!Array.isArray(allow)) {
        console.warn('SSH_MCP_COMMAND_ALLOW must be a JSON array, using empty array');
        return { allow: [], disallow: Array.isArray(disallow) ? disallow : defaultDangerousCommands };
      }
      
      if (!Array.isArray(disallow)) {
        console.warn('SSH_MCP_COMMAND_DISALLOW must be a JSON array, using defaults');
        return { allow, disallow: defaultDangerousCommands };
      }
      
      console.error(`Command filter loaded - Allow: ${allow.length} patterns, Disallow: ${disallow.length} patterns`);
      return { allow, disallow };
    } catch (error) {
      console.warn('Error parsing command filter environment variables:', error);
      return defaultFilter;
    }
  }

  private loadHostRules(): HostRulesConfig {
    const defaultConfig: HostRulesConfig = { defaults: {}, hosts: {} };
    
    // Try custom path from env, then default path
    const rulesPath = process.env.SSH_MCP_RULES_FILE || join(homedir(), '.ssh', 'ssh_mcp_rules.json');
    
    try {
      if (!existsSync(rulesPath)) {
        console.error(`Host rules file not found at ${rulesPath}, using defaults`);
        return defaultConfig;
      }
      
      const content = readFileSync(rulesPath, 'utf-8');
      const config = JSON.parse(content) as HostRulesConfig;
      
      const hostCount = config.hosts ? Object.keys(config.hosts).length : 0;
      console.error(`Host rules loaded from ${rulesPath} - ${hostCount} host patterns defined`);
      
      return config;
    } catch (error) {
      console.error(`Error loading host rules from ${rulesPath}:`, error);
      return defaultConfig;
    }
  }

  private getHostRules(host: string): HostRule & { _matchedPattern?: string } {
    const { defaults = {}, hosts = {} } = this.hostRules;
    
    // Find matching host pattern
    let matchedRule: HostRule | undefined;
    let matchedPattern: string | undefined;
    
    for (const pattern of Object.keys(hosts)) {
      if (this.matchesPattern(host, pattern)) {
        matchedRule = hosts[pattern];
        matchedPattern = pattern;
        break;
      }
    }
    
    if (!matchedRule) {
      return { ...defaults, _matchedPattern: undefined };
    }
    
    // Handle inheritance
    let resolvedRule = { ...matchedRule };
    if (matchedRule.inherit && hosts[matchedRule.inherit]) {
      const parentRule = hosts[matchedRule.inherit];
      resolvedRule = {
        commandAllow: [...(parentRule.commandAllow || []), ...(matchedRule.commandAllow || [])],
        commandDisallow: [...(parentRule.commandDisallow || []), ...(matchedRule.commandDisallow || [])],
        readonlyPaths: [...(parentRule.readonlyPaths || []), ...(matchedRule.readonlyPaths || [])],
        mode: matchedRule.mode || parentRule.mode,
      };
    }
    
    // Merge with defaults
    return {
      commandAllow: [...(defaults.commandAllow || []), ...(resolvedRule.commandAllow || [])],
      commandDisallow: [...(defaults.commandDisallow || []), ...(resolvedRule.commandDisallow || [])],
      readonlyPaths: [...(defaults.readonlyPaths || []), ...(resolvedRule.readonlyPaths || [])],
      mode: resolvedRule.mode || defaults.mode || 'permissive',
      _matchedPattern: matchedPattern,
    };
  }

  private isWriteCommand(command: string): boolean {
    return WRITE_COMMAND_PATTERNS.some(pattern => pattern.test(command));
  }

  private extractTargetPaths(command: string): string[] {
    const paths: string[] = [];
    
    // Extract paths that look like they could be targets
    // Match absolute paths
    const absolutePathMatch = command.match(/(?:^|\s)(\/[^\s;|&>]+)/g);
    if (absolutePathMatch) {
      paths.push(...absolutePathMatch.map(p => p.trim()));
    }
    
    // Match paths in redirects
    const redirectMatch = command.match(/>{1,2}\s*(\/[^\s;|&]+)/g);
    if (redirectMatch) {
      paths.push(...redirectMatch.map(p => p.replace(/>{1,2}\s*/, '')));
    }
    
    return paths;
  }

  private isPathReadonly(path: string, readonlyPaths: string[]): string | null {
    for (const roPath of readonlyPaths) {
      // Normalize paths for comparison
      const normalizedRoPath = roPath.endsWith('/') ? roPath : roPath + '/';
      const normalizedPath = path.endsWith('/') ? path : path + '/';
      
      // Check if path is under readonly path
      if (normalizedPath.startsWith(normalizedRoPath) || path === roPath || path.startsWith(roPath + '/')) {
        return roPath;
      }
    }
    return null;
  }

  private matchesCommandPattern(command: string, pattern: string): boolean {
    // Convert wildcard pattern to regex for command matching
    // More flexible than hostname matching to catch dangerous command variations
    const escapedPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars except * and ?
      .replace(/\*/g, '.*')  // Convert * to .*
      .replace(/\?/g, '.');   // Convert ? to .
    
    const regex = new RegExp(escapedPattern, 'i'); // Case insensitive for commands
    return regex.test(command.trim());
  }

  private isCommandAllowed(command: string, host?: string): { allowed: boolean; reason?: string; matchedPattern?: string; suggestions?: string[]; hostRule?: string } {
    const cleanCommand = command.trim().replace(/\s+/g, ' ');
    
    // Get per-host rules if host is provided
    const hostRules = host ? this.getHostRules(host) : null;
    const mode = hostRules?.mode || 'permissive';
    
    // 1. Check readonly mode - block all write commands
    if (mode === 'readonly' && this.isWriteCommand(cleanCommand)) {
      return {
        allowed: false,
        matchedPattern: 'readonly mode',
        hostRule: hostRules?._matchedPattern,
        reason: `⛔ WRITE BLOCKED: Host "${host}" is in readonly mode.\n\n` +
                `Command "${cleanCommand}" appears to modify files, which is not allowed.\n` +
                `If write access is needed, ask the user to:\n` +
                `1. Run the command manually via their terminal, OR\n` +
                `2. Update the host rules in ~/.ssh/ssh_mcp_rules.json`,
        suggestions: ['Ask user to run the command manually', 'Change host mode from readonly']
      };
    }
    
    // 2. Check readonly paths
    if (hostRules?.readonlyPaths && hostRules.readonlyPaths.length > 0 && this.isWriteCommand(cleanCommand)) {
      const targetPaths = this.extractTargetPaths(cleanCommand);
      for (const targetPath of targetPaths) {
        const matchedReadonly = this.isPathReadonly(targetPath, hostRules.readonlyPaths);
        if (matchedReadonly) {
          return {
            allowed: false,
            matchedPattern: `readonly path: ${matchedReadonly}`,
            hostRule: hostRules?._matchedPattern,
            reason: `⛔ PATH PROTECTED: "${targetPath}" is under readonly path "${matchedReadonly}".\n\n` +
                    `Write operations to this path are blocked for host "${host}".\n` +
                    `If write access is needed, ask the user to:\n` +
                    `1. Run the command manually via their terminal, OR\n` +
                    `2. Remove the path from readonlyPaths in ~/.ssh/ssh_mcp_rules.json`,
            suggestions: ['Ask user to run the command manually', 'Update readonlyPaths configuration']
          };
        }
      }
    }
    
    // 3. Check per-host allow list FIRST - explicit allows override disallows
    if (hostRules?.commandAllow && hostRules.commandAllow.length > 0) {
      for (const pattern of hostRules.commandAllow) {
        if (this.matchesCommandPattern(cleanCommand, pattern)) {
          console.error(`Command '${cleanCommand}' explicitly allowed by host rule pattern: '${pattern}'`);
          return { allowed: true, hostRule: hostRules?._matchedPattern };
        }
      }
    }
    
    // 4. Check per-host disallow list (includes defaults)
    if (hostRules?.commandDisallow) {
      for (const pattern of hostRules.commandDisallow) {
        if (this.matchesCommandPattern(cleanCommand, pattern)) {
          console.error(`Command '${cleanCommand}' blocked by host rule disallow pattern: '${pattern}'`);
          return {
            allowed: false,
            matchedPattern: pattern,
            hostRule: hostRules?._matchedPattern,
            reason: `⛔ COMMAND BLOCKED (host rule): "${cleanCommand}" matches blocked pattern "${pattern}" for host "${host}".\n\n` +
                    `This command is restricted by per-host security rules.\n` +
                    `If the user needs this command executed, they should:\n` +
                    `1. Run the command manually via their terminal, OR\n` +
                    `2. Add it to commandAllow in ~/.ssh/ssh_mcp_rules.json to override`,
            suggestions: ['Ask user to run the command manually', 'Add to host commandAllow to override']
          };
        }
      }
    }
    
    // 5. Check global disallow list
    const { allow, disallow } = this.commandFilter;
    for (const pattern of disallow) {
      if (this.matchesCommandPattern(cleanCommand, pattern)) {
        console.error(`Command '${cleanCommand}' blocked by global disallow pattern: '${pattern}'`);
        return { 
          allowed: false, 
          matchedPattern: pattern,
          reason: `⛔ COMMAND BLOCKED: "${cleanCommand}" matches blocked pattern "${pattern}".\n\n` +
                  `This command is restricted by the SSH MCP server security policy.\n` +
                  `If the user needs this command executed, they should:\n` +
                  `1. Run the command manually via their terminal, OR\n` +
                  `2. Update the SSH MCP configuration to allow this command pattern`,
          suggestions: [
            'Ask user to run the command manually',
            'Suggest an alternative approach',
            'Use ssh_get_restrictions to see all blocked patterns'
          ]
        };
      }
    }
    
    // 6. For allowlist mode, command must match host allow list
    if (mode === 'allowlist') {
      if (hostRules?.commandAllow) {
        for (const pattern of hostRules.commandAllow) {
          if (this.matchesCommandPattern(cleanCommand, pattern)) {
            return { allowed: true };
          }
        }
      }
      return {
        allowed: false,
        hostRule: hostRules?._matchedPattern,
        reason: `⛔ COMMAND NOT IN HOST ALLOWLIST: "${cleanCommand}" is not permitted for host "${host}".\n\n` +
                `Host is in allowlist mode - only explicitly allowed commands work.\n` +
                `Allowed patterns: ${hostRules?.commandAllow?.join(', ') || 'none'}\n` +
                `If the user needs this command, they should:\n` +
                `1. Run the command manually via their terminal, OR\n` +
                `2. Add the command pattern to commandAllow in ~/.ssh/ssh_mcp_rules.json`,
        suggestions: ['Ask user to run the command manually', 'Add command to host allowlist']
      };
    }
    
    // 7. For strict mode, check per-host allow list OR global allow list
    if (mode === 'strict') {
      // Check per-host allow
      if (hostRules?.commandAllow) {
        for (const pattern of hostRules.commandAllow) {
          if (this.matchesCommandPattern(cleanCommand, pattern)) {
            return { allowed: true };
          }
        }
      }
      // Check global allow
      for (const pattern of allow) {
        if (this.matchesCommandPattern(cleanCommand, pattern)) {
          return { allowed: true };
        }
      }
      // If neither matched, deny
      return {
        allowed: false,
        hostRule: hostRules?._matchedPattern,
        reason: `⛔ COMMAND NOT ALLOWED (strict mode): "${cleanCommand}" is not in any allow list for host "${host}".\n\n` +
                `Host is in strict mode - commands must be explicitly allowed.\n` +
                `If the user needs this command, they should:\n` +
                `1. Run the command manually via their terminal, OR\n` +
                `2. Add to commandAllow in ~/.ssh/ssh_mcp_rules.json`,
        suggestions: ['Ask user to run the command manually', 'Add command to allow list']
      };
    }
    
    // 8. Permissive mode - check global allow list if it exists
    if (allow.length === 0) {
      return { allowed: true };
    }
    
    // Check per-host allow
    if (hostRules?.commandAllow) {
      for (const pattern of hostRules.commandAllow) {
        if (this.matchesCommandPattern(cleanCommand, pattern)) {
          return { allowed: true };
        }
      }
    }
    
    // Check global allow
    for (const pattern of allow) {
      if (this.matchesCommandPattern(cleanCommand, pattern)) {
        return { allowed: true };
      }
    }
    
    // If global allow list exists but no patterns match, deny
    return { 
      allowed: false, 
      reason: `⛔ COMMAND NOT IN ALLOWLIST: "${cleanCommand}" is not permitted.\n\n` +
              `The SSH MCP server is configured with an allowlist, and this command doesn't match any allowed patterns.\n` +
              `If the user needs this command, they should:\n` +
              `1. Run the command manually via their terminal, OR\n` +
              `2. Add the command pattern to SSH_MCP_COMMAND_ALLOW in the MCP config`,
      suggestions: [
        'Ask user to run the command manually',
        'Use ssh_get_restrictions to see allowed patterns'
      ]
    };
  }

  private matchesPattern(hostname: string, pattern: string): boolean {
    // Convert wildcard pattern to regex
    // Escape regex special characters except *
    const escapedPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
      .replace(/\*/g, '.*');  // Convert * to .*
    
    const regex = new RegExp(`^${escapedPattern}$`);
    return regex.test(hostname);
  }

  private isHostAllowed(hostname: string): boolean {
    const { allow, disallow } = this.serverFilter;
    
    // If no filters are configured, allow all hosts
    if (allow.length === 0 && disallow.length === 0) {
      return true;
    }
    
    // Check disallow list first (takes precedence)
    for (const pattern of disallow) {
      if (this.matchesPattern(hostname, pattern)) {
        console.error(`Host '${hostname}' blocked by disallow pattern: '${pattern}'`);
        return false;
      }
    }
    
    // If allow list is empty, allow by default (only disallow list applies)
    if (allow.length === 0) {
      return true;
    }
    
    // Check allow list
    for (const pattern of allow) {
      if (this.matchesPattern(hostname, pattern)) {
        console.error(`Host '${hostname}' allowed by pattern: '${pattern}'`);
        return true;
      }
    }
    
    // If allow list exists but no patterns match, deny
    console.error(`Host '${hostname}' not allowed - no matching allow patterns`);
    return false;
  }

  private validateHostAccess(host: string): SSHHost {
    const hostConfig = this.sshHosts.get(host);
    
    if (hostConfig) {
      return hostConfig;
    }
    
    // Host not in map - check if it's filtered vs. not in config
    if (!this.isHostAllowed(host)) {
      throw new McpError(
        ErrorCode.InvalidRequest, 
        `Host '${host}' is not allowed by server access filters`
      );
    }
    
    // Host not found in SSH config
    throw new McpError(
      ErrorCode.InvalidRequest, 
      `Host '${host}' not found in SSH config`
    );
  }

  private filterUsefulServices(services: any[]): any[] {
    // Define patterns for services that are typically not useful to see
    const systemServicePatterns = [
      /^systemd-/,
      /^dracut-/,
      /^initrd-/,
      /^kmod-/,
      /^ldconfig/,
      /^selinux-/,
      /^import-state/,
      /^nis-domainname/,
      /^user-runtime-dir@/,
      /^getty@/,
      /^serial-getty@/,
      /^sshd-keygen@/,
      /^rc-local/,
      /^loadmodules/,
      /^microcode/,
      /^mdmonitor/,
      /^irqbalance/,
      /^cpupower/,
      /^auth-rpcgss-module/,
      /^emergency/,
      /^rescue/,
      /^cloud-/,        // cloud-init services
      /^rpc-/,          // RPC services (often not needed)
      /^user@/,         // user session services
      /^sssd/,          // system security services daemon (when inactive)
      /^polkit/,        // authorization manager
      /^dbus/,          // D-Bus (when not part of critical app services)
    ];
    
    // Filter out services that are:
    // 1. System maintenance services (based on patterns)
    // 2. Services with 'exited' state (one-time services)
    // 3. Failed services that are clearly boot/init related
    return services.filter(service => {
      const serviceName = service.unit.toLowerCase();
      
      // Skip system services that are typically not interesting
      if (systemServicePatterns.some(pattern => pattern.test(serviceName))) {
        return false;
      }
      
      // Skip one-time services that have completed (exited state)
      // Expanded list of exited services to filter out
      if (service.sub === 'exited') {
        const boringExitedServices = [
          'boot', 'setup', 'init', 'catalog-update', 'random-seed', 
          'machine-id', 'update-done', 'flush', 'wait-online', 'notify',
          'firstboot', 'remount', 'modules-load', 'sysctl', 'sysusers',
          'tmpfiles', 'hwdb-update', 'udev-trigger', 'user-sessions',
          'fsck', 'import', 'done', 'rebuild'
        ];
        
        if (boringExitedServices.some(keyword => serviceName.includes(keyword))) {
          return false;
        }
      }
      
      // Include services that are:
      // 1. Currently running (active/running)
      // 2. Failed (need attention)
      // 3. Application services (nginx, postgresql, etc.)
      return (
        (service.active === 'active' && service.sub === 'running') ||
        service.active === 'failed' ||
        this.isApplicationService(serviceName)
      );
    });
  }
  
  private isApplicationService(serviceName: string): boolean {
    // Patterns for common application services that are always interesting
    const applicationPatterns = [
      /nginx/,
      /apache/,
      /httpd/,
      /mysql/,
      /postgresql/,
      /redis/,
      /mongodb/,
      /docker/,
      /ssh[^d-keygen]/,  // sshd but not sshd-keygen
      /ftp/,
      /smtp/,
      /mail/,
      /dns/,
      /bind/,
      /named/,
      /dhcp/,
      /nfs/,
      /smb/,
      /cron/,
      /rsyslog/,
      /auditd/,
      /fail2ban/,
      /firewall/,
      /iptables/,
      /ufw/,
      /odoo/,
      /gunicorn/,
      /uwsgi/,
      /celery/,
      /node/,
      /pm2/,
      /jenkins/,
      /tomcat/,
      /elastic/,
      /kibana/,
      /grafana/,
      /prometheus/,
      /influxdb/,
      /rabbitmq/,
      /kafka/,
      /zookeeper/
    ];
    
    return applicationPatterns.some(pattern => pattern.test(serviceName));
  }

  private setupPromptHandlers(): void {
    const SSH_HELP_TEXT = `I can help you manage remote servers via SSH. Here are the available commands:

**SECURITY & RESTRICTIONS:**
- "Get SSH restrictions" - Check what commands/hosts are blocked BEFORE attempting them
- "Check if [command] is allowed on [host]" - Verify if a specific command will work
- Commands may be blocked by security policy - use restrictions check to understand limits

**PER-HOST RULES (~/.ssh/ssh_mcp_rules.json):**
- Configure different restrictions per host or host group (e.g., "production_*", "iot_*")
- Modes: permissive (default), strict, allowlist, readonly
- Explicit allows override default blocks
- Readonly paths protect specific directories from write operations
- Example: production servers can be strict, dev servers permissive

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
When a command is blocked, I will return details including:
- Which pattern blocked it and for which host rule
- Suggestions (run manually, add to allowlist, etc.)

**CONFIGURATION:**
- Global: SSH_MCP_COMMAND_DISALLOW / SSH_MCP_COMMAND_ALLOW env vars
- Per-host: ~/.ssh/ssh_mcp_rules.json (or SSH_MCP_RULES_FILE env var)
- Host filters: SSH_MCP_ALLOW / SSH_MCP_DISALLOW

All operations use your SSH config from ~/.ssh/config.`;

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [
        {
          name: 'ssh-help',
          description: 'Get help with SSH remote commands',
        },
      ],
    }));

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === 'ssh-help') {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: SSH_HELP_TEXT,
              },
            },
          ],
        };
      }
      throw new McpError(ErrorCode.InvalidRequest, `Unknown prompt: ${request.params.name}`);
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    // Load SSH config on startup
    await this.loadSSHConfig();
    
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('SSH Remote Commands MCP server running on stdio');
  }
}

// Start the server
const server = new SSHMCPServer();
server.run().catch(console.error);

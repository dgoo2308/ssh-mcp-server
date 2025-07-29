#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, exec } from 'child_process';
import { readFile, access } from 'fs/promises';
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

class SSHMCPServer {
  private server: Server;
  private sshHosts: Map<string, SSHHost> = new Map();
  private serverFilter: ServerFilter;
  private commandFilter: CommandFilter;

  constructor() {
    this.server = new Server(
      {
        name: 'ssh-remote-commands',
        version: '0.4.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.serverFilter = this.loadServerFilter();
    this.commandFilter = this.loadCommandFilter();
    this.setupToolHandlers();
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
        // Save previous host if exists
        if (currentHost && this.isHostAllowed(currentHost.host)) {
          this.sshHosts.set(currentHost.host, currentHost);
        }
        
        // Start new host
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

    // Save last host
    if (currentHost && this.isHostAllowed(currentHost.host)) {
      this.sshHosts.set(currentHost.host, currentHost);
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

    // Check if command is allowed
    const commandCheck = this.isCommandAllowed(command);
    if (!commandCheck.allowed) {
      throw new McpError(ErrorCode.InvalidRequest, commandCheck.reason || 'Command not allowed');
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

    // Check if script content is allowed
    // For scripts, we check each line that looks like a command
    const scriptLines = script.split('\n').map(line => line.trim()).filter(line => 
      line && !line.startsWith('#') && !line.startsWith('echo ') // Skip comments and echo statements
    );
    
    for (const line of scriptLines) {
      const commandCheck = this.isCommandAllowed(line);
      if (!commandCheck.allowed) {
        throw new McpError(ErrorCode.InvalidRequest, `Script contains disallowed command: "${line}". ${commandCheck.reason}`);
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
          const encodedContent = Buffer.from(content).toString('base64');
          command += `echo '${encodedContent}' | base64 -d | { read newline; sed -i '${lineNumber}s/.*/'"\$newline"'/' "${filePath}"; }`;
        } else if (pattern && content !== undefined) {
          // Replace by pattern using proper escaping and base64 for complex content
          // Escape special sed characters in pattern and replacement
          const escapedPattern = this.escapeSedPattern(pattern);
          const escapedContent = this.escapeSedReplacement(content);
          
          // For very complex patterns or content, use base64 with a temporary script
          if (this.needsBase64Encoding(pattern, content)) {
            const sedScript = `s/${escapedPattern}/${escapedContent}/g`;
            const encodedScript = Buffer.from(sedScript).toString('base64');
            command += `echo '${encodedScript}' | base64 -d > /tmp/sed_script_$$ && sed -i -f /tmp/sed_script_$$ "${filePath}"; rm -f /tmp/sed_script_$$`;
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
    
    command += `echo '${encodedContent}' | base64 -d > "${filePath}"`;

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
                backup,
                createDirectories,
                contentLength: content.length,
                contentLines: content.split('\n').length,
                exitCode: code,
                success: code === 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                message: code === 0 ? 'File rewritten successfully' : 'Rewrite operation failed',
                encoding: 'base64',
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
    
    command += `echo '${encodedContent}' | base64 -d >> "${filePath}"`;

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

  private isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
    const { allow, disallow } = this.commandFilter;
    
    // Clean the command - remove extra whitespace and get the base command
    const cleanCommand = command.trim().replace(/\s+/g, ' ');
    
    // Check disallow list first (takes precedence)
    for (const pattern of disallow) {
      if (this.matchesCommandPattern(cleanCommand, pattern)) {
        console.error(`Command '${cleanCommand}' blocked by disallow pattern: '${pattern}'`);
        return { 
          allowed: false, 
          reason: `Command blocked by security policy. Matches disallowed pattern: '${pattern}'` 
        };
      }
    }
    
    // If allow list is empty, allow by default (only disallow list applies)
    if (allow.length === 0) {
      return { allowed: true };
    }
    
    // Check allow list
    for (const pattern of allow) {
      if (this.matchesCommandPattern(cleanCommand, pattern)) {
        console.error(`Command '${cleanCommand}' allowed by pattern: '${pattern}'`);
        return { allowed: true };
      }
    }
    
    // If allow list exists but no patterns match, deny
    console.error(`Command '${cleanCommand}' not allowed - no matching allow patterns`);
    return { 
      allowed: false, 
      reason: 'Command not in allowed list. Use SSH_MCP_COMMAND_ALLOW to permit specific commands.' 
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

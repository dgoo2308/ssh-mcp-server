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

class SSHMCPServer {
  private server: Server;
  private sshHosts: Map<string, SSHHost> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'ssh-remote-commands',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

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
        if (currentHost) {
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
    if (currentHost) {
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
          description: 'Execute a command on a remote host via SSH using your SSH config',
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
          description: 'Execute a multi-line script on a remote host via SSH with base64 encoding',
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
          description: 'Upload a file to a remote host via SCP',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              localPath: {
                type: 'string',
                description: 'Local file path',
              },
              remotePath: {
                type: 'string',
                description: 'Remote destination path',
              },
            },
            required: ['host', 'localPath', 'remotePath'],
          },
        },
        {
          name: 'ssh_download_file',
          description: 'Download a file from a remote host via SCP',
          inputSchema: {
            type: 'object',
            properties: {
              host: {
                type: 'string',
                description: 'SSH host alias from your SSH config',
              },
              remotePath: {
                type: 'string',
                description: 'Remote file path',
              },
              localPath: {
                type: 'string',
                description: 'Local destination path',
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
              args.remotePath as string
            );
          
          case 'ssh_download_file':
            return await this.downloadFile(
              args.host as string, 
              args.remotePath as string, 
              args.localPath as string
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
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
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
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
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
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(hostConfig, null, 2),
        },
      ],
    };
  }

  private async uploadFile(host: string, localPath: string, remotePath: string): Promise<any> {
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
    }

    return new Promise((resolve, reject) => {
      const scpCommand = `scp "${localPath}" "${host}:${remotePath}"`;
      
      exec(scpCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new McpError(ErrorCode.InternalError, `SCP upload failed: ${error.message}`));
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
                success: true,
                message: 'File uploaded successfully',
                stdout: stdout.trim(),
                stderr: stderr.trim(),
              }, null, 2),
            },
          ],
        });
      });
    });
  }

  private async downloadFile(host: string, remotePath: string, localPath: string): Promise<any> {
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
    }

    return new Promise((resolve, reject) => {
      const scpCommand = `scp "${host}:${remotePath}" "${localPath}"`;
      
      exec(scpCommand, (error, stdout, stderr) => {
        if (error) {
          reject(new McpError(ErrorCode.InternalError, `SCP download failed: ${error.message}`));
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
                success: true,
                message: 'File downloaded successfully',
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
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
    }

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
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
    }

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
    const hostConfig = this.sshHosts.get(host);
    if (!hostConfig) {
      throw new McpError(ErrorCode.InvalidRequest, `Host '${host}' not found in SSH config`);
    }

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

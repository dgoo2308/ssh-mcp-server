#!/bin/bash

# SSH MCP Server - Quick Install Script
# This script clones and sets up the SSH MCP Server

set -e

echo "🚀 SSH MCP Server - Quick Install"
echo "================================="

# Check if git, node and npm are installed
if ! command -v git &> /dev/null; then
    echo "❌ git is required but not installed."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    echo "   Install it from: https://nodejs.org/"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed."
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Already inside a clone? Build in place — don't re-clone, and never offer to
# delete the checkout the user is standing in.
if [ -f "$SCRIPT_DIR/package.json" ] && [ -d "$SCRIPT_DIR/src" ]; then
    INSTALL_DIR="$SCRIPT_DIR"
    echo "📁 Existing checkout detected: $INSTALL_DIR"
    echo "   Building in place (skipping clone)."
    cd "$INSTALL_DIR"
    echo "📦 Installing dependencies..."
    npm install
    echo "🔨 Building project..."
    npm run build
    echo ""
    echo "🎉 Build complete!"
    echo ""
    echo "Register it with Claude Code:"
    echo "   claude mcp add --scope user ssh-remote-commands node $INSTALL_DIR/build/index.js"
    echo ""
    echo "Optional host rules: ~/.ssh/ssh_mcp_rules.json"
    echo "   (or point SSH_MCP_RULES_FILE at another path; defaults apply if absent)"
    exit 0
fi

# Set installation directory
INSTALL_DIR="${1:-$HOME/git/ssh_mcp}"

echo "📁 Installing to: $INSTALL_DIR"

# Clone the repository
if [ -d "$INSTALL_DIR" ]; then
    echo "⚠️  Directory $INSTALL_DIR already exists."
    read -p "   Remove and reinstall? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
    else
        echo "❌ Installation cancelled."
        exit 1
    fi
fi

echo "📦 Cloning repository..."
git clone https://github.com/dgoo2308/ssh-mcp-server.git "$INSTALL_DIR"

# Change to installation directory
cd "$INSTALL_DIR"

echo "📦 Installing dependencies..."
npm install

echo "🔨 Building project..."
npm run build

echo "🧪 Testing server..."
timeout 2 node build/index.js > /dev/null 2>&1 || echo "✅ Server test complete!"

echo ""
echo "🎉 Installation complete!"
echo ""
echo "📋 Next steps:"
echo "1. Add this to your Claude Desktop config:"
echo ""
echo "   {"
echo "     \"mcpServers\": {"
echo "       \"ssh-remote-commands\": {"
echo "         \"command\": \"node\","
echo "         \"args\": [\"$INSTALL_DIR/build/index.js\"],"
echo "         \"env\": {}"
echo "       }"
echo "     }"
echo "   }"
echo ""
echo "2. Restart Claude Desktop"
echo "3. Test with: 'List my SSH hosts'"
echo ""
echo "📚 Full documentation: $INSTALL_DIR/README.md"
echo "🔧 Development: cd $INSTALL_DIR && npm run dev"
echo ""

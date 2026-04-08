#!/bin/bash

# SSH MCP Server - Quick Install Script
# This script clones and sets up the SSH MCP Server

set -e

echo "🚀 SSH MCP Server - Quick Install"
echo "================================="

# Check if gh is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is required but not installed."
    echo "   Install it from: https://cli.github.com/"
    exit 1
fi

# Check if node and npm are installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed."
    echo "   Install it from: https://nodejs.org/"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm is required but not installed."
    exit 1
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
git clone git@github.com:dgoo2308/ssh-mcp-server.git "$INSTALL_DIR"

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

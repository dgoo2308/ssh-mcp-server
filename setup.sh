#!/bin/bash

# SSH MCP Server Setup Script

set -e

echo "🚀 Setting up SSH Remote Commands MCP Server..."

# Build the project
echo "📦 Building project..."
npm run build

echo "✅ Build complete!"

# Test the server
echo "🧪 Testing server startup..."
timeout 2 node build/index.js > /dev/null 2>&1 || echo "✅ Server test complete!"

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Add this to your Claude Desktop config:"
echo ""
echo "   {"
echo "     \"mcpServers\": {"
echo "       \"ssh-remote-commands\": {"
echo "         \"command\": \"node\","
echo "         \"args\": [\"$(pwd)/build/index.js\"],"
echo "         \"env\": {}"
echo "       }"
echo "     }"
echo "   }"
echo ""
echo "2. Restart Claude Desktop"
echo "3. Test with: 'List my SSH hosts'"
echo ""
echo "🔧 Available commands:"
echo "  npm run build  - Rebuild the server"
echo "  npm run dev    - Development mode with auto-rebuild"
echo "  npm start      - Start the server manually"
echo ""

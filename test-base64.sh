#!/bin/bash

# Test script for base64 encoding functionality

echo "🧪 Testing Base64 Encoding for SSH Commands"
echo "========================================="

# Test 1: Simple command
echo ""
echo "📝 Test 1: Simple Command"
SIMPLE_CMD="echo 'Hello World'"
echo "Original: $SIMPLE_CMD"
B64_SIMPLE=$(echo "$SIMPLE_CMD" | base64)
echo "Base64: $B64_SIMPLE"
echo "Decoded: $(echo "$B64_SIMPLE" | base64 -d)"

# Test 2: Complex command with pipes and quotes
echo ""
echo "📝 Test 2: Complex Command with Pipes"
COMPLEX_CMD="ps aux | grep 'ssh' | grep -v grep | awk '{print \$2, \$11}'"
echo "Original: $COMPLEX_CMD"
B64_COMPLEX=$(echo "$COMPLEX_CMD" | base64)
echo "Base64: $B64_COMPLEX"
echo "Decoded: $(echo "$B64_COMPLEX" | base64 -d)"

# Test 3: Multi-line script
echo ""
echo "📝 Test 3: Multi-line Script"
SCRIPT='#!/bin/bash
echo "Starting system check..."
date
uname -a
df -h
echo "Check complete!"'
echo "Original script:"
echo "$SCRIPT"
echo ""
B64_SCRIPT=$(echo "$SCRIPT" | base64)
echo "Base64: $B64_SCRIPT"
echo ""
echo "Decoded:"
echo "$B64_SCRIPT" | base64 -d

echo ""
echo "✅ All tests completed!"
echo ""
echo "💡 Usage in SSH:"
echo "   ssh yourhost \"echo '$B64_SIMPLE' | base64 -d | bash\""
echo ""

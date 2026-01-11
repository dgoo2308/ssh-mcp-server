# Development Workflow

## Git Tagging Best Practices

### Issue: Complex git tag messages fail
**Problem**: Using `git tag -a -m "very long message with emoji and formatting"` fails on macOS bash due to:
- Command line argument length limits
- Special character parsing issues with old bash (3.2.57)
- Complex multi-line formatting

**Solutions**:
```bash
# Option 1: Simple tag message
git tag -a v1.0.0 -m "v1.0.0: Brief release description"

# Option 2: Use file for complex messages
echo "Complex release notes with emoji 🚀
Multiple lines
- Bullet points
- Detailed descriptions" > tag_message.txt
git tag -a v1.0.0 -F tag_message.txt
rm tag_message.txt

# Option 3: Create tag without message, add details in GitHub releases
git tag v1.0.0
git push origin v1.0.0
# Then create detailed release notes in GitHub UI
```

**Lesson learned**: Keep tag messages simple via command line, use files or GitHub releases for complex release notes.

## Release Process

1. Update version in `package.json`
2. Update version in `src/index.ts`
3. Update `README.md` with new features
4. Run `npm run build` to verify compilation
5. Test on production servers
6. Commit changes with detailed message
7. Create simple git tag
8. Push changes and tag
9. Create detailed release notes in GitHub

## Testing Checklist

- [ ] Code compiles without errors (`npm run build`)
- [ ] Test on nell_remote_root server
- [ ] Test on nell_production_root server  
- [ ] Documentation updated
- [ ] Version numbers updated
- [ ] All todo items completed

## Common Commands

```bash
# Build and test
npm run build

# Test SSH commands
# (Use MCP client to test tools)

# Release workflow
git add .
git commit -m "feat: description"
git tag v0.x.0
git push origin main
git push origin v0.x.0
```

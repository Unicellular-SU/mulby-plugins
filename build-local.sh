#!/bin/bash

# Local build and test script for mulby plugins
# Replicates GitHub Actions workflow functionality with automatic cleanup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
CLEAN_UP=true
DRY_RUN=false
SANDBOX_MODE=false
GITHUB_REPO=""  # Optional: owner/repo format for generating real GitHub URLs
RELEASE_TAG=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-cleanup)
      CLEAN_UP=false
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --sandbox)
      SANDBOX_MODE=true
      shift
      ;;
    --repo)
      GITHUB_REPO="$2"  # Format: owner/repo
      shift 2
      ;;
    --release-tag)
      RELEASE_TAG="$2"  # Format: vYYYY.MM.DD-HHmm
      shift 2
      ;;
    --help)
      echo "Usage: ./build-local.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --no-cleanup    Keep build artifacts and node_modules (default: cleanup)"
      echo "  --dry-run       Show what would be done without executing"
      echo "  --sandbox       Run in a temporary directory (safest for testing)"
      echo "  --repo OWNER/REPO  Generate GitHub download URLs (e.g., --repo Unicellular-SU/mulby-plugins)"
      echo "  --release-tag TAG  Use a specific release tag (e.g., --release-tag v2026.04.10-1200)"
      echo "  --help          Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Function to print colored messages
print_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

# Function to cleanup build artifacts
cleanup_plugin() {
  local plugin_dir="$1"
  if [ ! -d "$plugin_dir" ]; then
    return
  fi
  
  print_info "Cleaning up $plugin_dir..."
  
  if [ "$DRY_RUN" = true ]; then
    echo "  (dry-run) Would remove: node_modules, dist, *.inplugin"
    return
  fi
  
  rm -rf "$plugin_dir/node_modules" 2>/dev/null || true
  rm -rf "$plugin_dir/dist" 2>/dev/null || true
  rm -rf "$plugin_dir/ui/dist" 2>/dev/null || true
  rm -f "$plugin_dir"/*.inplugin 2>/dev/null || true
}

# Function to cleanup all temporary files
cleanup_all() {
  print_info "Performing cleanup..."
  
  if [ "$DRY_RUN" = true ]; then
    echo "  (dry-run) Would cleanup all plugins and temp files"
    return
  fi
  
  # Clean up each plugin
  for plugin_dir in plugins/*/; do
    if [ -d "$plugin_dir" ]; then
      cleanup_plugin "$plugin_dir"
    fi
  done
  
  # Remove temporary files
  rm -f plugins_temp.jsonl 2>/dev/null || true
  
  print_success "Cleanup completed"
}

# Function to build and pack plugins
build_plugins() {
  cd "$SCRIPT_DIR"
  
  print_info "Starting plugin build process..."
  
  # Create releases directory
  if [ "$DRY_RUN" = false ]; then
    mkdir -p releases
  fi
  
  PLUGINS_JSON='{"version":"1.0.0","plugins":[]}'
  FAILED_PLUGINS=()
  SUCCESS_COUNT=0
  EFFECTIVE_RELEASE_TAG="$RELEASE_TAG"

  if [ -z "$EFFECTIVE_RELEASE_TAG" ]; then
    EFFECTIVE_RELEASE_TAG="v$(date -u +'%Y.%m.%d-%H%M')"
  fi
  
  for plugin_dir in plugins/*/; do
    if [ -f "$plugin_dir/package.json" ]; then
      plugin_name=$(basename "$plugin_dir")
      print_info "Processing plugin: $plugin_name"
      
      if [ "$DRY_RUN" = true ]; then
        echo "  (dry-run) Would build: $plugin_name"
        continue
      fi
      
      # Use subshell to isolate directory changes
      if (
        cd "$plugin_dir" || exit 1
        
        print_info "  Installing dependencies..."
        npm install --include=dev --legacy-peer-deps 2>&1 | grep -E "(added|up to date|npm warn)" | tail -1
        
        print_info "  Building..."
        npm run build 2>&1 | tail -3
        
        print_info "  Packing..."
        npm run pack 2>&1 | grep -E "(打包|✓|Error)" || true
        
        # Find and move the inplugin file
        inplugin_file=$(ls -1 *.inplugin 2>/dev/null | head -n1)
        if [ -z "$inplugin_file" ]; then
          echo "Error: No .inplugin file generated for $plugin_name" >&2
          exit 1
        fi
        
        print_success "  Found inplugin file: $inplugin_file"
        mv "$inplugin_file" ../../releases/
        
        # Build Plugin Store Index v2 (Rich Metadata) entry
        if [ -f "manifest.json" ]; then
          cd ../..
          if [ -n "$GITHUB_REPO" ]; then
            BASE_RAW="https://raw.githubusercontent.com/$GITHUB_REPO/main"
            REPO_URL="https://github.com/$GITHUB_REPO"
          else
            BASE_RAW="./"
            REPO_URL=""
          fi
          node scripts/build-plugin-index-entry.js "$plugin_name" "$inplugin_file" "$BASE_RAW" "$REPO_URL" "$EFFECTIVE_RELEASE_TAG" >> plugins_temp.jsonl
          cd - > /dev/null
        fi
      ); then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        print_success "Plugin $plugin_name built successfully"
      else
        FAILED_PLUGINS+=("$plugin_name")
        print_error "Failed to build plugin: $plugin_name"
      fi
    fi
  done
  
  # Combine all plugin info into plugins.json
  if [ -f "plugins_temp.jsonl" ]; then
    node -e "
      const fs = require('fs');
      const lines = fs.readFileSync('plugins_temp.jsonl', 'utf-8').trim().split('\n').filter(l => l);
      const plugins = lines.map(line => JSON.parse(line));
      const output = {
        version: '1.0.0',
        plugins: plugins
      };
      console.log(JSON.stringify(output, null, 2));
    " > plugins.json
    rm plugins_temp.jsonl
    print_success "Generated plugins.json with $SUCCESS_COUNT plugins"
  else
    echo "$PLUGINS_JSON" > plugins.json
    print_warning "No plugins were built, created empty plugins.json"
  fi
  
  # Report results
  echo ""
  echo "======================================"
  echo "Build Summary"
  echo "======================================"
  print_success "Successfully built: $SUCCESS_COUNT plugins"
  
  if [ ${#FAILED_PLUGINS[@]} -gt 0 ]; then
    print_error "Failed plugins (${#FAILED_PLUGINS[@]}):"
    for plugin in "${FAILED_PLUGINS[@]}"; do
      echo "  - $plugin"
    done
    return 1
  fi
  
  return 0
}

# Main execution
main() {
  print_info "Mulby Plugins Local Build Script"
  echo ""
  
  if [ "$SANDBOX_MODE" = true ]; then
    print_warning "Running in SANDBOX mode"
    CLEAN_UP=true
  fi
  
  if [ "$DRY_RUN" = true ]; then
    print_warning "DRY RUN mode - no actual changes will be made"
    echo ""
  fi
  
  # Setup trap for cleanup on exit
  trap 'cleanup_trap' EXIT INT TERM
  
  cleanup_trap() {
    if [ "$CLEAN_UP" = true ]; then
      echo ""
      cleanup_all
    else
      print_warning "Skipping cleanup. Build artifacts retained."
      echo ""
      print_info "To cleanup manually, run:"
      echo "  for dir in plugins/*/; do rm -rf \"\$dir/{node_modules,dist,*.inplugin}\"; done"
    fi
  }
  
  # Run build
  if build_plugins; then
    echo ""
    print_success "All plugins built successfully!"
    print_info "Packaged files are in: ./releases/"
    
    if [ "$DRY_RUN" = false ]; then
      ls -lh releases/
    fi
  else
    echo ""
    print_error "Build process failed!"
    exit 1
  fi
}

# Run main function
main

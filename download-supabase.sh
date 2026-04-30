#!/bin/bash
# ============================================================================
# Download Supabase JS Library
# Run this script from the funda-reacties directory:
#   chmod +x download-supabase.sh && ./download-supabase.sh
# ============================================================================

set -e

# Create lib directory
mkdir -p lib

# Download Supabase JS v2 UMD bundle
echo "⬇️  Downloading Supabase JS library..."
curl -sL "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js" -o lib/supabase.min.js

# Verify download
if [ -f lib/supabase.min.js ]; then
    SIZE=$(wc -c < lib/supabase.min.js)
    echo "✅ Downloaded lib/supabase.min.js (${SIZE} bytes)"
    echo ""
    echo "Supabase JS library is klaar!"
    echo "Je kunt de extensie nu laden in Chrome."
else
    echo "❌ Download mislukt. Check je internetverbinding."
    exit 1
fi

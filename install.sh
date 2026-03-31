#!/usr/bin/env bash
set -e

echo "Installing Squeezr..."
pip install -r requirements.txt

SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
fi

if [ -n "$SHELL_RC" ]; then
    SQUEEZR_DIR="$(cd "$(dirname "$0")" && pwd)"
    LINE="export ANTHROPIC_BASE_URL=http://localhost:8080"
    if ! grep -q "ANTHROPIC_BASE_URL" "$SHELL_RC"; then
        echo "" >> "$SHELL_RC"
        echo "# Squeezr - Claude context compressor" >> "$SHELL_RC"
        echo "$LINE" >> "$SHELL_RC"
        echo "Set ANTHROPIC_BASE_URL in $SHELL_RC"
    else
        echo "ANTHROPIC_BASE_URL already set in $SHELL_RC"
    fi
fi

echo ""
echo "Done. Start Squeezr with:"
echo "  python main.py"
echo ""
echo "Then restart your terminal or run:"
echo "  source $SHELL_RC"

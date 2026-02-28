#!/bin/bash

# Create necessary directories
mkdir -p data

# Run database initialization and data import
npm run import

# Sync current season fixtures so production has match data immediately
CURRENT_YEAR=$(date +%Y)
npm run sync-games -- year "$CURRENT_YEAR"

echo "Deployment preparation complete!"

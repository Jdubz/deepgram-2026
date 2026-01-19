#!/bin/bash

# Curl Examples for Audio Projects API
# These match the examples from the Deepgram interview prompt

BASE_URL="${API_URL:-http://localhost:3001}"

echo "=== Audio Projects API - Curl Examples ==="
echo ""
echo "Copy and paste these commands to test your API:"
echo ""

echo "# 1. Upload a file"
echo "curl -X POST -F \"file=@myfile.wav\" -F \"title=My Recording\" $BASE_URL/files"
echo ""

echo "# 2. List all files"
echo "curl $BASE_URL/list"
echo ""

echo "# 3. List files with max duration filter (300 seconds = 5 minutes)"
echo "curl \"$BASE_URL/list?maxduration=300\""
echo ""

echo "# 4. Download a file"
echo "curl \"$BASE_URL/download?name=myfile.wav\" -o downloaded.wav"
echo ""

echo "# 5. Get AI summary of a file"
echo "curl \"$BASE_URL/info?name=myfile.wav\""
echo ""

echo "# 6. Get file metadata by ID"
echo "curl $BASE_URL/files/{id}"
echo ""

echo "# 7. Delete a file"
echo "curl -X DELETE $BASE_URL/files/{id}"
echo ""

echo "# 8. Health check"
echo "curl $BASE_URL/health"

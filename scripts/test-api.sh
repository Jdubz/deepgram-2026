#!/bin/bash

# Audio Projects API - Test Script
# Tests all required endpoints from the Deepgram interview prompt

BASE_URL="${API_URL:-http://localhost:3000}"
TEST_AUDIO_DIR="./test-audio"

echo "========================================"
echo "  Audio Projects API - Test Suite"
echo "========================================"
echo "Base URL: $BASE_URL"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    echo -e "${GREEN}PASS${NC}: $1"
    ((TESTS_PASSED++))
}

fail() {
    echo -e "${RED}FAIL${NC}: $1"
    ((TESTS_FAILED++))
}

info() {
    echo -e "${YELLOW}INFO${NC}: $1"
}

# ----------------------------------------
# Test 1: Health Check
# ----------------------------------------
echo ""
echo "Test 1: Health Check"
echo "----------------------------------------"

HEALTH=$(curl -s "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    pass "Health endpoint returns OK"
else
    fail "Health endpoint failed: $HEALTH"
fi

# ----------------------------------------
# Test 2: Upload Audio File
# ----------------------------------------
echo ""
echo "Test 2: Upload Audio File (POST /files)"
echo "----------------------------------------"

# Create a simple test audio file if it doesn't exist
mkdir -p "$TEST_AUDIO_DIR"

# Check if we have a test file, if not create a simple one with sox or just use any available audio
if [ ! -f "$TEST_AUDIO_DIR/test.wav" ]; then
    info "Creating test audio file..."
    # Try to create with sox if available
    if command -v sox &> /dev/null; then
        sox -n -r 44100 -c 1 "$TEST_AUDIO_DIR/test.wav" synth 3 sine 440
        info "Created test.wav with sox"
    else
        info "sox not found - please provide a test audio file at $TEST_AUDIO_DIR/test.wav"
        info "You can use any .wav or .mp3 file for testing"
    fi
fi

if [ -f "$TEST_AUDIO_DIR/test.wav" ]; then
    UPLOAD_RESPONSE=$(curl -s -X POST \
        -F "file=@$TEST_AUDIO_DIR/test.wav" \
        -F "title=Test Audio" \
        -F "description=Test upload" \
        "$BASE_URL/files")

    echo "Response: $UPLOAD_RESPONSE"

    if echo "$UPLOAD_RESPONSE" | grep -q '"id"'; then
        pass "File upload successful"
        # Extract file ID for later tests
        FILE_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
        FILENAME=$(echo "$UPLOAD_RESPONSE" | grep -o '"filename":"[^"]*"' | cut -d'"' -f4)
        info "Uploaded file ID: $FILE_ID"
        info "Uploaded filename: $FILENAME"
    else
        fail "File upload failed: $UPLOAD_RESPONSE"
    fi
else
    info "Skipping upload test - no test audio file available"
fi

# ----------------------------------------
# Test 3: List Files
# ----------------------------------------
echo ""
echo "Test 3: List Files (GET /list)"
echo "----------------------------------------"

LIST_RESPONSE=$(curl -s "$BASE_URL/list")
echo "Response: $LIST_RESPONSE"

if echo "$LIST_RESPONSE" | grep -q '"files"'; then
    pass "List endpoint returns files array"
else
    fail "List endpoint failed: $LIST_RESPONSE"
fi

# ----------------------------------------
# Test 4: List Files with Filter
# ----------------------------------------
echo ""
echo "Test 4: List Files with Duration Filter (GET /list?maxduration=300)"
echo "----------------------------------------"

FILTERED_RESPONSE=$(curl -s "$BASE_URL/list?maxduration=300")
echo "Response: $FILTERED_RESPONSE"

if echo "$FILTERED_RESPONSE" | grep -q '"files"'; then
    pass "Filtered list endpoint works"
else
    fail "Filtered list failed: $FILTERED_RESPONSE"
fi

# ----------------------------------------
# Test 5: Download File
# ----------------------------------------
echo ""
echo "Test 5: Download File (GET /download?name=...)"
echo "----------------------------------------"

if [ -n "$FILENAME" ]; then
    DOWNLOAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/download?name=$FILENAME")

    if [ "$DOWNLOAD_STATUS" = "200" ]; then
        pass "Download endpoint returns 200"
    else
        fail "Download endpoint returned $DOWNLOAD_STATUS"
    fi
else
    info "Skipping download test - no file uploaded"
fi

# ----------------------------------------
# Test 6: Get File Info (AI Summary)
# ----------------------------------------
echo ""
echo "Test 6: Get AI Summary (GET /info?name=...)"
echo "----------------------------------------"

if [ -n "$FILENAME" ]; then
    INFO_RESPONSE=$(curl -s "$BASE_URL/info?name=$FILENAME")
    echo "Response: $INFO_RESPONSE"

    if echo "$INFO_RESPONSE" | grep -q '"summary"'; then
        pass "Info endpoint returns summary"
    else
        fail "Info endpoint failed: $INFO_RESPONSE"
    fi
else
    info "Skipping info test - no file uploaded"
fi

# ----------------------------------------
# Test 7: Get File by ID
# ----------------------------------------
echo ""
echo "Test 7: Get File Metadata (GET /files/:id)"
echo "----------------------------------------"

if [ -n "$FILE_ID" ]; then
    METADATA_RESPONSE=$(curl -s "$BASE_URL/files/$FILE_ID")
    echo "Response: $METADATA_RESPONSE"

    if echo "$METADATA_RESPONSE" | grep -q '"id"'; then
        pass "Metadata endpoint works"
    else
        fail "Metadata endpoint failed: $METADATA_RESPONSE"
    fi
else
    info "Skipping metadata test - no file uploaded"
fi

# ----------------------------------------
# Test 8: 404 Handling
# ----------------------------------------
echo ""
echo "Test 8: 404 Handling"
echo "----------------------------------------"

NOT_FOUND=$(curl -s "$BASE_URL/download?name=nonexistent.wav")
if echo "$NOT_FOUND" | grep -q '"error"'; then
    pass "404 returns error response"
else
    fail "404 handling failed: $NOT_FOUND"
fi

# ----------------------------------------
# Test 9: Delete File
# ----------------------------------------
echo ""
echo "Test 9: Delete File (DELETE /files/:id)"
echo "----------------------------------------"

if [ -n "$FILE_ID" ]; then
    DELETE_RESPONSE=$(curl -s -X DELETE "$BASE_URL/files/$FILE_ID")
    echo "Response: $DELETE_RESPONSE"

    if echo "$DELETE_RESPONSE" | grep -q '"message"'; then
        pass "Delete endpoint works"
    else
        fail "Delete endpoint failed: $DELETE_RESPONSE"
    fi
else
    info "Skipping delete test - no file uploaded"
fi

# ----------------------------------------
# Summary
# ----------------------------------------
echo ""
echo "========================================"
echo "  Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi

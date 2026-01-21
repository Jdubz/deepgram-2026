#!/bin/bash
#
# PipeWire Interview Audio Setup
#
# Creates a virtual audio device that combines:
# 1. Your microphone input (your voice)
# 2. System audio output monitor (interviewer's voice from Meet/Zoom/etc)
#
# This allows capturing both sides of a conversation in a single audio stream.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="/tmp/interview-audio-pids"

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up interview audio setup...${NC}"
    if [ -f "$PID_FILE" ]; then
        while read -r pid; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi
    echo -e "${GREEN}Cleanup complete${NC}"
}

# Check for required commands
check_dependencies() {
    local missing=()

    if ! command -v pw-loopback &> /dev/null; then
        missing+=("pw-loopback (pipewire)")
    fi

    if ! command -v pw-cli &> /dev/null; then
        missing+=("pw-cli (pipewire)")
    fi

    if ! command -v pactl &> /dev/null; then
        missing+=("pactl (pipewire-pulse or pulseaudio-utils)")
    fi

    if [ ${#missing[@]} -gt 0 ]; then
        echo -e "${RED}Missing required commands:${NC}"
        for cmd in "${missing[@]}"; do
            echo "  - $cmd"
        done
        echo ""
        echo "Install with: sudo apt install pipewire pipewire-pulse pipewire-audio-client-libraries"
        exit 1
    fi
}

# Get default audio input device (microphone)
get_default_source() {
    pactl get-default-source 2>/dev/null || echo ""
}

# Get default audio output device
get_default_sink() {
    pactl get-default-sink 2>/dev/null || echo ""
}

# List available audio sources
list_sources() {
    echo -e "${BLUE}Available audio input devices:${NC}"
    pactl list sources short | while read -r line; do
        name=$(echo "$line" | awk '{print $2}')
        # Skip monitor sources for mic selection
        if [[ ! "$name" =~ \.monitor$ ]]; then
            echo "  - $name"
        fi
    done
}

# List available audio sinks (for monitor)
list_sinks() {
    echo -e "${BLUE}Available audio output devices (for capturing system audio):${NC}"
    pactl list sinks short | while read -r line; do
        name=$(echo "$line" | awk '{print $2}')
        echo "  - $name (monitor: ${name}.monitor)"
    done
}

# Main setup function
setup_interview_audio() {
    local mic_source="$1"
    local output_sink="$2"

    # Get defaults if not specified
    if [ -z "$mic_source" ]; then
        mic_source=$(get_default_source)
        if [ -z "$mic_source" ]; then
            echo -e "${RED}Could not detect default microphone${NC}"
            list_sources
            echo ""
            echo "Please specify: $0 <mic-source> [output-sink]"
            exit 1
        fi
        echo -e "${BLUE}Using default microphone:${NC} $mic_source"
    fi

    if [ -z "$output_sink" ]; then
        output_sink=$(get_default_sink)
        if [ -z "$output_sink" ]; then
            echo -e "${RED}Could not detect default audio output${NC}"
            list_sinks
            echo ""
            echo "Please specify: $0 <mic-source> <output-sink>"
            exit 1
        fi
        echo -e "${BLUE}Using default audio output:${NC} $output_sink"
    fi

    local monitor_source="${output_sink}.monitor"

    # Clean up any existing setup
    cleanup 2>/dev/null || true

    echo ""
    echo -e "${GREEN}Setting up interview audio capture...${NC}"
    echo ""

    # Create the virtual combined source
    # This creates a sink (for mixing into) and a source (for capturing from)
    echo -e "${BLUE}[1/3]${NC} Creating virtual audio device..."
    pw-loopback \
        --capture-props='media.class=Audio/Sink node.name=interview_mix_sink node.description="Interview Mix (Sink)"' \
        --playback-props='media.class=Audio/Source node.name=interview_combined node.description="Interview Combined Audio"' \
        &
    echo $! >> "$PID_FILE"
    sleep 0.5

    # Route microphone to the virtual sink
    echo -e "${BLUE}[2/3]${NC} Routing microphone ($mic_source)..."
    pw-loopback \
        --capture-props="node.target=$mic_source" \
        --playback-props='node.target=interview_mix_sink' \
        &
    echo $! >> "$PID_FILE"
    sleep 0.5

    # Route system audio monitor to the virtual sink
    echo -e "${BLUE}[3/3]${NC} Routing system audio monitor ($monitor_source)..."
    pw-loopback \
        --capture-props="node.target=$monitor_source" \
        --playback-props='node.target=interview_mix_sink' \
        &
    echo $! >> "$PID_FILE"
    sleep 0.5

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}Interview audio setup complete!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "Virtual device created: ${YELLOW}Interview Combined Audio${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Open Chrome and go to your transcription app"
    echo "2. When prompted for microphone, select 'Interview Combined Audio'"
    echo "3. Start your Google Meet/Zoom call normally"
    echo "4. Both your voice AND the other person's voice will be captured"
    echo ""
    echo -e "${YELLOW}To stop:${NC} Run '$0 stop' or press Ctrl+C"
    echo ""

    # Keep running and wait for interrupt
    echo -e "${BLUE}Press Ctrl+C to stop and cleanup...${NC}"
    trap cleanup EXIT INT TERM

    # Wait forever (until interrupted)
    while true; do
        sleep 1
        # Check if our processes are still running
        if [ -f "$PID_FILE" ]; then
            all_dead=true
            while read -r pid; do
                if kill -0 "$pid" 2>/dev/null; then
                    all_dead=false
                    break
                fi
            done < "$PID_FILE"
            if $all_dead; then
                echo -e "${RED}Audio routing processes died unexpectedly${NC}"
                exit 1
            fi
        fi
    done
}

# Show usage
usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  start [mic] [sink]  Start interview audio capture (default command)"
    echo "  stop                Stop interview audio capture"
    echo "  list                List available audio devices"
    echo "  help                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0                  # Start with auto-detected devices"
    echo "  $0 list             # Show available devices"
    echo "  $0 start alsa_input.pci-0000_00_1f.3.analog-stereo"
    echo "  $0 stop             # Stop and cleanup"
}

# Main entry point
case "${1:-start}" in
    start)
        check_dependencies
        setup_interview_audio "$2" "$3"
        ;;
    stop)
        cleanup
        ;;
    list)
        check_dependencies
        echo ""
        list_sources
        echo ""
        list_sinks
        echo ""
        echo -e "${BLUE}Default microphone:${NC} $(get_default_source)"
        echo -e "${BLUE}Default output:${NC} $(get_default_sink)"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        # Assume it's a device name for backwards compatibility
        check_dependencies
        setup_interview_audio "$1" "$2"
        ;;
esac

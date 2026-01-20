# PipeWire Audio Capture Reference

This document provides machine-specific details for capturing system audio on this workstation.

## System Audio Configuration

### Hardware Detected

| Card | Type | Device |
|------|------|--------|
| 0 - HDA Intel PCH | Built-in audio | Headphone jack, line out |
| 1 - HDA NVidia | HDMI audio | GPU audio output |
| 2 - USB 0x46d:0x821 | USB webcam | HD Webcam C910 mic |
| 3 - Pebbles | USB speakers | JBL Pebbles |

### Current Default Devices

- **Output Sink**: `alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo` (JBL Pebbles)
- **Input Source**: `alsa_input.usb-046d_HD_Webcam_C910_DD5AB040-02.analog-stereo` (Webcam mic)

### Monitor Ports (for capturing playback audio)

Every PipeWire sink exposes a monitor port that captures what's being played:

```
JBL Pebbles Monitor:
  alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo:monitor_FL
  alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo:monitor_FR

Built-in Audio Monitor:
  alsa_output.pci-0000_00_1f.3.analog-stereo:monitor_FL
  alsa_output.pci-0000_00_1f.3.analog-stereo:monitor_FR
```

---

## Capture Methods

### Method 1: Browser getDisplayMedia (Recommended)

The simplest approach that requires no system configuration:

```javascript
async function captureSystemAudio() {
  // Request screen share with audio
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: 1, height: 1 }, // Minimal video
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }
  });

  // User must check "Share system audio" in Chrome dialog
  const audioTrack = stream.getAudioTracks()[0];

  if (!audioTrack) {
    throw new Error('No audio track - user must select "Share system audio"');
  }

  return new MediaStream([audioTrack]);
}
```

**User flow**:
1. Click "Start Streaming" button
2. Browser shows screen share dialog
3. Select any window/screen
4. Check "Share system audio" checkbox (bottom of dialog)
5. Click "Share"

### Method 2: PipeWire Virtual Device

Create a virtual microphone from the speaker monitor:

```bash
# Terminal 1: Create loopback from speaker monitor to virtual mic
pw-loopback \
  --capture-props='media.class=Audio/Sink node.name=interview-capture' \
  --playback-props='media.class=Audio/Source/Virtual node.name=interview-mic' \
  --capture='alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo'
```

Then in the browser, select "interview-mic" as microphone input.

### Method 3: Direct Monitor Recording (Testing)

For testing the monitor source works:

```bash
# Record 10 seconds from speaker monitor
pw-record \
  --target='alsa_output.usb-Harman_Multimedia_JBL_Pebbles_1.0.0-00.analog-stereo' \
  --format=s16 \
  --rate=16000 \
  --channels=1 \
  test-capture.wav &

# Play something, wait 10 seconds, then:
kill %1

# Verify recording
aplay test-capture.wav
```

---

## Useful PipeWire Commands

### List All Sinks (Outputs)
```bash
pw-cli ls Node | grep -A2 "Audio/Sink"
# Or with pactl (PulseAudio compat):
pactl list sinks short
```

### List All Sources (Inputs + Monitors)
```bash
pactl list sources short
```

### Check Default Devices
```bash
pactl get-default-sink
pactl get-default-source
```

### List Active Streams
```bash
pw-cli ls Client
```

### Monitor Audio Levels
```bash
# GUI tool
pavucontrol

# CLI level meter
pactl subscribe  # Watch for audio events
```

---

## Audio Format Requirements for Deepgram

Deepgram streaming requires:

| Parameter | Value |
|-----------|-------|
| Encoding | Linear PCM (16-bit signed) |
| Sample Rate | 16000 Hz (16kHz) |
| Channels | 1 (mono) or 2 (stereo) |
| Bit Depth | 16-bit |

### Browser AudioContext Configuration

```javascript
const audioContext = new AudioContext({
  sampleRate: 16000,  // Match Deepgram requirement
});
```

### PCM Conversion in AudioWorklet

```javascript
// Convert Float32 (-1 to 1) to Int16 PCM
function float32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}
```

---

## Troubleshooting

### No Audio in Capture

1. **Check PipeWire is running**:
   ```bash
   systemctl --user status pipewire pipewire-pulse wireplumber
   ```

2. **Verify sink exists**:
   ```bash
   pactl list sinks short
   ```

3. **Check something is playing**:
   ```bash
   pw-top  # Shows active audio streams
   ```

### getDisplayMedia Returns No Audio Track

- Ensure using Chrome/Edge (Firefox support is limited)
- User must explicitly check "Share system audio" checkbox
- Some Wayland compositors may not support audio capture

### Virtual Device Not Appearing

```bash
# Restart PipeWire
systemctl --user restart pipewire pipewire-pulse wireplumber

# Check for errors
journalctl --user -u pipewire -f
```

### Wrong Sample Rate

The AudioContext may need resampling:

```javascript
// If source is 48kHz but we need 16kHz
const source = audioContext.createMediaStreamSource(stream);
const resampler = new AudioWorkletNode(audioContext, 'resampler', {
  processorOptions: { targetRate: 16000 }
});
source.connect(resampler);
```

---

## Security Considerations

1. **User consent**: Both browser APIs require explicit user permission
2. **Visual indicator**: Chrome shows recording indicator in tab
3. **No background capture**: Audio stops when tab loses focus (getDisplayMedia)
4. **Local processing**: All audio processing happens locally before sending to Deepgram

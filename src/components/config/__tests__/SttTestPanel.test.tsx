/**
 * SttTestPanel — STT/VAD recorder test block (persona-modules 2-2, reworked).
 *
 * Verifies:
 *  - the pure parseWavAudioParams helper (WAV header → channels/bit_depth/sample_rate)
 *  - the pure computeVadBars helper (clamping / empty / duration bounds)
 *  - offline state renders "Connect to Harmony Link to test" and never records
 *  - the record → stop → transcribe state machine drives AudioRecorder + the
 *    ModuleTestSessionService (both mocked): resolves the active persona, sends
 *    STT_INPUT_AUDIO with the pinned event contract, renders the transcript
 *  - the session-service error message surfaces in the error state
 */

import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { SttTestPanel, computeVadBars, parseWavAudioParams } from '../SttTestPanel';

afterEach(cleanup);
beforeEach(cleanup);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../../utils/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../../utils/haptics', () => ({ hapticLightPress: jest.fn() }));

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => React.createElement(Text, { ...props }, name);
});

jest.mock('../../../contexts/ThemeContext', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: { primary: '#7c3aed', secondary: '#a78bfa' },
        background: { base: '#0f0f1a', surface: '#151d30', elevated: '#1e1e2e' },
        border: { default: '#333333' },
        text: { primary: '#ffffff', secondary: '#cccccc', muted: '#aaaaaa', disabled: '#555555' },
        status: { success: '#22c55e', warning: '#f59e0b', error: '#ef4444' },
      },
    },
  }),
}));

let mockIsConnected = true;
jest.mock('../../../contexts/SyncConnectionContext', () => ({
  useSyncConnection: () => ({ isConnected: mockIsConnected, connectionStatus: {} }),
}));

jest.mock('../../themed/ThemedText', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, ThemedText: ({ children, style, ...props }: any) =>
    React.createElement(Text, { style, ...props }, children) };
});
jest.mock('../../themed/ThemedButton', () => {
  const React = require('react');
  const { View, Text, TouchableOpacity } = require('react-native');
  return { __esModule: true, ThemedButton: ({ label, onPress, testID, disabled, ...props }: any) =>
    React.createElement(TouchableOpacity, { testID, onPress: () => onPress(), disabled, accessibilityRole: 'button', ...props },
      React.createElement(Text, null, label)) };
});

jest.mock('../../../services/AudioRecorder', () => ({
  __esModule: true,
  default: {
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  },
}));

jest.mock('../../../services/ChatPreferencesService', () => ({
  __esModule: true,
  default: { getGlobalImpersonatedEntity: jest.fn().mockResolvedValue('claire') },
}));

jest.mock('../../../database/repositories/userEntities', () => ({
  resolvePersonaId: jest.fn().mockResolvedValue('claire'),
}));

let mockRunTest: jest.Mock;
let mockCapturedSendEvents: any[];
jest.mock('../../../services/voiceInput/moduleTestSessionService', () => {
  const actual = jest.requireActual('../../../services/voiceInput/moduleTestSessionService');
  class ModuleTestSessionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ModuleTestSessionError';
    }
  }
  return {
    __esModule: true,
    runTest: jest.fn(),
    ModuleTestSessionError: actual.ModuleTestSessionError ?? ModuleTestSessionError,
  };
});

import AudioRecorder from '../../../services/AudioRecorder';
import ChatPreferencesService from '../../../services/ChatPreferencesService';
import { resolvePersonaId } from '../../../database/repositories/userEntities';
import { runTest, ModuleTestSessionError } from '../../../services/voiceInput/moduleTestSessionService';

const mockStartRecording = (AudioRecorder as any).startRecording as jest.Mock;
const mockStopRecording = (AudioRecorder as any).stopRecording as jest.Mock;
mockRunTest = runTest as jest.Mock;

async function flush() {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// ── WAV fixture: minimal 44-byte mono / 16-bit / 16 kHz RIFF header ──────────
function makeWavBase64(header: Partial<{ channels: number; sampleRate: number; bitDepth: number }> = {}): string {
  const channels = header.channels ?? 1;
  const sampleRate = header.sampleRate ?? 16000;
  const bitDepth = header.bitDepth ?? 16;
  const bytesPerSample = bitDepth / 8;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(0, 40);
  return buffer.toString('base64');
}

const wavBase64 = makeWavBase64();

describe('parseWavAudioParams — pure WAV header helper', () => {
  it('reads channels / sample_rate / bit_depth from a RIFF/WAVE header', () => {
    expect(parseWavAudioParams(wavBase64)).toEqual({ channels: 1, sampleRate: 16000, bitDepth: 16 });
    const stereo48k = makeWavBase64({ channels: 2, sampleRate: 48000, bitDepth: 24 });
    expect(parseWavAudioParams(stereo48k)).toEqual({ channels: 2, sampleRate: 48000, bitDepth: 24 });
  });

  it('returns null for a short or non-RIFF payload', () => {
    expect(parseWavAudioParams('QUJDRA==')).toBeNull(); // "ABCD", 4 bytes
    expect(parseWavAudioParams(Buffer.from('not a wav file at all').toString('base64'))).toBeNull();
  });
});

describe('computeVadBars — pure VAD layout helper', () => {
  it('maps segments to percentage left/width against the duration', () => {
    expect(
      computeVadBars(
        [
          { start_ms: 0, end_ms: 1000 },
          { start_ms: 1000, end_ms: 2000 },
        ],
        2000,
      ),
    ).toEqual([
      { left: 0, width: 50 },
      { left: 50, width: 50 },
    ]);
  });

  it('clamps segments outside [0, duration] and returns a non-negative width', () => {
    const bars = computeVadBars([{ start_ms: -100, end_ms: 5000 }], 2000);
    expect(bars).toEqual([{ left: 0, width: 100 }]);
  });

  it('returns [] for empty segments or a zero duration', () => {
    expect(computeVadBars([], 2000)).toEqual([]);
    expect(computeVadBars([{ start_ms: 0, end_ms: 1000 }], 0)).toEqual([]);
  });
});

describe('SttTestPanel — state machine + offline handling', () => {
  beforeEach(() => {
    mockIsConnected = true;
    jest.clearAllMocks();
    mockCapturedSendEvents = [];
    mockStartRecording.mockResolvedValue(undefined);
    mockStopRecording.mockResolvedValue({ data: wavBase64, mimeType: 'audio/wav', duration: 1.5 });
    mockRunTest.mockImplementation(async (_entityId: string, fn: any) => {
      mockCapturedSendEvents = [];
      return fn({
        sendEvent: async (ev: any) => { mockCapturedSendEvents.push(ev); },
        awaitEvent: async (_eventType: string, opts: any) => {
          const stt = mockCapturedSendEvents.find((e: any) => e.event_type === 'STT_INPUT_AUDIO');
          const messageId = stt?.payload?.message_id;
          return { event_type: 'STT_OUTPUT_TEXT', status: 'NEW', payload: { message_id: messageId, content: 'hello world' } };
        },
      });
    });
  });

  it('renders the offline state and never records when disconnected', async () => {
    mockIsConnected = false;
    const utils = await render(<SttTestPanel />);
    await flush();

    expect(utils.getByText('offlineTitle')).toBeTruthy();
    // No record button is offered offline.
    expect(utils.queryByTestId('stt-record-button')).toBeNull();
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it('resolves the active persona, INITs a debug session, sends STT_INPUT_AUDIO, renders the transcript', async () => {
    const utils = await render(<SttTestPanel />);
    await flush();

    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();
    expect(mockStartRecording).toHaveBeenCalledTimes(1);

    // Record → stop (the same button now says Stop).
    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();

    expect(mockStopRecording).toHaveBeenCalledTimes(1);

    // The session service is called with the resolved persona entity id.
    expect(ChatPreferencesService.getGlobalImpersonatedEntity).toHaveBeenCalledTimes(1);
    expect(resolvePersonaId).toHaveBeenCalledWith('claire');
    expect(mockRunTest).toHaveBeenCalledWith('claire', expect.any(Function));

    // The STT_INPUT_AUDIO event matches the pinned eventserver contract.
    const sttEvent = mockCapturedSendEvents.find((e: any) => e.event_type === 'STT_INPUT_AUDIO');
    expect(sttEvent).toBeTruthy();
    expect(sttEvent.payload.result_mode).toBe('return');
    expect(sttEvent.payload.audio_data).toEqual({
      audio_bytes: wavBase64,
      channels: 1,
      bit_depth: 16,
      sample_rate: 16000,
    });

    expect(utils.getByTestId('stt-transcript')).toBeTruthy();
    expect(utils.getByText('hello world')).toBeTruthy();
  });

  it('renders the "no VAD segments" note (one-shot mode has no live VAD segments)', async () => {
    const utils = await render(<SttTestPanel />);
    await flush();

    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();
    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();

    expect(utils.getByText('noVadSegments')).toBeTruthy();
    expect(utils.queryByTestId('stt-vad-timeline')).toBeNull();
  });

  it('surfaces the session-service error message', async () => {
    mockRunTest.mockRejectedValue(new ModuleTestSessionError('undecodable audio'));
    const utils = await render(<SttTestPanel />);
    await flush();

    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();
    await fireEvent.press(utils.getByTestId('stt-record-button'));
    await flush();

    expect(utils.getByTestId('stt-error')).toBeTruthy();
    expect(utils.getByText(/undecodable audio/)).toBeTruthy();
  });
});

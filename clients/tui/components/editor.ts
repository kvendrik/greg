import {
  Box,
  Editor,
  Text,
  SelectList,
  type Component,
  type TUI,
  CombinedAutocompleteProvider,
  Spacer,
} from '@mariozechner/pi-tui';
import { get as getConfig } from '../../../config';
import { listCommands } from '../../../agent/commands';
import {
  listAvFoundationDevices,
  type AvFoundationDevice,
  realtimeTranscribeFromMic,
} from '../../../voice/av';
import pc from 'picocolors';

const config = await getConfig();
const globalCommands = listCommands(config).map((command) =>
  command.replace('/', '')
);

interface Tools {
  render: (width: number) => string[];
  onSubmit: (callback: (text: string) => void) => void;
  setDisabled: (disabled: boolean) => void;
  handleInput: (input: string) => void;
  setCommands: (commands: Record<string, string>) => void;
}

const selectListTheme = {
  selectedPrefix: (text: string) => pc.bold(text),
  selectedText: (text: string) => pc.bold(pc.blue(text)),
  description: (text: string) => pc.dim(text),
  scrollInfo: (text: string) => pc.gray(text),
  noMatch: (text: string) => pc.yellow(text),
};

export function editor(tui: TUI, { voiceMode }: { voiceMode: boolean }): Tools {
  return voiceMode ? createVoiceEditor(tui) : createTextEditor(tui);
}

function createTextEditor(tui: TUI): Tools {
  const editor = new Editor(
    tui,
    {
      borderColor: (text) => pc.dim(text),
      selectList: selectListTheme,
    },
    {
      paddingX: 1,
    }
  );

  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(
      globalCommands.map((command) => ({
        name: command,
        description: '',
      })),
      process.env.PWD
    )
  );

  return {
    render: (width) => {
      return editor.render(width);
    },
    onSubmit(callback) {
      editor.onSubmit = (text) => {
        editor.addToHistory(text);
        callback(text);
        tui.requestRender();
      };
    },
    handleInput(input) {
      editor.handleInput(input);
    },
    setDisabled(disabled: boolean) {
      editor.disableSubmit = disabled;
    },
    setCommands(cmds: Record<string, string>) {
      const prov = new CombinedAutocompleteProvider(
        Object.entries(cmds).map(([name, description]) => ({
          name,
          description,
        })),
        process.cwd()
      );
      editor.setAutocompleteProvider(prov);
      editor.setText('');
      editor.handleInput('/');
    },
  };
}

type VoiceEditorState =
  | {
      kind: 'idle';
      message: string;
    }
  | {
      kind: 'select-device';
    }
  | {
      kind: 'recording';
      deviceName: string;
      partialTranscript: string;
    }
  | {
      kind: 'submitting';
      transcript: string;
    }
  | {
      kind: 'error';
      message: string;
    };

function createVoiceEditor(tui: TUI): Tools {
  let disabled = false;
  let isRecording = false;
  let deviceSelectList: SelectList | undefined = undefined;
  let selectedDeviceIndex: number | undefined = undefined;
  let selectedDeviceName: string | undefined = undefined;
  let submitMessage: (text: string) => void = () => {};
  let state: VoiceEditorState = {
    kind: 'idle',
    message: 'Voice mode enabled. Waiting to start listening...',
  };

  const setState = (nextState: VoiceEditorState): void => {
    state = nextState;
    tui.requestRender();
  };

  const showDeviceSelection = (devices: AvFoundationDevice[]): void => {
    const nextDeviceSelectList = new SelectList(
      devices.map((device) => ({
        value: String(device.index),
        label: device.name,
        description: `Device ${device.index}`,
      })),
      8,
      selectListTheme
    );

    nextDeviceSelectList.onSelect = (item) => {
      const selectedDevice = devices.find(
        (device) => String(device.index) === item.value
      );
      if (!selectedDevice) {
        return;
      }

      deviceSelectList = undefined;
      selectedDeviceIndex = selectedDevice.index;
      selectedDeviceName = selectedDevice.name;
      startListening();
    };

    nextDeviceSelectList.onCancel = () => {
      deviceSelectList = undefined;
      setState({
        kind: 'idle',
        message: 'Voice mode enabled. Press Enter to start listening.',
      });
    };

    deviceSelectList = nextDeviceSelectList;
    setState({
      kind: 'select-device',
    });
  };

  const startListening = (): void => {
    void startListeningIfPossible().catch((error: unknown) => {
      isRecording = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setState({
        kind: 'error',
        message: `Voice input failed: ${errorMessage}`,
      });
    });
  };

  const renderVoiceBox = (width: number, children: Component[]): string[] => {
    const box = new Box(1, 1, (text) => pc.bgBlack(text));
    children.forEach((child) => {
      box.addChild(child);
    });
    return ['', ...box.render(width), ''];
  };

  const startListeningIfPossible = async (): Promise<void> => {
    if (disabled || isRecording) {
      return;
    }

    if (process.platform !== 'darwin') {
      setState({
        kind: 'error',
        message: 'Voice input is only supported on macOS.',
      });
      return;
    }

    const apiKey = config.voice?.elevenlabs?.key;
    if (!apiKey) {
      setState({
        kind: 'error',
        message:
          'Voice not configured. Set voice.elevenlabs.key in your config.',
      });
      return;
    }

    if (selectedDeviceIndex === undefined || selectedDeviceName === undefined) {
      const devices = await listAvFoundationDevices();
      if (!devices?.length) {
        setState({
          kind: 'error',
          message:
            'No microphone found. Is ffmpeg installed and available on PATH?',
        });
        return;
      }

      if (devices.length === 1) {
        selectedDeviceIndex = devices[0].index;
        selectedDeviceName = devices[0].name;
      } else {
        showDeviceSelection(devices);
        return;
      }
    }

    const microphoneIndex = selectedDeviceIndex;
    const microphoneName = selectedDeviceName;

    isRecording = true;
    setState({
      kind: 'recording',
      deviceName: microphoneName,
      partialTranscript: '',
    });

    try {
      const transcript = await realtimeTranscribeFromMic(microphoneIndex, {
        apiKey,
        onPartial: (partialTranscript) => {
          setState({
            kind: 'recording',
            deviceName: microphoneName,
            partialTranscript,
          });
        },
      });

      isRecording = false;

      if (!transcript?.trim()) {
        setState({
          kind: 'idle',
          message: 'No speech detected. Press Enter to try again.',
        });
        return;
      }

      const trimmedTranscript = transcript.trim();

      setState({
        kind: 'submitting',
        transcript: trimmedTranscript,
      });

      submitMessage(trimmedTranscript);
    } catch (error: unknown) {
      isRecording = false;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setState({
        kind: 'error',
        message: `Voice input failed: ${errorMessage}`,
      });
    }
  };

  return {
    render: (width) => {
      if (state.kind === 'select-device') {
        return renderVoiceBox(width, [
          new Text(
            pc.dim('Select a microphone with arrow keys, then press Enter.'),
            0,
            0
          ),
          new Spacer(1),
          ...(deviceSelectList ? [deviceSelectList] : []),
        ]);
      }

      if (state.kind === 'recording') {
        const transcriptPreview =
          state.partialTranscript.trim() === ''
            ? pc.dim('🎙️  Listening... press Enter to stop.')
            : pc.dim(state.partialTranscript);
        return renderVoiceBox(width, [new Text(transcriptPreview, 0, 0)]);
      }

      if (state.kind === 'submitting') {
        return renderVoiceBox(width, [
          new Text(pc.dim('Sending transcript...'), 0, 0),
          new Text(pc.dim(state.transcript), 0, 0),
        ]);
      }

      const message = disabled
        ? pc.blue('Waiting for Greg...')
        : state.kind === 'error'
          ? pc.red(state.message)
          : state.message;

      return renderVoiceBox(width, [new Text(message, 0, 0)]);
    },
    onSubmit(callback) {
      submitMessage = callback;
    },
    handleInput(input) {
      if (state.kind === 'select-device') {
        deviceSelectList?.handleInput(input);
        return;
      }

      if (disabled) {
        return;
      }

      if (input === '\r' || input === '\n') {
        startListening();
      }
    },
    setDisabled(nextDisabled: boolean) {
      disabled = nextDisabled;
      tui.requestRender();
      if (!disabled) {
        startListening();
      }
    },
    setCommands() {},
  };
}

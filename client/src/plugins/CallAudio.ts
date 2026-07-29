import { registerPlugin, WebPlugin } from '@capacitor/core';

export type CallAudioRoute = 'speaker' | 'earpiece';

export interface CallAudioPlugin {
  startCallAudio(options?: { speaker?: boolean }): Promise<{ route: CallAudioRoute }>;
  setSpeaker(options: { enabled: boolean }): Promise<{ route: CallAudioRoute }>;
  stopCallAudio(): Promise<void>;
}

class CallAudioWeb extends WebPlugin implements CallAudioPlugin {
  async startCallAudio(options?: { speaker?: boolean }): Promise<{ route: CallAudioRoute }> {
    return { route: options?.speaker === false ? 'earpiece' : 'speaker' };
  }

  async setSpeaker(options: { enabled: boolean }): Promise<{ route: CallAudioRoute }> {
    return { route: options.enabled ? 'speaker' : 'earpiece' };
  }

  async stopCallAudio(): Promise<void> {}
}

export const CallAudio = registerPlugin<CallAudioPlugin>('CallAudio', {
  web: () => new CallAudioWeb(),
});

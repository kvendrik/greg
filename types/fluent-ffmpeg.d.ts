declare module 'fluent-ffmpeg' {
  interface FfmpegCommand {
    input(path: string): FfmpegCommand;
    toFormat(format: string): FfmpegCommand;
    audioFrequency(freq: number): FfmpegCommand;
    audioChannels(channels: number): FfmpegCommand;
    outputOptions(options: string | string[]): FfmpegCommand;
    output(path: string): FfmpegCommand;
    on(
      event: string,
      callback: (err?: Error | null, files?: string[]) => void
    ): FfmpegCommand;
    save(path: string): FfmpegCommand;
    run(): FfmpegCommand;
  }
  function ffmpeg(path?: string): FfmpegCommand;
  export = ffmpeg;
}

export class StreamParser {
  private buffer = "";

  constructor(
    private onMessage: (msg: unknown) => void,
    private onPassthrough: (data: Buffer) => void
  ) {}

  feed(chunk: Buffer): void {
    this.buffer += chunk.toString("utf-8");
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        this.onPassthrough(Buffer.from("\n"));
        continue;
      }
      try {
        const parsed = JSON.parse(line);
        this.onMessage(parsed);
      } catch {
        this.onPassthrough(Buffer.from(line + "\n"));
      }
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onPassthrough(Buffer.from(this.buffer));
      this.buffer = "";
    }
  }
}

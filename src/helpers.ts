import { Transform } from 'stream';

export function pkt_read_line(buffer: Buffer, offset: number = 0): Buffer {
  const length = pkt_length(buffer, offset);

  return buffer.slice(offset, length);
}

export function pkt_write_line (input: string) {
  const size = (4 + input.length).toString(16);
  return Buffer.from('0'.repeat(4 - size.length) + size + input);
}

export function pkt_length(buffer: Buffer, offset: number = 0) {
  try {
    return Number.parseInt(buffer.slice(offset, 4).toString('utf8'), 16);
  } catch (err) {
    return -1;
  }
}

export function pkt_seperator(): Transform {
  let underflow: Buffer;
  return new Transform({
    async transform(buffer: Buffer, encoding, next) {
      // Start where previous stopped
      if (underflow) {
        buffer = Buffer.concat([underflow, buffer]);
        underflow = undefined;
      }

      let length = 0;
      let offset = -1;
      do {
        offset = offset + length + 1;
        length = pkt_length(buffer, offset);

        // Break if no length found on first iteration
        if (offset === 0 && length === -1) {
          break;
        }

        // Special signal (0000) is 4 char long
        if (length === 0) {
          length = 4;
        }

        // We got data underflow (assume one more buffer)
        if (offset + length > buffer.length) {
          underflow = buffer.slice(offset);
          break;
        }

        if (length >= 4) {
          this.push(buffer.slice(offset, length));
        } else {
          this.push(buffer.slice(offset));
        }

        // Wait till next tick <- create async handling
        await next_tick();
      } while (length !== -1);

      // We got a data overflow, so append extra data
      if (!underflow && offset < buffer.length) {
        this.push(buffer.slice(offset));
      }

      next();
    },
  });
}

function next_tick() {
  return new Promise<void>((resolve) => process.nextTick(resolve));
}

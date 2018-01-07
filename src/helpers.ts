
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

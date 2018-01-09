// tslint:disable no-implicit-dependencies

// from packages
import { ok } from 'assert';
import { createReadStream, readFileSync } from 'fs';
import * as intoStream from 'into-stream';
import { Readable, Writable } from 'stream';
import * as through from 'through';
// from libraries
import { GitSmartProxy, ServiceType } from '../src';
import { ReceiveStream, UploadStream } from '../src/source';

interface CreateSourceOptions {
  input?: Writable;
  output?: Readable;
  messages?: Iterable<string> | IterableIterator<string>;
  has_input: boolean;
  Stream: typeof UploadStream | typeof ReceiveStream;
}

function create_source({input, output, messages, has_input, Stream}: CreateSourceOptions) {
  if (!(output && output.readable)) {
    output = through();
  }

  if (!(input && input.writable)) {
    input = through();
  }

  // @ts-ignore
  const source = new Stream({
    command: (c, r, a) => ({output, input}),
    has_info: !has_input,
  });

  // Append verbose messages
  if (messages) {
    source.verbose(messages);
  }

  return source;
}

describe('UploadStream', () => {
  it('should just pipe output when no input, but don\'t inspect it.', async(done) => {
    let buffer2: Buffer;
    const buffers: Buffer[] = [];

    const buffer1 = Buffer.from('SUPER SECRET NUCLEAR LAUNCH CODE: "1234"');
    const output = intoStream(buffer1);

    const source = create_source({
      Stream: UploadStream,
      has_input: false,
      output,
    });

    await source.wait();
    await source.process('');

    source.pipe(through(
      function write(buffer) {
        buffers.push(buffer);
        this.queue(buffer);
      },
      function end() {
        buffer2 = Buffer.concat(buffers);
        buffers.length = 0;

        expect(buffer2.equals(buffer1)).toBe(true);

        done();
      },
    ));
  });

  it('should understand requests to upload-pack service', async(done) => {
    // Random
    const input = intoStream([
      '0032want 0a53e9ddeaddad63ad106860237bbf53411d11a7\n',
      '0032want d049f6c27a2244e12041955e262a404c7faba355\n',
      '0032have 441b40d833fdfa93eb2908e52742248faf0ee993\n',
      '0032have 2cb58b79488a98d2721cea644875a8dd0026b115\n',
      '0000',
    ]) as Readable;

    const source = create_source({
      Stream: UploadStream,
      has_input: true,
    });

    input.pipe(source);

    ok(source, 'should now have a source');

    await source.wait();

    // Should have successfully parsed all want,
    expect(source.metadata.want).toMatchObject([
      '0a53e9ddeaddad63ad106860237bbf53411d11a7',
      'd049f6c27a2244e12041955e262a404c7faba355',
    ]);

    // and have.
    expect(source.metadata.have).toMatchObject([
      '441b40d833fdfa93eb2908e52742248faf0ee993',
      '2cb58b79488a98d2721cea644875a8dd0026b115',
    ]);

    done();
  });
});

describe('ReceiveStream', () => {
  it('should just pipe output when no input, but don\'t inspect it.', async(done) => {
    let buffer2: Buffer;
    const buffers: Buffer[] = [];

    const buffer1 = Buffer.from('SUPER SECRET NUCLEAR LAUNCH CODE: "1234"');
    const output = intoStream(buffer1);

    const source = create_source({
      Stream: ReceiveStream,
      has_input: false,
      output,
    });

    await source.wait();
    await source.process('');

    source.pipe(through(
      function write(buffer) {
        buffers.push(buffer);
        this.queue(buffer);
      },
      function end() {
        buffer2 = Buffer.concat(buffers);
        buffers.length = 0;

        expect(buffer2.equals(buffer1)).toBe(true);

        done();
      },
    ));
  });

  it('should understand requests to receive-pack service', async(done) => {
    const results = [
      // tslint:disable-next-line
      '00760a53e9ddeaddad63ad106860237bbf53411d11a7 441b40d833fdfa93eb2908e52742248faf0ee993 refs/heads/maint\0 report-status\n',
      '0000',
      '\nPACK....',
    ];

    const input = intoStream(results) as Readable;

    const output = new Writable({
      write(this: Writable, buffer: Buffer, encoding, next) {
        expect(buffer.toString('utf8')).toBe(results.shift());
      },
      final() {
        expect(source.metadata.ref).toBe('refs/heads/maint');
        expect(source.metadata.refname).toBe('maint');
        expect(source.metadata.reftype).toBe('head');
        expect(source.metadata.old_commit).toBe('0a53e9ddeaddad63ad106860237bbf53411d11a7');
        expect(source.metadata.new_commit).toBe('441b40d833fdfa93eb2908e52742248faf0ee993');
        expect(source.metadata.capabilities).toMatchObject(['report-status']);

        done();
      },
    });

    const source = create_source({
      Stream: ReceiveStream,
      has_input: true,
      input: output,
    });

    input.pipe(source);

    ok(source, 'should now have a source');

    await source.wait();

    await source.process('');
  });
});

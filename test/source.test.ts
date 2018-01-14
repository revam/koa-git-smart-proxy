// tslint:disable no-implicit-dependencies

// from packages
import { ok } from 'assert';
import * as intoStream from 'into-stream';
import { Readable, Writable } from 'stream';
import * as through from 'through';
// from libraries
import { GitSmartProxy, ServiceType } from '../src';
import { GitBasePack, Headers, ReceivePack, UploadPack } from '../src/source';

interface CreateSourceOptions {
  input?: Writable;
  output?: Readable;
  messages?: Iterable<string> | IterableIterator<string>;
  has_input: boolean;
  Pack: typeof GitBasePack | typeof UploadPack | typeof ReceivePack;
}

function create_source({input, output, messages, has_input, Pack}: CreateSourceOptions) {
  if (!(output && output.readable)) {
    output = through();
  }

  if (!(input && input.writable)) {
    input = through();
  }

  // @ts-ignore
  const source = new Pack({
    command: (c, r, a) => ({stdout: output, stdin: input}),
    has_input,
  });

  // Append verbose messages
  if (messages) {
    source.verbose(messages);
  }

  return source;
}

describe('GitStream', () => {
  it('should advertise when no input', async(done) => {
    const test_buffer = Buffer.from('test buffer');

    // Test all services
    for (const service of Reflect.ownKeys(Headers)) {
      const results = [
        Headers[service],
        test_buffer,
      ];
      const output = intoStream(test_buffer);

      const source = create_source({
        Pack: GitBasePack,
        has_input: false,
        output,
      });
      source.service = service;

      await source.wait();
      await source.process('');

      await new Promise((resolve) => {
        source.pipe(through(
          (b) => ok(results.shift().equals(b), 'should be equal'),
          resolve,
        ));
      });
    }

    done();
  });

  it('should add verbose messages to output', async(done) => {
    done();
  });

  it('should be possible to add verbose messages to all respones from git', async(done) => {
    done();
  });
});

describe('UploadStream', () => {
  it('should understand valid requests to git-upload-pack service', async(done) => {
    // Random
    const input = intoStream([
      '0032want 0a53e9ddeaddad63ad106860237bbf53411d11a7\n',
      '0032want d049f6c27a2244e12041955e262a404c7faba355\n',
      '0032have 441b40d833fdfa93eb2908e52742248faf0ee993\n',
      '0032have 2cb58b79488a98d2721cea644875a8dd0026b115\n',
      '0000',
    ]) as Readable;

    const source = create_source({
      Pack: UploadPack,
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
  const results = [
    // tslint:disable-next-line
    '00760a53e9ddeaddad63ad106860237bbf53411d11a7 441b40d833fdfa93eb2908e52742248faf0ee993 refs/heads/maint\0 report-status\n',
    '0000',
    '\nPACK....',
  ];

  it('should understand valid requests to git-receive-pack service', async(done) => {
    const input = intoStream(results) as Readable;

    const source = create_source({
      Pack: ReceivePack,
      has_input: true,
    });

    input.pipe(source);

    ok(source, 'should now have a source');

    await source.wait();

    expect(source.metadata.ref.path).toBe('refs/heads/maint');
    expect(source.metadata.ref.name).toBe('maint');
    expect(source.metadata.ref.type).toBe('heads');
    expect(source.metadata.old_commit).toBe('0a53e9ddeaddad63ad106860237bbf53411d11a7');
    expect(source.metadata.new_commit).toBe('441b40d833fdfa93eb2908e52742248faf0ee993');
    expect(source.metadata.capabilities).toMatchObject(['report-status']);

    done();
  });

  it('should pipe all data, both parsed and unparsed', async(done) => {
    const input = intoStream(results) as Readable;

    const r = results.map((s) => Buffer.from(s));
    const throughput = through(
      (b) => ok(r.shift().equals(b), 'should be equal'),
      done,
    );

    const source = create_source({
      Pack: ReceivePack,
      has_input: true,
      input: throughput,
    });

    input.pipe(source);

    ok(source, 'should now have a source');

    await source.wait();

    await source.process('');
  });
});

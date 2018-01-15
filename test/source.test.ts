// from packages
import { ok } from 'assert';
import { spawn } from 'child_process';
import { appendFile, exists, mkdir, rmdir } from "fs";
import * as intoStream from 'into-stream';
import { join, resolve } from 'path';
import { Readable, Writable } from 'stream';
import { directory } from 'tempy';
import * as through from 'through';
import { promisify } from 'util';
// from libraries
import { GitBasePack, GitCommand, Headers, ReceivePack, UploadPack } from '../src/source';

interface CreateSourceOptions {
  command?: GitCommand;
  input?: Writable;
  output?: Readable;
  messages?: Iterable<string> | IterableIterator<string>;
  has_input: boolean;
  Pack: typeof GitBasePack | typeof UploadPack | typeof ReceivePack;
}

function create_source({command, input, output, messages, has_input, Pack}: CreateSourceOptions) {
  if (!command) {
    if (!(output && output.readable)) {
      output = through();
    }

    if (!(input && input.writable)) {
      input = through();
    }

    const stderr = through();

    command = (c, r, a) => ({stdout: output, stdin: input, stderr});
  }

  const source = new Pack({
    command,
    has_input,
  });

  // Append verbose messages
  if (messages) {
    source.verbose(messages);
  }

  return source;
}

describe('GitStream', () => {
  it('should advertise when no input is supplied', async(done) => {
    const test_buffer = Buffer.from('test buffer');

    // Test both services
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

      // @ts-ignore
      source.service = service;

      await source.process_input();
      await source.accept('');

      await new Promise((next) => {
        source.pipe(through(
          (b) => ok(results.shift().equals(b), 'should be equal'),
          next,
        ));
      });
    }

    done();
  });

  it('should be able to check if given repo is a valid one.', async(done) => {
    const source = create_source({
      Pack: GitBasePack,
      command: (r, c, a = []) => spawn('git', [c, ...a, '.'], {cwd: r}),
      has_input: false,
    });

    await source.wait();

    // Create temp folder
    const repos = directory();

    // Test case 1: Non repo
    const test1 = resolve(repos, 'test1');

    await promisify(mkdir)(test1);

    ok(!await source.exists(test1), 'should not exist');

    // Test case 2: Non-init. repo
    const test2 = resolve(repos, 'test2');

    await create_repo(test2);

    ok(await source.exists(test2), 'should exist');

    // Test case 3: Init. repo
    const test3 = resolve(repos, 'test3');

    await create_bare_repo(test3);

    ok(await source.exists(test3), 'should exist, though no log');

    done();
  }, 10000);

  it('should be able to add verbose messages to output', async(done) => {
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

    await source.process_input();

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

    await source.process_input();

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

    await source.process_input();

    await source.accept('');
  });
});

describe('match', () => {
  it('should provide basic info for request', async(done) => {
    done();
  });
});

async function create_bare_repo(path: string) {
  // Create directory
  await promisify(mkdir)(path);

  // Init bare repo
  await new Promise((done, reject) => {
    const {stderr} = spawn('git', ['init', '--bare'], {cwd: path});

    stderr.once('data', (chunk) => {
      stderr.removeListener('end', done);
      reject(chunk.toString());
    });

    stderr.once('end', done);
  });
}

async function create_repo(path: string) {
  // Create directory
  await promisify(mkdir)(path);

  // Init normal repo
  await new Promise((done, reject) => {
    const {stderr} = spawn('git', ['init'], {cwd: path});

    stderr.once('data', (chunk) => {
      stderr.removeListener('end', done);
      reject(chunk.toString());
    });

    stderr.once('end', done);
  });

  // Create an empty README.md
  await promisify(appendFile)(join(path, 'README.md'), '');

  // Add files
  await new Promise((done, reject) => {
    const {stderr} = spawn('git', ['add', '.'], {cwd: path});

    stderr.once('data', (chunk) => {
      stderr.removeListener('end', done);
      reject(chunk.toString());
    });

    stderr.once('end', done);
  });

  // Commit
  await new Promise((done, reject) => {
    const {stderr} = spawn('git', ['commit', '-m', 'Initial commit'], {cwd: path});

    stderr.once('data', (chunk) => {
      stderr.removeListener('end', done);
      reject(chunk.toString());
    });

    stderr.once('end', done);
  });
}

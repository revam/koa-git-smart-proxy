// from packages
import * as encode from 'git-side-band-message';
import { Duplex, Readable, Writable } from 'stream';
import * as through from 'through';
import { promisify } from 'util';
// from library
import { GitSmartProxy, ServiceType } from '.';

const zero_buffer = new Buffer('0000');

const matches = {
  'receive-pack': {
    fields: ['last_commit', 'commit', 'refname'],
    match: /([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/(?:heads|tags)\/[^ \u0000]+)(?: |00|\u0000)|^(?:0000)$/,
  },
  'upload-pack': {
    fields: ['commit'],
    match: /^\S+ ([0-9a-f]{40})/,
  },
};

// Hardcoded headers
const headers = {
  'receive-pack': Buffer.from('001f# service=git-receive-pack\n0000'),
  'upload-pack': Buffer.from('001e# service=git-upload-pack\n0000'),
};

export const SymbolSource = Symbol('source stream');

export const SymbolVerbose = Symbol('verbose stream');

export interface GitCommandResult {
  output: Readable;
  input: Writable;
}

export type GitCommand = (commmand: string, repo_path: string, args: string[]) =>
  GitCommandResult | Promise<GitCommandResult>;

export interface GitStreamOptions {
  has_info: boolean;
  command: GitCommand;
}

export class GitStream extends Duplex {
  public readonly metadata: {[key: string]: string} = {};
  public readonly service: 'upload-pack' | 'receive-pack';
  public readonly hasInfo: boolean;

  // @ts-ignore suppress error [1166]
  private [SymbolSource]: SourceDuplex;
  // @ts-ignore suppress error [1166]
  private [SymbolVerbose]?: WritableBand;
  private __needs_flush = false;
  private __command: GitCommand;
  private __ready: number | false = false;
  protected __next?: (err?: Error) => void;
  protected __buffer?: Buffer;

  constructor(options: GitStreamOptions) {
    super();

    this.hasInfo = options.has_info;
    this.__command = options.command;

    this.once('parsed', () => {
      const source = this[SymbolSource] = new Duplex() as SourceDuplex;

      source._write = (buffer: Buffer, encoding, next) => {
        // compare last 4 bytes to terminate signal (0000)
        if (buffer.length && buffer.slice(buffer.length - 4).equals(zero_buffer)) {
          this.__needs_flush = true;
        } else {
          this.__needs_flush = false;
          this.push(buffer);
        }

        if (this.__ready) {
          next();
        } else {
          source.__next = next;
        }
      };

      source._read = (size) => {
        const buffer = this.__buffer;
        const next = this.__next;

        if (buffer) {
          delete this.__buffer;
          source.push(buffer);
        }

        if (next) {
          delete this.__next;
          next();
        }
      };

      source.on('error', (err) => this.emit('error', err));

      const verbose = this[SymbolVerbose];
      const flush = async() => {
        if (verbose && verbose.writable) {
          // Stop writing
          await promisify(verbose.end)();

          verbose._write = function _write(buf, enc, next) {
              this.push(encode(buf));
              next();
          };

          verbose.on('finish', flush);

          const buffer = verbose.__buffer;
          const resume = verbose.__next;

          if (buffer) {
            delete verbose.__buffer;
            this.push(encode(buffer));
          }

          if (resume) {
            delete verbose.__next;
            resume();
          }

          return;
        } else if (this.__needs_flush) {
          this.push('0000');
        }

        this.push(null);
      };

      source.on('finish', flush);

      if (this.hasInfo) {
        this.push(headers[this.service]);
      }

      if (this.__ready) {
        source._read(this.__ready);
      }
    });

    if (this.hasInfo) {
      this.writable = false;
      this.emit('parsed');
    }
  }

  public verbose(messages: Iterable<string | Buffer> | IterableIterator<string | Buffer>) {
    if (!this[SymbolVerbose]) {
      const band = this[SymbolVerbose] = new Writable() as WritableBand;

      band._write = function write(buffer, encoding, next) {
        band.__buffer = buffer;
        band.__next = next;
      };
    }

    const verbose = this[SymbolVerbose];

    if (verbose.writable) {
      for (const message of messages) {
        verbose.write(message);
      }
    }
  }

  public _read(size) {
    const source = this[SymbolSource];

    if (source && source.__next) {
        this.__ready = false;

        const next = source.__next;
        delete source.__next;

        next();
    } else {
      this.__ready = size;
    }
  }

  public wait() {
    return new Promise<void>((resolve) => {
      if (this[SymbolSource]) {
        return resolve();
      }

      this.once('parsed', resolve);
    });
  }

  public async process(repository: string) {
    const args = ['--stateless-rpc'];

    if (this.hasInfo) {
      args.push('--advertise-refs');
    }

    const source = this[SymbolSource];
    const {output, input} = await this.__command(this.service, repository, args);

    output.on('error', (err) => this.emit('error', err));
    input.on('error', (err) => this.emit('error', err));

    output.pipe(source).pipe(input);
  }
}

export class UploadStream extends GitStream {
  public readonly service = 'upload-pack';

  constructor(options?: GitStreamOptions) {
    super(options);
  }

  public _write(buffer, enc, next) {
    if (this[SymbolSource]) {
      this.__next = next;
      this[SymbolSource].push(buffer);

      return;
    }

    if (this.__buffer) {
      buffer = Buffer.concat([this.__buffer, buffer]);
    }

    // TODO: Read each pkt-line, and add every 'want' and 'have' to metadata.
  }
}

export class ReceiveStream extends GitStream {
  public readonly service = 'receive-pack';

  constructor(options?: GitStreamOptions) {
    super(options);
  }

  public _write(buffer, enc, next) {
    if (this[SymbolSource]) {
      this.__next = next;
      this[SymbolSource].push(buffer);

      return;
    }

    if (this.__buffer) {
      buffer = Buffer.concat([this.__buffer, buffer]);
    }

    // TODO: Read each pkt-line till we reach terminal signal (0000). Add metadata.
  }
}

// // Set service name
// function service_name (input: string) {
//   const size = (4 + input.length).toString(16);
//   let message = '0'.repeat(4 - size.length) + size + input;
//   message += '0000';
//   return message;
// }

interface SourceDuplex extends Duplex {
  __next?(err?: Error): void;
  __buffer?: Buffer;
}

interface WritableBand extends Writable {
  __next?(err?: Error): void;
  __buffer?: Buffer;
}

function read_pkt_line(buffer: Buffer): string | false {
  const marker = buffer.slice(0, 1).toString('utf8') === '00';
  const length = parseInt(buffer.slice(2, 3).toString('utf8'), 16);

  console.log(marker, length);

  return;
}

export function pkt_line (input: string) {
  const size = (4 + input.length).toString(16);
  return '0'.repeat(4 - size.length) + size + input;
}

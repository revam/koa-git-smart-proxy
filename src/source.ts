// from packages
import * as encode from 'git-side-band-message';
import { Duplex, Readable, Writable } from 'stream';
import * as through from 'through';
import { promisify } from 'util';
// from library
import { GitSmartProxy, ServiceType } from '.';
import { pkt_length } from './helpers';

const zero_buffer = new Buffer('0000');

const matches = {
  'receive-pack': /^[0-9a-f]{4}([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/([^\/]+)\/(.*?))(?:\n?$|\u0000([^\n]*)\n?$)/,
  'upload-pack':  /^[0-9a-f]{4}(want|have) ([0-9a-f]{40})\n?$/,
};

// Hardcoded headers
const headers = {
  'receive-pack': Buffer.from('001f# service=git-receive-pack\n0000'),
  'upload-pack': Buffer.from('001e# service=git-upload-pack\n0000'),
};

export const SymbolSource = Symbol('source stream');

export const SymbolVerbose = Symbol('verbose stream');

export interface GitMetadata {
  want?: string[];
  have?: string[];
  reftype?: string;
  refname?: string;
  ref?: string;
  old_commit?: string;
  new_commit?: string;
  capabilities?: string[];
}

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
  public readonly metadata: GitMetadata = {};
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
  protected __buffers?: Buffer[] = [];

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
          this.push(buffer.slice(0, -4));
        // We wern't finished, so append signal and continue.
        } else if (this.__needs_flush) {
          this.__needs_flush = false;
          this.push(zero_buffer);
          this.push(buffer);
        } else {
          this.push(buffer);
        }

        if (this.__ready) {
          next();
        } else {
          source.__next = next;
        }
      };

      source._read = (size) => {
        if (this.__buffers) {
          for (const buffer of this.__buffers) {
            source.push(buffer);
          }

          delete this.__buffers;
        }

        const next = this.__next;
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

  public async _write(buffer, enc, next) {
    if (this[SymbolSource]) {
      this.__next = next;
      this[SymbolSource].push(buffer);

      return;
    }

    // Stack buffers till fully parsed
    this.__buffers.push(buffer);

    const length = pkt_length(buffer);

    // Parse till we reach specal signal (0000) or unrecognisable data.
    if (length <= 0) {
      this.__next = next;
      this.emit('parsed');
    } else {
      const message = buffer.toString('utf8');
      const results = matches[this.service].exec(message);

      if (results) {
        const type = results[1];

        if (!(type in this.metadata)) {
          this.metadata[type] = [];
        }

        this.metadata[type].push(results[2]);
      }

      next();
    }
  }
}

export class ReceiveStream extends GitStream {
  public readonly service = 'receive-pack';

  constructor(options?: GitStreamOptions) {
    super(options);
  }

  public async _write(buffer, enc, next) {
    if (this[SymbolSource]) {
      this.__next = next;
      this[SymbolSource].push(buffer);

      return;
    }

    // Stack buffers till fully parsed
    this.__buffers.push(buffer);

    const length = pkt_length(buffer);

    // Parse till we reach specal signal (0000) or unrecognisable data.
    if (length <= 0) {
      this.__next = next;
      this.emit('parsed');
    } else {
      const message = buffer.toString('utf8');
      const results = matches[this.service].exec(message);

      if (results) {
        let type = results[4];

        if (type.endsWith('s')) {
          type = type.slice(0, -1);
        }

        this.metadata.old_commit = results[1];
        this.metadata.new_commit = results[2];
        this.metadata.ref = results[3];
        this.metadata.reftype = type;
        this.metadata.refname = results[5];
        this.metadata.capabilities = results[6] ? results[6].trim().split(' ') : [];
      }

      next();
    }
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

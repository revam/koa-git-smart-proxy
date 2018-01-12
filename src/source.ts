// from packages
import * as encode from 'git-side-band-message';
import { Duplex, Readable, Writable } from 'stream';
import { promisify } from 'util';
// from library
import { GitSmartProxy, ServiceType } from '.';
import { pkt_length } from './helpers';

const zero_buffer = new Buffer('0000');

const matches = {
  'receive-pack': /^[0-9a-f]{4}([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/([^\/]+?)s?\/(.*?))(?:\u0000([^\n]*)?\n?$)/,
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
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

export type GitCommand = (repo_path: string, commmand: string, command_args: string[]) =>
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
              this.push(buf);
              next();
          };

          verbose.on('finish', flush);

          const buffer = verbose.__buffer;
          const resume = verbose.__next;

          if (buffer) {
            delete verbose.__buffer;
            this.push(buffer);
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
      this.on('finish', () => source.push(null));

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
        verbose.write(encode(message));
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
    const {stdout, stdin} = await this.__command(repository, this.service, args);

    stdout.on('error', (err) => this.emit('error', err));
    stdin.on('error', (err) => this.emit('error', err));

    stdout.pipe(source).pipe(stdin);
  }

  public exists(repository: string) {
    return new Promise<boolean>(async(resolve) => {
      let exists = true;

      const {stdout} = await this.__command(repository, this.service, ['--advertise-refs']);

      stdout.once('error', (err) => exists = false);
      stdout.once('data', (chunk) =>
        (exists && (exists = 'fatal' !== chunk.slice(0, 4).toString())));
      stdout.once('end', () => resolve(exists));
      stdout.resume();
    });
  }
}

export class UploadStream extends GitStream {
  public readonly service = 'upload-pack';

  public async _write(buffer, enc, next) {
    if (this[SymbolSource]) {
      this.__next = next;
      this[SymbolSource].push(buffer);

      return;
    }

    // Stack buffers till fully parsed
    this.__buffers.push(buffer);

    // Buffer is pre-divided to correct length
    const length = pkt_length(buffer);

    // Parse till we reach specal signal (0000) or unrecognisable data.
    if (length > 0) {
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
    } else {
      this.__next = next;
      this.emit('parsed');
    }
  }
}

export class ReceiveStream extends GitStream {
  public readonly service = 'receive-pack';

  public async _write(buffer, enc, next) {
    if (this[SymbolSource]) {
      this.__next = next;
      this[SymbolSource].push(buffer);

      return;
    }

    // Stack buffers till fully parsed
    this.__buffers.push(buffer);

    // Buffer is pre-divided to correct length
    const length = pkt_length(buffer);

    // Parse till we reach specal signal (0000) or unrecognisable data.
    if (length > 0) {
      const message = buffer.toString('utf8');
      const results = matches[this.service].exec(message);

      if (results) {
        this.metadata.old_commit = results[1];
        this.metadata.new_commit = results[2];
        this.metadata.ref = results[3];
        this.metadata.reftype = results[4];
        this.metadata.refname = results[5];
        this.metadata.capabilities = results[6] ? results[6].trim().split(' ') : [];
      }

      next();
    } else {
      this.__next = next;
      this.emit('parsed');
    }
  }
}

interface SourceDuplex extends Duplex {
  __next?(err?: Error): void;
  __buffer?: Buffer;
}

interface WritableBand extends Writable {
  __next?(err?: Error): void;
  __buffer?: Buffer;
}

// from packages
import * as encode from 'git-side-band-message';
import { Duplex, Readable, Transform, Writable } from 'stream';
import { promisify } from 'util';

const zero_buffer = new Buffer('0000');

const matches = {
  'receive-pack': /^[0-9a-f]{4}([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/([^\/]+)\/(.*?))(?:\u0000([^\n]*)?\n?$)/,
  'upload-pack':  /^[0-9a-f]{4}(want|have) ([0-9a-f]{40})\n?$/,
};

// Hardcoded headers
export const Headers = {
  'receive-pack': Buffer.from('001f# service=git-receive-pack\n0000'),
  'upload-pack': Buffer.from('001e# service=git-upload-pack\n0000'),
};

export const SymbolSource = Symbol('source stream');

export const SymbolVerbose = Symbol('verbose stream');

export interface GitMetadata {
  want?: string[];
  have?: string[];
  ref?: {
    name: string;
    path: string;
    type: string;
  };
  old_commit?: string;
  new_commit?: string;
  capabilities?: string[];
}

export interface GitCommandResult {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

export type GitCommand = (repository: string, commmand: string, args?: string[]) =>
  GitCommandResult | Promise<GitCommandResult>;

export interface GitStreamOptions {
  has_input: boolean;
  command: GitCommand;
}

export class GitBasePack extends Duplex {
  public readonly metadata: GitMetadata = {};
  public readonly service: 'upload-pack' | 'receive-pack';

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

      if (!options.has_input) {
        this.push(Headers[this.service]);
      }

      if (this.__ready) {
        source._read(this.__ready);
      }
    });

    if (!options.has_input) {
      this.writable = false;
      setImmediate(() => this.emit('parsed'));
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

    if (!this.writable) {
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

export class UploadPack extends GitBasePack {
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

export class ReceivePack extends GitBasePack {
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
        this.metadata.ref = {
          name: results[5],
          path: results[3],
          type: results[4],
        };
        this.metadata.capabilities = results[6] ? results[6].trim().split(' ') : [];
      }

      next();
    } else {
      this.__next = next;
      this.emit('parsed');
    }
  }
}

export class Seperator extends Transform {
  private underflow?: Buffer;

  public async _transform(buffer: Buffer, encoding, next) {
    // Start where previous stopped
    if (this.underflow) {
      buffer = Buffer.concat([this.underflow, buffer]);
      this.underflow = undefined;
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
        this.underflow = buffer.slice(offset);
        break;
      }

      if (length >= 4) {
        this.push(buffer.slice(offset, length));
      } else {
        this.push(buffer.slice(offset));
      }

      // Wait till next tick so we can do other stuff inbetween.
      await new Promise<void>((resolve) => process.nextTick(resolve));
    } while (length !== -1);

    // We got a data overflow, so append extra data
    if (!this.underflow && offset < buffer.length) {
      this.push(buffer.slice(offset));
    }

    next();
  }
}

function pkt_length(buffer: Buffer, offset: number = 0) {
  try {
    return Number.parseInt(buffer.slice(offset, 4).toString('utf8'), 16);
  } catch (err) {
    return -1;
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

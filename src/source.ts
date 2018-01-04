// from packages
import * as encode from 'git-side-band-message';
import { Duplex } from 'stream';
import * as through from 'through';
// from library
import { GitProxy, RPCCommand, ServiceType, SymbolSource } from '.';

const zero_buffer = new Buffer('0000');
const services = {
  'receive-pack': {
    fields: ['last_commit', 'commit', 'refname'],
    match: /([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/(?:heads|tags)\/[^ \u0000]+)(?: |00|\u0000)|^(?:0000)$/,
  },
  'upload-pack': {
    fields: ['commit'],
    match: /^\S+ ([0-9a-f]{40})/,
  },
};

interface SourceDuplex extends Duplex {
  __next?(err?: Error): void;
  __buffer?: Buffer;
}

export const SymbolProxy = Symbol('proxy');

export interface GitDuplexDuplexOptions {
  proxy: GitProxy;
  command: RPCCommand;
  service: 'receive-pack' | 'upload-pack';
}

export class GitSourceDuplex extends Duplex {
  public refname?: string;
  public commit?: string;
  public last_commit?: string;
  public readonly service: 'receive-pack' | 'upload-pack';

  // @ts-ignore suppress error [1166]
  private [SymbolProxy]: GitProxy;
  // @ts-ignore suppress error [1166]
  private [SymbolSource]: SourceDuplex;
  private __needs_flush = false;
  private __command: RPCCommand;
  private __ready: number | false = false;
  private __parsed = false;
  private __next?: (err?: Error) => void;
  private __buffer?: Buffer;

  constructor(options: GitDuplexDuplexOptions) {
    super();

    this[SymbolProxy] = options.proxy;
    this.__command = options.command;
    this.service = options.service;

    this.once('parsed', () => {
      const source = this[SymbolSource] = new Duplex() as SourceDuplex;

      source._write = (buffer: Buffer, encoding, next) => {
        // dont send terminate signal
        if (buffer.length && buffer.equals(zero_buffer)) {
          this.__needs_flush = true;
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

      const bands = this[SymbolProxy].bands;
      const flush = () => {
        if (bands.length) {
          const band = bands.shift();

          band._write = function _write(buf, enc, next) {
              this.push(encode(buf));
              next();
          };

          band.on('finish', flush);

          const buffer = band.__buffer;
          const done = band.__next;

          if (buffer) {
            delete band.__buffer;
            this.push(encode(buffer));
          }
          if (done) {
            delete band.__next;
            done();
          }

          return;
        } else if (this.__needs_flush) {
          this.push(zero_buffer);
        }

        this.push(null);
      };

      source.on('finish', flush);

      if (this.hasInfo) {
        this.push(pack(`# service=git-${this.service}\n`));
        this.push(zero_buffer);
      } else if (this.__ready) {
        // @ts-ignore
        source._read();
      }
    });

    if (this.hasInfo) {
      this.__parsed = true;
      this.emit('parsed');
    }
  }

  get hasInfo() {
    return this[SymbolProxy].service === ServiceType.REFS;
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

    const {match, fields} = services[this.service];
    const body = buffer.slice(0, 512).toString('utf8');
    const results = match.exec(body);
    if (results) {
      this.__buffer = buffer;
      this.__next = next;

      for (const field of fields) {
        this[field] = results.shift();
      }

      this.__parsed = true;

      this.emit('parsed');
    } else if (buffer.length >= 512) {
      this.emit('parsed');
    } else {
      this.__buffer = buffer;

      next();
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
      if (this.__parsed) {
        return resolve();
      }

      this.once('parsed', resolve);
    });
  }

  public async attach(repo_path: string) {
    const args = ['--stateless-rpc'];

    if (this.hasInfo) {
      args.push('--advertise-refs');
    }

    const source = this[SymbolSource];
    const {output, input} = await this.__command(this.service, repo_path, args);

    output.on('error', (err) => this.emit('error', err));
    input.on('error', (err) => this.emit('error', err));

    output.
    // Split at line-feed
    pipe(through(function write(buffer: Buffer) {
      let last;
      let position = -1;
      do {
        last = position + 1;
        position = buffer.indexOf(10, last);

        // Don't slice buffers ending with line-feed
        if (position === buffer.length - 1) {
          this.queue(buffer);
          break;
        }

        if (position + 1) {
          // Slice till line-feed
          const new_buffer = buffer.slice(last, position + 1);
          this.queue(new_buffer);
        } else {
          // Slice remaining
          const new_buffer = buffer.slice(last);
          this.queue(new_buffer);
        }
      } while (position !== -1 && last !== position);
    })).
    pipe(source).
    pipe(input);

    return this;
  }
}

function pack (input: string) {
  const size = (4 + input.length).toString(16);
  return '0'.repeat(4 - size.length) + size + input;
}

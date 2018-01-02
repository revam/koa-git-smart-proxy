// from packages
import { spawn } from 'child_process';
import { exists } from 'fs';
import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
import * as HttpCodes from 'http-status';
import * as send from 'koa-send';
import { resolve } from 'path';
import * as through from 'through';
import { promisify } from 'util';
import { Context, Middleware } from 'koa'; // tslint:disable-line
import { Readable, Writable } from 'stream';
import { createGunzip } from 'zlib';
// from library
import { GitSourceDuplex } from './lib/source';

export enum ServiceType {
  UNKNOWN,
  PULL,
  PUSH,
  TAG,
  REFS,
  HEAD,
  ALTERNATES,
  PACKS,
  INFO,
  OBJECT,
  PACK,
  INDEX,
}

export enum AcceptStatus {
  PENDING,
  ACCEPTED,
  REJECTED,
}

const post_types = new Set([ServiceType.PUSH, ServiceType.PULL]);
const valid_services = new Set<string>(['upload-pack', 'receive-pack']);

const Matches = new Map<ServiceType, MatchEntry>([
  [ServiceType.PULL, {
    content_type: 'application/x-git-upload-pack-result',
    match: /^\/?(.*?)\/git-upload-pack$/,
  }],
  [ServiceType.PUSH, {
    content_type: 'application/x-git-receive-pack-result',
    match: /^\/?(.*?)\/git-receive-pack$/,
  }],
  [ServiceType.REFS, {
    content_type: 'application/x-git-%s-advertisement',
    match: /^\/?(.*?)\/info\/refs$/,
  }],
  [ServiceType.HEAD, {
    match: /^\/?(.*?)\/HEAD$/,
  }],
  [ServiceType.ALTERNATES, {
    match: /^\/?(.*?)\/objects\/info\/(?:http-)?alternates$/,
  }],
  [ServiceType.PACKS, {
    content_type: 'text/plain; charset=utf-8"',
    match: /^\/?(.*?)\/objects\/info\/packs$/,
  }],
  [ServiceType.INFO, {
    match: /^\/?(.*?)\/objects\/info\/[^/]*?$/,
  }],
  [ServiceType.OBJECT, {
    cache: true,
    content_type: 'application/x-git-loose-object',
    match: /^\/?(.*?)\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/,
  }],
  [ServiceType.PACK, {
    cache: true,
    content_type: 'application/x-git-packed-objects',
    match: /^\/?(.*?)\/objects\/pack\/pack-[0-9a-f]{40}\.pack$/,
  }],
  [ServiceType.INDEX, {
    cache: true,
    content_type: 'application/x-git-packed-objects-toc',
    match: /^\/?(.*?)\/objects\/pack\/pack-[0-9a-f]{40}\.idx$/,
  }],
]);

interface MatchEntry {
  match: RegExp;
  content_type?: string;
  cache?: boolean;
}

export const SymbolSource = Symbol('source');

export interface WritableBand extends Writable {
  __next?(err?: Error): void;
  __buffer?: Buffer;
}

export interface RPCResult {
  output: Readable;
  input: Writable;
}

export type RPCCommand = (commmand: string, repo_path: string, args: string[]) =>
  RPCResult | Promise<RPCResult>;

export interface ResourceResult {
  headers: OutgoingHttpHeaders;
  body: Readable;
}

export type ResourceCommand = (file_path: string, repo_path: string, headers: IncomingHttpHeaders) =>
  ResourceResult | Promise<ResourceResult>;

export interface GitProxyOptions {
  context: Context;
  rpc_command: RPCCommand;
  res_command: ResourceCommand;
}

export interface GitExecutableOptions {
  /**
   * Exectubale path.
   * Ignored if both `rpc` and `resource` is set.
   * Defaults to `'git'`.
   */
  executable_path?: string;
  /**
   * Local root folder to look for repositories.
   * Ignored if both `rpc` and `resource` is set.
   * Defaults to `process.cwd`.
   */
  root_folder?: string;
}

export interface GitCommandOptions {
  /**
   * Git stream command
   */
  rpc: RPCCommand;
  /**
   *
   */
  resource: ResourceCommand;
}

export interface MiddlewareOptions {
  /**
   * Can either be a string to the local root folder, an object with options.
   */
  git?: GitExecutableOptions | GitCommandOptions;

  /**
   * Where to store proxy in `Context.state`. Defaults to `'proxy'`.
   */
  key_name?: string;
  /**
   * If set, then automatically accepts/rejects request if no action has been taken.
   */
  auto_deploy?: boolean;
}

export class GitProxy {
  public repository: string;
  public readonly bands: WritableBand[] = [];
  public last_commit?: string;
  public commit?: string;
  public refname?: string;

  // @ts-ignore suppress error [1166]
  private [SymbolSource]?: GitSourceDuplex;
  private __context: Context;
  private __command?: ResourceCommand;
  private __file?: string;
  private __service: ServiceType;
  private __status: AcceptStatus = AcceptStatus.PENDING;

  constructor(options: GitProxyOptions) {
    this.__context = options.context;

    const {type = ServiceType.UNKNOWN, path = '', repository = ''} = this.match() || {};

    this.__service = type;
    this.repository = repository;

    if (this.service === ServiceType.UNKNOWN) {
      return this;
    }

    const refs = this.service === ServiceType.REFS;
    if (refs || post_types.has(this.service)) {
      const ctx = this.__context;
      const service = get_service(refs ? ctx.query.service : path);

      if (!service) {
        this.__service = ServiceType.UNKNOWN;

        return this;
      }

      if (!refs && this.__context.get('content-type') !== `application/x-git-${service}-request`) {
        this.__service = ServiceType.UNKNOWN;

        return this;
      }

      this[SymbolSource] = new GitSourceDuplex({
        command: options.rpc_command,
        proxy: this,
        service,
      });

      if (!refs) {
        let pipe: Readable = ctx.req;

        if ('gzip' === ctx.get('content-encoding')) {
          pipe = pipe.pipe(createGunzip());
        }

        pipe.pipe(this[SymbolSource]);
      }
    } else {
      this.__file = path;
      this.__command = options.res_command;
    }
  }

  get service() {
    return this.__service;
  }

  get status() {
    return this.__status;
  }

  public async wait() {
    // Wait for source
    const source = this[SymbolSource];
    if (source) {
      await source.wait();

      // Halt when no commit
      if (!(source.hasInfo || source.commit)) {
        this.__service = ServiceType.UNKNOWN;

        return;
      }

      // Switch to tag
      if (this.service === ServiceType.PUSH && source.refname.includes('/tags/')) {
        this.__service = ServiceType.TAG;
      }

      // Attach parsed info
      this.commit = source.commit;
      this.last_commit = source.last_commit;
      this.refname = source.refname;
    }
  }

  public async accept(): Promise<void>;
  public async accept(repo_path: string): Promise<void>;
  public async accept(repo_path?: string) {
    if (this.status !== AcceptStatus.PENDING) {
      return;
    }

    this.__status = AcceptStatus.ACCEPTED;

    if (!repo_path) {
      repo_path = this.repository;
    }

    // Abort on unkown type
    if (this.service === ServiceType.UNKNOWN) {
      return;
    }

    const source = this[SymbolSource];
    const ctx = this.__context;

    // Transport data from source
    if (source) {
      ctx.status = 200;

      this.set_headers();

      await source.attach(repo_path);

      ctx.body = source;

      return;
    }

    try {
      const {headers, body} = await this.__command(this.__file, repo_path, ctx.headers);

      for (const header of Reflect.ownKeys(headers) as string[]) {
        ctx.set(header, headers[header] as string | string[]);
      }

      this.set_headers();

      ctx.body = body;
    } catch (err) {
      ctx.status = err.status || HttpCodes.INTERNAL_SERVER_ERROR;

      ctx.throw(err.status, err.message);
    }
  }

  public async reject(): Promise<void>;
  public async reject(reason: string): Promise<void>;
  public async reject(status: number): Promise<void>;
  public async reject(status: number, reason: string): Promise<void>;
  public async reject(ar1?, ar2?): Promise<void> {
    if (this.status !== AcceptStatus.PENDING) {
      return;
    }

    this.__status = AcceptStatus.REJECTED;

    let reason: string;
    let status: number;
    if ('string' === typeof ar2) {
      reason = ar1;
      status = ar1;
    } else if ('number' === typeof ar1) {
      reason = HttpCodes[ar1];
      status = ar1;
    } else {
      reason = HttpCodes[HttpCodes.BAD_REQUEST];
      status = HttpCodes.BAD_REQUEST;
    }

    this.set_cache_options(false);

    if (!(status || reason)) {
      return;
    }

    const ctx = this.__context;

    ctx.set('content-type', 'text/plain');
    ctx.status = status;
    ctx.body = reason;
  }

  public create_band(): WritableBand {
    const band = new Writable() as WritableBand;

    band._write = (buffer, encoding, next) => {
      band.__buffer = buffer;
      band.__next = next;
    };

    this.bands.push(band);

    return band;
  }

  private match(): {type?: ServiceType; path?: string; repository: string} {
    const ctx = this.__context;

    for (const [type, {match}] of Matches) {
      const results = match.exec(ctx.path);

      if (results) {
        const method = post_types.has(type) ? 'POST' : 'GET';

        if (method !== ctx.method) {
          return;
        }

        // Remove the leading part (with tailing slash)
        const path = ctx.path.slice(results[1].length + 1);

        return {type, path, repository: results[1]};
      }
    }
  }

  private set_headers() {
    const match = Matches.get(this.service);
    let content_type = match.content_type || 'text/plain';

    if (this.service === ServiceType.REFS) {
      content_type = content_type.replace('%s', this[SymbolSource].service);
    }

    this.set_cache_options(match.cache);
    this.__context.set('content-type', content_type);
  }

  private set_cache_options(cache: boolean) {
    const ctx = this.__context;

    if (cache) {
      const now = new Date();
      const date = now.toUTCString();
      const expires = new Date(now.valueOf() + 31536000).toUTCString();
      this.__context.set('date', date);
      this.__context.set('expires', expires);
      this.__context.set('cache-control', 'public, max-age=31536000');
    } else {
      this.__context.set('expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
      this.__context.set('pragma', 'no-cache');
      this.__context.set('cache-control', 'no-cache, max-age=0, must-revalidate');
    }
  }

  public static async create(options: GitProxyOptions) {
    const service = new GitProxy(options);

    // Wait till ready
    if (service.service !== ServiceType.UNKNOWN) {
      await service.wait();
    }

    return service;
  }

  public static middleware(options: MiddlewareOptions = {}): Middleware {
    const {key_name = 'proxy', auto_deploy} = options;

    let rpc_command: RPCCommand;
    let res_command: ResourceCommand;
    if ('object' === typeof options.git &&
      'function' === typeof (options.git as GitCommandOptions).rpc &&
      'function' === typeof (options.git as GitCommandOptions).resource
    ) {
        rpc_command = (options.git as GitCommandOptions).rpc;
        res_command = (options.git as GitCommandOptions).resource;
    } else {
      let runtime: string;
      let root_folder: string;
      if ('object' === typeof options.git) {
        const git = options.git as GitExecutableOptions;
        runtime = git.executable_path || 'git';
        root_folder = git.root_folder || process.cwd();
      }

      runtime = runtime || 'git';
      root_folder = root_folder || process.cwd();

      rpc_command = (c, r, a) => {
        const f = resolve(root_folder, r);

        const ps = spawn(runtime, [c, ...a, f]);

        return {output: ps.stdout, input: ps.stdin};
      };
      // Get headers and body from koa-send
      res_command = (f, r, h) => {
        const headers: OutgoingHttpHeaders = {};
        const fake_context = {
          body: undefined,
          throw(code: number, reason: string) {
            const err = new Error(reason) as any;
            err.status = code;

            throw err;
          },
          acceptsEncodings(...encodings: string[]) {
            return false;
          },
          res: {
            removeHeader(header: string) {
              if (Reflect.has(headers, header)) {
                delete headers[header];
              }
            },
          },
          response: {
            get(header: string) {
              return headers[header];
            },
          },
          set(header: string, value: string) {
            headers[header] = value;
          },
          set type(value: string) {
            this.set('Content-Type', value);
          },
        };

        try {
          // @ts-ignore
          await send(fake_context, path, {root: root_folder});

          return {headers, body: fake_context.body};
        } catch (err) {
          if (!err.status) {
            err.status = HttpCodes.INTERNAL_SERVER_ERROR;
          }

          throw err;
        }
      };
    }

    return async(context, next) => {
      // @ts-ignore Were mixing two incomparable types
      const proxy = context.state[key_name] = await GitProxy.create({
        context,
        res_command,
        rpc_command,
      });

      await next();

      if (undefined !== auto_deploy && proxy.status === AcceptStatus.PENDING) {
        return auto_deploy ? proxy.accept() : proxy.reject();
      }
    };
  }
}

function get_service(input: string): 'receive-pack' | 'upload-pack' {
  if (!(input && input.startsWith('git-'))) {
    return;
  }

  const service = input.slice(4);

  if (valid_services.has(service)) {
    // @ts-ignore
    return service;
  }
}

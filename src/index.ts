// from packages
import { spawn } from 'child_process';
import { exists } from 'fs';
import { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
import * as HttpCodes from 'http-status';
import { resolve } from 'path';
import { promisify } from 'util';
import { Context, Middleware } from 'koa'; // tslint:disable-line
import { Readable, Writable } from 'stream';
import { createGunzip } from 'zlib';
// from library
import { GitCommand, GitMetadata, ReceivePack, Seperator, UploadPack } from './source';

// See https://github.com/git/git/blob/master/Documentation/technical/http-protocol.txt

export { GitCommand, GitCommandResult, GitMetadata } from './source';

export const SymbolSource = Symbol('source');

export enum ServiceType {
  UNKNOWN,
  INFO,
  PULL,
  PUSH,
}

export enum RequestStatus {
  PENDING,
  ACCEPTED,
  REJECTED,
}

const post_types = new Set([ServiceType.PUSH, ServiceType.PULL]);
const valid_services = new Set<string>(['upload-pack', 'receive-pack']);
const match_array = new Map<ServiceType, [string, RegExp]>([
  [ServiceType.PULL, ['application/x-git-upload-pack-result', /^\/?(.*?)\/git-upload-pack$/]],
  [ServiceType.PUSH, ['application/x-git-receive-pack-result', /^\/?(.*?)\/git-receive-pack$/]],
  [ServiceType.INFO, ['application/x-git-%s-advertisement', /^\/?(.*?)\/info\/refs$/]],
]);

export class GitSmartProxy {
  public repository: string;
  public metadata: GitMetadata;

  // @ts-ignore suppress error [1166]
  private [SymbolSource]?: ReceivePack | UploadPack;
  private __context: Context;
  private __service: ServiceType;
  private __status: RequestStatus = RequestStatus.PENDING;
  private __content_type: string;

  constructor(context: Context, command: GitCommand) {
    this.__context = context;

    const {type, repository, service, content_type} = this.match();

    this.repository = repository;
    this.__service = type;
    this.__content_type = content_type;

    if (this.__service === ServiceType.UNKNOWN) {
      return this;
    }

    const has_input = this.service !== ServiceType.INFO;

    this[SymbolSource] = service === 'upload-pack'
    // Upload pack
    ? new UploadPack({
        command,
        has_input,
      })
    // Receive pack
    : new ReceivePack({
        command,
        has_input,
      });

    // We have a request body to pipe
    if (has_input) {
      let pipe: Readable = context.req;

      pipe.on('error', (err) => context.throw(err));

      if ('gzip' === context.get('content-encoding')) {
        pipe = pipe.
          pipe(createGunzip()).
          on('error', (err) => context.throw(err));
      }

      // Split chunck into packets
      pipe = pipe.
        pipe(new Seperator()).
        on('error', (err) => context.throw(err)).
        pipe(this[SymbolSource]).
        on('error', (err) => context.throw(err));
    }
  }

  get service() {
    return this.__service;
  }

  get status() {
    return this.__status;
  }

  public async accept(): Promise<void>;
  public async accept(repo_path: string): Promise<void>;
  public async accept(repo_path?: string) {
    if (this.status !== RequestStatus.PENDING) {
      return;
    }

    this.__status = RequestStatus.ACCEPTED;

    // Abort on unkown type
    if (this.service === ServiceType.UNKNOWN) {
      return;
    }

    if (!repo_path) {
      repo_path = this.repository;
    }

    const source = this[SymbolSource];

    await source.process(repo_path);

    const ctx = this.__context;

    this.set_cache_options();
    ctx.type = this.__content_type;
    ctx.status = HttpCodes.OK;
    ctx.body = source;
  }

  public async reject(): Promise<void>;
  public async reject(reason: string, status?: number): Promise<void>;
  public async reject(status: number, reason?: string): Promise<void>;
  public async reject(ar1?, ar2?): Promise<void> {
    if (this.status !== RequestStatus.PENDING) {
      return;
    }

    this.__status = RequestStatus.REJECTED;

    let reason: string;
    let status: number;
    if ('string' === typeof ar1) {
      reason = ar1;
      if ('number' === typeof ar2) {
        status = ar2;
      }
    } else if ('number' === typeof ar1) {
      status = ar1;
      if ('string' === typeof ar2) {
        reason = ar2;
      }
      reason = HttpCodes[ar1];
    }

    if (!status) {
      status = HttpCodes.FORBIDDEN;
    }

    if (!reason) {
      reason = HttpCodes[status];
    }

    const ctx = this.__context;

    this.set_cache_options();
    ctx.type = 'text/plain';
    ctx.status = status;
    ctx.body = reason;
  }

  public verbose(...messages: Array<string | Buffer>) {
    this[SymbolSource].verbose(messages);
  }

  private match(): MatchResult {
    const ctx = this.__context;

    const ref_type = ServiceType.INFO;
    for (let [type, [content_type, match]] of match_array) {
      const results = match.exec(ctx.path);

      if (results) {
        const isInfo = ref_type === type;

        const method = isInfo ? 'GET' : 'POST';

        // Invlaid method
        if (method !== ctx.method) {
          break;
        }

        const service = get_service(isInfo
        ? ctx.query.service
        : ctx.path.slice(results[1].length + 1),
        );

        // Invalid service
        if (!service) {
          break;
        }

        // Invalid post request
        if (!isInfo && ctx.get('content-type') !== `application/x-git-${service}-request`) {
          break;
        }

        if (isInfo) {
          content_type = content_type.replace('%s', service);
        }

        return {
          content_type,
          repository: results[1],
          service,
          type,
        };
      }
    }

    return {type: ServiceType.UNKNOWN};
  }

  private set_cache_options() {
    this.__context.set('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
    this.__context.set('Pragma', 'no-cache');
    this.__context.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  }

  private async wait() {
    const source = this[SymbolSource];

    // Wait for source
    await source.wait();

    // Set metadata
    this.metadata = source.metadata;
  }

  public static async create(context: Context, command: GitCommand) {
    const service = new GitSmartProxy(context, command);

    // Wait till ready
    if (service.service !== ServiceType.UNKNOWN) {
      await service.wait();
    }

    return service;
  }

  public static middleware(options: MiddlewareOptions = {}): Middleware {
    const {key_name = 'proxy', auto_deploy} = options;

    let command: GitCommand;
    if ('function' === typeof options.git) {
      command = options.git;
    } else {
      let runtime = 'git';
      let root_folder: string;
      if ('object' === typeof options.git) {
        if (options.git.executable_path) {
          runtime = options.git.executable_path;
        }

        root_folder = resolve(options.git.root_folder || '');
      } else if ('string' === typeof options.git) {
        root_folder = resolve(options.git);
      } else {
        root_folder = process.cwd();
      }

      command = (repo_path, cmd, args) => {
        const full_path = resolve(root_folder, repo_path);

        return spawn(runtime, [cmd, ...args, full_path], {
          cwd: full_path,
        });
      };
    }

    return async(context, next) => {
      // Add proxy to context
      const proxy = context.state[key_name] = await GitSmartProxy.create(context, command);

      await next();

      // If auto_deploy is defined and request is still pending -> deploy
      if (undefined !== auto_deploy && proxy.status === RequestStatus.PENDING) {
        // No repository -> Not found
        if (!(await proxy.exists())) {
          return proxy.reject(HttpCodes.NOT_FOUND);
        }

        // Unknown service -> Forbidden (default for protocol, see link at top)
        if (proxy.service !== ServiceType.UNKNOWN) {
          return proxy.reject();
        }

        // Accept or reject
        return auto_deploy ? proxy.accept() : proxy.reject();
      }
    };
  }
}

export function middleware(options?: MiddlewareOptions) {
  return GitSmartProxy.middleware(options);
}

export interface GitProxyOptions {
  context: Context;
  command: GitCommand;
}

export interface MiddlewareOptions {
  /**
   * Can either be a string to the local root folder, an object with options.
   */
  git?: string | GitCommand | {
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
  };

  /**
   * Where to store proxy in `Context.state`. Defaults to `'proxy'`.
   */
  key_name?: string;
  /**
   * If set, then automatically accepts/rejects request if no action has been taken.
   */
  auto_deploy?: boolean;
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

interface MatchResult {
  content_type?: string;
  repository?: string;
  service?: 'upload-pack' | 'receive-pack';
  type: ServiceType;
}

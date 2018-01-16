import { spawn } from 'child_process';
import {
  exists,
  GitBasePack,
  GitCommand,
  GitCommandResult,
  GitMetadata,
  match,
  ReceivePack,
  RequestStatus,
  Seperator,
  ServiceType,
} from 'git-smart-proxy-core';
import * as HttpCodes from 'http-status';
import { Context, Middleware } from 'koa';
import { resolve } from 'path';
import { Readable, Writable } from 'stream';
import { promisify } from 'util';
import { createGunzip } from 'zlib';

// See https://github.com/git/git/blob/master/Documentation/technical/http-protocol.txt

export {
  GitCommand,
  GitCommandResult,
  GitMetadata,
  ServiceType,
  RequestStatus,
} from 'git-smart-proxy-core';

export const SymbolSource = Symbol('source');

export class GitSmartProxy {
  public repository?: string;
  public metadata: GitMetadata;

  // @ts-ignore suppress error [1166]
  private [SymbolSource]?: GitBasePack;
  private __command: GitCommand;
  private __context: Context;
  private __service: ServiceType;
  private __status: RequestStatus;
  private __content_type: string;

  constructor(context: Context, command: GitCommand) {
    const {content_type, service, repository, source} = match({
      command,
      content_type: context.get('content-type'),
      method: context.method,
      path: context.path,
      service: context.query.service,
    });

    this.repository = repository;
    this.__command = command;
    this.__content_type = content_type;
    this.__context = context;
    this.__service = service;
    this.__status = RequestStatus.PENDING;

    if (this.__service === ServiceType.UNKNOWN) {
      return this;
    }

    this[SymbolSource] = source;

    // We have a request body to pipe
    if (source.has_input) {
      let pipe: Readable = context.req;

      pipe.on('error', (err) => context.throw(err));

      if ('gzip' === context.get('content-encoding')) {
        pipe = pipe.
          pipe(createGunzip()).
          on('error', (err) => context.throw(err));
      }

      pipe = pipe.
        // Split chunck into packets
        pipe(new Seperator()).
        on('error', (err) => context.throw(err)).
        // Process input
        pipe(source).
        on('error', (err) => context.throw(err));
    }
  }

  public get service() {
    return this.__service;
  }

  public get status() {
    return this.__status;
  }

  public async accept(): Promise<void>;
  public async accept(alternative_path: string): Promise<void>;
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
      if (!this.repository) {
        return;
      }

      repo_path = this.repository;
    }

    const source = this[SymbolSource];

    await source.accept(repo_path);

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

  public async exists(): Promise<boolean>;
  public async exists(alternative_path: string): Promise<boolean>;
  public async exists(repo_path?: string): Promise<boolean> {
    if (!repo_path) {
      if (!this.repository) {
        return false;
      }

      repo_path = this.repository;
    }

    return exists(this.__command, repo_path);
  }

  public verbose(...messages: Array<string | Buffer>) {
    this[SymbolSource].verbose(messages);
  }

  private set_cache_options() {
    this.__context.set('Expires', 'Fri, 01 Jan 1980 00:00:00 GMT');
    this.__context.set('Pragma', 'no-cache');
    this.__context.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  }

  public static async create(context: Context, command: GitCommand) {
    const service = new GitSmartProxy(context, command);

    // Wait for source and set metadata
    if (service.service !== ServiceType.UNKNOWN) {
      const source = service[SymbolSource];

      await source.process_input();

      service.metadata = source.metadata;
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

      command = (repo_path, cmd, args = []) => {
        const full_path = resolve(root_folder, repo_path);

        return spawn(runtime, [cmd, ...args, '.'], {
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

export function create(context: Context, command: GitCommand) {
  return GitSmartProxy.create(context, command);
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

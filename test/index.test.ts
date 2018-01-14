// tslint:disable no-implicit-dependencies

// from packages
import { ok } from 'assert';
import * as intoStream from 'into-stream';
import * as koa from 'koa';
import { Readable, Writable } from 'stream';
import * as through from 'through';
// from libraries
import { GitCommand, middleware } from '../src';

interface CreateMiddlewareOptions {
  command?: GitCommand;
  input?: Writable;
  output?: Readable;
}

function create_middleware({command, input, output}: CreateMiddlewareOptions = {}) {
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

  return middleware({
    git: command,
  });
}

describe('GitSmartProxy', () => {
  it('should be possible to ', async(done) => {
    done();
  });

  describe('middleware', () => {
    it('should bind to koa', async(done) => {
      const app = new koa();

      app.use(create_middleware());

      done();
    });
  });
});

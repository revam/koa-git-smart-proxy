// tslint:disable no-implicit-dependencies

// from packages
import { ok } from 'assert';
import * as intoStream from 'into-stream';
import * as koa from 'koa';
import { Readable, Writable } from 'stream';
import * as through from 'through';
// from libraries
import { middleware } from '../src';

interface CreateMiddlewareOptions {
  input?: Writable;
  output?: Readable;
}

function create_middleware({input, output}: CreateMiddlewareOptions = {}) {
  if (!(output && output.readable)) {
    output = through();
  }

  if (!(input && input.writable)) {
    input = through();
  }

  return middleware({
    git(repo, cmd, args) {
      return {stdin: input, stdout: output};
    },
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

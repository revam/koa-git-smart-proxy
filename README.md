# koa-git-smart-proxy

A proxy library for custom git deploy logic made for koa.

**Note:** The api is currently not fully tested and may be unstable. Working on tests.

## Install

```sh
npm install --save koa-git-smart-proxy
```

## Why?

Looking at existing git deployment libraries for node, not many have good compatibility with [koa](https://www.npmjs.com/package/koa).So instead of creating a compatibility layer for my
application, I created a new library made for [koa](https://www.npmjs.com/package/koa).
All core functinality now lives in a [seperate package](https://www.npmjs.com/package/git-smart-proxy-core).

I took insparation from existing packages for node;
[pushover](https://github.com/substack/pushover),
[git-http-backend](https://github.com/substack/git-http-backend),
gems for ruby;
[grack](https://github.com/schacon/grack)
and the
[http protocol documentation for git](https://github.com/git/git/blob/master/Documentation/technical/http-protocol.txt).

## API

### **create(** context, command **)** (function) (export)

*Note:* You can also use the static class method `GitSmartProxy.middleware`.

Create a new GitSmartProxy instance, and wait till it's ready.
Return a promise for the instance.

#### Parameters

- `context`
  \<[koa.Context](#Context)>
  Koa context.

- `command`
  \<[GitCommand](#GitCommand)>
  Git RPC handler.

#### Returns

- \<[Promise](#GitSmartProxy)>
  A promise that resolves to a new instance of [`GitSmartProxy`](#GitSmartProxy).

### See also

- [GitSmartProxy.create](#GitSmartProxy.create)

#### Usage example

Bare usage.

```js
const { spawn } = require('child_process');
const { createServer } = require('http');
const koa =  require('koa');
const { create, ServiceType } = require('koa-git-smart-proxy');
const { resolve } = require('path');

function command(repo_path, command, args = []) {
  const full_path = resolve(r);

  return spawn('git', [command, ...args, '.'], {
    cwd: full_path,
  });
}

const app = new koa;

app.use(async(ctx) => {
  const service = await create(ctx, command);

  // Not found
  if (!await service.exists()) {
    return service.reject(404);
  }

  // Forbidden
  if (service.service === ServiceType.UNKNOWN) {
    return service.reject();
  }

  return service.accept();
});

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

### **middleware(** [options] **)** (function) (export)

*Note:* You can also use the static class method `GitSmartProxy.middleware`.

Creates a middleware attaching a new instance to context.

#### Parameters

- `options`
  \<[MiddlewareOptions](#MiddlewareOptions)>
  Middleware options.

#### Returns

- \<[Function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)>
  A koa middleware function.

### See also

- [GitSmartProxy.middleware](#GitSmartProxyMiddleware)

#### Usage examples

Bare usage (with auto deploy).

```js
const { createServer } = require('http');
const koa =  require('koa');
const { middleware } = require('koa-git-smart-proxy');

const {
  GIT_ROOT_FOLDER: root_folder = '/data/repos',
} = process.env;

const app = new koa;

app.use(middleware({
  auto_deploy: true,
  git: root_folder,
}));

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

Bare usage (without auto deploy).

```js
const { createServer } = require('http');
const koa =  require('koa');
const { middleware } = require('koa-git-smart-proxy');

const {
  GIT_ROOT_FOLDER: root_folder = '/data/repos',
} = process.env;

const app = new koa;

app.use(middleware({
  git: root_folder,
}));

app.use(async(ctx) => {
  const {proxy} = ctx.state;

  // Not found
  if (!await proxy.exists()) {
    return proxy.reject(404);
  }

  // Forbidden
  if (proxy.service === ServiceType.UNKNOWN) {
    return proxy.reject();
  }

  return proxy.accept();
});

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

### **GitSmartProxy** (class) (export)

*Note:* When creating new instances, use static method [create](#GitSmartProxy.create).

#### Public properties

- `service`
  \<[ServiceType](#ServiceType)>
  Service type.
  Read-only.

- `status`
  \<[RequestStatus](#RequestStatus)>
  Request status.
  Read-only.

- `metadata`
  \<[GitMetadata](#GitMetadata)>
  Request metadata.

- `repository`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Repoistory name/path.

#### Public static methods

- [create](#create)

- [middleware](#middleware)

#### Public instance methods

- [accept](#accept)

- [reject](#reject)

- [exists](#exists)

- [verbose](#verbose)

### **GitSmartProxy.create(** context, command **)** (static method)

*Note:* You can also use the exported `create` function.

Create a new GitSmartProxy instance, and wait till it's ready.
Return a promise for the instance.

#### Parameters

- `context`
  \<[koa.Context](#Context)>
  Koa context.

- `command`
  \<[GitCommand](#GitCommand)>
  Git RPC handler.

#### Returns

- \<[Promise](#GitSmartProxy)>
  A promise that resolves to a new instance of [`GitSmartProxy`](#GitSmartProxy).

#### See also

- [create](#create)

#### Usage example

Bare usage.

```js
const { spawn } = require('child_process');
const { createServer } = require('http');
const koa =  require('koa');
const { GitSmartProxy, ServiceType } = require('koa-git-smart-proxy');
const { resolve } = require('path');

function command(repo_path, command, args = []) {
  const full_path = resolve(r);

  return spawn('git', [command, ...args, '.'], {
    cwd: full_path,
  });
}

const app = new koa;

app.use(async(ctx) => {
  const service = await GitSmartProxy.create(ctx, command);

  // Not found
  if (!await service.exists()) {
    return service.reject(404);
  }

  // Forbidden
  if (service.service === ServiceType.UNKNOWN) {
    return service.reject();
  }

  return service.accept();
});

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

### **GitSmartProxy.middleware(** [options] **)** (static method)

*Note:* You can also use the exported `middleware` function.

Creates a middleware attaching a new instance to context.

#### Parameters

- `options`
  \<[MiddlewareOptions](#MiddlewareOptions)>
  Middleware options.

#### Returns

- \<[Function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)>
  A koa middleware function.

#### See also

- [middleware](#middlware)

#### Usage examples

Bare usage (with auto deploy).

```js
const { createServer } = require('http');
const koa =  require('koa');
const { GitSmartProxy } = require('koa-git-smart-proxy');

const {
  GIT_ROOT_FOLDER: root_folder = '/data/repos',
} = process.env;

const app = new koa;

app.use(GitSmartProxy.middleware({
  auto_deploy: true,
  git: root_folder,
}));

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

Bare usage (without auto deploy).

```js
const { createServer } = require('http');
const koa =  require('koa');
const { GitSmartProxy } = require('koa-git-smart-proxy');

const app = new koa;

app.use(GitSmartProxy.middleware({
  git: root_folder,
}));

app.use(async(ctx) => {
  const {proxy} = ctx.state;

  // Not found
  if (!await proxy.exists()) {
    return proxy.reject(404);
  }

  // Forbidden
  if (proxy.service === ServiceType.UNKNOWN) {
    return proxy.reject();
  }

  return proxy.accept();
});

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

### **GitSmartProxy#accept(** [alternative_path] **)** (instance method)

Accept the request for provided service.

#### Parameters

- `alternative_path`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Optional alternative path where repository is stored.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#reject(** [status,] [reason] **)** (instance method)

Reject request to service. Optionally supplied with status code and reason.

#### Parameters

- `status`
  \<[Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)>
  HTTP Status code to set for response.
  Defaults to `403`.

- `reason`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Rejection reason.
  Defaults to text for status code.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#reject(** reason, [status] **)** (instance method)

Reject request to service. Supplied with a reason and optionally a status code.

#### Parameters

- `reason`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Rejection reason.

- `status`
  \<[Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)>
  HTTP Status code to set for response.
  Defaults to `403`.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#exists( [alternative_path] )** (instance method)

Checks if repository exists.

#### Parameters

- \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Optional alternative path where repository is stored.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  A promise that resolves to a boolean for whether or not repository exists.

### **GitSmartProxy#verbose(** ...messages **)** (instance method)

Side-loades verbose messages to client.

#### Parameters

- `messages`
  \<[Array\<String>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)>
  \<[Iterable\<String>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)> |
  \<[IterableIterator\<String>](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols)>
  Messages to side-load.

### **ServiceType** (enum) (export)

Service types with values.

#### Values

- `UNKNOWN` (0)
  Unknown service.

- `INFO` (1)
  Advertise refs.

- `PULL` (2)
  All forms of data fetch.

- `PUSH` (3)
  All forms of data push.
  (Including setting tags)

### **RequestStatus** (enum) (export)

Request stauts with values.

#### Values

- `PENDING` (0)
  Request is still pending.

- `ACCEPTED` (1)
  Request was accepted.

- `REJECTED` (2)
  Request was rejected.

### **GitMetadata** (interface) (typescript only export)

Request metadata. Only available for pull/push services.

### Properties

- `want`
  \<[Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)>
  An array containing what the client want.
  Pull only.

- `have`
  \<[Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)>
  An array containing what the client have.
  Pull only.

- `ref`
  \<[Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)>
  Push only.

  - `path`
    \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
    Full reference path.

  - `name`
    \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
    Reference name

  - `type`
    \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
    Reference type.

- `old_commit`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Old commit.
  Push only.

- `new_commit`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  New commit
  Push only.

- `capebilities`
  \<[Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)>
  An array containing the capebilities client want/have.

### **MiddlewareOptions** (interface) (typescript only export)

Middleware options.

#### Properties

- `git`
  \<[string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)> |
  \<[GitExecutableOptions](#GitExecutableOptions)> |
  \<[GitCommand](#GitCommand)>
  Can either be a string to the local root folder, a custom handler or an options object.
  Defaults to `process.cwd()`.

- `auto_deploy`
  \<[Boolean](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean)>
  Auto deployment accepts or rejects a request if no action is taken further down the middleware chain.
  No default.

- `key_name`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Where to store instance in `Context.state`.
  Defaults to `'proxy'`.

### **GitCommand** (type) (typescript only export)

A function returning stdin/stdout of a spawned git process.

#### Parameters

- `repository`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Repository name.

- `command`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Git command to execute.

- `command_args`
  \<[Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)>
  An array of arguments to pass to git instance.

#### Returns

- \<[GitCommandResult](#GitCommandResult)>
  An object containing stdin/stdout.

### **GitCommandResult** (interface) (typescript only export)

An object containing stdin/stdout of a git process.

#### Properties

- `stdin`
  \<[Writable](https://nodejs.org/dist/latest/docs/api/stream.html#stream_class_stream_writable)>
  Process standard input.

- `stdout`
  \<[Readable](https://nodejs.org/dist/latest/docs/api/stream.html#stream_class_stream_readable)>
  Process standard output.

- `stderr`
  \<[Readable](https://nodejs.org/dist/latest/docs/api/stream.html#stream_class_stream_readable)>
  Process error output.

### **GitExecutableOptions** (interface) (typescript only export)

Options for customizing the default [GitCommand](#GitCommand).

#### Properties

- `executable_path`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  A path to the git executable.
  Defaults to `'git'`.

- `root_folder`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  A path leading to the projects root folder. Will be resolved.
  Defaults to `process.cwd()`.

## Specialized Usage

### Custom authentication/authorization example

In the below example, we statelessly authenticate with HTTP Basic Authenticatoin
and check if both repo exist and service is available for user (or guest).

```js
const koa = require('koa');
const passport = require('koa-passport');
const HttpStatus = ('http-status');
const { match } = require('koa-match');
const { middleware, ServiceType } = require('koa-git-smart-proxy');
const Models = require('./models');

// Get repository root folder
const {
  REPOS_ROOT_FOLDER: root_folder = '/data/repos',
} = process.env;

// Create app
const app = new koa;

// Git services (Info, pull & push)
app.use(match({
  path: ':username/:repository.git/:path(.*)?',
  handlers: [
    // Authenticate client
    passport.initialize(),
    passport.authenticate('basic'),

    // Get repository
    async(ctx, next) => {
      const {username, repository} = ctx.params;

      const repo = await Models.Repository.findByOwnerAndName(username, repository);

      if (repo) {
        ctx.state.repo = repo;
      }

      return next();
    },

    // Attach proxy
    middleware({git: {root_folder} }),

    // Validation
    async(ctx) => {
      const {proxy, repo, user} = ctx.state;
      const {username, repository, path} = ctx.params;

      // Redirect
      if (!path) {
        return ctx.redirect('back', `/${username}/${repository}/`);
      }

      // Not found
      if (!repo) {
        return proxy.reject(HttpStatus.NOT_FOUND);
      }

      // Unknown service
      if (proxy.service === ServiceType.UNKNOWN) {
        return proxy.reject();
      }

      // Unautrorized access
      if (!await repo.checkService(proxy.service, user)) {
        ctx.set('www-authenticate', `Basic`);
        return proxy.reject(HttpStatus.UNAUTHORIZED);
      }

      // Repos are stored differently than url structure.
      const repo_path = repo.get_path();

      // #accept can be supplied with an absolute path
      // or a path relative to root_folder.
      return proxy.accept(repo_path);
    }
  ]
}));

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

## Typescript

This module includes a [TypeScript](https://www.typescriptlang.org/)
declaration file to enable auto complete in compatible editors and type
information for TypeScript projects. This module depends on the Node.js
types, so install `@types/node`:

```sh
npm install --save-dev @types/node
```

## License

MIT

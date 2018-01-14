# koa-git-smart-proxy

A proxy library for custom git deploy logic made for koa.

## Install

```sh
npm install --save koa-git-smart-proxy
```

## Why?

Looking at existing git deployment libraries for node, not many have good compatibility with [koa](https://www.npmjs.com/package/koa). So instead of creating a compatibility layer for my application, I created a new library made just for [koa](https://www.npmjs.com/package/koa).

I took insparation from existing packages for node;
[pushover](https://github.com/substack/pushover),
[git-http-backend](https://github.com/substack/git-http-backend),
gems for ruby;
[grack](https://github.com/schacon/grack)
and the
[http protocol documentation for git](https://github.com/git/git/blob/master/Documentation/technical/http-protocol.txt).

## Usage

### Basic usage (without auto-deployment)

```js

const koa = require('koa');
const HttpStatus = ('http-status');
const { middleware, ServiceType } = require('koa-git-smart-proxy');

// Path to git executable
const executable_path = 'git';
// Repositories root folder
const root_folder = process.env.GIT_ROOT;

// Create app
const app = new koa;

// Attach proxy
app.use(middleware({
  git: root_folder,
}));

// Git services
app.use(ctx => {
  const {proxy} = ctx.state;

  // Not found
  if (!proxy.repository) {
    return proxy.reject(HttpStatus.NOT_FOUND);
  }

  // Forbidden
  if (proxy.service=!== ServiceType.UNKNOWN) {
    return proxy.reject(HttpStatus.FORBIDDEN);
  }

  // Accept
  return proxy.accept();
});

```

### Auto-deployment

Auto deployment accepts or rejects a request if no action is taken further down the middleware chain. The option is **off by default**.

Set the `auto_deploy` option to `true` to accept, or `false` to reject not handled requests. It also has a default reject logic independent of the flag value, and works simular to the below code.

```js
// Not found
if (!proxy.repository) {
  return proxy.reject(404);
}

// Forbidden
if (proxy.service !== ServiceType.UNKNOWN) {
  return proxy.reject(403);
}

// Accept/Reject
return auto_deploy? proxy.accept() : proxy.reject();
```

So if you set `auto_deploy` to `true`, you can shrink the basic example down to:

```js
const koa = require('koa');
const { middleware } = require('koa-git-smart-proxy');

// Repositories root folder
const root_folder = process.env.GIT_ROOT;

// Create app
const app = new koa;

// Attach proxy and respond to requests
app.use(middleware({git: root_folder, auto_deploy: true}));
```

### Custom authentication/authorization example

You got a user system where you want to restrict some services?
In the below example, we authenticate with HTTP Basic Authenticatoin and
check if both repo exist and service is available for user (or non-user).

```js
const koa = require('koa');
const passport = require('koa-passport');
const HttpStatus = ('http-status');
const { match } = require('koa-match');
const { middleware, ServiceType } = require('koa-git-smart-proxy');
const Models = require('./models');

// Get root folder
const root_folder = process.env.GIT_ROOT;

// Create app
const app = new koa;

/* ... some more logic ... */

// Git services
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
        return proxy.reject(HttpStatus.FORBIDDEN);
      }

      // Unautrorized access
      if (!await repo.checkService(proxy.service, user)) {
        ctx.set('www-authenticate', `Basic`);
        return proxy.reject(HttpStatus.UNAUTHORIZED);
      }

      // Repos are stored differently than url structure.
      const repo_path = await repo.get_path();

      // #accept can be supplied with an absolute path
      // or a path relative to root_folder.
      return proxy.accept(repo_path);
    }
  ]
}));

/* ... maybe some more logic? ... */
```

### Custom git handler

We only need a connection to stdin and stdout from the git process. How you spawn is up to you.

```js
const custom_command = function git_input_output(repository, command, command_arguments) {
  let output; // Readable stream
  let input; // Writable stream

  /* some magical logic to set input/output */

  return {output, input};
}

app.use(middleware({
  git: custom_command,
}));
```

## API

### **middleware(** [options] **)** (function) (export)

*Note:* You can also use the exported `GitSmartProxy.middleware` static class method.

Creates a middleware attaching a new instance to context.

#### Parameters

- `options`
  \<[MiddlewareOptions](#MiddlewareOptions)>
  Middleware options.

#### Returns

- \<[Function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function)>
  A koa middleware function.

#### Usage examples

Bare usage.

```js
const { createServer } = require('http');
const koa =  require('koa');
const { middleware } = require('koa-git-smart-proxy');

const app = new koa;

app.use(middleware({auto_deploy: true}));

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

### **GitSmartProxy** (class) (export)

*Note:* It is adviced against using the `new` keyword when creating new instances.
Instead use [create](#GitSmartProxy.create).

#### Constructor parameters

- `context`
  \<[koa.Context](#Context)>
  Koa context.

- `command`
  \<[GitCommand](#GitCommand)>
  Git RPC handler.

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

- `create`

- `middleware`

#### Public instance methods

- `accept`

- `reject`

- `exists`

- `verbose`

### **GitSmartProxy.create(** context, command **)** (static method)

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

#### Usage example

Bare usage.

```js
const { spawn } = require('child_process');
const { exists } = require('fs');
const { createServer } = require('http');
const koa =  require('koa');
const { GitSmartProxy, ServiceType } = require('koa-git-smart-proxy');
const { resolve } = require('path');
const { promisify } = require('util');

const command = (r, c, ar) => spawn('git', [c, ...ar, resolve(r)], {cwd: resolve(r)});

const app = new koa;

app.use(async(ctx) => {
  const service = await GitSmartProxy.create(ctx, command);

  // Not found
  if (!(await service.exists())) {
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

- [Usage](#Usage)

- [GitSmartProxy.create](#GitSmartProxy.create)

- [middleware](#middlware)

#### Usage examples

Bare usage.

```js
const { createServer } = require('http');
const koa =  require('koa');
const { GitSmartProxy } = require('koa-git-smart-proxy');

const app = new koa;

app.use(GitSmartProxy.middleware({auto_deploy: true}));

const server = createServer(app.callback());

server.listen(3000, () => console.log('listening on port 3000'));
```

### **GitSmartProxy#accept(** [alternative_path] **)** (instance method)

Accept the request for provided service.

#### Parameters

- `alternative_path`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Alternative path where repository is stored.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#reject()** (instance method)

Reject request to service. Can be optionally supplied with a status code and/or reason.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#reject(** [status,] [reason] **)** (instance method)

Reject request to service. Supplied with a status code and an optional reason.

#### Parameters

- `status`
  \<[Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)>
  HTTP Status code to set for response.

- `reason`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Rejection reason.
  Defaults to text for status code.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#reject(** reason, [status] **)** (instance method)

Reject request to service. Supplied with a reason and an optional status code.

#### Parameters

- `reason`
  \<[String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String)>
  Rejection reason.
  Defaults to text for status code.

- `status`
  \<[Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)>
  HTTP Status code to set for response.

#### Returns

- \<[Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)>
  An empty promise that resolves when processing is done.

### **GitSmartProxy#exists()** (instance method)

Checks if repository exists.

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

### **GitCommand()** (interface) (typescript only export)

A function returning stdin/stdout of a spawned git process.

#### Parameters

- `repository`

- `command`

- `command_args`

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

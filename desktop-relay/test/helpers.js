const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

class MockRequest extends PassThrough {
  constructor({ method = 'GET', url = '/', headers = {} } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
  }
}

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.ended = false;
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    Object.assign(this.headers, headers);
  }

  write(chunk) {
    if (chunk !== undefined) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
    }
    return true;
  }

  end(chunk) {
    if (chunk !== undefined) this.write(chunk);
    this.ended = true;
    this.emit('finish');
    return this;
  }

  body() {
    return this.chunks.join('');
  }
}

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.stdinWrites = [];
    this.killed = false;
    this.stdin.on('data', chunk => {
      this.stdinWrites.push(chunk.toString());
    });
  }

  kill() {
    this.killed = true;
  }
}

function silentLogger() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
}

async function invokeHandler(handler, { method, url, headers = {}, body } = {}) {
  const req = new MockRequest({ method, url, headers });
  const res = new MockResponse();
  const pending = Promise.resolve(handler(req, res));

  if (body !== undefined) {
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  } else {
    req.end();
  }

  await pending;
  await flush();
  return { req, res };
}

module.exports = {
  FakeChildProcess,
  MockRequest,
  MockResponse,
  flush,
  invokeHandler,
  silentLogger,
};

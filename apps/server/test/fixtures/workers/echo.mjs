// A thread for the pool tests. It answers `{ op: 'echo' }` with the parameters, `sleep` after
// `params.ms`, `spin` never, `alloc` by filling memory until the limit ends the thread, `crash`
// with an uncaught error, `env` with the names of the environment variables it can see.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', async ({ id, op, params }) => {
  const done = (result) => parentPort.postMessage({ id, ok: true, result });
  switch (op) {
    case 'echo':
      done(params);
      break;
    case 'sleep':
      await new Promise((resolve) => setTimeout(resolve, params.ms));
      done({ slept: params.ms });
      break;
    case 'spin':
      for (;;) {
        // never ends
      }
    case 'alloc': {
      const keep = [];
      for (;;) keep.push(new Array(100_000).fill(Math.random()));
    }
    case 'crash':
      setTimeout(() => {
        throw new Error('boom');
      }, 0);
      break;
    case 'fail':
      parentPort.postMessage({
        id,
        ok: false,
        failure: { status: 422, code: 'unprocessable', message: 'nope' },
      });
      break;
    case 'env':
      done({ names: Object.keys(process.env) });
      break;
    default:
      done({ unknown: op });
  }
});

import { Buffer } from 'buffer';

if (typeof globalThis !== 'undefined') {
  globalThis.global = globalThis;
  globalThis.Buffer = Buffer;
}

if (typeof window !== 'undefined') {
  window.global = window;
  window.Buffer = Buffer;
}

if (typeof process === 'undefined') {
  globalThis.process = { env: {} };
}

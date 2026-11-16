/* Resilient browser file reader for URS uploads. */
(function (root) {
  'use strict';

  const MAX_BYTES = 50 * 1024 * 1024;

  function messageOf(error) {
    return error && error.message ? error.message : String(error || 'Unknown file read error');
  }

  function readWithFileReader(file) {
    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined') {
        reject(new Error('FileReader is not supported in this browser.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('FileReader could not access the selected file.'));
      reader.onabort = () => reject(new Error('Reading the selected file was cancelled.'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) resolve(reader.result);
        else reject(new Error('The browser returned unreadable file data.'));
      };
      try {
        reader.readAsArrayBuffer(file);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function readWithStream(file) {
    if (!file || typeof file.stream !== 'function') {
      throw new Error('Readable file streams are not supported for this selection.');
    }
    const reader = file.stream().getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
        total += chunk.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          throw new Error('File exceeds 50 MB.');
        }
        chunks.push(chunk);
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return joined.buffer;
  }

  async function readBytes(file) {
    if (!file) throw new Error('No file was selected.');
    const failures = [];

    if (typeof file.arrayBuffer === 'function') {
      try {
        return await file.arrayBuffer();
      } catch (error) {
        failures.push('arrayBuffer: ' + messageOf(error));
      }
    }

    try {
      return await readWithFileReader(file);
    } catch (error) {
      failures.push('FileReader: ' + messageOf(error));
    }

    try {
      return await readWithStream(file);
    } catch (error) {
      failures.push('stream: ' + messageOf(error));
    }

    const detail = failures.length ? failures.join(' | ') : 'No supported browser file reader was available.';
    throw new Error('The browser could not access this file through its available read methods. It may have been moved, removed, or made temporarily unavailable. ' + detail);
  }

  root.CSFileReader = { readBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.CSFileReader;
})(typeof window !== 'undefined' ? window : globalThis);

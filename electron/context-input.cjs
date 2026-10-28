'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {TextDecoder}=require('node:util');

const DIRECTORY = /^OpenDeepL-context-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = 'selection.txt';
const MAX_CHARS = 100000;
const MAX_BYTES = MAX_CHARS * 4;

// Consume only the one file passed by our native Services helper. Never inspect
// the general clipboard, and never recursively remove an untrusted directory.
function consumeContextTextFile(input, { temporaryRoot = os.tmpdir() } = {}) {
  if(process.platform==='win32')throw new Error('The native text Service is macOS-only.');
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0'))
    throw new Error('Invalid context text path.');
  const root = fs.realpathSync(temporaryRoot);
  const dir = path.dirname(input);
  if (!DIRECTORY.test(path.basename(dir)) || path.basename(input) !== FILE ||
      fs.realpathSync(path.dirname(dir)) !== root)
    throw new Error('Context text path is outside its private temporary directory.');
  const dirStat = fs.lstatSync(dir);
  const fileStat = fs.lstatSync(input);
  const uid = process.getuid?.();
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink() ||
      (uid !== undefined && dirStat.uid !== uid) || (dirStat.mode & 0o077) !== 0 ||
      !fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.nlink !== 1 ||
      (uid !== undefined && fileStat.uid !== uid) || (fileStat.mode & 0o077) !== 0 ||
      fileStat.size > MAX_BYTES)
    throw new Error('Context text file has unsafe ownership, permissions, or size.');
  const fd = fs.openSync(input, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let bytes;
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== fileStat.dev || opened.ino !== fileStat.ino ||
        !opened.isFile() || opened.nlink !== 1 || opened.size > MAX_BYTES)
      throw new Error('Context text file changed during opening.');
    bytes = fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text || [...text].length > MAX_CHARS)
    throw new Error('Context text is empty or too long.');
  const beforeDelete = fs.lstatSync(input);
  const dirBeforeDelete = fs.lstatSync(dir);
  if (beforeDelete.dev !== fileStat.dev || beforeDelete.ino !== fileStat.ino ||
      dirBeforeDelete.dev !== dirStat.dev || dirBeforeDelete.ino !== dirStat.ino)
    throw new Error('Context text path changed during consumption.');
  if (fs.readdirSync(dir).length !== 1)
    throw new Error('Context directory contains unexpected files.');
  fs.unlinkSync(input);
  fs.rmdirSync(dir); // Fails rather than removing unexpected neighboring files.
  return text;
}

module.exports = { consumeContextTextFile, MAX_CHARS, MAX_BYTES };

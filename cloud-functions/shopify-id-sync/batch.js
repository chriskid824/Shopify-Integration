/**
 * to be triggered locally
 */

'use strict';
const fs = require('fs');

const { runBatchFromDb } = require('./sync');


// file system

async function readFile(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, 'utf8' , (err, data) => {
      if (err)
        reject(err);
      else
        resolve(data);
    });
  });
}

async function writeFile(path, content) {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, content, err => {
      if (err) {
        console.error(err);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function createFileIfNotExists(path, content) {
  return new Promise((resolve, reject) => {
    fs.access(path, fs.F_OK, async (err) => {
      if (err) {
        // file does not exist
        await writeFile(path, content);
      }
      resolve();
    });
  })
}


// core functions

const idPath = './id.txt';
const udtPath = './udt.txt';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await createFileIfNotExists(idPath, '0');
  await createFileIfNotExists(udtPath, '0');

  let i = 0;
  while (true) {
    console.log('iteration:', ++i);
    const id = parseInt(await readFile(idPath));
    const udt = parseInt(await readFile(udtPath));
    const updatePointers = await runBatchFromDb(id, udt);
    if (updatePointers === null) {
      break;
    }
    const [newId, newUdt] = updatePointers;
    await writeFile(idPath, newId.toString());
    await writeFile(udtPath, newUdt.toString());
    await delay(100);
  }
}

main();

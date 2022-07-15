import { Console } from "node:console";
import fs from 'fs';

const output = fs.createWriteStream('./stdout.log');
const errorOutput = fs.createWriteStream('./stderr.log');
const console = new Console({ stdout: output, stderr: errorOutput, ignoreErrors: false, colorMode: true });

export { console }

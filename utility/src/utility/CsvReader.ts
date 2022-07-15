import csv from 'csvtojson/v2';

/**
 * read csv file that is incoming data
 * @returns return promise of csv file result
*/
const readFromCsv = async (path) => {
    return await csv({ delimiter: '\n' }).fromFile(path);
}

export { readFromCsv };

import fs from 'fs';

var ENABLE_CACHE = true;

const switchOffCache = () => {
    ENABLE_CACHE = false;
}

const getCache = async <T>(cb: () => Promise<T[]>, fileName: string) => {
    return new Promise<T[]>((resolve) => {
        console.warn(`Cache ${ENABLE_CACHE ? 'enabled' : 'disabled'}`);
        if (ENABLE_CACHE) {
            if (fs.existsSync(fileName)) {
                console.log('Read cache json from file cache.json');
                const data = fs.readFileSync(fileName, 'utf-8');
                resolve(JSON.parse(data) as T[]);
            }
            else {
                console.log('Get cache json from callback function and write to cache.json');
                cb().then((data) => {
                    const json = JSON.stringify(data, null, 2);
                    fs.writeFileSync(fileName, json);
                    resolve(data);
                });
            }
        }
        else {
            cb().then((data) => {
                resolve(data);
            });
        }
    });
}

export { getCache, switchOffCache }


